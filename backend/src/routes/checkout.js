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
  res.json({ mode: payments.mode(), coupons: Object.entries(COUPONS).map(([code, c]) => ({ code, label: c.label })) });
});

// Price preview for the cart page (coupon check, shipping) without creating an order.
router.post('/quote', (req, res) => {
  const quote = priceCart(req.body.items, { coupon: req.body.coupon, delivery: req.body.delivery });
  res.json(quote);
});

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
  const quote = priceCart(req.body.items, { coupon: req.body.coupon, delivery: customer.delivery });
  if (req.body.coupon && quote.couponError) throw new HttpError(400, quote.couponError);

  const order = {
    id: db.newOrderId(),
    accessToken: crypto.randomBytes(16).toString('hex'),
    total: quote.total
  };
  db.get().prepare(`
    INSERT INTO orders (id, access_token, user_id, name, email, phone, delivery, address, items,
                        subtotal, discount, shipping, total, coupon)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    order.id, order.accessToken, req.user?.id ?? null, customer.name, customer.email, customer.phone,
    customer.delivery, customer.address ? JSON.stringify(customer.address) : null, JSON.stringify(quote.lines),
    quote.subtotal, quote.discount, quote.shipping, quote.total, quote.coupon
  );

  let payment;
  try {
    payment = await payments.createPayment(order);
  } catch (err) {
    db.get().prepare("UPDATE orders SET status = 'cancelled' WHERE id = ?").run(order.id);
    throw err;
  }
  db.get().prepare('UPDATE orders SET payment_provider = ?, payment_order_id = ? WHERE id = ?')
    .run(payment.provider, payment.paymentOrderId, order.id);

  res.status(201).json({
    orderId: order.id,
    accessToken: order.accessToken,
    total: quote.total,
    payment: { provider: payment.provider, ...(payment.checkout || {}) },
    prefill: { name: customer.name, email: customer.email, contact: customer.phone }
  });
}));

// Confirms payment, then atomically re-checks and decrements stock.
router.post('/:id/verify', asyncRoute(async (req, res) => {
  const row = db.get().prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!row || row.access_token !== req.body.accessToken) throw new HttpError(404, 'Order not found.');
  if (row.status === 'paid') return res.json(db.orderFromRow(row));
  if (row.status !== 'pending_payment') throw new HttpError(409, `This order is ${row.status.replace('_', ' ')}.`);

  let paymentId;
  if (row.payment_provider === 'razorpay') {
    const { razorpay_order_id: rzpOrder, razorpay_payment_id: rzpPayment, razorpay_signature: sig } = req.body;
    if (rzpOrder !== row.payment_order_id || !payments.verifyRazorpaySignature(rzpOrder, rzpPayment, sig)) {
      throw new HttpError(400, 'Payment could not be verified.');
    }
    paymentId = rzpPayment;
  } else if (row.payment_provider === 'demo' && payments.mode() === 'demo') {
    paymentId = `demo_${crypto.randomBytes(6).toString('hex')}`;
  } else {
    throw new HttpError(400, 'Payment could not be verified.');
  }

  const items = JSON.parse(row.items);
  const soldOut = db.tx(() => {
    const getStock = db.get().prepare('SELECT stock FROM products WHERE id = ?');
    const takeStock = db.get().prepare('UPDATE products SET stock = stock - ? WHERE id = ?');
    const missing = items.find((item) => (getStock.get(item.productId)?.stock ?? 0) < item.qty);
    if (missing) return missing;
    for (const item of items) takeStock.run(item.qty, item.productId);
    db.get().prepare("UPDATE orders SET status = 'paid', payment_id = ?, paid_at = datetime('now') WHERE id = ?")
      .run(paymentId, row.id);
    return null;
  });
  if (soldOut) {
    // Paid but unfulfillable: cancel and keep the payment id so an admin can refund it.
    db.get().prepare("UPDATE orders SET status = 'cancelled', payment_id = ? WHERE id = ?").run(paymentId, row.id);
    throw new HttpError(409, `${soldOut.name} sold out while you were paying. Your order was cancelled and the payment will be refunded.`);
  }
  res.json(db.orderFromRow(db.get().prepare('SELECT * FROM orders WHERE id = ?').get(row.id)));
}));

module.exports = router;
