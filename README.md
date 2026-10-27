# VTU Hackfest 2026 — Monorepo

Welcome to the **VTU Hackfest 2026** monorepo (`vtu-monorepo`). This repository houses the entire ecosystem built for Hackfest 2026, comprising an AI-powered automated ticket triage and healing system, an e-commerce platform, and a customer support helpdesk.

---

## 📦 Projects Overview

| Folder | Project | Stack | Description |
|---|---|---|---|
| [`trick-or-commit/`](./trick-or-commit) | **Trick or Commit** | React 19, Vite, Express, SQLite, MongoDB, SMEPay UPI | E-commerce merchandise store for the VTU Hacktoberfest 2026 event. Includes product catalogue, cart, checkout, payments, and an in-app bug reporting widget. |
| [`helpdesk/`](./helpdesk) | **Lantern Desk** | Node.js, Express, SQLite, MongoDB, Vanilla HTML/CSS/JS | Standalone customer service portal. Manages bug reports, ticket triage stages, and customer communication timelines. |
| [`autofix/`](./autofix) | **AutoFix** | Python 3, FastAPI, Ollama (Gemma), Claude Code, SQLite | AI-powered autonomous agent pipeline. Triages inbound tickets with Gemma and automatically generates, tests, and pushes code fixes with Claude Code. |

---

## 🏛 Architecture & Data Flow

```text
[ Trick or Commit Store ] ──(Report Bug)──► [ Lantern Desk Helpdesk ]
                                                      │
                                                      ▼
[ Production Deploy / Actions ] ◄──(Push Fix)── [ AutoFix (Gemma + Claude) ]
```

1. **User Reports Problem**: When an issue is observed on the store, a user submits a bug report via the floating widget with reproduction steps and screenshots.
2. **Ticket Ingestion**: Lantern Desk ingests the ticket and sends it to the AutoFix engine.
3. **AI Triage**: AutoFix uses **Gemma** to analyze risk and classify the ticket (`LOW`, `MODERATE`, `HIGH`).
4. **Autonomous Fix**: For `LOW` risk tickets, **Claude Code** operates within a sandboxed clone, validates guardrails, builds, tests, and commits the fix.
5. **Continuous Deployment**: Fixes are pushed to GitHub, triggering CI/CD verification and live updates.

---

## 🚀 Getting Started

### Prerequisites
- **Node.js**: v18+ (v20+ recommended)
- **Python**: v3.11+
- **Git**
- Optional: **Ollama** (for local `gemma4:e4b` execution)

### Environment Configuration
Each project folder includes a `.env.example` file documenting all required configuration variables:
- `trick-or-commit/backend/.env.example`
- `helpdesk/.env.example`
- `autofix/.env.example`

Copy each example to `.env` and fill in your local secrets before running:
```bash
cp trick-or-commit/backend/.env.example trick-or-commit/backend/.env
cp helpdesk/.env.example helpdesk/.env
cp autofix/.env.example autofix/.env
```

---

## 📄 Documentation & Slides
- [STATUS.md](./STATUS.md) — Detailed sprint status, architecture notes, and verification logs.
- [Code Warriors.pptx](./Code%20Warriors.pptx) — Project presentation slides.
