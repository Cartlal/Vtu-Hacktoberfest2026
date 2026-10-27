# VictoryPath AutoFix

Bugs reported in VictoryPath ("Report a Bug") are forwarded here. **Gemma**
(hosted, through the Gemini API) rates each as LOW / MODERATE / HIGH risk.
LOW ones are fixed by **Claude Code** running on this machine, pushed to the
`Production` branch, and deployed by VictoryPath's **GitHub Actions** pipeline.
Progress appears on the bug report's own timeline, ending in "Resolved".

```
VictoryPath "Report a Bug" ─► VictoryPath backend ─► POST /api/tickets (AutoFix)
                                                           │
                                       Gemma triage ───────┼─ MODERATE ─► questions on the bug report
                                                           ├─ HIGH ─────► "needs a developer"
                                                           ▼ LOW
                                       Claude worker: edit → lint → build → push to Production
                                                           ▼
             GitHub Actions ci-cd.yml: CI → deploy.ps1 over SSH → health check (→ revert + redeploy)
                                                           ▼
             /api/deploy-status ─► ticket LIVE ─► bug report "Resolved" + reporter notified
```

## Layout
| Path | What |
|---|---|
| `app/main.py` | FastAPI: tickets, approve, deploy-status callback |
| `app/triage.py` | Gemma prompt and schema, output validation, keyword/confidence guardrails |
| `app/worker.py` | Claude worker: reset clone → `claude -p` → checks → commit → push |
| `app/victorypath.py` | Posts progress onto the linked VictoryPath bug report |
| `app/db.py` | SQLite tickets table and statuses |
| `scripts/eval_triage.py` | Gemma accuracy check on `samples/sample_tickets.json` |
| `victorypath-templates/` | Files for the VictoryPath repo; see its `INTEGRATION.md` |

## Setup
1. `pip install -r requirements.txt`
2. Get a Gemini API key (Google AI Studio) and put it in `GEMMA_API_KEY`.
3. Claude Code CLI installed and logged in (`claude` on PATH).
4. Make the worker's dedicated clone (it is hard-reset before every ticket):
   `git clone --branch Production <repo-url> C:/autofix-work/VictoryPath`,
   then `npm ci` inside its `frontend/`.
5. `copy .env.example .env` and fill it in.
6. Run: `uvicorn app.main:app --port 8000`
7. Expose it so VictoryPath and GitHub Actions can reach it, e.g.
   `cloudflared tunnel --url http://localhost:8000`, and use that URL as
   `AUTOFIX_URL` on the VictoryPath side.
8. Wire up VictoryPath: `victorypath-templates/INTEGRATION.md`.

## API
| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/tickets` | secret only when `external_id` is set | Create a ticket and triage it in the background |
| GET | `/api/tickets[?status=]` | none | List tickets |
| GET | `/api/tickets/{id}` | none | Ticket with triage result and agent log |
| POST | `/api/tickets/{id}/approve` | `X-AutoFix-Secret` | Human sends a ticket to the worker anyway |
| POST | `/api/deploy-status` | `X-AutoFix-Secret` | GitHub Actions reports started / success / failure |

Statuses: `NEW → QUEUED → IN_PROGRESS → PUSHED → DEPLOYING → LIVE`, plus
`NEEDS_INFO`, `HUMAN`, `AGENT_FAILED`, `DEPLOY_FAILED`.

## Safety
- Claude only sees Gemma's rewritten task spec, not the raw bug text.
- Sensitive keywords (login, role, database, delete, ...) and prompt-injection
  phrases force HIGH; low confidence downgrades LOW to MODERATE.
- Claude runs with `--permission-mode dontAsk` and an explicit tool allowlist:
  file tools, read-only git, and the lint/build commands. Push, commit, curl, rm
  and web access are denied.
- The worker independently rejects changes outside `frontend/src/`, to protected
  files (auth, roles, API client, backend, CI, `.env`), or above the size limits,
  and re-runs lint and build itself.
- CI must pass before deploy. A failed health check reverts the AutoFix commit
  and redeploys the previous version.

## Try it
```bash
python -m scripts.eval_triage
curl -X POST localhost:8000/api/tickets -H "Content-Type: application/json" -d "{\"title\":\"Typo on home page\",\"description\":\"Heading says Welcom, should be Welcome\"}"
curl localhost:8000/api/tickets/VP-1
```
