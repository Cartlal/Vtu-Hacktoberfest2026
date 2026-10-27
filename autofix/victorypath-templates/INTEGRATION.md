# Wiring AutoFix into VictoryPath

Everything in this folder mirrors the VictoryPath repo layout. Nothing here
changes how the app behaves until `AUTOFIX_URL` and `AUTOFIX_SECRET` are set.

## 1. Backend (forward bugs in, receive progress back)
1. Copy `backend/app/services/autofix.js` and `backend/app/routes/autofix_routes.js`.
2. `backend/app/routes/bug_routes.js`:
   ```js
   const { forwardBugToAutofix } = require('../services/autofix');
   ```
   In `router.post('/', ...)`, replace
   ```js
   return res.json({ status: 'success', bug: await loadBug(id) });
   ```
   with
   ```js
   const bug = await loadBug(id);
   forwardBugToAutofix(bug);
   return res.json({ status: 'success', bug });
   ```
3. `backend/index.js`, next to the other routers:
   ```js
   const autofixRouter = require('./app/routes/autofix_routes');
   app.use('/api/autofix', autofixRouter);
   ```
4. `backend/.env` (on the server, never committed):
   ```
   AUTOFIX_URL=https://<your AutoFix tunnel URL>
   AUTOFIX_SECRET=<same value as autofix/.env>
   ```

AutoFix comments on the bug's timeline as **AutoFix (AI)**. It moves the report
to In Progress when the AI starts and to Resolved when the fix is live, and it
never touches a report a human has already Closed or Rejected.

## 2. CI/CD
Replace `.github/workflows/ci-cd.yml` with the one here. The CI jobs and deploy
step are unchanged; the deploy job gains a health check, AutoFix status
reports, and automatic revert-and-redeploy when an **AutoFix** commit breaks the
deploy.
- New repo secret: `AUTOFIX_SECRET`
- New repo variables: `AUTOFIX_URL`, `HEALTH_URL` (defaults to the site root)
- If `Production` is a protected branch, allow GitHub Actions to push to it so
  the revert can land, or the rollback step will fail and only report.

## 3. CLAUDE.md
Copy `CLAUDE.md` to the repo root. Claude reads it first on every ticket.

## 4. The worker's clone
```bash
git clone --branch Production <repo-url> C:/autofix-work/VictoryPath
cd C:/autofix-work/VictoryPath/frontend && npm ci
```
The worker pushes AutoFix commits straight to `Production` (CI still has to
pass before anything deploys), so this clone needs push access to that branch.
