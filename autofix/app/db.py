"""SQLite storage for tickets. One shared connection guarded by a lock."""
import json
import sqlite3
import threading
from datetime import datetime, timezone

from . import config


class Status:
    NEW = "NEW"                      # received, waiting for Gemma
    NEEDS_INFO = "NEEDS_INFO"        # MODERATE: reporter must clarify
    HUMAN = "HUMAN"                  # HIGH: normal human process
    QUEUED = "QUEUED"                # LOW: waiting for the Claude worker
    IN_PROGRESS = "IN_PROGRESS"      # Claude is working on it
    AGENT_FAILED = "AGENT_FAILED"    # Claude gave up; needs a human
    PUSHED = "PUSHED"                # commit pushed, waiting for CI/CD
    DEPLOYING = "DEPLOYING"          # GitHub Actions deploy running
    LIVE = "LIVE"                    # deployed and health check passed
    DEPLOY_FAILED = "DEPLOY_FAILED"  # CI/CD failed or rolled back


_COLUMNS = {
    "source", "external_id", "title", "description", "page_url", "reporter_name", "reporter_email",
    "reporter_phone", "status", "risk", "triage_json", "task_spec", "attempts", "error",
    "commit_sha", "run_url", "deployed_at",
}

_SCHEMA = """
CREATE TABLE IF NOT EXISTS tickets (
    n              INTEGER PRIMARY KEY AUTOINCREMENT,
    id             TEXT UNIQUE,
    source         TEXT,
    external_id    TEXT,
    title          TEXT NOT NULL,
    description    TEXT NOT NULL,
    page_url       TEXT,
    reporter_name  TEXT,
    reporter_email TEXT,
    reporter_phone TEXT,
    status         TEXT NOT NULL,
    risk           TEXT,
    triage_json    TEXT,
    task_spec      TEXT,
    attempts       INTEGER NOT NULL DEFAULT 0,
    error          TEXT,
    agent_log      TEXT NOT NULL DEFAULT '',
    commit_sha     TEXT,
    run_url        TEXT,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL,
    deployed_at    TEXT
)
"""

_lock = threading.Lock()
_conn: sqlite3.Connection | None = None
# Called as listener(ticket_id, new_status) on a background thread whenever
# update_ticket changes a status (used to mirror progress into VictoryPath).
_status_listeners: list = []


def on_status_change(listener) -> None:
    _status_listeners.append(listener)


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def init_db() -> None:
    global _conn
    _conn = sqlite3.connect(config.DB_PATH, check_same_thread=False)
    _conn.row_factory = sqlite3.Row
    with _lock:
        _conn.execute(_SCHEMA)
        columns = {r["name"] for r in _conn.execute("PRAGMA table_info(tickets)")}
        if "external_id" not in columns:  # databases created before this column
            _conn.execute("ALTER TABLE tickets ADD COLUMN external_id TEXT")
        # A ticket left IN_PROGRESS means the server stopped mid-run; retry it.
        _conn.execute("UPDATE tickets SET status = ? WHERE status = ?",
                      (Status.QUEUED, Status.IN_PROGRESS))
        _conn.commit()


def _to_dict(row: sqlite3.Row | None) -> dict | None:
    if row is None:
        return None
    t = dict(row)
    t.pop("n", None)
    t["triage"] = json.loads(t.pop("triage_json") or "null")
    return t


def create_ticket(data: dict) -> dict:
    fields = {k: v for k, v in data.items() if k in _COLUMNS}
    fields.update(status=Status.NEW)
    ts = now()
    cols = list(fields) + ["created_at", "updated_at"]
    with _lock:
        cur = _conn.execute(
            f"INSERT INTO tickets ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
            [*fields.values(), ts, ts],
        )
        tid = f"{config.TICKET_PREFIX}-{cur.lastrowid}"
        _conn.execute("UPDATE tickets SET id = ? WHERE n = ?", (tid, cur.lastrowid))
        _conn.commit()
    return get_ticket(tid)


def get_ticket(tid: str) -> dict | None:
    with _lock:
        row = _conn.execute("SELECT * FROM tickets WHERE id = ?", (tid,)).fetchone()
    return _to_dict(row)


def list_tickets(status: str | None = None) -> list[dict]:
    sql, args = "SELECT * FROM tickets", []
    if status:
        sql, args = sql + " WHERE status = ?", [status]
    with _lock:
        rows = _conn.execute(sql + " ORDER BY n DESC", args).fetchall()
    return [_to_dict(r) for r in rows]


def update_ticket(tid: str, **fields) -> None:
    unknown = set(fields) - _COLUMNS
    if unknown:
        raise ValueError(f"unknown ticket fields: {unknown}")
    if "triage_json" in fields and not isinstance(fields["triage_json"], str):
        fields["triage_json"] = json.dumps(fields["triage_json"])
    fields["updated_at"] = now()
    with _lock:
        _conn.execute(
            f"UPDATE tickets SET {', '.join(f'{k} = ?' for k in fields)} WHERE id = ?",
            [*fields.values(), tid],
        )
        _conn.commit()
    if "status" in fields:
        for listener in _status_listeners:
            threading.Thread(target=listener, args=(tid, fields["status"]), daemon=True).start()


def append_log(tid: str, line: str) -> None:
    with _lock:
        _conn.execute(
            "UPDATE tickets SET agent_log = agent_log || ?, updated_at = ? WHERE id = ?",
            (line.rstrip() + "\n", now(), tid),
        )
        _conn.commit()


def claim_next_queued() -> dict | None:
    """Atomically take the oldest QUEUED ticket and mark it IN_PROGRESS."""
    with _lock:
        row = _conn.execute(
            "SELECT id FROM tickets WHERE status = ? ORDER BY n LIMIT 1", (Status.QUEUED,)
        ).fetchone()
        if row is None:
            return None
        _conn.execute("UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?",
                      (Status.IN_PROGRESS, now(), row["id"]))
        _conn.commit()
    return get_ticket(row["id"])
