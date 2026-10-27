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
  if (await db.col('users').findOne({ email })) {
    throw new HttpError(409, 'An account with that email already exists. Sign in instead.');
  }
  const doc = {
    _id: await db.nextSeq('store_users'), name, email,
    passwordHash: await bcrypt.hash(password, 10), role: 'customer', createdAt: new Date()
  };
  try {
    await db.col('users').insertOne(doc);
  } catch (err) {
    if (err.code === 11000) throw new HttpError(409, 'An account with that email already exists. Sign in instead.');
    throw err;
  }
  const user = publicUser(doc);
  res.status(201).json({ token: signToken(user), user });
}));

router.post('/login', asyncRoute(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const doc = await db.col('users').findOne({ email });
  if (!doc || !(await bcrypt.compare(password, doc.passwordHash))) {
    throw new HttpError(401, 'Wrong email or password.');
  }
  const user = publicUser(doc);
  res.json({ token: signToken(user), user });
}));

router.get('/me', requireAuth, (req, res) => res.json(req.user));

module.exports = router;
