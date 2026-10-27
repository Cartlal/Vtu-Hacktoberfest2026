const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.ADMIN_EMAIL = 'admin@test.local';
process.env.ADMIN_PASSWORD = 'admin-password-123';
delete process.env.RAZORPAY_KEY_ID;
delete process.env.RAZORPAY_KEY_SECRET;

const db = require('../src/db');
db.open(':memory:');
const app = require('../src/app');
const payments = require('../src/payments');

let server;
let base;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server.close());

async function api(method, path, body, token) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: res.status, body: await res.json() };
}

const customer = {
  name: 'Asha Rao', email: 'asha@example.com', phone: '9876543210', delivery: 'shipping',
  address: { line1: '12 Campus Road', city: 'Belagavi', state: 'Karnataka', pincode: '590018' }
};

async function product(slug) {
  return (await api('GET', `/products/${slug}`)).body;
}

test('lists, filters and sorts products', async () => {
  const all = await api('GET', '/products');
  assert.equal(all.status, 200);
  assert.ok(all.body.length >= 16);

  const tees = await api('GET', '/products?category=tees&sort=price-asc');
  assert.ok(tees.body.every((p) => p.category === 'tees'));
  const prices = tees.body.map((p) => p.price);
  assert.deepEqual(prices, [...prices].sort((a, b) => a - b));

  const ghosts = await api('GET', '/products?q=ghost');
  assert.ok(ghosts.body.length >= 1 && ghosts.body.every((p) => /ghost/i.test(p.name + p.description)));

  assert.equal((await api('GET', '/products/no-such-thing')).status, 404);
  const detail = await product('hacktoberfest-2026-classic-tee');
  assert.equal(detail.price, 59900);
  assert.ok(Array.isArray(detail.related));
});

test('registers, signs in and rejects duplicates and bad passwords', async () => {
  const reg = await api('POST', '/auth/register', { name: 'Ravi', email: 'Ravi@Example.com', password: 'pumpkin-pie-1' });
  assert.equal(reg.status, 201);
  assert.equal(reg.body.user.email, 'ravi@example.com');
  assert.equal(reg.body.user.role, 'customer');

  assert.equal((await api('POST', '/auth/register', { name: 'Ravi', email: 'ravi@example.com', password: 'pumpkin-pie-1' })).status, 409);
  assert.equal((await api('POST', '/auth/login', { email: 'ravi@example.com', password: 'wrong-password' })).status, 401);

  const login = await api('POST', '/auth/login', { email: 'ravi@example.com', password: 'pumpkin-pie-1' });
  assert.equal(login.status, 200);
  const me = await api('GET', '/auth/me', null, login.body.token);
  assert.equal(me.body.name, 'Ravi');
  assert.equal((await api('GET', '/auth/me', null, 'not-a-token')).status, 401);
});

test('prices carts on the server: coupons, shipping, campus pickup', async () => {
  const tee = await product('hacktoberfest-2026-classic-tee');       // ₹599
  const hoodie = await product('hacktoberfest-2026-hoodie');         // ₹1,499

  const small = await api('POST', '/checkout/quote', { items: [{ productId: tee.id, size: 'M', qty: 1, price: 1 }] });
  assert.equal(small.body.subtotal, 59900);              // client "price" is ignored
  assert.equal(small.body.shipping, 7900);
  assert.equal(small.body.total, 67800);

  const pickup = await api('POST', '/checkout/quote', { items: [{ productId: tee.id, size: 'M', qty: 1 }], delivery: 'campus_pickup' });
  assert.equal(pickup.body.shipping, 0);

  const big = await api('POST', '/checkout/quote', { items: [{ productId: hoodie.id, size: 'L', qty: 1 }], coupon: 'hacktober26' });
  assert.equal(big.body.coupon, 'HACKTOBER26');
  assert.equal(big.body.discount, 22500);                 // 15% of ₹1,499 = ₹224.85, rounded to ₹225
  assert.equal(big.body.shipping, 0);                     // ₹1,274 after discount, free shipping

  const tooSmall = await api('POST', '/checkout/quote', { items: [{ productId: tee.id, size: 'M', qty: 1 }], coupon: 'HACKTOBER26' });
  assert.equal(tooSmall.body.discount, 0);
  assert.match(tooSmall.body.couponError, /₹999/);

  assert.equal((await api('POST', '/checkout/quote', { items: [{ productId: tee.id, size: 'XXXL', qty: 1 }] })).status, 400);
  assert.equal((await api('POST', '/checkout/quote', { items: [{ productId: tee.id, size: 'M', qty: 0 }] })).status, 400);
  assert.equal((await api('POST', '/checkout/quote', { items: [] })).status, 400);
});

test('demo checkout: pending order, payment verify, stock decremented, token-protected order page', async () => {
  const before = await product('pumpkin-pull-request-tee');
  const created = await api('POST', '/checkout', { ...customer, items: [{ productId: before.id, size: 'L', qty: 2 }] });
  assert.equal(created.status, 201);
  assert.equal(created.body.payment.provider, 'demo');
  assert.equal(created.body.total, 2 * 64900);            // ₹1,298: free shipping
  const { orderId, accessToken } = created.body;

  assert.equal((await api('GET', `/orders/${orderId}`)).status, 404);
  assert.equal((await api('POST', `/checkout/${orderId}/verify`, { accessToken: 'wrong' })).status, 404);

  const paid = await api('POST', `/checkout/${orderId}/verify`, { accessToken });
  assert.equal(paid.status, 200);
  assert.equal(paid.body.status, 'paid');
  assert.match(paid.body.paymentId, /^demo_/);

  const after = await product('pumpkin-pull-request-tee');
  assert.equal(after.stock, before.stock - 2);

  const again = await api('POST', `/checkout/${orderId}/verify`, { accessToken });   // idempotent
  assert.equal(again.body.status, 'paid');
  assert.equal((await product('pumpkin-pull-request-tee')).stock, before.stock - 2);

  const view = await api('GET', `/orders/${orderId}?token=${accessToken}`);
  assert.equal(view.status, 200);
  assert.equal(view.body.items[0].qty, 2);
});

test('checkout validates customer details and stock', async () => {
  const zombie = await product('zombie-developer-costume-kit');
  const items = [{ productId: zombie.id, size: 'M', qty: 1 }];
  assert.equal((await api('POST', '/checkout', { ...customer, phone: '12345', items })).status, 400);
  assert.equal((await api('POST', '/checkout', { ...customer, address: { ...customer.address, pincode: '59' }, items })).status, 400);
  assert.equal((await api('POST', '/checkout', { ...customer, coupon: 'FAKE', items })).status, 400);

  const tooMany = await api('POST', '/checkout', { ...customer, items: [{ productId: zombie.id, size: 'M', qty: 10 }, { productId: zombie.id, size: 'L', qty: 10 }] });
  assert.equal(tooMany.status, 400);
  assert.match(tooMany.body.error, /left in stock/);
});

test('signed-in orders appear under /orders/mine', async () => {
  const { body: auth } = await api('POST', '/auth/register', { name: 'Meera', email: 'meera@example.com', password: 'boo-boo-123' });
  const sticker = await product('spooky-sticker-pack');
  const created = await api('POST', '/checkout', { ...customer, delivery: 'campus_pickup', items: [{ productId: sticker.id, size: 'One size', qty: 3 }] }, auth.token);
  assert.equal(created.body.total, 3 * 14900);             // pickup: no shipping
  await api('POST', `/checkout/${created.body.orderId}/verify`, { accessToken: created.body.accessToken });

  const mine = await api('GET', '/orders/mine', null, auth.token);
  assert.equal(mine.body.length, 1);
  assert.equal(mine.body[0].status, 'paid');
  assert.equal((await api('GET', `/orders/${created.body.orderId}`, null, auth.token)).status, 200);
});

test('admin: protected routes, stats, cancel restocks, product edits', async () => {
  const { body: user } = await api('POST', '/auth/login', { email: 'ravi@example.com', password: 'pumpkin-pie-1' });
  assert.equal((await api('GET', '/admin/stats', null, user.token)).status, 403);
  assert.equal((await api('GET', '/admin/stats')).status, 401);

  const { body: admin } = await api('POST', '/auth/login', { email: 'admin@test.local', password: 'admin-password-123' });
  const stats = await api('GET', '/admin/stats', null, admin.token);
  assert.equal(stats.status, 200);
  assert.equal(stats.body.paidOrders, 2);
  assert.equal(stats.body.revenue, 2 * 64900 + 3 * 14900);
  assert.equal(stats.body.itemsSold, 5);

  const orders = (await api('GET', '/admin/orders?status=paid', null, admin.token)).body;
  const tee = await product('pumpkin-pull-request-tee');
  const teeOrder = orders.find((o) => o.items[0].productId === tee.id);
  const cancelled = await api('PATCH', `/admin/orders/${teeOrder.id}`, { status: 'cancelled' }, admin.token);
  assert.equal(cancelled.body.status, 'cancelled');
  assert.equal((await product('pumpkin-pull-request-tee')).stock, tee.stock + 2);

  const edited = await api('PATCH', `/admin/products/${tee.id}`, { price: 54900, badge: 'Sale' }, admin.token);
  assert.equal(edited.body.price, 54900);
  assert.equal((await api('PATCH', `/admin/products/${tee.id}`, { price: -5 }, admin.token)).status, 400);

  const added = await api('POST', '/admin/products', {
    name: 'Candy Corn Socks', category: 'accessories', description: 'Stripy socks.', price: 19900, stock: 20, sizes: ['One size']
  }, admin.token);
  assert.equal(added.status, 201);
  assert.equal(added.body.slug, 'candy-corn-socks');
});

test('marketing stats and newsletter', async () => {
  assert.equal((await api('POST', '/marketing/subscribe', { email: 'not-an-email' })).status, 400);
  assert.equal((await api('POST', '/marketing/subscribe', { email: 'fan@example.com' })).status, 201);
  assert.equal((await api('POST', '/marketing/subscribe', { email: 'FAN@example.com' })).status, 201);   // no duplicate
  const stats = await api('GET', '/marketing/stats');
  assert.equal(stats.body.subscribers, 1);
  assert.equal(stats.body.orders, 1);                       // one order was cancelled above
  assert.equal(stats.body.teesSold, 0);
});

test('payments: Razorpay signature check and live-key guard', () => {
  process.env.RAZORPAY_KEY_SECRET = 'test_secret';
  const sig = crypto.createHmac('sha256', 'test_secret').update('order_1|pay_1').digest('hex');
  assert.equal(payments.verifyRazorpaySignature('order_1', 'pay_1', sig), true);
  assert.equal(payments.verifyRazorpaySignature('order_1', 'pay_2', sig), false);
  assert.equal(payments.verifyRazorpaySignature('order_1', 'pay_1', 'short'), false);

  process.env.RAZORPAY_KEY_ID = 'rzp_test_abc';
  assert.equal(payments.mode(), 'razorpay');
  process.env.RAZORPAY_KEY_ID = 'rzp_live_abc';
  assert.equal(payments.mode(), 'blocked');
  delete process.env.RAZORPAY_KEY_ID;
  delete process.env.RAZORPAY_KEY_SECRET;
  assert.equal(payments.mode(), 'demo');
});
