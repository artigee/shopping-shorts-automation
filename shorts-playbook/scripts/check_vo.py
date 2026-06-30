#!/usr/bin/env python3
"""
check_vo.py — deterministic guardrail for shopping-short beat sheets.

Enforces two things that must NOT be left to judgment:
  1. Ban-list   : no VO line or caption may contain a banned generic phrase.
  2. Redundancy : a beat's vo_line must not just restate its caption
                  (the "react, don't narrate" rule).

Usage:
    python check_vo.py beatsheet.json
    python check_vo.py beatsheet.json --banlist ../data/banlist.txt
    python check_vo.py beatsheet.json --threshold 0.6

Exit code 0 = PASS, 1 = FAIL. Prints a report either way.
"""

import argparse
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_BANLIST = os.path.join(HERE, "..", "data", "banlist.txt")

STOPWORDS = {
    "a", "an", "the", "and", "or", "but", "so", "to", "of", "in", "on", "it",
    "is", "this", "that", "your", "you", "with", "for", "into", "just", "one",
    "no", "i", "my", "me", "at", "its", "then", "now", "up",
}


def load_banlist(path):
    phrases = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            phrases.append(line.lower())
    return phrases


def find_banned(text, banlist):
    low = text.lower()
    return [p for p in banlist if p in low]


def content_words(text):
    words = re.findall(r"[a-z0-9']+", text.lower())
    return [w for w in words if w not in STOPWORDS and len(w) > 1]


def novelty_ratio(caption, vo_line):
    """Fraction of the VO's content words that are NOT in the caption.
    LOW novelty => the VO adds almost nothing the caption didn't say
    (it is narrating). HIGH novelty => the VO brings new content (it reacts).
    Sharing the product noun (e.g. 'ice cream') no longer triggers a flag,
    because a reacting line still adds many new words around it."""
    cap = set(content_words(caption))
    vo = content_words(vo_line)
    if not vo:
        return 1.0
    new = [w for w in vo if w not in cap]
    return len(new) / len(vo)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("beatsheet", help="Path to the beat sheet JSON.")
    ap.add_argument("--banlist", default=DEFAULT_BANLIST)
    ap.add_argument("--threshold", type=float, default=0.35,
                    help="VO novelty below this is FLAGGED; below half of it FAILS (default 0.35).")
    args = ap.parse_args()

    with open(args.beatsheet, encoding="utf-8") as f:
        data = json.load(f)
    banlist = load_banlist(args.banlist)

    failures = []
    warnings = []

    # Collect all voice-facing text for the ban-list (exclude cta.disclosure).
    checks = []
    if data.get("vo_monologue"):
        checks.append(("vo_monologue", data["vo_monologue"]))
    for i, beat in enumerate(data.get("beats", [])):
        checks.append((f"beat[{i}].caption", beat.get("caption", "")))
        checks.append((f"beat[{i}].vo_line", beat.get("vo_line", "")))
    cta = data.get("cta", {})
    checks.append(("cta.caption", cta.get("caption", "")))
    checks.append(("cta.vo_line", cta.get("vo_line", "")))

    for label, text in checks:
        hits = find_banned(text, banlist)
        for h in hits:
            failures.append(f"BANNED phrase '{h}' in {label}: \"{text}\"")

    # Redundancy: vo_line must add something the caption didn't.
    # Egregious (VO is essentially the caption restated) -> FAIL.
    # Borderline -> WARNING (the real "react vs narrate" call is Claude's at
    # authoring time; the script only surfaces suspects).
    for i, beat in enumerate(data.get("beats", [])):
        cap = beat.get("caption", "")
        vo = beat.get("vo_line", "")
        if not cap or not vo:
            continue
        nov = novelty_ratio(cap, vo)
        if nov < args.threshold / 2:
            failures.append(
                f"NARRATES caption in beat[{i}] (only {nov:.0%} of VO is new): "
                f"caption=\"{cap}\" vo=\"{vo}\"  -> VO restates the caption; rewrite to react."
            )
        elif nov < args.threshold:
            warnings.append(
                f"low novelty {nov:.0%} in beat[{i}] — check it reacts, not narrates: "
                f"caption=\"{cap}\" vo=\"{vo}\""
            )

    # Persona sanity.
    if data.get("persona", "").strip().lower() in ("", "enthusiastic creator", "creator", "default"):
        failures.append("persona is missing or generic — pass a named persona from personas.yaml.")

    print("=" * 60)
    print(f"check_vo.py — {args.beatsheet}")
    print("=" * 60)
    if warnings:
        print("\nWARNINGS:")
        for w in warnings:
            print("  ! " + w)
    if failures:
        print("\nFAILURES:")
        for fl in failures:
            print("  x " + fl)
        print(f"\nRESULT: FAIL ({len(failures)} issue(s))")
        sys.exit(1)
    print("\nRESULT: PASS")
    sys.exit(0)


if __name__ == "__main__":
    main()
