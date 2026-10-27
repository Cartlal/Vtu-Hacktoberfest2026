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

function publicUser(row) {
  return { id: row.id, name: row.name, email: row.email, role: row.role };
}

// Sets req.user when a valid Bearer token is present; never rejects.
function optionalAuth(req, res, next) {
  const header = req.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    try {
      const payload = jwt.verify(token, secret());
      const row = db.get().prepare('SELECT * FROM users WHERE id = ?').get(payload.sub);
      if (row) req.user = publicUser(row);
    } catch {
      // expired or tampered token: treat as signed out
    }
  }
  next();
}

function requireAuth(req, res, next) {
  optionalAuth(req, res, () => (req.user ? next() : next(new HttpError(401, 'Please sign in.'))));
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, (err) => {
    if (err) return next(err);
    if (req.user.role !== 'admin') return next(new HttpError(403, 'Admins only.'));
    next();
  });
}

module.exports = { signToken, publicUser, optionalAuth, requireAuth, requireAdmin };
