"""VictoryPath AutoFix API.

Run with:  uvicorn app.main:app --reload --port 8000   (from the autofix/ folder)
"""
import hmac
import logging
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from fastapi import BackgroundTasks, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from . import config, db, triage, victorypath, worker
from .db import Status

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("autofix")

DASHBOARD = Path(__file__).parent / "static" / "dashboard.html"


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    db.on_status_change(victorypath.sync_status)
    stop = threading.Event()
    # Re-triages tickets still NEW: rate-limited ones, or ones that arrived while down.
    threading.Thread(target=triage.retry_loop, args=(stop,), name="triage-retry", daemon=True).start()
    worker.start(stop)
    yield
    stop.set()


app = FastAPI(title="VictoryPath AutoFix", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.ALLOWED_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


def require_secret(secret: str | None) -> None:
    if not config.AUTOFIX_SECRET:
        raise HTTPException(503, "AUTOFIX_SECRET is not configured on the server")
    if not secret or not hmac.compare_digest(secret, config.AUTOFIX_SECRET):
        raise HTTPException(401, "bad or missing X-AutoFix-Secret header")


class TicketIn(BaseModel):
    title: str = Field(min_length=3, max_length=200)
    description: str = Field(min_length=5, max_length=5000)
    page_url: str | None = Field(default=None, max_length=500)
    reporter_name: str | None = Field(default=None, max_length=100)
    reporter_email: str | None = Field(default=None, max_length=200)
    reporter_phone: str | None = Field(default=None, max_length=30)
    source: str = Field(default="victorypath", max_length=30)
    # VictoryPath bug report ID (e.g. BUG-1A2B3C). Requires X-AutoFix-Secret,
    # because AutoFix posts progress back onto that report.
    external_id: str | None = Field(default=None, max_length=40, pattern=r"^[A-Za-z0-9_-]+$")


class DeployStatusIn(BaseModel):
    ticket_ids: list[str]
    status: Literal["started", "success", "failure"]
    run_url: str | None = None
    sha: str | None = None


@app.get("/", include_in_schema=False)
@app.get("/dashboard", include_in_schema=False)
def dashboard():
    """Halloween-themed live view of where every ticket is in the pipeline."""
    return FileResponse(DASHBOARD)


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/api/tickets", status_code=201)
def create_ticket(body: TicketIn, background: BackgroundTasks,
                  x_autofix_secret: str | None = Header(default=None)):
    if body.external_id:
        require_secret(x_autofix_secret)
    ticket = db.create_ticket(body.model_dump())
    background.add_task(triage.triage_ticket, ticket["id"])
    return {"id": ticket["id"], "status": ticket["status"]}


@app.get("/api/tickets")
def list_tickets(status: str | None = None):
    return db.list_tickets(status)


@app.get("/api/tickets/{tid}")
def get_ticket(tid: str):
    ticket = db.get_ticket(tid)
    if not ticket:
        raise HTTPException(404, "ticket not found")
    return ticket


@app.post("/api/tickets/{tid}/approve")
def approve_ticket(tid: str, x_autofix_secret: str | None = Header(default=None)):
    """A human sends a NEEDS_INFO / HUMAN / failed ticket to the Claude worker anyway."""
    require_secret(x_autofix_secret)
    ticket = db.get_ticket(tid)
    if not ticket:
        raise HTTPException(404, "ticket not found")
    allowed = {Status.NEEDS_INFO, Status.HUMAN, Status.AGENT_FAILED, Status.DEPLOY_FAILED}
    if ticket["status"] not in allowed:
        raise HTTPException(409, f"cannot approve a ticket in status {ticket['status']}")
    if not ticket["task_spec"]:
        raise HTTPException(409, "ticket has no task spec from triage yet")
    db.update_ticket(tid, status=Status.QUEUED, error=None)
    return {"id": tid, "status": Status.QUEUED}


@app.post("/api/deploy-status")
def deploy_status(body: DeployStatusIn, x_autofix_secret: str | None = Header(default=None)):
    """Called by the GitHub Actions deploy workflow."""
    require_secret(x_autofix_secret)
    new_status = {"started": Status.DEPLOYING, "success": Status.LIVE,
                  "failure": Status.DEPLOY_FAILED}[body.status]
    updated = []
    for tid in body.ticket_ids:
        ticket = db.get_ticket(tid)
        if not ticket or ticket["status"] not in (Status.PUSHED, Status.DEPLOYING):
            continue
        fields = {"status": new_status, "run_url": body.run_url}
        if new_status == Status.LIVE:
            fields["deployed_at"] = db.now()
        db.update_ticket(tid, **fields)
        updated.append(tid)
    log.info("deploy %s for %s", body.status, updated or "no matching tickets")
    return {"updated": updated}
