// "Report a problem" tickets. They live in the Lantern Desk helpdesk's collections
// (same MongoDB database, same document shape as helpdesk/src/db.js), so a ticket raised
// here is a helpdesk ticket at once: the helpdesk forwards it to AutoFix, and agent
// replies and AutoFix progress show up here. This file maps between the helpdesk's
// documents and the store's own ticket vocabulary, which the frontend uses.
const express = require('express');
const crypto = require('node:crypto');
const multer = require('multer');
const { Binary } = require('mongodb');
const db = require('../db');
const { HttpError, asyncRoute } = require('../errors');
const { optionalAuth, requireAuth, requireAdmin } = require('../auth');

const router = express.Router();

const CATEGORIES = ['bug', 'typo', 'design', 'feature', 'payment', 'other'];
const SEVERITIES = ['low', 'medium', 'high', 'critical'];
const STATUSES = ['open', 'in_progress', 'resolved', 'closed', 'rejected'];
const MAX_FILES = 3;
const MAX_FILE_BYTES = 3 * 1024 * 1024;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The helpdesk client this store is registered as, and its ticket id prefix.
const clientSlug = () => process.env.HELPDESK_CLIENT_SLUG || 'trick-or-commit';
const ticketPrefix = () => process.env.HELPDESK_TICKET_PREFIX || 'LD';

// Store status <-> helpdesk status. "rejected" is a closed ticket with resolution "rejected".
const TO_HELPDESK = { open: 'new', in_progress: 'open', resolved: 'solved', closed: 'closed', rejected: 'closed' };
// Gemma's risk rating (from AutoFix, via the helpdesk) sets severity unless an admin chose one.
const RISK_TO_SEVERITY = { LOW: 'low', MODERATE: 'medium', HIGH: 'high' };
const SEVERITY_TO_PRIORITY = { low: 'low', medium: 'normal', high: 'high', critical: 'urgent' };
// Helpdesk message kinds the reporter may see, and who they appear as here.
const ROLE_BY_KIND = { customer: 'reporter', agent: 'admin', autofix: 'autofix' };

const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

// --- Uploads: kept in memory, checked by content, then stored in MongoDB ---
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: MAX_FILES, fileSize: MAX_FILE_BYTES, fields: 30, fieldSize: 20 * 1024 }
}).array('screenshots', MAX_FILES);

function uploadScreenshots(req, res, next) {
  upload(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return next(new HttpError(400, 'Each screenshot must be 3 MB or smaller.'));
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
      return next(new HttpError(400, `Attach at most ${MAX_FILES} screenshots.`));
    }
    next(new HttpError(400, 'Could not read the upload.'));
  });
}

// Trust the file's bytes, not its name or the browser's claimed type.
function sniffImage(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.toString('ascii', 0, 4) === 'GIF8') return 'image/gif';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

// --- Simple per-IP limit so the public form can't be flooded ---
const recent = new Map();
function rateLimit(req, res, next) {
  const limit = Number(process.env.TICKET_RATE_LIMIT) || 5;
  const windowMs = 10 * 60 * 1000;
  const time = Date.now();
  const hits = (recent.get(req.ip) || []).filter((t) => time - t < windowMs);
  if (hits.length >= limit) return next(new HttpError(429, 'Too many reports from this device. Please try again in a few minutes.'));
  hits.push(time);
  recent.set(req.ip, hits);
  next();
}

function text(value, max) {
  const s = String(value ?? '').trim();
  return s ? s.slice(0, max) : null;
}

function parseEnvironment(raw) {
  try {
    const env = JSON.parse(raw || 'null');
    if (!env || typeof env !== 'object') return null;
    const keep = {};
    for (const key of ['userAgent', 'viewport', 'screen', 'language', 'platform', 'timezone', 'url']) {
      if (env[key] != null) keep[key] = String(env[key]).slice(0, 300);
    }
    return Object.keys(keep).length ? keep : null;
  } catch {
    return null;
  }
}

async function storeClient() {
  return db.col('clients').findOne({ slug: clientSlug() });
}

async function loadTicket(id) {
  const client = await storeClient();
  if (!client) return null;
  return db.col('tickets').findOne({ _id: String(id), client_id: client._id });
}

// Reporter (by access token or account), or any admin.
function canView(req, doc) {
  if (!doc) return false;
  const token = req.query.token || req.body?.token || req.get('X-Ticket-Token');
  if (token && token === doc.access_token) return true;
  return !!req.user && (req.user.role === 'admin' || req.user.id === doc.store_user_id);
}

function storeStatus(doc) {
  switch (doc.status) {
    case 'new': return 'open';
    case 'solved': return 'resolved';
    case 'closed': return doc.resolution === 'rejected' ? 'rejected' : 'closed';
    default: return 'in_progress'; // open, pending, on_hold
  }
}

function severityOf(doc) {
  if (doc.severity) return doc.severity;
  try {
    const risk = JSON.parse(doc.autofix_json || 'null')?.risk;
    return RISK_TO_SEVERITY[String(risk || '').toUpperCase()] || null;
  } catch {
    return null;
  }
}

function ticketOut(doc) {
  let environment = null;
  try { environment = doc.environment ? JSON.parse(doc.environment) : null; } catch { /* plain text from the helpdesk */ }
  return {
    id: doc._id,
    userId: doc.store_user_id ?? null,
    name: doc.requester_name,
    email: doc.requester_email,
    title: doc.subject,
    category: doc.category,
    severity: severityOf(doc),
    pageUrl: doc.page_url,
    description: doc.description,
    steps: doc.steps,
    expected: doc.expected,
    actual: doc.actual,
    environment,
    status: storeStatus(doc),
    autofixId: doc.autofix_id,
    createdAt: doc.created_at,
    updatedAt: doc.updated_at
  };
}

async function ticketDetail(doc) {
  const ticket = ticketOut(doc);
  const [files, messages] = await Promise.all([
    db.col('attachments').find({ ticket_id: doc._id }, { projection: { data: 0 } }).sort({ _id: 1 }).toArray(),
    db.col('messages').find({ ticket_id: doc._id, kind: { $in: Object.keys(ROLE_BY_KIND) } }).sort({ _id: 1 }).toArray()
  ]);
  ticket.attachments = files.map((a) => ({ id: a._id, filename: a.filename, mime: a.mime, size: a.size }));
  ticket.updates = [
    { id: 0, author: doc.requester_name || doc.requester_email, authorRole: 'reporter', statusFrom: null,
      statusTo: 'open', message: 'Ticket raised', createdAt: doc.created_at },
    ...messages.map((m) => ({
      id: m._id, author: m.author, authorRole: ROLE_BY_KIND[m.kind],
      statusFrom: m.status_from || null, statusTo: m.status_to || null,
      message: m.status_only ? null : m.body, createdAt: m.created_at
    }))
  ];
  return ticket;
}

async function addMessage(ticketId, kind, author, body, extra = {}) {
  const ts = now();
  await db.col('messages').insertOne({
    _id: await db.nextSeq('messages'), ticket_id: ticketId, kind, author, body, created_at: ts, ...extra
  });
  return ts;
}

// --- Raise a ticket (public; multipart form with up to 3 screenshots) ---
router.post('/', optionalAuth, rateLimit, uploadScreenshots, asyncRoute(async (req, res) => {
  const b = req.body;
  const t = {
    title: text(b.title, 120),
    category: b.category,
    // No severity: triage (AutoFix or an admin) decides it, not the reporter.
    pageUrl: text(b.pageUrl, 300),
    description: text(b.description, 5000),
    steps: text(b.steps, 2000),
    expected: text(b.expected, 1000),
    actual: text(b.actual, 1000),
    name: text(b.name, 80) || req.user?.name || null,
    email: (text(b.email, 200) || req.user?.email || '').toLowerCase(),
    environment: parseEnvironment(b.environment)
  };
  if (!t.title || t.title.length < 5) throw new HttpError(400, 'Give your report a short title (at least 5 characters).');
  if (!CATEGORIES.includes(t.category)) throw new HttpError(400, 'Choose what kind of problem this is.');
  if (!t.description || t.description.length < 10) throw new HttpError(400, 'Describe what happened (at least 10 characters).');
  if (!EMAIL_RE.test(t.email)) throw new HttpError(400, 'Enter a valid email so we can update you.');

  const files = (req.files || []).map((f) => ({ ...f, sniffed: sniffImage(f.buffer) }));
  const bad = files.find((f) => !f.sniffed);
  if (bad) throw new HttpError(400, `"${bad.originalname}" is not a PNG, JPEG, GIF or WebP image.`);

  const client = await storeClient();
  if (!client) throw new HttpError(503, 'Reporting is not available right now. Please try again later.');

  const n = await db.nextSeq('tickets');
  const id = `${ticketPrefix()}-${1000 + n}`;
  const accessToken = crypto.randomBytes(18).toString('base64url');
  const ts = now();
  // Same fields as the helpdesk's createTicket(); store_user_id, severity and resolution
  // are the store's own and the helpdesk ignores them.
  await db.col('tickets').insertOne({
    _id: id, n, client_id: client._id, channel: 'store', access_token: accessToken,
    requester_name: t.name, requester_email: t.email, subject: t.title, description: t.description,
    category: t.category, priority: 'normal', status: 'new', page_url: t.pageUrl, steps: t.steps,
    expected: t.expected, actual: t.actual, environment: t.environment ? JSON.stringify(t.environment) : null,
    external_ref: null, assignee_id: null, autofix_id: null, autofix_stage: null, autofix_json: null,
    autofix_synced_at: null, created_at: ts, updated_at: ts, first_reply_at: null, solved_at: null,
    store_user_id: req.user?.id ?? null, severity: null, resolution: null
  });
  for (const f of files) {
    await db.col('attachments').insertOne({
      _id: await db.nextSeq('attachments'), ticket_id: id,
      filename: String(f.originalname || 'screenshot').replace(/[^\w.\- ]+/g, '_').slice(0, 100),
      mime: f.sniffed, size: f.size, data: new Binary(f.buffer), created_at: ts
    });
  }
  await addMessage(id, 'system', 'Trick or Commit', 'Ticket raised on the store\'s "Report a problem" form.');

  // The helpdesk picks the ticket up on its next sync round and sends it to AutoFix.
  res.status(201).json({ id, accessToken, autofix: !!client.autofix });
}));

router.get('/mine', requireAuth, asyncRoute(async (req, res) => {
  const client = await storeClient();
  if (!client) return res.json([]);
  const docs = await db.col('tickets').find({ client_id: client._id, store_user_id: req.user.id })
    .sort({ created_at: -1 }).toArray();
  res.json(docs.map(ticketOut));
}));

// --- Admin list ---
const STATUS_ORDER = { open: 0, in_progress: 1 };
const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

router.get('/', requireAdmin, asyncRoute(async (req, res) => {
  const { status, severity, q } = req.query;
  const client = await storeClient();
  if (!client) return res.json([]);
  const filter = { client_id: client._id };
  if (q) {
    const like = new RegExp(String(q).slice(0, 60).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ subject: like }, { description: like }, { _id: like }, { requester_email: like }];
  }
  const docs = await db.col('tickets').find(filter).sort({ created_at: -1 }).limit(500).toArray();
  const counts = await db.col('attachments').aggregate([
    { $match: { ticket_id: { $in: docs.map((d) => d._id) } } },
    { $group: { _id: '$ticket_id', n: { $sum: 1 } } }
  ]).toArray();
  const byTicket = Object.fromEntries(counts.map((c) => [c._id, c.n]));

  const tickets = docs.map((d) => ({ ...ticketOut(d), attachmentCount: byTicket[d._id] || 0 }))
    .filter((t) => (!STATUSES.includes(status) || t.status === status)
      && (!SEVERITIES.includes(severity) || t.severity === severity));
  // Stable sort keeps newest first within each group.
  tickets.sort((a, b) => (STATUS_ORDER[a.status] ?? 2) - (STATUS_ORDER[b.status] ?? 2)
    || (SEVERITY_ORDER[a.severity] ?? 4) - (SEVERITY_ORDER[b.severity] ?? 4));
  res.json(tickets);
}));

router.get('/:id', optionalAuth, asyncRoute(async (req, res) => {
  const doc = await loadTicket(req.params.id);
  if (!canView(req, doc)) throw new HttpError(404, 'Ticket not found.');
  res.json(await ticketDetail(doc));
}));

router.get('/:id/attachments/:aid', optionalAuth, asyncRoute(async (req, res) => {
  const doc = await loadTicket(req.params.id);
  if (!canView(req, doc)) throw new HttpError(404, 'Not found.');
  const file = await db.col('attachments').findOne({ _id: Number(req.params.aid), ticket_id: doc._id });
  if (!file) throw new HttpError(404, 'Not found.');
  const data = Buffer.from(file.data.buffer);
  res.set({
    'Content-Type': file.mime,
    'Content-Length': data.length,
    'Content-Disposition': `inline; filename="${file.filename.replace(/"/g, '')}"`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, max-age=3600'
  });
  res.end(data);
}));

// Reporter or admin adds a comment. They show in the helpdesk as a customer or agent reply.
router.post('/:id/comments', optionalAuth, asyncRoute(async (req, res) => {
  const doc = await loadTicket(req.params.id);
  if (!canView(req, doc)) throw new HttpError(404, 'Ticket not found.');
  const message = text(req.body.message, 2000);
  if (!message) throw new HttpError(400, 'Write a message first.');
  const isAdmin = req.user?.role === 'admin';
  if (!isAdmin && ['closed', 'rejected'].includes(storeStatus(doc))) throw new HttpError(400, 'This ticket is closed.');

  const ts = await addMessage(doc._id, isAdmin ? 'agent' : 'customer',
    isAdmin ? 'Store team' : (doc.requester_name || doc.requester_email), message);
  const set = { updated_at: ts };
  if (isAdmin) {
    if (!doc.first_reply_at) set.first_reply_at = ts;
  } else {
    // Like a reply on the helpdesk's own tracking page: the ticket needs attention again,
    // and answers to AutoFix's questions are sent back for a fresh triage.
    if (['pending', 'solved'].includes(doc.status)) Object.assign(set, { status: 'open', solved_at: null });
    if (doc.autofix_stage === 'NEEDS_INFO') set.retriage_requested = true;
  }
  await db.col('tickets').updateOne({ _id: doc._id }, { $set: set });
  res.status(201).json(await ticketDetail(await loadTicket(doc._id)));
}));

// Admin triage: change status and/or severity, with an optional note to the reporter.
router.patch('/:id', requireAdmin, asyncRoute(async (req, res) => {
  const doc = await loadTicket(req.params.id);
  if (!doc) throw new HttpError(404, 'Ticket not found.');
  const current = ticketOut(doc);
  const status = req.body.status ?? current.status;
  const severity = req.body.severity === undefined ? current.severity : (req.body.severity || null);
  const note = text(req.body.message, 2000);
  if (!STATUSES.includes(status)) throw new HttpError(400, 'Invalid status.');
  if (severity !== null && !SEVERITIES.includes(severity)) throw new HttpError(400, 'Invalid severity.');
  const statusChanged = status !== current.status;
  const severityChanged = severity !== current.severity;
  if (statusChanged && status === 'rejected' && !note) throw new HttpError(400, 'Tell the reporter why the ticket is rejected.');
  if (!statusChanged && !severityChanged && !note) throw new HttpError(400, 'Nothing to update.');

  const set = {};
  if (statusChanged) {
    const hd = TO_HELPDESK[status];
    Object.assign(set, { status: hd, resolution: status === 'rejected' ? 'rejected' : null,
                         solved_at: ['solved', 'closed'].includes(hd) ? (doc.solved_at || now()) : null });
  }
  if (severityChanged) Object.assign(set, { severity, priority: severity ? SEVERITY_TO_PRIORITY[severity] : 'normal' });

  const lines = [severityChanged && (severity ? `Severity set to ${severity}.` : 'Severity cleared.'), note].filter(Boolean);
  const body = lines.join(' ') || `Status changed to ${status.replace('_', ' ')}.`;
  set.updated_at = await addMessage(doc._id, 'agent', 'Store team', body, {
    ...(statusChanged ? { status_from: current.status, status_to: status } : {}),
    ...(lines.length ? {} : { status_only: true })
  });
  await db.col('tickets').updateOne({ _id: doc._id }, { $set: set });
  res.json(await ticketDetail(await loadTicket(doc._id)));
}));

// Open or in progress, for the admin dashboard.
async function countOpen() {
  const client = await storeClient();
  if (!client) return 0;
  return db.col('tickets').countDocuments({ client_id: client._id, status: { $in: ['new', 'open', 'pending', 'on_hold'] } });
}

module.exports = { router, STATUSES, countOpen };
