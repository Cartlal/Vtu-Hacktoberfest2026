const express = require('express');
const db = require('../db');
const { HttpError, asyncRoute } = require('../errors');

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PAID = ['paid', 'shipped', 'delivered'];

// Live numbers for the marketing page, straight from the database.
router.get('/stats', asyncRoute(async (req, res) => {
  const [paid, teeIds, subscribers, products] = await Promise.all([
    db.col('orders').find({ status: { $in: PAID } }, { projection: { items: 1 } }).toArray(),
    db.col('products').distinct('_id', { category: 'tees' }),
    db.col('subscribers').countDocuments(),
    db.col('products').countDocuments({ active: true })
  ]);
  const tees = new Set(teeIds);
  let itemsSold = 0;
  let teesSold = 0;
  for (const order of paid) {
    for (const item of order.items) {
      itemsSold += item.qty;
      if (tees.has(item.productId)) teesSold += item.qty;
    }
  }
  res.json({ orders: paid.length, itemsSold, teesSold, subscribers, products });
}));

router.post('/subscribe', asyncRoute(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Enter a valid email address.');
  await db.col('subscribers').updateOne({ _id: email }, { $setOnInsert: { createdAt: new Date() } }, { upsert: true });
  res.status(201).json({ ok: true });
}));

module.exports = router;
