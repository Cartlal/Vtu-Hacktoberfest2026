// AutoFix integration. New tickets are forwarded to the AutoFix server, where
// Gemma triages them and LOW-risk ones are fixed by the Claude coding agent.
// AutoFix posts progress back to POST /api/autofix/bugs/:id/update.
//
// Needs AUTOFIX_URL and AUTOFIX_SECRET; without them this is a no-op and
// tickets are handled by humans in the admin dashboard.
const db = require('./db');

const CATEGORY_LABELS = {
  bug: 'Something is broken', typo: 'Wrong text or typo', design: 'Design / layout',
  feature: 'Feature request', payment: 'Payment or order problem', other: 'Other'
};

function enabled() {
  return !!(process.env.AUTOFIX_URL && process.env.AUTOFIX_SECRET);
}

function describe(ticket) {
  return [
    ticket.description,
    ticket.steps && `Steps to reproduce:\n${ticket.steps}`,
    ticket.expected && `Expected: ${ticket.expected}`,
    ticket.actual && `Actual: ${ticket.actual}`,
    `Category: ${CATEGORY_LABELS[ticket.category] || ticket.category} · Reporter severity: ${ticket.severity}`
  ].filter(Boolean).join('\n\n').slice(0, 5000);
}

// Fire-and-forget: a slow or offline AutoFix must never break raising a ticket.
function forwardTicket(ticket) {
  if (!enabled()) return;
  const url = `${process.env.AUTOFIX_URL.replace(/\/+$/, '')}/api/tickets`;
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-AutoFix-Secret': process.env.AUTOFIX_SECRET },
    body: JSON.stringify({
      title: ticket.title,
      description: describe(ticket),
      page_url: ticket.pageUrl || null,
      reporter_name: ticket.name || null,
      source: 'trick-or-commit',
      external_id: ticket.id
    }),
    signal: AbortSignal.timeout(10000)
  })
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      db.get().prepare('UPDATE tickets SET autofix_id = ? WHERE id = ?').run(body.id || null, ticket.id);
    })
    .catch((err) => console.error(`AutoFix forward of ${ticket.id} failed:`, err.message));
}

module.exports = { enabled, forwardTicket };
