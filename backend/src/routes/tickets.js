const express = require('express');
const crypto = require('node:crypto');
const multer = require('multer');
const db = require('../db');
const autofix = require('../autofix');
const { HttpError } = require('../errors');
const { optionalAuth, requireAuth, requireAdmin } = require('../auth');

const router = express.Router();

const CATEGORIES = ['bug', 'typo', 'design', 'feature', 'payment', 'other'];
const SEVERITIES = ['low', 'medium', 'high', 'critical'];
const STATUSES = ['open', 'in_progress', 'resolved', 'closed', 'rejected'];
const MAX_FILES = 3;
const MAX_FILE_BYTES = 3 * 1024 * 1024;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// --- Uploads: kept in memory, checked by content, then stored in SQLite ---
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
  const now = Date.now();
  const hits = (recent.get(req.ip) || []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) return next(new HttpError(429, 'Too many reports from this device. Please try again in a few minutes.'));
  hits.push(now);
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

function loadTicket(id) {
  return db.get().prepare('SELECT * FROM tickets WHERE id = ?').get(id);
}

// Reporter (by access token or account), or any admin.
function canView(req, row) {
  if (!row) return false;
  const token = req.query.token || req.body?.token || req.get('X-Ticket-Token');
  if (token && token === row.access_token) return true;
  return !!req.user && (req.user.role === 'admin' || req.user.id === row.user_id);
}

function ticketDetail(row, { includeToken = false } = {}) {
  const ticket = db.ticketFromRow(row);
  ticket.attachments = db.get()
    .prepare('SELECT id, filename, mime, size FROM ticket_attachments WHERE ticket_id = ? ORDER BY id').all(row.id);
  ticket.updates = db.get()
    .prepare('SELECT id, author, author_role AS authorRole, status_from AS statusFrom, status_to AS statusTo, message, created_at AS createdAt FROM ticket_updates WHERE ticket_id = ? ORDER BY id')
    .all(row.id);
  if (includeToken) ticket.accessToken = row.access_token;
  return ticket;
}

// --- Raise a ticket (public; multipart form with up to 3 screenshots) ---
router.post('/', optionalAuth, rateLimit, uploadScreenshots, (req, res) => {
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

  const id = db.newTicketId();
  const accessToken = crypto.randomBytes(16).toString('hex');
  db.tx(() => {
    db.get().prepare(`
      INSERT INTO tickets (id, access_token, user_id, name, email, title, category, page_url,
                           description, steps, expected, actual, environment)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, accessToken, req.user?.id ?? null, t.name, t.email, t.title, t.category, t.pageUrl,
      t.description, t.steps, t.expected, t.actual, t.environment ? JSON.stringify(t.environment) : null
    );
    const insertFile = db.get().prepare('INSERT INTO ticket_attachments (ticket_id, filename, mime, size, data) VALUES (?, ?, ?, ?, ?)');
    for (const f of files) {
      const name = String(f.originalname || 'screenshot').replace(/[^\w.\- ]+/g, '_').slice(0, 100);
      insertFile.run(id, name, f.sniffed, f.size, f.buffer);
    }
    db.get().prepare(`INSERT INTO ticket_updates (ticket_id, author, author_role, status_to, message)
                      VALUES (?, ?, 'reporter', 'open', 'Ticket raised')`).run(id, t.name || t.email);
  });

  const row = loadTicket(id);
  autofix.forwardTicket(db.ticketFromRow(row));
  res.status(201).json({ id, accessToken, autofix: autofix.enabled() });
});

router.get('/mine', requireAuth, (req, res) => {
  const rows = db.get().prepare('SELECT * FROM tickets WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
  res.json(rows.map(db.ticketFromRow));
});

// --- Admin list ---
router.get('/', requireAdmin, (req, res) => {
  const { status, severity, q } = req.query;
  const where = [];
  const args = [];
  if (STATUSES.includes(status)) { where.push('t.status = ?'); args.push(status); }
  if (SEVERITIES.includes(severity)) { where.push('t.severity = ?'); args.push(severity); }
  if (q) {
    where.push('(t.title LIKE ? OR t.description LIKE ? OR t.id LIKE ? OR t.email LIKE ?)');
    const like = `%${String(q).slice(0, 60)}%`;
    args.push(like, like, like, like);
  }
  const rows = db.get().prepare(`
    SELECT t.*, (SELECT COUNT(*) FROM ticket_attachments a WHERE a.ticket_id = t.id) AS attachment_count
    FROM tickets t ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,
             CASE t.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
             t.created_at DESC
    LIMIT 500`).all(...args);
  res.json(rows.map((r) => ({ ...db.ticketFromRow(r), attachmentCount: r.attachment_count })));
});

router.get('/:id', optionalAuth, (req, res) => {
  const row = loadTicket(req.params.id);
  if (!canView(req, row)) throw new HttpError(404, 'Ticket not found.');
  res.json(ticketDetail(row));
});

router.get('/:id/attachments/:aid', optionalAuth, (req, res) => {
  const row = loadTicket(req.params.id);
  if (!canView(req, row)) throw new HttpError(404, 'Not found.');
  const file = db.get().prepare('SELECT * FROM ticket_attachments WHERE id = ? AND ticket_id = ?')
    .get(Number(req.params.aid), row.id);
  if (!file) throw new HttpError(404, 'Not found.');
  res.set({
    'Content-Type': file.mime,
    'Content-Length': file.size,
    'Content-Disposition': `inline; filename="${file.filename.replace(/"/g, '')}"`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, max-age=3600'
  });
  res.end(Buffer.from(file.data));
});

// Reporter or admin adds a comment.
router.post('/:id/comments', optionalAuth, (req, res) => {
  const row = loadTicket(req.params.id);
  if (!canView(req, row)) throw new HttpError(404, 'Ticket not found.');
  const message = text(req.body.message, 2000);
  if (!message) throw new HttpError(400, 'Write a message first.');
  const isAdmin = req.user?.role === 'admin';
  if (!isAdmin && ['closed', 'rejected'].includes(row.status)) throw new HttpError(400, 'This ticket is closed.');
  db.tx(() => {
    db.get().prepare('INSERT INTO ticket_updates (ticket_id, author, author_role, message) VALUES (?, ?, ?, ?)')
      .run(row.id, isAdmin ? 'Store team' : (row.name || row.email), isAdmin ? 'admin' : 'reporter', message);
    db.get().prepare("UPDATE tickets SET updated_at = datetime('now') WHERE id = ?").run(row.id);
  });
  res.status(201).json(ticketDetail(loadTicket(row.id)));
});

// Admin triage: change status and/or severity, with an optional note to the reporter.
router.patch('/:id', requireAdmin, (req, res) => {
  const row = loadTicket(req.params.id);
  if (!row) throw new HttpError(404, 'Ticket not found.');
  const status = req.body.status ?? row.status;
  const severity = req.body.severity === undefined ? row.severity : (req.body.severity || null);
  const note = text(req.body.message, 2000);
  if (!STATUSES.includes(status)) throw new HttpError(400, 'Invalid status.');
  if (severity !== null && !SEVERITIES.includes(severity)) throw new HttpError(400, 'Invalid severity.');
  const statusChanged = status !== row.status;
  const severityChanged = severity !== row.severity;
  if (statusChanged && status === 'rejected' && !note) throw new HttpError(400, 'Tell the reporter why the ticket is rejected.');
  if (!statusChanged && !severityChanged && !note) throw new HttpError(400, 'Nothing to update.');

  const message = [severityChanged && (severity ? `Severity set to ${severity}.` : 'Severity cleared.'), note]
    .filter(Boolean).join(' ') || null;
  db.tx(() => {
    db.get().prepare("UPDATE tickets SET status = ?, severity = ?, updated_at = datetime('now') WHERE id = ?")
      .run(status, severity, row.id);
    db.get().prepare(`INSERT INTO ticket_updates (ticket_id, author, author_role, status_from, status_to, message)
                      VALUES (?, 'Store team', 'admin', ?, ?, ?)`)
      .run(row.id, statusChanged ? row.status : null, statusChanged ? status : null, message);
  });
  res.json(ticketDetail(loadTicket(row.id)));
});

module.exports = { router, STATUSES };
