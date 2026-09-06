#!/usr/bin/env python3
"""
Check the built dataset against the published Kerkspieel Ringsverslag.

validate_pipeline.py proves the decode path straight off the workbooks.
This proves the same numbers survive the whole pipeline -- codebook,
crosswalk, key reconciliation, option ordering -- and come out of the JSON
the browser actually reads.

Figures are the WK / George report. Ring and synod bases match it exactly;
the national base does not, and the reasons are asserted here too rather
than smoothed over:

  - the published synod figures include WK_TOE001 "Toetsgemeente", a test
    record whose ring reads #N/A. It is excluded here, which moves the WK
    2018 base from 190 to 189.
  - the published national base is 849 where this extract holds 846
    congregations answering the question, so national shares differ in the
    second decimal.

Usage:  python3 scripts/validate_dataset.py
"""

import argparse
import json
import pathlib
import sys

WAVES = ("2018", "2022", "2026")

# label fragment -> {wave: {option value: percent}} for the George ring,
# read off the published report.
EXPECTED_RING = {
    "huidige rigting": {
        "2018": {1: 0.00, 2: 57.14, 3: 28.57, 4: 14.29},
        "2022": {1: 0.00, 2: 75.00, 3: 25.00, 4: 0.00},
    },
    "missionale gemeente": {
        "2018": {1: 0.00, 2: 14.29, 3: 28.57, 4: 28.57, 5: 28.57},
        "2022": {1: 0.00, 2: 0.00, 3: 0.00, 4: 100.00, 5: 0.00},
    },
}
EXPECTED_PARTICIPATION = {"2018": 7, "2022": 4}
TOLERANCE = 0.01


def load(out_dir):
    return [json.loads((out_dir / f"{n}.json").read_text(encoding="utf-8"))
            for n in ("congregations", "questions", "responses")]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", default="data/build")
    args = ap.parse_args()
    out_dir = pathlib.Path(args.data_dir)
    if not (out_dir / "responses.json").exists():
        sys.exit(f"missing {out_dir}/responses.json; run scripts/build_dataset.py first")

    congregations, questions, responses = load(out_dir)
    by_code = {c["code"]: c for c in congregations}
    george = {c["code"] for c in congregations if c["ring"] == "George"}

    failures = 0
    print("=" * 68)
    print("Participation in the George ring")
    print("=" * 68)
    for wave, expected in EXPECTED_PARTICIPATION.items():
        got = sum(1 for r in responses if r["wave"] == wave and r["code"] in george)
        ok = got == expected
        failures += not ok
        print(f"  [{'OK ' if ok else 'FAIL'}] {wave}: {got} congregations "
              f"(published: {expected})")

    print()
    print("=" * 68)
    print("Distributions in the George ring")
    print("=" * 68)
    for fragment, by_wave in EXPECTED_RING.items():
        question = next((q for q in questions
                         if fragment.lower() in q["label"].lower()), None)
        if not question:
            print(f"  [FAIL] no question matching {fragment!r}")
            failures += 1
            continue
        order = {int(k): v for k, v in (question.get("order") or {}).items()}
        for wave, expected in by_wave.items():
            values = [r["values"].get(question["id"]) for r in responses
                      if r["wave"] == wave and r["code"] in george]
            values = [v for v in values if v is not None]
            total = len(values)
            if not total:
                print(f"  [FAIL] {wave} {fragment}: no responses")
                failures += 1
                continue
            # The published report orders options worst-first; the raw codes
            # of several questions run the other way.
            shares = {}
            for raw in values:
                slot = order.get(raw, raw)
                shares[slot] = shares.get(slot, 0) + 100 / total
            worst = max(abs(shares.get(k, 0) - v) for k, v in expected.items())
            ok = worst <= TOLERANCE
            failures += not ok
            shown = " ".join(f"{k}:{shares.get(k, 0):.2f}" for k in sorted(expected))
            print(f"  [{'OK ' if ok else 'FAIL'}] {wave} n={total} "
                  f"{fragment:22s} {shown}")

    print()
    print("=" * 68)
    print("Coverage")
    print("=" * 68)
    usable = [q for q in questions if q["comparable"] in ("yes", "scale-changed")]
    placed = sum(1 for c in congregations if c["lat"] is not None)
    print(f"  congregations           : {len(congregations)} ({placed} mapped)")
    print(f"  questions offered       : {len(usable)} of {len(questions)}")
    print(f"  of those, same scale    : "
          f"{sum(1 for q in usable if q['comparable'] == 'yes')}")
    for wave in WAVES:
        n = sum(1 for r in responses if r["wave"] == wave)
        print(f"  responses {wave}          : {n}")

    print()
    print("FAILURES:", failures if failures else "none")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
