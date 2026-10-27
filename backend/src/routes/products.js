const express = require('express');
const db = require('../db');
const { CATEGORIES } = require('../seed');
const { HttpError } = require('../errors');

const router = express.Router();

const SORTS = {
  featured: 'featured DESC, rating_count DESC',
  'price-asc': 'price ASC',
  'price-desc': 'price DESC',
  rating: 'rating DESC, rating_count DESC',
  newest: 'id DESC'
};

router.get('/categories', (req, res) => {
  const counts = db.get().prepare(
    'SELECT category, COUNT(*) AS n FROM products WHERE active = 1 GROUP BY category'
  ).all();
  const byId = Object.fromEntries(counts.map((c) => [c.category, c.n]));
  res.json(CATEGORIES.map((c) => ({ ...c, count: byId[c.id] || 0 })));
});

// GET /api/products?category=tees&q=ghost&size=M&min=500&max=1500&sort=price-asc&featured=1
// min/max are in rupees.
router.get('/products', (req, res) => {
  const { category, q, size, min, max, sort, featured } = req.query;
  const where = ['active = 1'];
  const args = [];
  if (category) { where.push('category = ?'); args.push(String(category)); }
  if (q) {
    where.push('(name LIKE ? OR description LIKE ?)');
    const like = `%${String(q).slice(0, 60)}%`;
    args.push(like, like);
  }
  if (min && !Number.isNaN(Number(min))) { where.push('price >= ?'); args.push(Math.round(Number(min) * 100)); }
  if (max && !Number.isNaN(Number(max))) { where.push('price <= ?'); args.push(Math.round(Number(max) * 100)); }
  if (featured === '1') where.push('featured = 1');

  const orderBy = SORTS[sort] || SORTS.featured;
  let products = db.get().prepare(`SELECT * FROM products WHERE ${where.join(' AND ')} ORDER BY ${orderBy}`)
    .all(...args).map(db.productFromRow);
  if (size) products = products.filter((p) => p.sizes.includes(String(size)));
  res.json(products);
});

router.get('/products/:slug', (req, res) => {
  const product = db.productFromRow(
    db.get().prepare('SELECT * FROM products WHERE slug = ? AND active = 1').get(req.params.slug)
  );
  if (!product) throw new HttpError(404, 'Product not found.');
  const related = db.get().prepare(
    'SELECT * FROM products WHERE category = ? AND id != ? AND active = 1 ORDER BY rating_count DESC LIMIT 4'
  ).all(product.category, product.id).map(db.productFromRow);
  res.json({ ...product, related });
});

module.exports = router;
