const express = require('express');
const db = require('../db');
const payments = require('../payments');
const { fulfil } = require('./checkout');

// SMEPay uses one callback_url for two things: it redirects the shopper's
// browser there after paying, and POSTs its webhook there.
const router = express.Router();

const ORDER_ID_RE = /^TOC-[0-9A-F]{6}$/;

// Browser redirect after payment: send the shopper to their order page.
router.get('/smepay/callback', (req, res) => {
  const id = String(req.query.order || '');
  res.redirect(303, ORDER_ID_RE.test(id) ? `/order/${id}` : '/account');
});

// Webhook. Acknowledge at once (SMEPay retries on 5xx/timeouts), then confirm
// the payment with SMEPay itself; the webhook body is never trusted on its own.
router.post('/smepay/callback', (req, res) => {
  const id = String(req.body?.ref_id || req.query.order || '');
  res.status(200).json({ received: true });
  if (!ORDER_ID_RE.test(id)) return;

  const row = db.get().prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!row || row.payment_provider !== 'smepay' || row.status !== 'pending_payment') return;
  payments.validateSmepay(row.payment_order_id, row.total)
    .then((check) => {
      if (check.paid) fulfil(row, `smepay_${row.payment_order_id}`);
    })
    .catch((err) => console.error(`SMEPay webhook for ${id} failed:`, err.message));
});

module.exports = router;
