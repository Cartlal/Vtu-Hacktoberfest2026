"""Run Gemma triage over samples/sample_tickets.json and report accuracy.

Usage (from the autofix/ folder):  python -m scripts.eval_triage [path/to/tickets.json]
"""
import json
import sys
import time
from pathlib import Path

from app import triage

path = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).parent.parent / "samples" / "sample_tickets.json")
tickets = json.loads(path.read_text(encoding="utf-8"))

correct = 0
for i, t in enumerate(tickets, 1):
    start = time.time()
    try:
        r = triage.classify(t)
        got, note = r["risk"], r.get("guardrail") or r["reason"]
    except Exception as e:
        got, note = "ERROR", str(e)
    ok = got == t["expected"]
    correct += ok
    print(f"{i:2}. {'OK  ' if ok else 'MISS'} expected={t['expected']:<8} got={got:<8} "
          f"{time.time() - start:5.1f}s  {t['title']}")
    if not ok:
        print(f"      -> {note}")

print(f"\n{correct}/{len(tickets)} correct ({100 * correct / len(tickets):.0f}%)")
