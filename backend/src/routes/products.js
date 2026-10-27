const express = require('express');
const db = require('../db');
const { CATEGORIES } = require('../seed');
const { HttpError, asyncRoute } = require('../errors');

const router = express.Router();

const SORTS = {
  featured: { featured: -1, ratingCount: -1 },
  'price-asc': { price: 1 },
  'price-desc': { price: -1 },
  rating: { rating: -1, ratingCount: -1 },
  newest: { _id: -1 }
};

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

router.get('/categories', asyncRoute(async (req, res) => {
  const counts = await db.col('products').aggregate([
    { $match: { active: true } }, { $group: { _id: '$category', n: { $sum: 1 } } }
  ]).toArray();
  const byId = Object.fromEntries(counts.map((c) => [c._id, c.n]));
  res.json(CATEGORIES.map((c) => ({ ...c, count: byId[c.id] || 0 })));
}));

// GET /api/products?category=tees&q=ghost&size=M&min=500&max=1500&sort=price-asc&featured=1
// min/max are in rupees.
router.get('/products', asyncRoute(async (req, res) => {
  const { category, q, size, min, max, sort, featured } = req.query;
  const filter = { active: true };
  if (category) filter.category = String(category);
  if (q) {
    const re = new RegExp(escapeRegex(String(q).slice(0, 60)), 'i');
    filter.$or = [{ name: re }, { description: re }];
  }
  if (size) filter.sizes = String(size);
  const price = {};
  if (min && !Number.isNaN(Number(min))) price.$gte = Math.round(Number(min) * 100);
  if (max && !Number.isNaN(Number(max))) price.$lte = Math.round(Number(max) * 100);
  if (Object.keys(price).length) filter.price = price;
  if (featured === '1') filter.featured = true;

  const docs = await db.col('products').find(filter).sort(SORTS[sort] || SORTS.featured).toArray();
  res.json(docs.map(db.productOut));
}));

router.get('/products/:slug', asyncRoute(async (req, res) => {
  const product = db.productOut(await db.col('products').findOne({ slug: req.params.slug, active: true }));
  if (!product) throw new HttpError(404, 'Product not found.');
  const related = await db.col('products')
    .find({ category: product.category, _id: { $ne: product.id }, active: true })
    .sort({ ratingCount: -1 }).limit(4).toArray();
  res.json({ ...product, related: related.map(db.productOut) });
}));

module.exports = router;
