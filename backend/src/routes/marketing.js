const express = require('express');
const db = require('../db');
const { HttpError } = require('../errors');

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Live numbers for the marketing page, straight from the database.
router.get('/stats', (req, res) => {
  const d = db.get();
  const paid = d.prepare("SELECT items FROM orders WHERE status IN ('paid', 'shipped', 'delivered')").all();
  let teesSold = 0;
  let itemsSold = 0;
  const teeIds = new Set(d.prepare("SELECT id FROM products WHERE category = 'tees'").all().map((r) => r.id));
  for (const row of paid) {
    for (const item of JSON.parse(row.items)) {
      itemsSold += item.qty;
      if (teeIds.has(item.productId)) teesSold += item.qty;
    }
  }
  res.json({
    orders: paid.length,
    itemsSold,
    teesSold,
    subscribers: d.prepare('SELECT COUNT(*) AS n FROM subscribers').get().n,
    products: d.prepare('SELECT COUNT(*) AS n FROM products WHERE active = 1').get().n
  });
});

router.post('/subscribe', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Enter a valid email address.');
  db.get().prepare('INSERT OR IGNORE INTO subscribers (email) VALUES (?)').run(email);
  res.status(201).json({ ok: true });
});

module.exports = router;
