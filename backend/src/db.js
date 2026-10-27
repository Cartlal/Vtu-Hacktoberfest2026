// SQLite through Node's built-in node:sqlite (no native dependency to build).
// On Render's free plan the disk is reset on every deploy: products re-seed
// automatically, orders and accounts start fresh. Point DB_FILE at a Render
// persistent disk (paid) if they must survive deploys.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { DatabaseSync } = require('node:sqlite');
const { PRODUCTS } = require('./seed');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slug         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  category     TEXT NOT NULL,
  description  TEXT NOT NULL,
  price        INTEGER NOT NULL CHECK (price >= 0),
  compare_at   INTEGER,
  sizes        TEXT NOT NULL,
  stock        INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  badge        TEXT,
  rating       REAL NOT NULL DEFAULT 0,
  rating_count INTEGER NOT NULL DEFAULT 0,
  art          TEXT NOT NULL,
  featured     INTEGER NOT NULL DEFAULT 0,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id               TEXT PRIMARY KEY,
  access_token     TEXT NOT NULL,
  user_id          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  name             TEXT NOT NULL,
  email            TEXT NOT NULL,
  phone            TEXT NOT NULL,
  delivery         TEXT NOT NULL CHECK (delivery IN ('shipping', 'campus_pickup')),
  address          TEXT,
  items            TEXT NOT NULL,
  subtotal         INTEGER NOT NULL,
  discount         INTEGER NOT NULL,
  shipping         INTEGER NOT NULL,
  total            INTEGER NOT NULL,
  coupon           TEXT,
  status           TEXT NOT NULL DEFAULT 'pending_payment'
                   CHECK (status IN ('pending_payment', 'paid', 'shipped', 'delivered', 'cancelled')),
  payment_provider TEXT,
  payment_order_id TEXT,
  payment_id       TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at          TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders (user_id, created_at);

CREATE TABLE IF NOT EXISTS subscribers (
  email      TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- "Report a problem" tickets. AutoFix triages these and posts progress back.
CREATE TABLE IF NOT EXISTS tickets (
  id           TEXT PRIMARY KEY,
  access_token TEXT NOT NULL,
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  name         TEXT,
  email        TEXT NOT NULL,
  title        TEXT NOT NULL,
  category     TEXT NOT NULL,
  severity     TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  page_url     TEXT,
  description  TEXT NOT NULL,
  steps        TEXT,
  expected     TEXT,
  actual       TEXT,
  environment  TEXT,
  status       TEXT NOT NULL DEFAULT 'open'
               CHECK (status IN ('open', 'in_progress', 'resolved', 'closed', 'rejected')),
  autofix_id   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets (status, created_at);

-- Screenshots live in the database (not on disk) so they survive with their ticket.
CREATE TABLE IF NOT EXISTS ticket_attachments (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  filename  TEXT NOT NULL,
  mime      TEXT NOT NULL,
  size      INTEGER NOT NULL,
  data      BLOB NOT NULL
);

CREATE TABLE IF NOT EXISTS ticket_updates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id   TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author      TEXT NOT NULL,
  author_role TEXT NOT NULL CHECK (author_role IN ('reporter', 'admin', 'autofix')),
  status_from TEXT,
  status_to   TEXT,
  message     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ticket_updates ON ticket_updates (ticket_id, id);
`;

let db = null;

function open(file = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'store.db')) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  seedProducts();
  seedAdmin();
  return db;
}

function get() {
  if (!db) throw new Error('database not opened');
  return db;
}

// node:sqlite has no transaction helper; this keeps multi-statement writes atomic.
function tx(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function seedProducts() {
  if (db.prepare('SELECT COUNT(*) AS n FROM products').get().n > 0) return;
  const insert = db.prepare(`
    INSERT INTO products (slug, name, category, description, price, compare_at, sizes, stock, badge,
                          rating, rating_count, art, featured)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  tx(() => {
    for (const p of PRODUCTS) {
      insert.run(p.slug, p.name, p.category, p.description, p.price, p.compareAt ?? null,
        JSON.stringify(p.sizes), p.stock, p.badge ?? null, p.rating, p.ratingCount,
        JSON.stringify(p.art), p.featured ? 1 : 0);
    }
  });
}

// The admin account comes from ADMIN_EMAIL / ADMIN_PASSWORD so no credentials
// live in the repo. Created once; change the password by editing the env and
// deleting the user, or extend the admin API.
function seedAdmin() {
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  if (!email || !password) return;
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return;
  db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'admin')")
    .run('Store Admin', email, bcrypt.hashSync(password, 10));
}

function productFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    category: row.category,
    description: row.description,
    price: row.price,
    compareAt: row.compare_at,
    sizes: JSON.parse(row.sizes),
    stock: row.stock,
    badge: row.badge,
    rating: row.rating,
    ratingCount: row.rating_count,
    art: JSON.parse(row.art),
    featured: !!row.featured,
    active: !!row.active
  };
}

function orderFromRow(row, { includeToken = false } = {}) {
  if (!row) return null;
  const order = {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    delivery: row.delivery,
    address: row.address ? JSON.parse(row.address) : null,
    items: JSON.parse(row.items),
    subtotal: row.subtotal,
    discount: row.discount,
    shipping: row.shipping,
    total: row.total,
    coupon: row.coupon,
    status: row.status,
    paymentProvider: row.payment_provider,
    paymentId: row.payment_id,
    createdAt: row.created_at,
    paidAt: row.paid_at
  };
  if (includeToken) order.accessToken = row.access_token;
  return order;
}

function newOrderId() {
  return `TOC-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function newTicketId() {
  return `BUG-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function ticketFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    email: row.email,
    title: row.title,
    category: row.category,
    severity: row.severity,
    pageUrl: row.page_url,
    description: row.description,
    steps: row.steps,
    expected: row.expected,
    actual: row.actual,
    environment: row.environment ? JSON.parse(row.environment) : null,
    status: row.status,
    autofixId: row.autofix_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

module.exports = { open, get, tx, productFromRow, orderFromRow, ticketFromRow, newOrderId, newTicketId };
