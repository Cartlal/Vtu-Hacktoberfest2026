// Payment gateways:
//   smepay   - SMEPay Wizard checkout (UPI QR widget). Default when its keys are set.
//   razorpay - Razorpay Checkout.
//   demo     - built-in fake gateway, used when no keys are configured.
// PAYMENT_PROVIDER can force one. Live modes are refused unless
// ALLOW_LIVE_PAYMENTS=true, so this demo store can't take real money by accident.
const crypto = require('node:crypto');
const { HttpError } = require('./errors');

const SMEPAY_HOSTS = { test: 'https://staging.smepay.in', live: 'https://extranet.smepay.in' };

const smepayConfigured = () => !!(process.env.SMEPAY_CLIENT_ID && process.env.SMEPAY_CLIENT_SECRET);
const razorpayConfigured = () => !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
const smepayEnv = () => ((process.env.SMEPAY_ENV || 'test').toLowerCase() === 'live' ? 'live' : 'test');
const smepayBase = () => (process.env.SMEPAY_BASE_URL || SMEPAY_HOSTS[smepayEnv()]).replace(/\/+$/, '');
const liveAllowed = () => process.env.ALLOW_LIVE_PAYMENTS === 'true';

function mode() {
  const preferred = (process.env.PAYMENT_PROVIDER || '').toLowerCase();
  let pick;
  if (preferred === 'demo') pick = 'demo';
  else if (preferred === 'smepay') pick = smepayConfigured() ? 'smepay' : 'demo';
  else if (preferred === 'razorpay') pick = razorpayConfigured() ? 'razorpay' : 'demo';
  else pick = smepayConfigured() ? 'smepay' : razorpayConfigured() ? 'razorpay' : 'demo';

  if (pick === 'smepay' && smepayEnv() === 'live' && !liveAllowed()) return 'blocked';
  if (pick === 'razorpay' && process.env.RAZORPAY_KEY_ID.startsWith('rzp_live_') && !liveAllowed()) return 'blocked';
  return pick;
}

function isTestMode() {
  const m = mode();
  if (m === 'smepay') return smepayEnv() === 'test';
  if (m === 'razorpay') return !process.env.RAZORPAY_KEY_ID.startsWith('rzp_live_');
  return true;
}

const rupees = (paise) => (paise / 100).toFixed(2);

// --- SMEPay (Wizard API) ---------------------------------------------------
let smepayToken = { value: null, expiresAt: 0 };

async function smepayPost(path, body, { auth = true, retried = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers.Authorization = `Bearer ${await smepayAccessToken()}`;
  let res;
  try {
    res = await fetch(`${smepayBase()}${path}`, {
      method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(15000)
    });
  } catch (err) {
    console.error('SMEPay unreachable:', path, err.message);
    throw new HttpError(502, 'The payment gateway is not responding. Please try again.');
  }
  // An expired token gets one fresh retry.
  if (res.status === 401 && auth && !retried) {
    smepayToken = { value: null, expiresAt: 0 };
    return smepayPost(path, body, { auth, retried: true });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('SMEPay error:', path, res.status, data?.message || data?.error);
    throw new HttpError(502, 'The payment gateway rejected the request. Please try again.');
  }
  return data;
}

// Tokens live 600 s; refresh a minute early.
async function smepayAccessToken() {
  if (smepayToken.value && Date.now() < smepayToken.expiresAt) return smepayToken.value;
  const data = await smepayPost('/api/wiz/external/auth', {
    client_id: process.env.SMEPAY_CLIENT_ID,
    client_secret: process.env.SMEPAY_CLIENT_SECRET
  }, { auth: false });
  if (!data.access_token) throw new HttpError(502, 'Could not sign in to the payment gateway.');
  smepayToken = { value: data.access_token, expiresAt: Date.now() + ((data.expires_in || 600) - 60) * 1000 };
  return smepayToken.value;
}

// Asks SMEPay whether the order was really paid (never trust the browser or webhook alone).
async function validateSmepay(slug, totalPaise) {
  const data = await smepayPost('/api/wiz/external/order/validate', {
    client_id: process.env.SMEPAY_CLIENT_ID,
    amount: Number(rupees(totalPaise)),
    slug
  });
  return {
    paid: data.status === true && data.valid !== false && data.payment_status === 'SUCCESS',
    status: data.payment_status || 'UNKNOWN'
  };
}

// --- Razorpay -----------------------------------------------------------------
async function createRazorpayOrder(order) {
  const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: order.total, currency: 'INR', receipt: order.id, notes: { store_order: order.id } }),
    signal: AbortSignal.timeout(15000)
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('Razorpay order create failed:', res.status, body?.error?.description);
    throw new HttpError(502, 'The payment gateway is not responding. Please try again.');
  }
  return {
    provider: 'razorpay',
    paymentOrderId: body.id,
    checkout: { keyId: process.env.RAZORPAY_KEY_ID, razorpayOrderId: body.id, amount: order.total, currency: 'INR' }
  };
}

// Razorpay signs order_id|payment_id with the key secret (HMAC-SHA256, hex).
function verifyRazorpaySignature(razorpayOrderId, paymentId, signature) {
  if (!razorpayOrderId || !paymentId || !signature) return false;
  const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '')
    .update(`${razorpayOrderId}|${paymentId}`).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * order: { id, total (paise), customer: { name, email, phone } }
 * callbackUrl: where SMEPay redirects the browser and POSTs its webhook.
 */
async function createPayment(order, { callbackUrl } = {}) {
  const m = mode();
  if (m === 'blocked') {
    throw new HttpError(503, 'Live payments are disabled for this demo store. Use test-mode gateway keys.');
  }
  if (m === 'demo') return { provider: 'demo', paymentOrderId: null };
  if (m === 'razorpay') return createRazorpayOrder(order);

  const data = await smepayPost('/api/wiz/external/order/create', {
    client_id: process.env.SMEPAY_CLIENT_ID,
    amount: rupees(order.total),
    order_id: order.id,
    callback_url: callbackUrl,
    customer_details: { email: order.customer.email, mobile: order.customer.phone, name: order.customer.name }
  });
  if (!data.order_slug) {
    console.error('SMEPay order create returned no slug:', data?.message);
    throw new HttpError(502, 'The payment gateway did not create the order. Please try again.');
  }
  return { provider: 'smepay', paymentOrderId: data.order_slug, checkout: { slug: data.order_slug } };
}

module.exports = { mode, isTestMode, createPayment, verifyRazorpaySignature, validateSmepay };
