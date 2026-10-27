const express = require('express');
const db = require('../db');
const { HttpError, asyncRoute } = require('../errors');
const { optionalAuth, requireAuth } = require('../auth');

const router = express.Router();

router.get('/mine', requireAuth, asyncRoute(async (req, res) => {
  const docs = await db.col('orders').find({ userId: req.user.id }).sort({ createdAt: -1 }).toArray();
  res.json(docs.map((d) => db.orderOut(d)));
}));

// Readable by its owner, an admin, or anyone holding the order's access token
// (how guest checkouts see their confirmation page).
router.get('/:id', optionalAuth, asyncRoute(async (req, res) => {
  const order = await db.col('orders').findOne({ _id: req.params.id });
  const allowed = order && (
    (req.query.token && req.query.token === order.accessToken) ||
    (req.user && (req.user.role === 'admin' || req.user.id === order.userId))
  );
  if (!allowed) throw new HttpError(404, 'Order not found.');
  res.json(db.orderOut(order));
}));

module.exports = router;
