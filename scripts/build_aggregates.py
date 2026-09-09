#!/usr/bin/env python3
"""
Pre-aggregate the dataset so nothing congregation-level is published.

build_dataset.py emits one row per congregation per wave. The dashboard
only ever displays three scopes -- a ring, its synod, the whole church --
but the file itself lets anyone read a named congregation's answers, which
is not something to put behind a public URL.

This computes those three scopes here and ships only the counts, so the
published site holds no congregation-level responses at all. The register
keeps congregation names and coordinates, which are not survey answers.

Usage:  python3 scripts/build_aggregates.py
"""

import argparse
import collections
import gzip
import json
import pathlib
import sys

WAVES = ("2018", "2022", "2026")
NATIONAL = "__all__"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in-dir", default="data/build")
    ap.add_argument("--out-dir", default="web/public/data")
    args = ap.parse_args()
    in_dir = pathlib.Path(args.in_dir)
    out_dir = pathlib.Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    needed = ["congregations.json", "questions.json", "responses.json"]
    missing = [n for n in needed if not (in_dir / n).exists()]
    if missing:
        sys.exit(f"missing {', '.join(missing)}; run scripts/build_dataset.py first")

    congregations, questions, responses = (
        json.loads((in_dir / n).read_text(encoding="utf-8")) for n in needed)

    # A congregation belongs to its ring, to its synod, and to the church.
    scopes_of = {}
    members = collections.Counter()
    for c in congregations:
        keys = [f"s:{c['synod']}", NATIONAL]
        if c["ring"]:
            keys.insert(0, f"r:{c['synod']}|{c['ring']}")
        scopes_of[c["code"]] = keys
        for key in keys:
            members[key] += 1

    # A question asked in only one wave still says something about a ring
    # against its synod and the church; it just cannot be trended. It is
    # offered where it has options to count.
    offered = [q for q in questions
               if q["comparable"] in ("yes", "scale-changed", "single-wave")
               and any(q["options"].values())]
    values_of = {q["id"]: [o["value"] for o in
                           next((q["options"][w] for w in reversed(WAVES)
                                 if q["options"].get(w)), [])]
                 for q in offered}
    numeric = [q for q in questions if q["comparable"] == "numeric"]
    numeric_ids = {q["id"] for q in numeric}

    # counts[qid][scope][wave] -> [count per option, in the question's order]
    counts = collections.defaultdict(lambda: collections.defaultdict(dict))
    # values[qid][scope][wave] -> every congregation's number, for the
    # counts the survey asks for (members, baptisms, attendance)
    values = collections.defaultdict(lambda: collections.defaultdict(
        lambda: collections.defaultdict(list)))
    responded = collections.defaultdict(collections.Counter)
    for row in responses:
        keys = scopes_of.get(row["code"])
        if not keys:
            continue
        for key in keys:
            responded[key][row["wave"]] += 1
        for qid, value in row["values"].items():
            if qid in numeric_ids:
                if isinstance(value, (int, float)) and value >= 0:
                    for key in keys:
                        values[qid][key][row["wave"]].append(value)
                continue
            options = values_of.get(qid)
            if not options or value not in options:
                continue
            slot = options.index(value)
            for key in keys:
                bucket = counts[qid][key].setdefault(row["wave"], [0] * len(options))
                bucket[slot] += 1

    scopes = [{"key": NATIONAL, "kind": "national", "name": "Algemene Sinode",
               "synod": "", "congregations": members[NATIONAL],
               "responded": dict(responded[NATIONAL])}]
    for key in sorted(members):
        if key == NATIONAL:
            continue
        kind, _, rest = key.partition(":")
        synod, _, ring = rest.partition("|")
        scopes.append({"key": key, "kind": "ring" if kind == "r" else "synod",
                       "name": ring or synod, "synod": synod,
                       "congregations": members[key],
                       "responded": dict(responded[key])})

    payload = {
        "waves": list(WAVES),
        "scopes": scopes,
        "questions": [{"id": q["id"], "label": q["label"], "codes": q["codes"],
                       "comparable": q["comparable"],
                       "optionCounts": {w: len(o) for w, o in q["options"].items()},
                       "options": [{"value": o["value"], "label": o["label"]} for o in
                                   next((q["options"][w] for w in reversed(WAVES)
                                         if q["options"].get(w)), [])],
                       "order": q["order"]}
                      for q in offered],
        "counts": {qid: {k: v for k, v in scoped.items()} for qid, scoped in counts.items()},
        # The counted questions' index only, so a report can list them
        # without downloading every ring's totals. The totals themselves
        # are in numeric.json, which is fetched when one is chosen.
        "numericQuestions": [{"id": q["id"], "label": q["label"], "codes": q["codes"]}
                             for q in numeric if q["id"] in values],
    }
    write(out_dir / "aggregates.json", payload)
    print(f"scopes: {len(payload['scopes'])}  questions: {len(payload['questions'])}")

    # The counted questions live in their own file. They are a fifth of the
    # questionnaire and only one report reaches for them, so folding them
    # into aggregates.json would double what every page downloads.
    numeric_payload = {
        "waves": list(WAVES),
        "questions": [{"id": q["id"], "label": q["label"], "codes": q["codes"]}
                      for q in numeric if q["id"] in values],
        "stats": {qid: {key: {wave: summarise(nums)
                              for wave, nums in sorted(waves.items())}
                        for key, waves in sorted(scoped.items())}
                  for qid, scoped in sorted(values.items())},
    }
    write(out_dir / "numeric.json", numeric_payload)
    print(f"numeric questions: {len(numeric_payload['questions'])}")
    return 0


def summarise(numbers):
    """[congregations answering, total, median] -- the mean is total/n."""
    ordered = sorted(numbers)
    n = len(ordered)
    middle = (ordered[n // 2] if n % 2
              else (ordered[n // 2 - 1] + ordered[n // 2]) / 2)
    return [n, sum(ordered), round(middle, 1)]


def write(path, payload):
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
                    encoding="utf-8")
    packed = len(gzip.compress(path.read_bytes(), 9))
    print(f"  {path}  {path.stat().st_size / 1e6:.2f} MB "
          f"({packed / 1e6:.2f} MB gzipped)")


if __name__ == "__main__":
    sys.exit(main())
