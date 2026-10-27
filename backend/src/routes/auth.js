const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { HttpError, asyncRoute } = require('../errors');
const { signToken, publicUser, requireAuth } = require('../auth');

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post('/register', asyncRoute(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (name.length < 2) throw new HttpError(400, 'Enter your name.');
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Enter a valid email address.');
  if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
  if (db.get().prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
    throw new HttpError(409, 'An account with that email already exists. Sign in instead.');
  }
  const hash = await bcrypt.hash(password, 10);
  const { lastInsertRowid } = db.get()
    .prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)').run(name, email, hash);
  const user = publicUser(db.get().prepare('SELECT * FROM users WHERE id = ?').get(lastInsertRowid));
  res.status(201).json({ token: signToken(user), user });
}));

router.post('/login', asyncRoute(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const row = db.get().prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!row || !(await bcrypt.compare(password, row.password_hash))) {
    throw new HttpError(401, 'Wrong email or password.');
  }
  const user = publicUser(row);
  res.json({ token: signToken(user), user });
}));

router.get('/me', requireAuth, (req, res) => res.json(req.user));

module.exports = router;
