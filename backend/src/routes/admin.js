const express = require('express');
const db = require('../db');
const { CATEGORIES } = require('../seed');
const { HttpError } = require('../errors');
const { requireAdmin } = require('../auth');

const router = express.Router();
router.use(requireAdmin);

const ORDER_STATUSES = ['pending_payment', 'paid', 'shipped', 'delivered', 'cancelled'];
const PAID_STATUSES = "('paid', 'shipped', 'delivered')";

router.get('/stats', (req, res) => {
  const d = db.get();
  const sales = d.prepare(`SELECT COUNT(*) AS orders, COALESCE(SUM(total), 0) AS revenue
                           FROM orders WHERE status IN ${PAID_STATUSES}`).get();
  const items = d.prepare(`SELECT items FROM orders WHERE status IN ${PAID_STATUSES}`).all()
    .reduce((n, r) => n + JSON.parse(r.items).reduce((m, i) => m + i.qty, 0), 0);
  const byDay = d.prepare(`SELECT date(paid_at) AS day, COUNT(*) AS orders, SUM(total) AS revenue
                           FROM orders WHERE status IN ${PAID_STATUSES} AND paid_at >= date('now', '-13 days')
                           GROUP BY day ORDER BY day`).all();
  res.json({
    revenue: sales.revenue,
    paidOrders: sales.orders,
    itemsSold: items,
    averageOrder: sales.orders ? Math.round(sales.revenue / sales.orders) : 0,
    pendingOrders: d.prepare("SELECT COUNT(*) AS n FROM orders WHERE status = 'pending_payment'").get().n,
    customers: d.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'customer'").get().n,
    subscribers: d.prepare('SELECT COUNT(*) AS n FROM subscribers').get().n,
    openTickets: d.prepare("SELECT COUNT(*) AS n FROM tickets WHERE status IN ('open', 'in_progress')").get().n,
    lowStock: d.prepare('SELECT * FROM products WHERE active = 1 AND stock <= 10 ORDER BY stock').all().map(db.productFromRow),
    byDay
  });
});

router.get('/orders', (req, res) => {
  const { status } = req.query;
  const rows = ORDER_STATUSES.includes(status)
    ? db.get().prepare('SELECT * FROM orders WHERE status = ? ORDER BY created_at DESC LIMIT 500').all(status)
    : db.get().prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 500').all();
  res.json(rows.map((r) => db.orderFromRow(r)));
});

router.patch('/orders/:id', (req, res) => {
  const { status } = req.body;
  if (!ORDER_STATUSES.includes(status)) throw new HttpError(400, 'Invalid status.');
  const row = db.get().prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!row) throw new HttpError(404, 'Order not found.');
  db.tx(() => {
    // Cancelling a paid order puts its stock back on the shelf.
    if (status === 'cancelled' && ['paid', 'shipped'].includes(row.status)) {
      const restock = db.get().prepare('UPDATE products SET stock = stock + ? WHERE id = ?');
      for (const item of JSON.parse(row.items)) restock.run(item.qty, item.productId);
    }
    db.get().prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, row.id);
  });
  res.json(db.orderFromRow(db.get().prepare('SELECT * FROM orders WHERE id = ?').get(row.id)));
});

router.get('/products', (req, res) => {
  res.json(db.get().prepare('SELECT * FROM products ORDER BY category, name').all().map(db.productFromRow));
});

function productFields(body, { partial }) {
  const out = {};
  const need = (key) => !partial || body[key] !== undefined;
  if (need('name')) {
    out.name = String(body.name || '').trim();
    if (out.name.length < 3) throw new HttpError(400, 'Name is too short.');
  }
  if (need('category')) {
    if (!CATEGORIES.some((c) => c.id === body.category)) throw new HttpError(400, 'Invalid category.');
    out.category = body.category;
  }
  if (need('description')) out.description = String(body.description || '').trim();
  if (need('price')) {
    out.price = Number(body.price);
    if (!Number.isInteger(out.price) || out.price < 100) throw new HttpError(400, 'Price must be at least ₹1 (in paise).');
  }
  if (body.compareAt !== undefined) out.compare_at = body.compareAt ? Number(body.compareAt) : null;
  if (need('stock')) {
    out.stock = Number(body.stock);
    if (!Number.isInteger(out.stock) || out.stock < 0) throw new HttpError(400, 'Stock must be 0 or more.');
  }
  if (need('sizes')) {
    if (!Array.isArray(body.sizes) || body.sizes.length === 0) throw new HttpError(400, 'Give at least one size.');
    out.sizes = JSON.stringify(body.sizes.map(String));
  }
  if (body.badge !== undefined) out.badge = body.badge ? String(body.badge) : null;
  if (body.featured !== undefined) out.featured = body.featured ? 1 : 0;
  if (body.active !== undefined) out.active = body.active ? 1 : 0;
  if (body.art !== undefined) out.art = JSON.stringify(body.art);
  return out;
}

router.post('/products', (req, res) => {
  const f = productFields(req.body, { partial: false });
  const slug = f.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (db.get().prepare('SELECT 1 FROM products WHERE slug = ?').get(slug)) {
    throw new HttpError(409, 'A product with that name already exists.');
  }
  f.slug = slug;
  f.art = f.art || JSON.stringify({ icon: 'Shirt', bg: '#2b1748', fg: '#ff7a1a' });
  const cols = Object.keys(f);
  const { lastInsertRowid } = db.get()
    .prepare(`INSERT INTO products (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .run(...Object.values(f));
  res.status(201).json(db.productFromRow(db.get().prepare('SELECT * FROM products WHERE id = ?').get(lastInsertRowid)));
});

router.patch('/products/:id', (req, res) => {
  const f = productFields(req.body, { partial: true });
  if (Object.keys(f).length === 0) throw new HttpError(400, 'Nothing to update.');
  const result = db.get()
    .prepare(`UPDATE products SET ${Object.keys(f).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
    .run(...Object.values(f), Number(req.params.id));
  if (result.changes === 0) throw new HttpError(404, 'Product not found.');
  res.json(db.productFromRow(db.get().prepare('SELECT * FROM products WHERE id = ?').get(Number(req.params.id))));
});

module.exports = router;
