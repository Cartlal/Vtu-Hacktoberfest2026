const express = require('express');
const crypto = require('node:crypto');
const db = require('../db');
const payments = require('../payments');
const { priceCart, COUPONS } = require('../pricing');
const { HttpError, asyncRoute } = require('../errors');
const { optionalAuth } = require('../auth');

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[6-9]\d{9}$/;   // Indian mobile number, 10 digits
const PIN_RE = /^\d{6}$/;

router.get('/payment-config', (req, res) => {
  res.json({ mode: payments.mode(), testMode: payments.isTestMode(), coupons: Object.entries(COUPONS).map(([code, c]) => ({ code, label: c.label })) });
});

// Price preview for the cart page (coupon check, shipping) without creating an order.
router.post('/quote', asyncRoute(async (req, res) => {
  res.json(await priceCart(req.body.items, { coupon: req.body.coupon, delivery: req.body.delivery }));
}));

function validateCustomer(body) {
  const customer = {
    name: String(body.name || '').trim(),
    email: String(body.email || '').trim().toLowerCase(),
    phone: String(body.phone || '').replace(/[\s-]/g, '').replace(/^\+91/, ''),
    delivery: body.delivery === 'campus_pickup' ? 'campus_pickup' : 'shipping'
  };
  if (customer.name.length < 2) throw new HttpError(400, 'Enter your full name.');
  if (!EMAIL_RE.test(customer.email)) throw new HttpError(400, 'Enter a valid email address.');
  if (!PHONE_RE.test(customer.phone)) throw new HttpError(400, 'Enter a valid 10-digit mobile number.');

  if (customer.delivery === 'shipping') {
    const a = body.address || {};
    const address = {
      line1: String(a.line1 || '').trim(),
      line2: String(a.line2 || '').trim(),
      city: String(a.city || '').trim(),
      state: String(a.state || '').trim(),
      pincode: String(a.pincode || '').trim()
    };
    if (!address.line1 || !address.city || !address.state) throw new HttpError(400, 'Complete your shipping address.');
    if (!PIN_RE.test(address.pincode)) throw new HttpError(400, 'Enter a valid 6-digit PIN code.');
    customer.address = address;
  } else {
    customer.address = null;
  }
  return customer;
}

// Creates a pending order and the matching payment-gateway order.
router.post('/', optionalAuth, asyncRoute(async (req, res) => {
  const customer = validateCustomer(req.body);
  const quote = await priceCart(req.body.items, { coupon: req.body.coupon, delivery: customer.delivery });
  if (req.body.coupon && quote.couponError) throw new HttpError(400, quote.couponError);

  const order = {
    _id: db.newOrderId(),
    accessToken: crypto.randomBytes(16).toString('hex'),
    userId: req.user?.id ?? null,
    name: customer.name, email: customer.email, phone: customer.phone,
    delivery: customer.delivery, address: customer.address,
    items: quote.lines,
    subtotal: quote.subtotal, discount: quote.discount, shipping: quote.shipping, total: quote.total,
    coupon: quote.coupon,
    status: 'pending_payment', paymentProvider: null, paymentOrderId: null, paymentId: null,
    createdAt: new Date(), paidAt: null
  };
  await db.col('orders').insertOne(order);

  let payment;
  try {
    payment = await payments.createPayment(
      { id: order._id, total: order.total, customer },
      { callbackUrl: `${publicUrl(req)}/api/payments/smepay/callback?order=${order._id}` }
    );
  } catch (err) {
    await db.col('orders').updateOne({ _id: order._id }, { $set: { status: 'cancelled' } });
    throw err;
  }
  await db.col('orders').updateOne({ _id: order._id },
    { $set: { paymentProvider: payment.provider, paymentOrderId: payment.paymentOrderId } });

  res.status(201).json({
    orderId: order._id,
    accessToken: order.accessToken,
    total: quote.total,
    payment: { provider: payment.provider, ...(payment.checkout || {}) },
    prefill: { name: customer.name, email: customer.email, contact: customer.phone }
  });
}));

// Confirms payment with the gateway, then takes the stock and marks the order paid.
router.post('/:id/verify', asyncRoute(async (req, res) => {
  const order = await db.col('orders').findOne({ _id: req.params.id });
  if (!order || order.accessToken !== req.body.accessToken) throw new HttpError(404, 'Order not found.');
  if (order.status === 'paid') return res.json(db.orderOut(order));
  if (order.status !== 'pending_payment') throw new HttpError(409, `This order is ${order.status.replace('_', ' ')}.`);

  let paymentId;
  if (order.paymentProvider === 'smepay') {
    const check = await payments.validateSmepay(order.paymentOrderId, order.total);
    if (!check.paid) {
      throw new HttpError(400, check.status === 'FAILED'
        ? 'The payment failed. You have not been charged; please try again.'
        : 'We have not received the payment yet. If you paid, wait a moment and refresh your order page.');
    }
    paymentId = `smepay_${order.paymentOrderId}`;
  } else if (order.paymentProvider === 'razorpay') {
    const { razorpay_order_id: rzpOrder, razorpay_payment_id: rzpPayment, razorpay_signature: sig } = req.body;
    if (rzpOrder !== order.paymentOrderId || !payments.verifyRazorpaySignature(rzpOrder, rzpPayment, sig)) {
      throw new HttpError(400, 'Payment could not be verified.');
    }
    paymentId = rzpPayment;
  } else if (order.paymentProvider === 'demo' && payments.mode() === 'demo') {
    paymentId = `demo_${crypto.randomBytes(6).toString('hex')}`;
  } else {
    throw new HttpError(400, 'Payment could not be verified.');
  }

  res.json(await fulfil(order, paymentId));
}));

// Takes stock for a verified payment and marks the order paid. Shared by /verify and
// the SMEPay webhook; safe to call twice (only one call can move it out of pending).
// Each item is decremented only if enough stock is left; on a shortfall the items
// already taken are put back and the paid order is cancelled for a refund.
async function fulfil(order, paymentId) {
  const products = db.col('products');
  const taken = [];
  let soldOut = null;
  for (const item of order.items) {
    const r = await products.updateOne({ _id: item.productId, stock: { $gte: item.qty } }, { $inc: { stock: -item.qty } });
    if (r.modifiedCount === 0) { soldOut = item; break; }
    taken.push(item);
  }
  const putBack = () => Promise.all(taken.map((i) => products.updateOne({ _id: i.productId }, { $inc: { stock: i.qty } })));

  if (soldOut) {
    await putBack();
    const r = await db.col('orders').updateOne({ _id: order._id, status: 'pending_payment' },
      { $set: { status: 'cancelled', paymentId } });
    if (r.modifiedCount === 1) {
      throw new HttpError(409, `${soldOut.name} sold out while you were paying. Your order was cancelled and the payment will be refunded.`);
    }
  } else {
    const r = await db.col('orders').updateOne({ _id: order._id, status: 'pending_payment' },
      { $set: { status: 'paid', paymentId, paidAt: new Date() } });
    if (r.modifiedCount === 0) await putBack();   // another call got there first
  }
  return db.orderOut(await db.col('orders').findOne({ _id: order._id }));
}

// Public base URL for gateway callbacks: PUBLIC_URL if set, else this request's host
// (Render sits behind a proxy; app.js trusts it, so req.protocol is https there).
function publicUrl(req) {
  return (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
}

module.exports = { router, fulfil };
