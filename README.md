# Trick or Commit 🎃

Halloween costumes and **Hacktoberfest 2026** tees for the **VTU on-campus event**, powered by **GDG on Campus VTU**.
A complete demo e-commerce site: marketing landing page, shop, cart, checkout with a payment gateway, customer
accounts and an admin dashboard. React frontend, Node/Express backend, one Render service.

> Unofficial demo store built for Hackfest 2026. Not affiliated with DigitalOcean (Hacktoberfest) or Google
> (GDG on Campus). Payments run in test mode; no real money is charged.

## Features
- **Marketing site**: hero with countdown to Halloween hack night, live stats from the database (orders, tees sold,
  subscribers), featured products, event schedule, FAQ, newsletter signup.
- **Shop**: categories, search, size and price filters, sorting, product pages with sizes, stock levels and related items.
- **Cart and checkout**: persistent cart, server-side pricing, coupon codes, free shipping over ₹999, free campus
  pickup, Indian phone/PIN validation, guest or signed-in checkout.
- **Payments**: **SMEPay** UPI checkout widget (scan a QR with any UPI app). The server creates the SMEPay order and
  marks it paid only after SMEPay's `/order/validate` confirms it; the webhook (`/api/payments/smepay/callback`) is
  re-validated the same way. Razorpay is available as an alternative (`PAYMENT_PROVIDER=razorpay`). With no keys set,
  a built-in demo gateway is used so checkout always works. Live mode is refused unless `ALLOW_LIVE_PAYMENTS=true`.
- **Orders**: stock is decremented atomically when payment is confirmed; confirmation page; order history.
- **Accounts**: register, sign in (JWT, bcrypt).
- **Admin dashboard** (`/admin`): revenue, orders, items sold, low-stock alerts, 14-day revenue chart, order status
  management (cancelling restocks), product price/stock/visibility editing, add products.
- **Report a problem** (`/report`): a floating "Report a bug" button on every page opens a full ticket form: problem
  type, page (auto-filled), what happened, steps to reproduce, expected vs actual, up to 3 screenshots
  (click, drag and drop, or paste with Ctrl+V; PNG/JPEG/GIF/WebP, 3 MB each, checked by file content), contact
  details and optional browser info. Reporters get a private tracking page (`/ticket/:id`) with status, timeline and
  comments; signed-in users see "Your reports" on their account. Admins triage in the **Tickets** tab.
- **Helpdesk + AutoFix**: tickets are written straight into the Lantern Desk helpdesk's MongoDB collections (same
  database). The helpdesk, running next to AutoFix, forwards them for Gemma triage and Claude auto-fix; agent replies
  and AutoFix progress show on the store's tracking page, and answering AutoFix's questions here re-triages.

Coupons: `HACKTOBER26` (15% off ₹999+), `GDGVTU` (₹100 off ₹599+), `SPOOKY10` (10% off).

## Stack
| Part | Tech |
|---|---|
| Frontend | React 19, Vite, React Router, lucide-react |
| Backend | Node 22.13+ / Express, MongoDB Atlas, JWT, bcryptjs |
| Payments | SMEPay Wizard API + checkout widget (test mode); Razorpay optional |
| Hosting | Render web service (`render.yaml`), GitHub Actions CI |

## Run locally
```bash
npm run setup                     # install backend + frontend
cp backend/.env.example backend/.env
npm run dev:api                   # API on http://localhost:4000
npm run dev:web                   # site on http://localhost:5173 (proxies /api)
```
Admin login: the `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `backend/.env` (created on first start).

Production-style run (Express serves the built site): `npm run build && npm start`, then open http://localhost:4000.

Tests: `npm test` (API: catalogue, auth, pricing, checkout, stock, admin, payments, tickets and uploads, AutoFix
forward and callback). Lint: `npm run lint`.

## Deploy on Render
1. Push this repo to GitHub.
2. Render → **New → Blueprint** → select the repo. `render.yaml` creates one free web service.
3. In the service's **Environment**, set `MONGODB_URI` (the helpdesk's Atlas cluster; allow Render in Atlas
   Network Access), `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `SMEPAY_CLIENT_ID` /
   `SMEPAY_CLIENT_SECRET` (from app.smepay.in → Integrations; keep `SMEPAY_ENV=test`). `JWT_SECRET` is generated for you.
4. Every push to the default branch redeploys automatically. Health check: `/api/health`.

**Data:** everything is in MongoDB Atlas, so orders, accounts and tickets survive deploys. Products are seeded on
first start. Tests use a throwaway database on the same cluster (`MONGODB_URI` in `backend/.env`).

## Project layout
```
backend/   Express API: src/routes/*, pricing.js, payments.js, db.js (schema + seed.js), test/
frontend/  React app: src/pages/*, src/components/*, src/context/* (cart, auth), src/content/event.js
render.yaml, .github/workflows/ci.yml
```
Event details (dates, venue, schedule, FAQ) live in `frontend/src/content/event.js`; the catalogue seed is in
`backend/src/seed.js`.
