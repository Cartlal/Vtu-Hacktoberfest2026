const express = require('express');
const db = require('../db');
const { CATEGORIES } = require('../seed');
const { HttpError, asyncRoute } = require('../errors');
const { requireAdmin } = require('../auth');
const { countOpen } = require('./tickets');

const router = express.Router();
router.use(requireAdmin);

const ORDER_STATUSES = ['pending_payment', 'paid', 'shipped', 'delivered', 'cancelled'];
const PAID = ['paid', 'shipped', 'delivered'];

router.get('/stats', asyncRoute(async (req, res) => {
  const orders = db.col('orders');
  const since = new Date(Date.now() - 13 * 864e5);
  since.setUTCHours(0, 0, 0, 0);
  const [sales, items, byDay, pendingOrders, customers, subscribers, openTickets, lowStock] = await Promise.all([
    orders.aggregate([{ $match: { status: { $in: PAID } } },
      { $group: { _id: null, orders: { $sum: 1 }, revenue: { $sum: '$total' } } }]).toArray(),
    orders.aggregate([{ $match: { status: { $in: PAID } } }, { $unwind: '$items' },
      { $group: { _id: null, n: { $sum: '$items.qty' } } }]).toArray(),
    orders.aggregate([{ $match: { status: { $in: PAID }, paidAt: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$paidAt' } }, orders: { $sum: 1 }, revenue: { $sum: '$total' } } },
      { $sort: { _id: 1 } }]).toArray(),
    orders.countDocuments({ status: 'pending_payment' }),
    db.col('users').countDocuments({ role: 'customer' }),
    db.col('subscribers').countDocuments(),
    countOpen(),
    db.col('products').find({ active: true, stock: { $lte: 10 } }).sort({ stock: 1 }).toArray()
  ]);
  const revenue = sales[0]?.revenue || 0;
  const paidOrders = sales[0]?.orders || 0;
  res.json({
    revenue,
    paidOrders,
    itemsSold: items[0]?.n || 0,
    averageOrder: paidOrders ? Math.round(revenue / paidOrders) : 0,
    pendingOrders, customers, subscribers, openTickets,
    lowStock: lowStock.map(db.productOut),
    byDay: byDay.map((d) => ({ day: d._id, orders: d.orders, revenue: d.revenue }))
  });
}));

router.get('/orders', asyncRoute(async (req, res) => {
  const filter = ORDER_STATUSES.includes(req.query.status) ? { status: req.query.status } : {};
  const docs = await db.col('orders').find(filter).sort({ createdAt: -1 }).limit(500).toArray();
  res.json(docs.map((d) => db.orderOut(d)));
}));

router.patch('/orders/:id', asyncRoute(async (req, res) => {
  const { status } = req.body;
  if (!ORDER_STATUSES.includes(status)) throw new HttpError(400, 'Invalid status.');
  const order = await db.col('orders').findOne({ _id: req.params.id });
  if (!order) throw new HttpError(404, 'Order not found.');
  // Only the request that actually moves the order changes stock.
  const r = await db.col('orders').updateOne({ _id: order._id, status: order.status }, { $set: { status } });
  // Cancelling a paid order puts its stock back on the shelf.
  if (r.modifiedCount === 1 && status === 'cancelled' && ['paid', 'shipped'].includes(order.status)) {
    await Promise.all(order.items.map((i) => db.col('products').updateOne({ _id: i.productId }, { $inc: { stock: i.qty } })));
  }
  res.json(db.orderOut(await db.col('orders').findOne({ _id: order._id })));
}));

router.get('/products', asyncRoute(async (req, res) => {
  const docs = await db.col('products').find().sort({ category: 1, name: 1 }).toArray();
  res.json(docs.map(db.productOut));
}));

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
  if (body.compareAt !== undefined) out.compareAt = body.compareAt ? Number(body.compareAt) : null;
  if (need('stock')) {
    out.stock = Number(body.stock);
    if (!Number.isInteger(out.stock) || out.stock < 0) throw new HttpError(400, 'Stock must be 0 or more.');
  }
  if (need('sizes')) {
    if (!Array.isArray(body.sizes) || body.sizes.length === 0) throw new HttpError(400, 'Give at least one size.');
    out.sizes = body.sizes.map(String);
  }
  if (body.badge !== undefined) out.badge = body.badge ? String(body.badge) : null;
  if (body.featured !== undefined) out.featured = !!body.featured;
  if (body.active !== undefined) out.active = !!body.active;
  if (body.art !== undefined) out.art = body.art;
  return out;
}

router.post('/products', asyncRoute(async (req, res) => {
  const f = productFields(req.body, { partial: false });
  const slug = f.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (await db.col('products').findOne({ slug })) throw new HttpError(409, 'A product with that name already exists.');
  const doc = {
    _id: await db.nextSeq('store_products'), slug, compareAt: null, badge: null, rating: 0, ratingCount: 0,
    featured: false, active: true, art: { icon: 'Shirt', bg: '#2b1748', fg: '#ff7a1a' }, createdAt: new Date(), ...f
  };
  await db.col('products').insertOne(doc);
  res.status(201).json(db.productOut(doc));
}));

router.patch('/products/:id', asyncRoute(async (req, res) => {
  const f = productFields(req.body, { partial: true });
  if (Object.keys(f).length === 0) throw new HttpError(400, 'Nothing to update.');
  const doc = await db.col('products').findOneAndUpdate(
    { _id: Number(req.params.id) }, { $set: f }, { returnDocument: 'after' }
  );
  if (!doc) throw new HttpError(404, 'Product not found.');
  res.json(db.productOut(doc));
}));

module.exports = router;
