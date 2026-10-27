"""Mirror AutoFix progress onto the linked VictoryPath bug report.

VictoryPath's side is backend/app/routes/autofix_routes.js (see
victorypath-templates/), which adds a timeline entry and, when `status` is
given, moves the bug report to that status and notifies the reporter.
"""
import logging

import httpx

from . import config, db
from .db import Status

log = logging.getLogger("autofix.victorypath")


def _message(ticket: dict, status: str) -> tuple[str | None, str] | None:
    """(new VictoryPath status or None, timeline message) for an AutoFix status."""
    triage = ticket.get("triage") or {}
    if status == Status.QUEUED:
        return "IN_PROGRESS", (f"AutoFix: Gemma rated this LOW risk. The AI agent is fixing it.\n"
                               f"Plan: {ticket.get('task_spec') or ''}")
    if status == Status.NEEDS_INFO:
        questions = "\n".join(f"- {q}" for q in triage.get("clarifying_questions") or [])
        return None, f"AutoFix needs a little more detail before it can fix this:\n{questions}"
    if status == Status.HUMAN:
        why = ticket.get("error") or triage.get("guardrail") or triage.get("reason") or ""
        return None, f"AutoFix: this needs a developer (rated {ticket.get('risk') or 'HIGH'} risk). {why}"
    if status == Status.PUSHED:
        return None, f"AutoFix: fix committed ({(ticket.get('commit_sha') or '')[:8]}). Deploying now."
    if status == Status.LIVE:
        return "RESOLVED", "AutoFix: the fix is live. Please check it and confirm, or reopen if it's still wrong."
    if status in (Status.AGENT_FAILED, Status.DEPLOY_FAILED):
        return None, "AutoFix could not fix this automatically, so a developer will take over."
    return None  # NEW, IN_PROGRESS, DEPLOYING: nothing worth telling the reporter


def sync_status(tid: str, status: str) -> None:
    if not config.VICTORYPATH_API_URL or not config.AUTOFIX_SECRET:
        return
    ticket = db.get_ticket(tid)
    if not ticket or not ticket.get("external_id"):
        return
    update = _message(ticket, status)
    if not update:
        return
    new_status, message = update
    try:
        resp = httpx.post(
            f"{config.VICTORYPATH_API_URL}/api/autofix/bugs/{ticket['external_id']}/update",
            headers={"X-AutoFix-Secret": config.AUTOFIX_SECRET},
            # risk lets the receiving site set the ticket's severity from Gemma's triage.
            json={"status": new_status, "message": message, "ticket_id": tid, "risk": ticket.get("risk")},
            timeout=15,
        )
        resp.raise_for_status()
    except httpx.HTTPError as e:
        log.warning("could not update VictoryPath bug %s: %s", ticket["external_id"], e)
