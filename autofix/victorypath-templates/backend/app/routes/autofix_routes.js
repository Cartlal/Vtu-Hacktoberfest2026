const express = require('express');
const crypto = require('crypto');
const { query, withTransaction } = require('../db/postgres');
const { ROLES } = require('../constants/roles');
const { createAndDispatchNotification } = require('../services/notificationService');

// AutoFix (the AI bug fixer, see services/autofix.js) posts its progress onto
// bug reports here. Authenticated by the shared AUTOFIX_SECRET header instead
// of a user JWT, since AutoFix is a server, not a logged-in user.
const router = express.Router();

const STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'REJECTED'];

function requireAutofixSecret(req, res, next) {
  const secret = Buffer.from(process.env.AUTOFIX_SECRET || '');
  const given = Buffer.from(String(req.get('X-AutoFix-Secret') || ''));
  if (!secret.length || given.length !== secret.length || !crypto.timingSafeEqual(given, secret)) {
    return res.status(401).json({ detail: 'Invalid AutoFix secret' });
  }
  next();
}
router.use(requireAutofixSecret);

// notifications.sender_id must be a real user, so AutoFix notices go out as
// the first SUPERADMIN account (the same role that normally drives bug reports).
async function systemSenderId() {
  const { rows } = await query('SELECT id FROM users WHERE role = $1 LIMIT 1', [ROLES.SUPERADMIN]);
  return rows[0]?.id || null;
}

// --- PROGRESS UPDATE --- adds a timeline entry; with `status`, also moves the report.
router.post('/bugs/:id/update', async (req, res) => {
  const message = String(req.body.message || '').trim().slice(0, 5000);
  const status = req.body.status || null;
  if (!message) return res.status(400).json({ detail: 'Message is required' });
  if (status && !STATUSES.includes(status)) return res.status(400).json({ detail: 'Invalid status' });

  try {
    const { rows } = await query('SELECT * FROM bug_reports WHERE id = $1', [req.params.id]);
    const bug = rows[0];
    if (!bug) return res.status(404).json({ detail: 'Bug report not found' });

    // Never override a decision a human already made on the report.
    const changeStatus = status && status !== bug.status && !['CLOSED', 'REJECTED'].includes(bug.status);

    await withTransaction(async (client) => {
      if (changeStatus) {
        await client.query(
          `UPDATE bug_reports SET status = $1, updated_at = now(),
             resolved_at = CASE WHEN $1 IN ('RESOLVED', 'CLOSED') THEN COALESCE(resolved_at, now()) ELSE resolved_at END
           WHERE id = $2`,
          [status, bug.id]
        );
      } else {
        await client.query('UPDATE bug_reports SET updated_at = now() WHERE id = $1', [bug.id]);
      }
      await client.query(
        `INSERT INTO bug_report_updates (bug_id, author_id, author_name, author_role, status_from, status_to, message)
         VALUES ($1, NULL, 'AutoFix (AI)', 'SYSTEM', $2, $3, $4)`,
        [bug.id, changeStatus ? bug.status : null, changeStatus ? status : null, message]
      );
    });

    // Best-effort notice to the reporter, same rules as bug_routes.js notifyReporter.
    if (bug.reporter_id && bug.institute_id) {
      const senderId = await systemSenderId();
      if (senderId && senderId !== bug.reporter_id) {
        createAndDispatchNotification({
          instituteId: bug.institute_id,
          senderId,
          title: `Update on your bug report ${bug.id}`,
          body: message.slice(0, 200),
          contacts: [{ userId: bug.reporter_id, email: null, phone: null, name: bug.reporter_name }],
          audienceSummary: 'Bug report update',
          sendWhatsapp: false
        }).catch((e) => console.error('AutoFix notify error:', e.message));
      }
    }

    return res.json({ status: 'success', bug_status: changeStatus ? status : bug.status });
  } catch (error) {
    console.error('AutoFix update error:', error);
    return res.status(500).json({ detail: error.message });
  }
});

module.exports = router;
