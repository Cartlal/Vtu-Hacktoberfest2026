// Payment gateway: Razorpay in test mode, or a built-in demo gateway when no
// keys are configured. Live Razorpay keys are refused unless
// ALLOW_LIVE_PAYMENTS=true, so this demo store can never take real money by
// accident.
const crypto = require('node:crypto');
const { HttpError } = require('./errors');

function mode() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !secret) return 'demo';
  if (keyId.startsWith('rzp_live_') && process.env.ALLOW_LIVE_PAYMENTS !== 'true') return 'blocked';
  return 'razorpay';
}

async function createPayment(order) {
  const m = mode();
  if (m === 'blocked') {
    throw new HttpError(503, 'Live Razorpay keys are disabled for this demo store. Use rzp_test_ keys.');
  }
  if (m === 'demo') return { provider: 'demo', paymentOrderId: null };

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

module.exports = { mode, createPayment, verifyRazorpaySignature };
