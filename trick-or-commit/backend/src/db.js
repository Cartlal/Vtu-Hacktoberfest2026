// MongoDB storage. The store shares one database with the Lantern Desk helpdesk:
//   store_*      - owned by the store (products, users, orders, subscribers)
//   tickets, messages, attachments, clients, counters
//                - owned by the helpdesk (helpdesk/src/db.js defines their shape). The store
//                  writes its "Report a problem" tickets straight in, the helpdesk forwards
//                  them to AutoFix, and replies plus AutoFix progress show on the store's pages.
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { MongoClient } = require('mongodb');
const { PRODUCTS } = require('./seed');

const NAMES = {
  products: 'store_products',
  users: 'store_users',
  orders: 'store_orders',
  subscribers: 'store_subscribers',
  tickets: 'tickets',
  messages: 'messages',
  attachments: 'attachments',
  clients: 'clients',
  counters: 'counters'
};

let client = null;
let database = null;

async function connect(uri = process.env.MONGODB_URI, dbName = process.env.MONGODB_DB || 'lantern_desk') {
  if (!uri) throw new Error('MONGODB_URI is not set.');
  client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
  await client.connect();
  database = client.db(dbName);
  await ensureIndexes();
  await seedProducts();
  await seedAdmin();
  return database;
}

async function close() {
  await client?.close();
  client = null;
  database = null;
}

// Tests only: removes the throwaway database they ran against.
async function dropDatabase() {
  await database?.dropDatabase();
}

function col(name) {
  if (!database) throw new Error('database not connected');
  return database.collection(NAMES[name]);
}

// Atomic counters (product and user ids, and ticket numbers shared with the helpdesk).
async function nextSeq(name) {
  const doc = await col('counters').findOneAndUpdate(
    { _id: name }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' }
  );
  return doc.seq;
}

async function ensureIndexes() {
  await Promise.all([
    col('users').createIndex({ email: 1 }, { unique: true }),
    col('products').createIndex({ slug: 1 }, { unique: true }),
    col('orders').createIndex({ userId: 1, createdAt: -1 }),
    col('orders').createIndex({ status: 1, paidAt: -1 }),
    col('tickets').createIndex({ client_id: 1, created_at: -1 }),
    col('tickets').createIndex({ store_user_id: 1, created_at: -1 }, { sparse: true })
  ]);
}

async function seedProducts() {
  if (await col('products').estimatedDocumentCount() > 0) return;
  const docs = [];
  for (const p of PRODUCTS) {
    docs.push({
      _id: await nextSeq('store_products'),
      slug: p.slug, name: p.name, category: p.category, description: p.description,
      price: p.price, compareAt: p.compareAt ?? null, sizes: p.sizes, stock: p.stock,
      badge: p.badge ?? null, rating: p.rating, ratingCount: p.ratingCount, art: p.art,
      featured: !!p.featured, active: true, createdAt: new Date()
    });
  }
  await col('products').insertMany(docs);
}

// The admin account comes from ADMIN_EMAIL / ADMIN_PASSWORD so no credentials live in the repo.
async function seedAdmin() {
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  if (!email || !password || await col('users').findOne({ email })) return;
  await col('users').insertOne({
    _id: await nextSeq('store_users'), name: 'Store Admin', email,
    passwordHash: bcrypt.hashSync(password, 10), role: 'admin', createdAt: new Date()
  });
}

function productOut(doc) {
  if (!doc) return null;
  const { _id, createdAt: _c, ...rest } = doc;
  return { id: _id, ...rest };
}

function orderOut(doc, { includeToken = false } = {}) {
  if (!doc) return null;
  const { _id, accessToken, paymentOrderId: _p, ...rest } = doc;
  return { id: _id, ...rest, ...(includeToken ? { accessToken } : {}) };
}

const newOrderId = () => `TOC-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

module.exports = { connect, close, dropDatabase, col, nextSeq, productOut, orderOut, newOrderId };
