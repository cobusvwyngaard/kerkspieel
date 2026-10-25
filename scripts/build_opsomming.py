#!/usr/bin/env python3
"""
The question set behind the Opsomming entrance.

BYLAAG 3 of the 2026 Gemeente-opname -- Kobus Schoeman's summary tables --
draws on about thirty of the questionnaire's questions, plus the counts
that say how large a congregation is. The Opsomming pages show those and
nothing else.

Each entry names its question **by the variable code in each wave**, read
off the questionnaires themselves, rather than by a label or a question
id. That is deliberate. The crosswalk pairs a wave's rows to the next
wave's by wording, and where a grid's rows are worded alike -- the
technology grid is three rows of "... kommunikeer?" -- it has crossed a
few of them. Pinning each wave's code here means this report is right even
where the crosswalk is not, and an entry whose wave is missing from the
published data simply loses that year rather than borrowing the wrong one.

The build reports, for every entry, which published question holds each
wave's column, so the pairing can be audited against the questionnaire.

Reads web/public/data/aggregates.json and numeric.json, so run
build_aggregates.py first.

Usage:  python3 scripts/build_opsomming.py
"""

import argparse
import csv
import gzip
import json
import pathlib
import sys

WAVES = ("2018", "2022", "2026")
SIZE_SECTION = "Gemeentegrootte"


def merge_sequences(sequences):
    """One order that respects every wave's own order of its options."""
    after, first, order = {}, {}, []
    for seq in sequences:
        for i, label in enumerate(seq):
            first.setdefault(label, len(first))
            after.setdefault(label, set()).update(seq[:i])
    remaining = list(first)
    while remaining:
        ready = [l for l in remaining if not (after[l] & set(remaining))]
        if not ready:
            ready = [min(remaining, key=lambda l: first[l])]
        pick = min(ready, key=lambda l: first[l])
        order.append(pick)
        remaining.remove(pick)
    return order


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in-dir", default="web/public/data")
    ap.add_argument("--out-dir", default="web/public/data")
    ap.add_argument("--questions", default="data/lookup/opsomming_questions.csv")
    args = ap.parse_args()
    in_dir, out_dir = pathlib.Path(args.in_dir), pathlib.Path(args.out_dir)

    needed = ("aggregates.json", "numeric.json", "map.json")
    missing = [n for n in needed if not (in_dir / n).exists()]
    if missing:
        sys.exit(f"missing {', '.join(missing)}; run build_aggregates.py "
                 f"and build_map.py first")
    aggregates = json.loads((in_dir / "aggregates.json").read_text(encoding="utf-8"))
    numeric = json.loads((in_dir / "numeric.json").read_text(encoding="utf-8"))
    mapped = json.loads((in_dir / "map.json").read_text(encoding="utf-8"))

    # (wave, code) -> the published question whose column that is.
    holder = {}
    for q in aggregates["questions"]:
        for wave, code in q["codes"].items():
            holder[(wave, code)] = ("choice", q)
    for q in numeric["questions"]:
        for wave, code in q["codes"].items():
            holder.setdefault((wave, code), ("number", q))
    on_map = {q["id"] for q in mapped["questions"]}

    entries, failures, lost = [], [], []
    with pathlib.Path(args.questions).open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            sources, options, kinds, codes = {}, {}, set(), {}
            for wave in WAVES:
                code = (row.get(f"v{wave}") or "").strip()
                if not code:
                    continue
                found = holder.get((wave, code))
                if not found:
                    lost.append(f"  {row['title']!r}: {wave} {code} is in no "
                                f"published question")
                    continue
                kind, question = found
                sources[wave] = question["id"]
                codes[wave] = code
                kinds.add(kind)
                if kind == "choice":
                    options[wave] = question["options"][wave]
            if not sources:
                failures.append(f"  {row['title']!r}: no wave resolves")
                continue
            if len(kinds) > 1:
                failures.append(f"  {row['title']!r}: mixes counted and "
                                f"chosen answers across its waves")
                continue
            kind = kinds.pop()
            entries.append({
                "key": f"o{len(entries):02d}",
                "section": row["section"],
                "title": row["title"],
                "kind": kind,
                "codes": codes,
                "sources": sources,
                "waves": [w for w in WAVES if w in sources],
                # A wave's column can sit in a different published question
                # from its neighbours', so each one carries its own options.
                "options": options,
                "optionCounts": {w: len(o) for w, o in options.items()},
                "categories": merge_sequences(
                    [[o["label"] for o in options[w]] for w in WAVES if w in options]),
                "mappable": [w for w in sources if sources[w] in on_map],
            })

    if failures:
        sys.exit("the Opsomming list does not resolve:\n" + "\n".join(failures))
    if lost:
        print(f"waves with no published column: {len(lost)}")
        print("\n".join(lost))

    sections = []
    for entry in entries:
        if not sections or sections[-1]["label"] != entry["section"]:
            sections.append({"label": entry["section"], "keys": []})
        sections[-1]["keys"].append(entry["key"])

    payload = {
        "title": "Gemeente-opname 2026",
        "subtitle": "Opsomming van enkele tabelle",
        "source": "BYLAAG 3 — Opsomming enkele tabelle, saamgestel deur Kobus Schoeman",
        "waves": list(WAVES),
        "sections": sections,
        "entries": entries,
        "size": [e["key"] for e in entries if e["section"] == SIZE_SECTION],
    }
    path = out_dir / "opsomming.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
                    encoding="utf-8")
    packed = len(gzip.compress(path.read_bytes(), 9))
    print(f"  {path}  {path.stat().st_size / 1e3:.0f} kB "
          f"({packed / 1e3:.0f} kB gzipped)")
    print(f"{len(entries)} entries over {len(sections)} sections; "
          f"{sum(1 for e in entries if e['kind'] == 'number')} counted, "
          f"{sum(1 for e in entries if e['mappable'])} on the map")
    spread = {}
    for entry in entries:
        spread[len(set(entry["sources"].values()))] = \
            spread.get(len(set(entry["sources"].values())), 0) + 1
    print(f"published questions per entry: {dict(sorted(spread.items()))} "
          f"(more than one means the crosswalk split that row)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
