const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

process.env.SMEPAY_CLIENT_ID = 'test-client';
process.env.SMEPAY_CLIENT_SECRET = 'test-secret';
delete process.env.RAZORPAY_KEY_ID;
delete process.env.PAYMENT_PROVIDER;

const db = require('../src/db');
db.open(':memory:');
const app = require('../src/app');
const payments = require('../src/payments');

// A stand-in for SMEPay's Wizard API, following its documented contract.
const sme = { authCalls: 0, created: [], validations: [], status: 'PENDING', token: 'tok-1' };
let fake;
let server;
let base;

before(async () => {
  fake = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      const send = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
      const authed = req.headers.authorization === `Bearer ${sme.token}`;
      if (req.url === '/api/wiz/external/auth') {
        sme.authCalls += 1;
        if (body.client_id !== 'test-client' || body.client_secret !== 'test-secret') return send(401, { message: 'bad creds' });
        return send(200, { access_token: sme.token, token_type: 'Bearer', expires_in: 600, environment: 'test' });
      }
      if (!authed) return send(401, { message: 'token expired' });
      if (req.url === '/api/wiz/external/order/create') {
        sme.created.push(body);
        return send(200, { status: true, order_id: 'HZR1', order_slug: `slug-${sme.created.length}`, payment_status: 'CREATED' });
      }
      if (req.url === '/api/wiz/external/order/validate') {
        sme.validations.push(body);
        return send(200, { status: true, valid: sme.status === 'SUCCESS', payment_status: sme.status });
      }
      send(404, {});
    });
  });
  fake.listen(0);
  await new Promise((r) => fake.once('listening', r));
  process.env.SMEPAY_BASE_URL = `http://127.0.0.1:${fake.address().port}`;

  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); fake.close(); });

async function call(method, path, body) {
  const res = await fetch(base + path, {
    method, redirect: 'manual', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined
  });
  const isJson = (res.headers.get('content-type') || '').includes('json');
  return { status: res.status, body: isJson ? await res.json() : null, location: res.headers.get('location') };
}

const customer = {
  name: 'Asha Rao', email: 'asha@example.com', phone: '9876543210', delivery: 'campus_pickup'
};

async function placeOrder(qty = 1) {
  const tee = (await call('GET', '/api/products/hacktoberfest-2026-classic-tee')).body;
  const created = await call('POST', '/api/checkout', { ...customer, items: [{ productId: tee.id, size: 'M', qty }] });
  return { tee, created };
}

const stockOf = async (slug) => (await call('GET', `/api/products/${slug}`)).body.stock;
const until = async (fn) => { for (let i = 0; i < 50 && !(await fn()); i++) await new Promise((r) => setTimeout(r, 20)); };

test('SMEPay is used when its keys are set', async () => {
  assert.equal(payments.mode(), 'smepay');
  const cfg = await call('GET', '/api/checkout/payment-config');
  assert.equal(cfg.body.mode, 'smepay');
  assert.equal(cfg.body.testMode, true);
});

test('checkout creates a SMEPay order with the right amount, customer and callback', async () => {
  const { created } = await placeOrder(2);
  assert.equal(created.status, 201);
  assert.equal(created.body.payment.provider, 'smepay');
  assert.match(created.body.payment.slug, /^slug-\d+$/);

  const sent = sme.created.at(-1);
  assert.equal(sent.client_id, 'test-client');
  assert.equal(sent.amount, '1198.00');                     // string rupees, as SMEPay expects
  assert.equal(sent.order_id, created.body.orderId);
  assert.equal(sent.callback_url, `${base}/api/payments/smepay/callback?order=${created.body.orderId}`);
  assert.deepEqual(sent.customer_details, { email: 'asha@example.com', mobile: '9876543210', name: 'Asha Rao' });
});

test('an order is only marked paid once SMEPay confirms SUCCESS', async () => {
  const { created } = await placeOrder(1);
  const { orderId, accessToken } = created.body;
  const before = await stockOf('hacktoberfest-2026-classic-tee');

  sme.status = 'PENDING';
  const pending = await call('POST', `/api/checkout/${orderId}/verify`, { accessToken });
  assert.equal(pending.status, 400);
  assert.match(pending.body.error, /not received the payment yet/);

  sme.status = 'FAILED';
  assert.match((await call('POST', `/api/checkout/${orderId}/verify`, { accessToken })).body.error, /payment failed/);

  sme.status = 'SUCCESS';
  const paid = await call('POST', `/api/checkout/${orderId}/verify`, { accessToken });
  assert.equal(paid.status, 200);
  assert.equal(paid.body.status, 'paid');
  assert.match(paid.body.paymentId, /^smepay_slug-\d+$/);
  assert.equal(await stockOf('hacktoberfest-2026-classic-tee'), before - 1);

  const check = sme.validations.at(-1);
  assert.equal(check.amount, 599);                            // number rupees for /validate
  assert.equal(check.slug, created.body.payment.slug);
});

test('the webhook re-checks with SMEPay, so a spoofed SUCCESS does nothing', async () => {
  const { created } = await placeOrder(1);
  const { orderId, accessToken } = created.body;
  const order = async () => (await call('GET', `/api/orders/${orderId}?token=${accessToken}`)).body;

  sme.status = 'PENDING';
  const spoof = await call('POST', `/api/payments/smepay/callback?order=${orderId}`, { ref_id: orderId, status: 'SUCCESS', amount: '599.00' });
  assert.equal(spoof.status, 200);
  await new Promise((r) => setTimeout(r, 150));
  assert.equal((await order()).status, 'pending_payment');

  sme.status = 'SUCCESS';
  const real = await call('POST', '/api/payments/smepay/callback', { ref_id: orderId, status: 'SUCCESS', transaction_id: 'SME_TXN_1' });
  assert.equal(real.status, 200);
  await until(async () => (await order()).status === 'paid');
  assert.equal((await order()).status, 'paid');

  // A repeated webhook (SMEPay retries) must not take stock twice.
  const stock = await stockOf('hacktoberfest-2026-classic-tee');
  await call('POST', '/api/payments/smepay/callback', { ref_id: orderId, status: 'SUCCESS' });
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(await stockOf('hacktoberfest-2026-classic-tee'), stock);

  assert.equal((await call('POST', '/api/payments/smepay/callback', { ref_id: '../etc' })).status, 200);
});

test('the browser redirect goes to the order page', async () => {
  const ok = await call('GET', '/api/payments/smepay/callback?order=TOC-ABC123');
  assert.equal(ok.status, 303);
  assert.equal(ok.location, '/order/TOC-ABC123');
  assert.equal((await call('GET', '/api/payments/smepay/callback?order=https://evil.example')).location, '/account');
});

test('the access token is reused, and refreshed when SMEPay rejects it', async () => {
  const before = sme.authCalls;
  await placeOrder(1);
  await placeOrder(1);
  assert.equal(sme.authCalls, before);                        // cached token reused

  sme.token = 'tok-2';                                        // SMEPay expires the old token
  const { created } = await placeOrder(1);
  assert.equal(created.status, 201);
  assert.equal(sme.authCalls, before + 1);
});

test('live SMEPay is refused unless explicitly allowed', async () => {
  process.env.SMEPAY_ENV = 'live';
  assert.equal(payments.mode(), 'blocked');
  const { created } = await placeOrder(1);
  assert.equal(created.status, 503);
  process.env.ALLOW_LIVE_PAYMENTS = 'true';
  assert.equal(payments.mode(), 'smepay');
  assert.equal(payments.isTestMode(), false);
  delete process.env.ALLOW_LIVE_PAYMENTS;
  process.env.SMEPAY_ENV = 'test';

  process.env.PAYMENT_PROVIDER = 'demo';
  assert.equal(payments.mode(), 'demo');
  delete process.env.PAYMENT_PROVIDER;
});
