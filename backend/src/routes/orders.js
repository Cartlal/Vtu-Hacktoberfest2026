const express = require('express');
const db = require('../db');
const { HttpError } = require('../errors');
const { optionalAuth, requireAuth } = require('../auth');

const router = express.Router();

router.get('/mine', requireAuth, (req, res) => {
  const rows = db.get().prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
  res.json(rows.map((r) => db.orderFromRow(r)));
});

// Readable by its owner, an admin, or anyone holding the order's access token
// (how guest checkouts see their confirmation page).
router.get('/:id', optionalAuth, (req, res) => {
  const row = db.get().prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  const allowed = row && (
    (req.query.token && req.query.token === row.access_token) ||
    (req.user && (req.user.role === 'admin' || req.user.id === row.user_id))
  );
  if (!allowed) throw new HttpError(404, 'Order not found.');
  res.json(db.orderFromRow(row));
});

module.exports = router;
