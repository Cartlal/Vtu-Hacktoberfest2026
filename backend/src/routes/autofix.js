const express = require('express');
const crypto = require('node:crypto');
const db = require('../db');
const { HttpError } = require('../errors');

// AutoFix posts its progress onto tickets here (same contract as its
// VictoryPath integration). Authenticated by the shared AUTOFIX_SECRET.
const router = express.Router();

// AutoFix speaks upper-case bug-report statuses; map them to ours.
const STATUS_MAP = { OPEN: 'open', IN_PROGRESS: 'in_progress', RESOLVED: 'resolved', CLOSED: 'closed', REJECTED: 'rejected' };
// Gemma's risk rating becomes the ticket's severity.
const RISK_TO_SEVERITY = { LOW: 'low', MODERATE: 'medium', HIGH: 'high' };

router.use((req, res, next) => {
  const secret = Buffer.from(process.env.AUTOFIX_SECRET || '');
  const given = Buffer.from(String(req.get('X-AutoFix-Secret') || ''));
  if (!secret.length || given.length !== secret.length || !crypto.timingSafeEqual(given, secret)) {
    return next(new HttpError(401, 'Invalid AutoFix secret.'));
  }
  next();
});

router.post('/bugs/:id/update', (req, res) => {
  const row = db.get().prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!row) throw new HttpError(404, 'Ticket not found.');
  const message = String(req.body.message || '').trim().slice(0, 5000);
  if (!message) throw new HttpError(400, 'Message is required.');
  const status = req.body.status ? STATUS_MAP[req.body.status] : null;
  if (req.body.status && !status) throw new HttpError(400, 'Invalid status.');

  const severity = req.body.risk ? RISK_TO_SEVERITY[String(req.body.risk).toUpperCase()] : null;
  if (req.body.risk && !severity) throw new HttpError(400, 'Invalid risk.');

  // Never override a decision the store team already made (a closed ticket,
  // or a severity an admin set).
  const change = status && status !== row.status && !['closed', 'rejected'].includes(row.status);
  db.tx(() => {
    if (change) db.get().prepare("UPDATE tickets SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, row.id);
    else db.get().prepare("UPDATE tickets SET updated_at = datetime('now') WHERE id = ?").run(row.id);
    if (severity && !row.severity) db.get().prepare('UPDATE tickets SET severity = ? WHERE id = ?').run(severity, row.id);
    if (req.body.ticket_id) db.get().prepare('UPDATE tickets SET autofix_id = ? WHERE id = ?').run(String(req.body.ticket_id).slice(0, 40), row.id);
    db.get().prepare(`INSERT INTO ticket_updates (ticket_id, author, author_role, status_from, status_to, message)
                      VALUES (?, 'AutoFix (AI)', 'autofix', ?, ?, ?)`)
      .run(row.id, change ? row.status : null, change ? status : null, message);
  });
  res.json({ status: 'success', ticketStatus: change ? status : row.status });
});

module.exports = router;
