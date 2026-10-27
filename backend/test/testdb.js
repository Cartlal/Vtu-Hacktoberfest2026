// Tests run against a throwaway database on the MongoDB cluster in backend/.env
// (MONGODB_URI), like the helpdesk's tests. Each test file gets its own and drops it.
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const db = require('../src/db');

async function open() {
  await db.connect(process.env.MONGODB_URI, `toc_test_${process.pid}`);
  // The store's client record, which the helpdesk normally creates on its first start.
  await db.col('clients').insertOne({ _id: 1, name: 'Trick or Commit', slug: 'trick-or-commit', autofix: true });
}

async function close() {
  await db.dropDatabase();
  await db.close();
}

module.exports = { open, close };
