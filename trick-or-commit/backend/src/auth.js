const jwt = require('jsonwebtoken');
const db = require('./db');
const { HttpError } = require('./errors');

const TOKEN_TTL = '7d';

function secret() {
  return process.env.JWT_SECRET || 'dev-only-secret-do-not-use-in-production';
}

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, secret(), { expiresIn: TOKEN_TTL });
}

function publicUser(doc) {
  return { id: doc._id, name: doc.name, email: doc.email, role: doc.role };
}

// Sets req.user when a valid Bearer token is present; never rejects.
function optionalAuth(req, res, next) {
  const header = req.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next();
  let payload;
  try {
    payload = jwt.verify(token, secret());
  } catch {
    return next(); // expired or tampered token: treat as signed out
  }
  db.col('users').findOne({ _id: payload.sub })
    .then((doc) => { if (doc) req.user = publicUser(doc); next(); })
    .catch(next);
}

function requireAuth(req, res, next) {
  optionalAuth(req, res, (err) => {
    if (err) return next(err);
    next(req.user ? undefined : new HttpError(401, 'Please sign in.'));
  });
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, (err) => {
    if (err) return next(err);
    if (req.user.role !== 'admin') return next(new HttpError(403, 'Admins only.'));
    next();
  });
}

module.exports = { signToken, publicUser, optionalAuth, requireAuth, requireAdmin };
