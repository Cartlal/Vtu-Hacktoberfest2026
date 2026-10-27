"""All settings come from environment variables (or autofix/.env)."""
import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def _list(name: str, default: str = "") -> list[str]:
    return [p.strip() for p in os.getenv(name, default).split(",") if p.strip()]


def _bool(name: str, default: str = "true") -> bool:
    return os.getenv(name, default).strip().lower() in ("1", "true", "yes", "on")


# --- Server ---
DB_PATH = os.getenv("AUTOFIX_DB", str(BASE_DIR / "autofix.db"))
TICKET_PREFIX = os.getenv("TICKET_PREFIX", "VP")
# Shared secret for admin actions and the GitHub Actions callback.
AUTOFIX_SECRET = os.getenv("AUTOFIX_SECRET", "")
# Origins allowed to post tickets from the browser (the VictoryPath site).
ALLOWED_ORIGINS = _list("ALLOWED_ORIGINS", "*")

# VictoryPath backend base URL. When set, AutoFix posts progress onto the
# linked bug report (POST /api/autofix/bugs/<BUG-id>/update) using AUTOFIX_SECRET.
VICTORYPATH_API_URL = os.getenv("VICTORYPATH_API_URL", "").rstrip("/")

# --- Gemma triage ---
# "google": hosted Gemma through the Gemini API (needs GEMMA_API_KEY).
# "openai": any OpenAI-compatible chat API at GEMMA_BASE_URL, e.g. OpenRouter's
#           free Gemma models (needs GEMMA_API_KEY).
# "ollama": a local or remote Ollama server at OLLAMA_URL.
GEMMA_PROVIDER = os.getenv("GEMMA_PROVIDER", "google")
GEMMA_API_KEY = os.getenv("GEMMA_API_KEY") or os.getenv("GEMINI_API_KEY", "")
# Comma-separated: on HTTP 429 (common on free tiers) the next model is tried.
GEMMA_MODELS = _list("GEMMA_MODEL") or [{
    "google": "gemma-4-26b-a4b-it",
    "openai": "google/gemma-4-26b-a4b-it:free",
}.get(GEMMA_PROVIDER, "gemma4:e4b")]
GEMMA_MODEL = GEMMA_MODELS[0]
# When every model is rate-limited: rounds of retries, waiting RATE_LIMIT_WAIT x round
# seconds between them; after that the ticket stays NEW and is retried every
# TRIAGE_RETRY_SECONDS.
RATE_LIMIT_ROUNDS = int(os.getenv("RATE_LIMIT_ROUNDS", "3"))
RATE_LIMIT_WAIT = float(os.getenv("RATE_LIMIT_WAIT", "10"))
TRIAGE_RETRY_SECONDS = float(os.getenv("TRIAGE_RETRY_SECONDS", "60"))
GOOGLE_API_URL = os.getenv("GOOGLE_API_URL", "https://generativelanguage.googleapis.com/v1beta")
GEMMA_BASE_URL = os.getenv("GEMMA_BASE_URL", "https://openrouter.ai/api/v1").rstrip("/")
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
GEMMA_TIMEOUT = float(os.getenv("GEMMA_TIMEOUT", "120"))
MIN_CONFIDENCE = float(os.getenv("MIN_CONFIDENCE", "0.75"))

# --- Claude worker ---
WORKER_ENABLED = _bool("WORKER_ENABLED")
WORKER_POLL_SECONDS = float(os.getenv("WORKER_POLL_SECONDS", "5"))
# A dedicated clone of the VictoryPath repo. The worker hard-resets it, so never
# point this at a folder you edit by hand.
REPO_DIR = os.getenv("VICTORYPATH_REPO_DIR", "")
GIT_BRANCH = os.getenv("GIT_BRANCH", "Production")  # VictoryPath deploys from Production
# "main" pushes straight to GIT_BRANCH (CI still gates the deploy);
# "branch" pushes to ai/<ticket-id> for review.
PUSH_MODE = os.getenv("PUSH_MODE", "main")
GIT_AUTHOR_NAME = os.getenv("GIT_AUTHOR_NAME", "AutoFix Bot")
GIT_AUTHOR_EMAIL = os.getenv("GIT_AUTHOR_EMAIL", "autofix-bot@users.noreply.github.com")
BUILD_CMD = os.getenv("BUILD_CMD", "")
TEST_CMD = os.getenv("TEST_CMD", "")

CLAUDE_BIN = os.getenv("CLAUDE_BIN", "claude")
CLAUDE_MODEL = os.getenv("CLAUDE_MODEL", "sonnet")
CLAUDE_TIMEOUT = int(os.getenv("CLAUDE_TIMEOUT", "600"))
CLAUDE_MAX_BUDGET_USD = os.getenv("CLAUDE_MAX_BUDGET_USD", "")
MAX_ATTEMPTS = int(os.getenv("MAX_ATTEMPTS", "2"))

# Guardrails on what the agent may change.
ALLOWED_PATHS = _list("ALLOWED_PATHS")  # empty = anywhere except PROTECTED_PATHS
PROTECTED_PATHS = _list("PROTECTED_PATHS", ".github/,.env,CLAUDE.md")
MAX_CHANGED_FILES = int(os.getenv("MAX_CHANGED_FILES", "5"))
MAX_DIFF_LINES = int(os.getenv("MAX_DIFF_LINES", "200"))
