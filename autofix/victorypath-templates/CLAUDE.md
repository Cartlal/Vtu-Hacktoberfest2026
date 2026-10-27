# VictoryPath: notes for coding agents

VictoryPath AI helps KLE Tech mentors, HODs and admins spot students at risk of
academic disengagement and act early (meetings, calls, WhatsApp/notifications).

## Stack
- **Frontend** (`frontend/`): React 19 + Vite, react-router-dom 7, styled-components,
  framer-motion, lucide-react icons, axios (`src/api/client.js`).
- **Backend** (`backend/`): Node + Express, PostgreSQL 18 (`app/db/schema.sql`,
  applied on boot), JWT auth.
- **Mobile** (`mobile/`): Flutter. **OpenWA** (`OpenWA/`): WhatsApp gateway.
- Production: Windows server, PM2 (`ecosystem.config.js`), deployed by
  `.github/workflows/ci-cd.yml` on every push to the `Production` branch.

## Where things live (frontend)
| What | Path |
|---|---|
| Routes | `frontend/src/App.jsx` |
| Pages (one file per screen) | `frontend/src/pages/` (e.g. `HodDashboard.jsx`, `Students.jsx`, `ReportBug.jsx`) |
| Shared components | `frontend/src/components/` (`Sidebar.jsx`, `Navbar.jsx`, `Dialog.jsx`, ...) |
| Global styles / theme variables | `frontend/src/index.css`, `frontend/src/App.css`, `frontend/src/Dashboard.css` |
| Page-specific CSS | next to the page, e.g. `pages/BugReports.css` |

## Style rules (from THEME_GUIDELINES.md)
- Monochrome theme. Use the CSS variables (`var(--bg-page)`, `var(--bg-card)`,
  `var(--border-color)`, `var(--text-main)`, `var(--text-muted)`), never hard-coded colours.
- Dark mode is the `.dark-theme` class on `.theme2-root`; don't add `@media` dark-mode rules.
- Use `useToast()` from `context/ToastContext` and the `Dialog` component, not `alert()`.

## Checks (both must pass; CI runs the same)
- `npm --prefix frontend run lint`
- `npm --prefix frontend run build`

## Rules for automated (AutoFix) changes
- Smallest change that fixes the ticket; match the surrounding code style.
- Frontend only (`frontend/src/`). No new dependencies.
- Never edit: login/auth (`context/AuthContext.jsx`, `pages/Login.jsx`,
  `components/ForcedPasswordGate.jsx`), roles (`constants/roles.js`), the API
  client (`api/client.js`), anything under `backend/`, `deploy/`, `.github/`,
  `.env*`, `ecosystem.config.js`, `render.yaml`, or this file.
- Text fixes: change the visible string only; check whether the same typo
  appears elsewhere on that same page.
