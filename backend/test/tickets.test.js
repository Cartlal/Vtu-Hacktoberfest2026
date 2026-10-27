const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

process.env.ADMIN_EMAIL = 'admin@test.local';
process.env.ADMIN_PASSWORD = 'admin-password-123';
process.env.TICKET_RATE_LIMIT = '100';
process.env.AUTOFIX_SECRET = 'shared-secret';

const db = require('../src/db');
db.open(':memory:');
const app = require('../src/app');

let server;
let base;
let fakeAutofix;
const forwarded = [];

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;

  // Stands in for the AutoFix server and records what the store sends it.
  fakeAutofix = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      forwarded.push({ url: req.url, secret: req.headers['x-autofix-secret'], body: JSON.parse(body) });
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: `VP-${forwarded.length}`, status: 'NEW' }));
    });
  });
  fakeAutofix.listen(0);
  await new Promise((r) => fakeAutofix.once('listening', r));
  process.env.AUTOFIX_URL = `http://127.0.0.1:${fakeAutofix.address().port}`;
});
after(() => { server.close(); fakeAutofix.close(); });

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 2)]);

function form(fields, files = []) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  for (const f of files) fd.append('screenshots', new Blob([f.data], { type: f.type }), f.name);
  return fd;
}

const valid = {
  title: 'Checkout button overlaps footer',
  category: 'design',
  severity: 'critical',          // sent by an old/tampered client; must be ignored
  pageUrl: '/checkout',
  description: 'On my phone the Pay button sits on top of the footer text.',
  steps: '1. Add a tee\n2. Open checkout on a phone',
  expected: 'Button above the footer',
  actual: 'Button covers the footer',
  name: 'Asha',
  email: 'asha@example.com',
  environment: JSON.stringify({ userAgent: 'TestBrowser/1.0', viewport: '375x812', language: 'en-IN', secret: 'dropped' })
};

async function raise(fields, files, token) {
  const res = await fetch(`${base}/tickets`, {
    method: 'POST', body: form(fields, files), headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  return { status: res.status, body: await res.json() };
}

async function json(method, path, body, headers = {}) {
  const res = await fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined
  });
  return { status: res.status, body: await res.json() };
}

async function adminToken() {
  return (await json('POST', '/auth/login', { email: 'admin@test.local', password: 'admin-password-123' })).body.token;
}

test('raises a ticket with screenshots and serves them only to the reporter and admins', async () => {
  const created = await raise(valid, [
    { data: PNG, type: 'image/png', name: 'phone.png' },
    { data: JPEG, type: 'image/jpeg', name: 'desktop "view".jpg' }
  ]);
  assert.equal(created.status, 201);
  assert.match(created.body.id, /^BUG-[0-9A-F]{6}$/);
  const { id, accessToken } = created.body;

  assert.equal((await json('GET', `/tickets/${id}`)).status, 404);
  const view = await json('GET', `/tickets/${id}?token=${accessToken}`);
  assert.equal(view.status, 200);
  assert.equal(view.body.severity, null);              // triage sets it, not the reporter
  assert.equal(view.body.attachments.length, 2);
  assert.deepEqual(view.body.environment, { userAgent: 'TestBrowser/1.0', viewport: '375x812', language: 'en-IN' });
  assert.equal(view.body.updates[0].message, 'Ticket raised');

  const att = view.body.attachments[0];
  const img = await fetch(`${base}/tickets/${id}/attachments/${att.id}?token=${accessToken}`);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.equal(img.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await img.arrayBuffer()), PNG);
  assert.equal((await fetch(`${base}/tickets/${id}/attachments/${att.id}`)).status, 404);

  const admin = await adminToken();
  assert.equal((await json('GET', `/tickets/${id}`, null, { Authorization: `Bearer ${admin}` })).status, 200);
});

test('validates the form and the uploaded files', async () => {
  assert.equal((await raise({ ...valid, title: 'Bug' })).status, 400);
  assert.equal((await raise({ ...valid, category: 'nonsense' })).status, 400);
  assert.equal((await raise({ ...valid, description: 'short' })).status, 400);
  assert.equal((await raise({ ...valid, email: 'not-an-email' })).status, 400);

  const fake = await raise(valid, [{ data: Buffer.from('<svg onload=alert(1)></svg>'.padEnd(40)), type: 'image/png', name: 'evil.png' }]);
  assert.equal(fake.status, 400);
  assert.match(fake.body.error, /not a PNG/);

  const four = await raise(valid, Array.from({ length: 4 }, (_, i) => ({ data: PNG, type: 'image/png', name: `s${i}.png` })));
  assert.equal(four.status, 400);
  assert.match(four.body.error, /at most 3/);

  const big = await raise(valid, [{ data: Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024)]), type: 'image/png', name: 'big.png' }]);
  assert.equal(big.status, 400);
  assert.match(big.body.error, /3 MB/);
});

test('forwards new tickets to AutoFix and records its id', async () => {
  const before = forwarded.length;
  const { body } = await raise({ ...valid, title: 'Typo on the hoodie page', category: 'typo' });
  for (let i = 0; i < 50 && forwarded.length === before; i++) await new Promise((r) => setTimeout(r, 20));
  const sent = forwarded.at(-1);
  assert.equal(sent.url, '/api/tickets');
  assert.equal(sent.secret, 'shared-secret');
  assert.equal(sent.body.external_id, body.id);
  assert.match(sent.body.description, /Steps to reproduce/);
  await new Promise((r) => setTimeout(r, 50));
  const view = await json('GET', `/tickets/${body.id}?token=${body.accessToken}`);
  assert.match(view.body.autofixId, /^VP-\d+$/);
});

test('AutoFix callback updates the ticket, but never overrides a closed one', async () => {
  const { body: t } = await raise(valid);
  const path = `/autofix/bugs/${t.id}/update`;
  assert.equal((await json('POST', path, { message: 'hi' })).status, 401);
  assert.equal((await json('POST', path, { message: 'hi' }, { 'X-AutoFix-Secret': 'wrong-secret!' })).status, 401);

  assert.equal((await json('POST', path, { message: 'hi', risk: 'EXTREME' }, { 'X-AutoFix-Secret': 'shared-secret' })).status, 400);
  const ok = await json('POST', path, { status: 'IN_PROGRESS', risk: 'LOW', message: 'Gemma rated this LOW risk.' }, { 'X-AutoFix-Secret': 'shared-secret' });
  assert.equal(ok.body.ticketStatus, 'in_progress');
  assert.equal((await json('GET', `/tickets/${t.id}?token=${t.accessToken}`)).body.severity, 'low');

  const admin = await adminToken();
  await json('PATCH', `/tickets/${t.id}`, { status: 'closed', message: 'Duplicate' }, { Authorization: `Bearer ${admin}` });
  const late = await json('POST', path, { status: 'RESOLVED', message: 'Fix is live.' }, { 'X-AutoFix-Secret': 'shared-secret' });
  assert.equal(late.body.ticketStatus, 'closed');

  const view = await json('GET', `/tickets/${t.id}?token=${t.accessToken}`);
  assert.deepEqual(view.body.updates.map((u) => u.authorRole), ['reporter', 'autofix', 'admin', 'autofix']);
});

test('reporter comments, admin triage, and signed-in history', async () => {
  const { body: auth } = await json('POST', '/auth/register', { name: 'Ravi Kumar', email: 'ravi@example.com', password: 'pumpkin-pie-1' });
  const { body: t } = await raise({ ...valid, name: '', email: '' }, [], auth.token);   // name/email come from the account

  const mine = await json('GET', '/tickets/mine', null, { Authorization: `Bearer ${auth.token}` });
  assert.equal(mine.body.length, 1);
  assert.equal(mine.body[0].email, 'ravi@example.com');

  const comment = await json('POST', `/tickets/${t.id}/comments`, { message: 'Still happening on Chrome.', token: t.accessToken });
  assert.equal(comment.status, 201);
  assert.equal(comment.body.updates.at(-1).author, 'Ravi Kumar');

  assert.equal((await json('GET', '/tickets', null, { Authorization: `Bearer ${auth.token}` })).status, 403);
  const admin = await adminToken();
  const asAdmin = { Authorization: `Bearer ${admin}` };

  // Admin sets severity on its own; it then filters, and AutoFix can't override it.
  const triaged = await json('PATCH', `/tickets/${t.id}`, { severity: 'high' }, asAdmin);
  assert.equal(triaged.body.severity, 'high');
  assert.equal(triaged.body.status, 'open');
  assert.equal(triaged.body.updates.at(-1).message, 'Severity set to high.');
  await json('POST', `/autofix/bugs/${t.id}/update`, { risk: 'LOW', message: 'Gemma: LOW' }, { 'X-AutoFix-Secret': 'shared-secret' });
  const list = await json('GET', '/tickets?severity=high&status=open', null, asAdmin);
  assert.ok(list.body.some((x) => x.id === t.id));
  assert.ok(list.body.every((x) => x.severity === 'high' && x.status === 'open'));

  assert.equal((await json('PATCH', `/tickets/${t.id}`, { severity: 'extreme' }, asAdmin)).status, 400);
  assert.equal((await json('PATCH', `/tickets/${t.id}`, {}, asAdmin)).status, 400);
  assert.equal((await json('PATCH', `/tickets/${t.id}`, { status: 'rejected' }, asAdmin)).status, 400);
  const resolved = await json('PATCH', `/tickets/${t.id}`, { status: 'resolved', message: 'Fixed in today’s deploy.' }, { Authorization: `Bearer ${admin}` });
  assert.equal(resolved.body.status, 'resolved');

  const stats = await json('GET', '/admin/stats', null, { Authorization: `Bearer ${admin}` });
  assert.equal(typeof stats.body.openTickets, 'number');
});

test('migrates an old database where reporters chose severity, keeping tickets and screenshots', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { DatabaseSync } = require('node:sqlite');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'toc-')), 'old.db');
  const old = new DatabaseSync(file);
  old.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'customer', created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE tickets (id TEXT PRIMARY KEY, access_token TEXT NOT NULL, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      name TEXT, email TEXT NOT NULL, title TEXT NOT NULL, category TEXT NOT NULL,
      severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
      page_url TEXT, description TEXT NOT NULL, steps TEXT, expected TEXT, actual TEXT, environment TEXT,
      status TEXT NOT NULL DEFAULT 'open', autofix_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE ticket_attachments (id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE, filename TEXT NOT NULL, mime TEXT NOT NULL,
      size INTEGER NOT NULL, data BLOB NOT NULL);
    INSERT INTO tickets (id, access_token, email, title, category, severity, description)
      VALUES ('BUG-OLD001', 'tok', 'a@b.co', 'Old ticket', 'bug', 'medium', 'From before the change');
    INSERT INTO ticket_attachments (ticket_id, filename, mime, size, data) VALUES ('BUG-OLD001', 's.png', 'image/png', 3, x'010203');
  `);
  old.close();

  const migrated = db.open(file);
  const severity = migrated.prepare('PRAGMA table_info(tickets)').all().find((c) => c.name === 'severity');
  assert.equal(severity.notnull, 0);
  assert.equal(migrated.prepare("SELECT severity FROM tickets WHERE id = 'BUG-OLD001'").get().severity, 'medium');
  assert.equal(migrated.prepare('SELECT COUNT(*) AS n FROM ticket_attachments').get().n, 1);
  assert.deepEqual(migrated.prepare('PRAGMA foreign_key_check').all(), []);
  assert.ok(migrated.prepare("SELECT 1 FROM sqlite_master WHERE name = 'idx_tickets_status'").get());
  migrated.prepare(`INSERT INTO tickets (id, access_token, email, title, category, description)
                    VALUES ('BUG-NEW001', 't', 'a@b.co', 'New', 'bug', 'No severity')`).run();
  // Cascade still points at the rebuilt table.
  migrated.prepare("DELETE FROM tickets WHERE id = 'BUG-OLD001'").run();
  assert.equal(migrated.prepare('SELECT COUNT(*) AS n FROM ticket_attachments').get().n, 0);
  db.open(':memory:');   // later tests use a fresh in-memory database again
});

test('rate-limits the public form', async () => {
  process.env.TICKET_RATE_LIMIT = '1';
  const res = await raise(valid);
  assert.equal(res.status, 429);
  process.env.TICKET_RATE_LIMIT = '100';
});
