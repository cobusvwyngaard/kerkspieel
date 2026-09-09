#!/usr/bin/env python3
"""
Build the dataset behind the map report.

Unlike the ring report, a map is congregation-level by construction: a pin
is one congregation and its colour or size is that congregation's own
answer. So this file necessarily publishes what aggregates.json
deliberately does not, and it should not be served publicly without an
access policy in front of it. Free text is still excluded -- only coded
answers are carried.

Each question is classified by how it can be drawn:

  binary   two options, drawn as two colours
  ordinal  three to six ordered options, drawn as a graduated colour ramp
           so that "more" reads darker
  numeric  a count, drawn as a graduated pin size

Values are stored as arrays positionally aligned to the congregations
array, which is far smaller than repeating a key per congregation.

Usage:  python3 scripts/build_map.py
"""

import argparse
import collections
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from scales import unparsed_scales

WAVES = ("2018", "2022", "2026")
MAX_ORDINAL = 6
# A numeric question is only worth a pin size if congregations actually
# differ on it; a column that is almost always zero makes a blank map.
MIN_NUMERIC_SPREAD = 4


def classify(question, coded=frozenset()):
    """How this question can be drawn, or None if it cannot."""
    if question["id"] in coded:
        # Filed as a count, but its values are option codes whose labels
        # were never parsed. A pin sized by an Altyd/Soms/Nooit code would
        # say nothing, so it is not offered.
        return None, None
    options = None
    for wave in reversed(WAVES):
        listed = question["options"].get(wave)
        if listed:
            options = listed
            break
    if options:
        if len(options) == 2:
            return "binary", options
        if 3 <= len(options) <= MAX_ORDINAL:
            return "ordinal", options
        return None, None
    if question["comparable"] == "numeric":
        return "numeric", None
    return None, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in-dir", default="data/build")
    ap.add_argument("--out-dir", default="web/public/data")
    args = ap.parse_args()
    in_dir, out_dir = pathlib.Path(args.in_dir), pathlib.Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    needed = ["congregations.json", "questions.json", "responses.json"]
    missing = [n for n in needed if not (in_dir / n).exists()]
    if missing:
        sys.exit(f"missing {', '.join(missing)}; run scripts/build_dataset.py first")
    congregations, questions, responses = (
        json.loads((in_dir / n).read_text(encoding="utf-8")) for n in needed)

    # Only congregations that can actually be placed on the map.
    placed = [c for c in congregations if c["lat"] is not None]
    index_of = {c["code"]: i for i, c in enumerate(placed)}
    print(f"congregations with coordinates: {len(placed)} of {len(congregations)}")

    answers = collections.defaultdict(dict)          # qid -> wave -> {idx: value}
    for row in responses:
        slot = index_of.get(row["code"])
        if slot is None:
            continue
        for qid, value in row["values"].items():
            answers[qid].setdefault(row["wave"], {})[slot] = value

    coded = unparsed_scales([q for q in questions if q["comparable"] == "numeric"],
                            responses)
    if coded:
        print(f"held back, option list never parsed: {len(coded)} questions")

    mappable, values = [], {}
    for question in questions:
        kind, options = classify(question, coded)
        if not kind or question["id"] not in answers:
            continue

        per_wave, counts = {}, {}
        for wave in WAVES:
            found = answers[question["id"]].get(wave)
            if not found:
                continue
            if kind == "numeric":
                distinct = {v for v in found.values()}
                if len(distinct) < MIN_NUMERIC_SPREAD:
                    continue
            column = [None] * len(placed)
            for slot, value in found.items():
                column[slot] = value
            per_wave[wave] = column
            counts[wave] = len(found)
        if not per_wave:
            continue

        entry = {"id": question["id"], "label": question["label"], "kind": kind,
                 "codes": question["codes"], "answered": counts}
        if options:
            # Each wave carries its own scale. 2022 inserts "Gereeld" into
            # grids that read "Altyd / Soms / Nooit" either side of it, so a
            # pin coloured by 2022's value against 2026's list would show
            # "Soms" where the congregation answered "Gereeld".
            order = question.get("order") or {}
            listed = {w: question["options"].get(w) or options for w in per_wave}
            entry["options"] = {
                wave: [{"value": o["value"], "label": o["label"],
                        "rank": order.get(str(o["value"]), o["value"])}
                       for o in opts]
                for wave, opts in listed.items()}
        if kind == "numeric":
            # The legend needs a scale; percentiles beat min/max because a
            # single very large congregation would otherwise flatten the rest.
            everything = sorted(v for column in per_wave.values()
                                for v in column if v is not None)
            if everything:
                entry["scale"] = {
                    "min": everything[0],
                    "p50": everything[len(everything) // 2],
                    "p95": everything[int(len(everything) * 0.95)],
                    "max": everything[-1],
                }
        mappable.append(entry)
        values[question["id"]] = per_wave

    payload = {
        "waves": list(WAVES),
        "congregations": [{"code": c["code"], "name": c["name"], "ring": c["ring"],
                           "synod": c["synod"],
                           "lat": round(c["lat"], 5), "lon": round(c["lon"], 5)}
                          for c in placed],
        "questions": sorted(mappable, key=lambda q: (q["kind"], q["label"])),
        "values": values,
    }

    path = out_dir / "map.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
                    encoding="utf-8")
    import gzip
    packed = len(gzip.compress(path.read_bytes(), 9))

    kinds = collections.Counter(q["kind"] for q in mappable)
    print(f"mappable questions: {len(mappable)}  {dict(kinds)}")
    print(f"wrote {path}  {path.stat().st_size / 1e6:.2f} MB "
          f"({packed / 1e6:.2f} MB gzipped)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
