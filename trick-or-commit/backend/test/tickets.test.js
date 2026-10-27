const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.ADMIN_EMAIL = 'admin@test.local';
process.env.ADMIN_PASSWORD = 'admin-password-123';
process.env.TICKET_RATE_LIMIT = '100';

const testdb = require('./testdb');
const db = require('../src/db');
const app = require('../src/app');

let server;
let base;

before(async () => {
  await testdb.open();
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(async () => { server.close(); await testdb.close(); });

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
  assert.match(created.body.id, /^LD-\d{4}$/);
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

test("stores tickets in the helpdesk's collections, in the helpdesk's shape", async () => {
  const { body } = await raise({ ...valid, title: 'Typo on the hoodie page', category: 'typo' },
    [{ data: PNG, type: 'image/png', name: 'hoodie.png' }]);
  const doc = await db.col('tickets').findOne({ _id: body.id });
  assert.equal(doc.client_id, 1);
  assert.equal(doc.channel, 'store');
  assert.equal(doc.status, 'new');
  assert.equal(doc.subject, 'Typo on the hoodie page');
  assert.equal(doc.requester_email, 'asha@example.com');
  assert.equal(doc.access_token, body.accessToken);
  assert.equal(doc.autofix_id, null);                // the helpdesk's sync loop forwards it to AutoFix
  assert.equal(await db.col('attachments').countDocuments({ ticket_id: body.id }), 1);
  assert.equal((await db.col('messages').findOne({ ticket_id: body.id })).kind, 'system');
});

test('shows helpdesk replies and AutoFix progress, and asks for a re-triage when the reporter answers', async () => {
  const { body: t } = await raise(valid);
  // What the helpdesk writes once AutoFix has triaged the ticket and asked a question.
  await db.col('tickets').updateOne({ _id: t.id }, { $set: {
    status: 'pending', autofix_id: 'AF-9', autofix_stage: 'NEEDS_INFO', autofix_json: JSON.stringify({ risk: 'MODERATE' })
  } });
  await db.col('messages').insertMany([
    { _id: 900001, ticket_id: t.id, kind: 'autofix', author: 'AutoFix', body: 'Which phone?', created_at: '2026-10-27T10:00:00Z' },
    { _id: 900002, ticket_id: t.id, kind: 'note', author: 'Agent', body: 'internal only', created_at: '2026-10-27T10:01:00Z' }
  ]);
  const view = await json('GET', `/tickets/${t.id}?token=${t.accessToken}`);
  assert.equal(view.body.status, 'in_progress');
  assert.equal(view.body.severity, 'medium');        // from Gemma's risk
  assert.equal(view.body.autofixId, 'AF-9');
  assert.deepEqual(view.body.updates.map((u) => u.authorRole), ['reporter', 'autofix']);   // notes stay internal

  await json('POST', `/tickets/${t.id}/comments`, { message: 'A Pixel 8, in Chrome.', token: t.accessToken });
  const doc = await db.col('tickets').findOne({ _id: t.id });
  assert.equal(doc.status, 'open');
  assert.equal(doc.retriage_requested, true);
  assert.equal((await db.col('messages').find({ ticket_id: t.id, kind: 'customer' }).toArray()).length, 1);

  // The helpdesk closes it: the store sees it closed and the reporter can no longer comment.
  await db.col('tickets').updateOne({ _id: t.id }, { $set: { status: 'closed' } });
  assert.equal((await json('GET', `/tickets/${t.id}?token=${t.accessToken}`)).body.status, 'closed');
  assert.equal((await json('POST', `/tickets/${t.id}/comments`, { message: 'hello?', token: t.accessToken })).status, 400);
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
  await db.col('tickets').updateOne({ _id: t.id }, { $set: { autofix_json: JSON.stringify({ risk: 'LOW' }) } });
  const list = await json('GET', '/tickets?severity=high&status=open', null, asAdmin);
  assert.ok(list.body.some((x) => x.id === t.id));
  assert.ok(list.body.every((x) => x.severity === 'high' && x.status === 'open'));

  assert.equal((await json('PATCH', `/tickets/${t.id}`, { severity: 'extreme' }, asAdmin)).status, 400);
  assert.equal((await json('PATCH', `/tickets/${t.id}`, {}, asAdmin)).status, 400);
  assert.equal((await json('PATCH', `/tickets/${t.id}`, { status: 'rejected' }, asAdmin)).status, 400);
  const resolved = await json('PATCH', `/tickets/${t.id}`, { status: 'resolved', message: 'Fixed in today’s deploy.' }, { Authorization: `Bearer ${admin}` });
  assert.equal(resolved.body.status, 'resolved');
  const doc = await db.col('tickets').findOne({ _id: t.id });
  assert.equal(doc.status, 'solved');                // the helpdesk sees it as solved
  assert.equal(doc.priority, 'high');
  const rejected = await json('PATCH', `/tickets/${t.id}`, { status: 'rejected', message: 'Not a bug.' }, asAdmin);
  assert.equal(rejected.body.status, 'rejected');
  assert.equal((await db.col('tickets').findOne({ _id: t.id })).status, 'closed');

  const stats = await json('GET', '/admin/stats', null, { Authorization: `Bearer ${admin}` });
  assert.equal(typeof stats.body.openTickets, 'number');
});

test('rate-limits the public form', async () => {
  process.env.TICKET_RATE_LIMIT = '1';
  const res = await raise(valid);
  assert.equal(res.status, 429);
  process.env.TICKET_RATE_LIMIT = '100';
});
