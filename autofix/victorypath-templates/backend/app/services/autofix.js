// AutoFix integration: every new WEB bug report is forwarded to the AutoFix
// server, where Gemma triages it and LOW-risk ones are fixed by the AI agent
// and deployed. Progress comes back through routes/autofix_routes.js.
//
// Needs AUTOFIX_URL and AUTOFIX_SECRET in backend/.env; without them this is a
// no-op, so the bug flow works exactly as before.
const AUTOFIX_URL = (process.env.AUTOFIX_URL || '').replace(/\/+$/, '');
const AUTOFIX_SECRET = process.env.AUTOFIX_SECRET || '';

// Fire-and-forget: a slow or offline AutoFix server must never break filing a bug.
function forwardBugToAutofix(bug) {
  // Only the web app is deployed by the CI/CD pipeline; mobile bugs stay manual.
  if (!AUTOFIX_URL || !AUTOFIX_SECRET || !bug || bug.platform !== 'WEB') return;

  const description = bug.steps_to_reproduce
    ? `${bug.description}\n\nSteps to reproduce:\n${bug.steps_to_reproduce}`
    : bug.description;

  fetch(`${AUTOFIX_URL}/api/tickets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-AutoFix-Secret': AUTOFIX_SECRET },
    body: JSON.stringify({
      title: bug.title,
      description: description.slice(0, 5000),
      page_url: bug.page || null,
      reporter_name: bug.reporter_name || null,
      source: 'victorypath',
      external_id: bug.id
    }),
    signal: AbortSignal.timeout(10000)
  })
    .then((r) => { if (!r.ok) console.error(`AutoFix forward of ${bug.id} failed: HTTP ${r.status}`); })
    .catch((e) => console.error(`AutoFix forward of ${bug.id} failed:`, e.message));
}

module.exports = { forwardBugToAutofix };
