# Hackfest 2026 — Project Status

_Last updated: 27 Oct 2026_

Solo project. Three parts live in this folder:

| Folder | What it is | State |
|---|---|---|
| [`autofix/`](autofix/) | **AutoFix**: AI ticket triage (Gemma) + automatic fixing (Claude Code) + deploy via GitHub Actions | Core built and tested locally |
| [`trick-or-commit/`](trick-or-commit/) | **Trick or Commit**: demo e-commerce store (the website AutoFix will fix) | Built, tested, pushed to GitHub, CI green; Render deploy in progress |
| [`helpdesk/`](helpdesk/) | **Lantern Desk**: separate helpdesk website (the "support company") that client sites send tickets to; agent dashboard + customer tracking page; bridges to AutoFix | Built, 8/8 tests, checked in the browser; not yet connected to the store or a live AutoFix |

---

## The idea

Bulk tickets come in from a ticketing source. **Gemma** reads each one and rates it:

| Risk | Meaning | What happens |
|---|---|---|
| LOW | Small frontend / form change | Sent to the **Claude coding agent**, which fixes it, builds, and `git push`es |
| MODERATE | Needs clarification | Questions go back to the reporter |
| HIGH | Architecture-level change | Normal human process |

GitHub Actions then builds, deploys, health-checks (rolling back on failure), and the fix is **live on the website**.
Source: the handwritten "Planning Book" notes (3 pages).

---

## Part 1 — AutoFix (`autofix/`)

Python + FastAPI + SQLite. See [`autofix/README.md`](autofix/README.md).

### Done
- **Ticket API** (`app/main.py`): create/list/get tickets, human "approve" override, `/api/deploy-status` callback for GitHub Actions. Shared-secret auth on admin and callback routes.
- **Gemma triage** (`app/triage.py`):
  - LOW / MODERATE / HIGH with a structured JSON result (summary, task spec, clarifying questions, confidence).
  - Guardrails the model can't override: sensitive keywords (login, roles, database, delete, payment…) and prompt-injection phrases force HIGH; low confidence forces MODERATE; a LOW without a task spec becomes MODERATE.
  - Providers: local **Ollama**, hosted Gemini API, or any OpenAI-compatible API (OpenRouter). Model fallback list, backoff on rate limits, and a background loop that retries tickets left NEW.
- **Claude worker** (`app/worker.py`): one ticket at a time in a dedicated clone → `claude -p` headless with a tool allowlist (no push/commit/curl/rm/web) → independent checks (allowed paths, protected files, size limits, build + lint) → commit with the ticket ID → push. Retries, then hands to a human.
- **Status sync** (`app/victorypath.py`): mirrors progress onto a linked bug report (built for VictoryPath; on hold).
- **VictoryPath templates** (`victorypath-templates/`): CI/CD workflow with health check + auto-revert, backend hook files, `CLAUDE.md`, integration guide. **On hold** — focus moved to the demo store.
- **Dashboard** (`app/static/dashboard.html`): added by Karthik.

### Gemma model journey
| Tried | Result |
|---|---|
| Local `gemma4:26b` (Ollama) | 14/15 correct; one runaway-output bug fixed with schema length caps |
| Google Gemini API key | 403: free tier not available for that Google project (even after enabling billing) |
| OpenRouter free Gemma 4 (26B, 31B) | Key works, but the shared free pool was rate-limited |
| **Local `gemma4:e4b` (Ollama)** ✅ | **15/15 correct, ~7–9 s per ticket** — current setting |

### Verified
- API, routing, guardrails, secret checks — tested.
- Full worker run with real Claude on a throwaway repo: fixed a typo, checks passed, pushed (~$0.16).
- Guardrails reject protected-file edits, edits outside allowed paths, and empty changes.
- Triage eval: 15/15 on `samples/sample_tickets.json` with `gemma4:e4b`.

### Config notes
- `autofix/.env` (git-ignored) holds the keys: provider `ollama`, model `gemma4:e4b`; OpenRouter key kept for switching back.
- ⚠️ The Gemini and OpenRouter keys were pasted in chat — rotate them before sharing anything.

---

## Part 2 — Trick or Commit store (`trick-or-commit/`)

Halloween costumes + **Hacktoberfest 2026** tees for the **VTU on-campus event**, powered by **GDG on Campus VTU**.
GitHub: **https://github.com/Cartlal/Vtu-Hacktoberfest2026** (branch `main`). See [`trick-or-commit/README.md`](trick-or-commit/README.md).

### Stack
React 19 + Vite frontend · Node/Express backend · SQLite (`node:sqlite`) · **SMEPay** UPI checkout (test mode; Razorpay optional) · Render · GitHub Actions.

### Features
- **Marketing page**: hack-night countdown, live stats from the DB, featured products, event schedule, FAQ, newsletter signup.
- **Shop**: 16 products in 3 categories, search, size/price filters, sorting, product pages with stock and related items.
- **Cart & checkout**: server-side pricing, coupons (`HACKTOBER26`, `GDGVTU`, `SPOOKY10`), free shipping ≥ ₹999, free campus pickup, Indian phone/PIN validation, guest or signed-in checkout.
- **Payments** (SMEPay added 27 Oct): **SMEPay Wizard** widget (UPI QR popup) is used when `SMEPAY_CLIENT_ID`/`SMEPAY_CLIENT_SECRET` are set. Flow: auth (10-min token, cached) → create order → widget → server validates with SMEPay's `/order/validate` before marking paid. Webhook at `/api/payments/smepay/callback` replies 200 at once, then re-validates (spoofed or repeated webhooks do nothing). Test host `staging.smepay.in`; live refused unless `ALLOW_LIVE_PAYMENTS=true`. Razorpay kept as an option; demo gateway when no keys.
- **Accounts**: register/sign in (JWT, bcrypt), order history.
- **Admin** (`/admin`): revenue, orders, low stock, 14-day chart, order status (cancel restocks), product editing, add products, **Tickets** tab.
- **Report a problem / Raise a ticket** (added 27 Oct):
  - Floating "Report a bug" button on every page (remembers which page you were on) + footer and account links.
  - Full form: problem type (6 kinds), page, what happened, steps to reproduce, expected vs actual, contact details, optional browser/screen info.
  - Up to 3 screenshots: click, drag & drop, or paste (Ctrl+V); previews with remove; PNG/JPEG/GIF/WebP ≤ 3 MB, verified by file content on the server; stored in the database.
  - Private tracking page per ticket (`/ticket/BUG-XXXXXX`) with status, timeline and comments; "Your reports" on the account page.
  - **Severity is decided by the ticketing side, not the reporter**: AutoFix's Gemma risk sets it (LOW→low, MODERATE→medium, HIGH→high) unless an admin already set one; tickets show "Awaiting triage" until then. Old databases are migrated automatically.
  - Admin Tickets tab: filter by status/severity, view screenshots and browser info, set severity, change status with a note to the reporter.
  - Spam guard: 5 reports per device per 10 minutes.
  - **AutoFix hook**: with `AUTOFIX_URL` + `AUTOFIX_SECRET` set, new tickets are sent to AutoFix, and AutoFix's progress (In progress → Resolved) appears on the ticket timeline as "AutoFix (AI)".

### Verified
- Backend tests: **23/23 pass** (catalogue, auth, pricing, checkout, stock, admin, marketing, payments, tickets + uploads, AutoFix forward/callback with risk → severity, DB migration, rate limit, and SMEPay against a fake SMEPay server: order create, validate-before-paid, webhook re-check, retries, token refresh, live-mode guard).
- Ticket flow in the browser: report button → page auto-filled → validation → 2 screenshots attached (non-image and 4th file rejected) → submit → tracking page with images → admin moves it to In progress with a note. No console errors; works on a phone screen.
- Frontend lint and build: clean.
- Browser walkthrough: product → size check → cart → coupon → checkout validation → demo payment → confirmation → admin dashboard. No console errors; mobile layout OK.
- GitHub Actions CI on the first push: **success**.

### Render deployment — in progress
The service was first created as a **Static Site** with Root Directory set to `npm run build`, which fails
("Root directory does not exist" / "Publish Directory required"). A static site can't run the backend.

**Fix:** delete the Static Site and create a **Blueprint** (uses `render.yaml`) or a **Web Service**:

| Field | Value |
|---|---|
| Root Directory | _empty_ |
| Language | Node |
| Build Command | `npm run build` |
| Start Command | `npm start` |
| Env | `NODE_ENV=production`, `NODE_VERSION=24`, `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `SMEPAY_CLIENT_ID`, `SMEPAY_CLIENT_SECRET`, `SMEPAY_ENV=test` |

Check it worked: `https://<service>.onrender.com/api/health` → `{"ok":true}`.

### Known limitations
- Render free plan resets the SQLite file on each deploy/restart: products re-seed, orders/accounts are lost.
- Free services sleep after ~15 min idle; the first visit takes 30–60 s. Open the site before demoing.
- Event date/venue in `frontend/src/content/event.js` are placeholders (Oct 31, 6 pm; Jnana Sangama, Belagavi) — confirm them.
- No emails are sent (order confirmation is on-screen only).
- SMEPay is tested against a fake server only; it needs real SMEPay test credentials for a live check (the SMEPay dashboard may also require business verification).

---

## Part 3 — Lantern Desk helpdesk (`helpdesk/`)

A standalone helpdesk site, run like an outside support company. See [`helpdesk/README.md`](helpdesk/README.md).
GitHub: **https://github.com/Cartlal/xyz-service-company**.

### Stack
Node/Express · SQLite (`node:sqlite`) · plain HTML/CSS/JS pages (no build step) · runs locally next to AutoFix, so tickets survive store redeploys.

### Done
- **Intake**: client API `POST /api/v1/tickets` with a per-client API key (hashed, rotatable), plus a hosted form at `/request/<client>`. Up to 3 screenshots (checked by file content).
- **Agent workspace** (`/app`): overview numbers (open, new, waiting, AutoFix working, needs developer, fixed by AutoFix + rate, median reply/solve/AutoFix times), 14-day chart, AutoFix stage counts, recent activity; 10 saved views with search, filters, sort, CSV export; ticket page with replies, internal notes, status/priority/category/assignee and an AutoFix panel (risk, Gemma summary, guardrail, task, questions, commit, deploy run, agent log, "Fix it anyway" / "Re-triage").
- **Customer tracking page** (`/t/<id>?token=`): progress bar, replies; answering AutoFix's questions re-triages automatically.
- **AutoFix bridge**: forwards each ticket with `external_id`, polls AutoFix every 15 s, and answers AutoFix's existing callback path `/api/autofix/bugs/<id>/update`, so AutoFix only needs `VICTORYPATH_API_URL` pointed at the helpdesk.
- `npm run seed:demo` adds 19 realistic tickets at every stage.

### Verified
- 8/8 API tests against a fake AutoFix (full NEEDS_INFO → reply → re-triage → fix → LIVE path, developer hand-off, notes stay internal, tokens, keys).
- Browser: landing, sign-in, overview, views, ticket page, clients, hosted form, tracking page; no sideways scrolling at phone width.

### Not done yet
- Store not connected yet (another session was changing the store's ticket code). The store's backend should post its "Report a problem" form to `/api/v1/tickets` with its key.
- Not tested against the real AutoFix + Gemma yet.

---

## Next steps
1. **Finish Render deploy** of the store as a Web Service / Blueprint.
2. **Point AutoFix at the store**: dedicated clone of `Vtu-Hacktoberfest2026`, set `GIT_BRANCH=main`, `BUILD_CMD`/`TEST_CMD` to the store's build/test, `ALLOWED_PATHS=frontend/src/`, add a `CLAUDE.md` to the store repo, and set AutoFix's `VICTORYPATH_API_URL` to the store's Render URL (the store implements the same callback).
3. ~~Ticket intake from the store~~ — done: "Report a problem" form forwards to AutoFix once `AUTOFIX_URL`/`AUTOFIX_SECRET` are set on Render.
4. **Deploy feedback**: health check + AutoFix status callback in the store's CI (Render auto-deploys on push).
5. **Demo rehearsal**: seed bulk tickets, show Gemma triage → Claude fix → push → live change on the site; record a backup video.
6. Rotate the API keys that were shared in chat.
