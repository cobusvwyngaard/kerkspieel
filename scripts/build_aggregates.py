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

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from scales import suspect_scales, unparsed_scales, values_by_question

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
    # Each wave is counted against its own option list. The scales move
    # between waves -- 2022 inserts "Gereeld" into grids that read
    # "Altyd / Soms / Nooit" either side of it -- and counting a 2022 answer
    # against 2026's shorter list drops "Nooit" entirely and files "Soms"
    # under the wrong name.
    options_of = {q["id"]: wave_options(q) for q in offered}
    values_of = {qid: {w: [o["value"] for o in opts] for w, opts in by_wave.items()}
                 for qid, by_wave in options_of.items()}
    numeric = [q for q in questions if q["comparable"] == "numeric"]
    whole, per_wave = values_by_question(responses)
    coded = unparsed_scales(numeric, responses, whole)
    if coded:
        print(f"questions filed as counts that are really scales: {len(coded)}")
        print("  (their option lists were not parsed out of the questionnaire, "
              "so they are neither counted nor charted)")
    numeric = [q for q in numeric if q["id"] not in coded]
    numeric_ids = {q["id"] for q in numeric}
    suspect = suspect_scales(offered, responses, per_wave)
    if suspect:
        print(f"scales that do not match their column: {len(suspect)} question-waves")
        for (qid, wave), why in sorted(suspect.items()):
            print(f"  {qid} {wave}: {why}")
    # A question every wave of which is quarantined has nothing left to
    # draw, so it leaves the dropdown rather than offering an empty chart.
    dropped = [q["id"] for q in offered
               if all((q["id"], w) in suspect
                      for w, o in q["options"].items() if o)]
    if dropped:
        print(f"  withdrawn entirely: {', '.join(dropped)}")
    offered = [q for q in offered if q["id"] not in set(dropped)]
    values_of = {qid: v for qid, v in values_of.items() if qid not in set(dropped)}

    def tally(rows):
        """Count a set of responses into scopes, options and numbers."""
        # counts[qid][scope][wave] -> [count per option, in the question's order]
        counts = collections.defaultdict(lambda: collections.defaultdict(dict))
        # values[qid][scope][wave] -> every congregation's number, for the
        # counts the survey asks for (members, baptisms, attendance)
        values = collections.defaultdict(lambda: collections.defaultdict(
            lambda: collections.defaultdict(list)))
        responded = collections.defaultdict(collections.Counter)
        for row in rows:
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
                options = (values_of.get(qid) or {}).get(row["wave"])
                if not options or value not in options:
                    continue
                if (qid, row["wave"]) in suspect:
                    continue
                slot = options.index(value)
                for key in keys:
                    bucket = counts[qid][key].setdefault(row["wave"], [0] * len(options))
                    bucket[slot] += 1
        return counts, values, responded

    def scope_list(responded, membership):
        rows = [{"key": NATIONAL, "kind": "national", "name": "Algemene Sinode",
                 "synod": "", "congregations": membership[NATIONAL],
                 "responded": dict(responded[NATIONAL])}]
        for key in sorted(membership):
            if key == NATIONAL:
                continue
            kind, _, rest = key.partition(":")
            synod, _, ring = rest.partition("|")
            rows.append({"key": key, "kind": "ring" if kind == "r" else "synod",
                         "name": ring or synod, "synod": synod,
                         "congregations": membership[key],
                         "responded": dict(responded[key])})
        return rows

    counts, values, responded = tally(responses)
    scopes = scope_list(responded, members)

    payload = {
        "waves": list(WAVES),
        "scopes": scopes,
        "questions": [question_entry(q, options_of[q["id"]]) for q in offered],
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

    # The same tally over the congregations that answered in every wave.
    # Comparing 2018 with 2026 otherwise compares two different sets of
    # congregations as much as two points in time: three quarters answer
    # each wave, but not the same three quarters.
    answered = collections.defaultdict(set)
    for row in responses:
        answered[row["code"]].add(row["wave"])
    panel = {code for code, waves in answered.items()
             if len(waves) == len(WAVES) and code in scopes_of}
    panel_members = collections.Counter()
    for code in panel:
        for key in scopes_of[code]:
            panel_members[key] += 1
    panel_counts, panel_values, panel_responded = tally(
        [r for r in responses if r["code"] in panel])
    write(out_dir / "panel.json", {
        "waves": list(WAVES),
        "congregations": len(panel),
        "scopes": scope_list(panel_responded, panel_members),
        "counts": {qid: dict(scoped) for qid, scoped in panel_counts.items()},
        "numeric": {qid: {key: {wave: summarise(nums)
                                for wave, nums in sorted(waves.items())}
                          for key, waves in sorted(scoped.items())}
                    for qid, scoped in sorted(panel_values.items())},
    })
    print(f"panel: {len(panel)} congregations answered all "
          f"{len(WAVES)} waves, in {sum(1 for k in panel_members if k.startswith('r:'))} rings")
    return 0


def wave_options(question):
    """Each wave's option list, borrowing from the nearest wave that has one.

    A question can match across waves while only one of them had its options
    parsed out of the questionnaire. Borrowing is an assumption, but a
    smaller one than dropping the wave.
    """
    listed = {w: question["options"].get(w) for w in WAVES}
    fallback = next((listed[w] for w in reversed(WAVES) if listed[w]), [])
    return {w: [{"value": o["value"], "label": o["label"]} for o in (listed[w] or fallback)]
            for w in WAVES if question["codes"].get(w)}


def merge_sequences(sequences):
    """One order that respects every wave's own order of its options.

    2022 puts "Gereeld" between "Altyd" and "Soms" in grids that read
    "Altyd / Soms / Nooit" either side of it. Ordering the union by option
    number would put it after "Soms", because "Soms" is 2 in the shorter
    scale and "Gereeld" is 2 in the longer one. Merging the sequences keeps
    each wave's neighbours in the right order.
    """
    after = collections.defaultdict(set)          # label -> labels before it
    first, order = {}, []
    for seq in sequences:
        for i, label in enumerate(seq):
            first.setdefault(label, len(first))
            after[label] |= set(seq[:i])
    remaining = list(first)
    while remaining:
        # The earliest label nothing outstanding has to precede.
        ready = [l for l in remaining if not (after[l] & set(remaining))]
        if not ready:                              # a cycle: fall back to order seen
            ready = [min(remaining, key=lambda l: first[l])]
        pick = min(ready, key=lambda l: first[l])
        order.append(pick)
        remaining.remove(pick)
    return order


def question_entry(question, by_wave):
    """One question as the reports read it, with the waves' scales side by side."""
    order = question["order"] or {}
    rank_of = (lambda o: order.get(str(o["value"]), o["value"]))
    # The categories a chart puts on its axis: every label any wave offers,
    # in the order the questionnaire puts them. A wave that does not offer
    # one simply has no bar there, which is what a changed scale looks like.
    sequences = [[o["label"] for o in sorted(by_wave[w], key=rank_of)]
                 for w in WAVES if by_wave.get(w)]
    categories = merge_sequences(sequences)
    return {
        "id": question["id"], "label": question["label"],
        "codes": question["codes"], "comparable": question["comparable"],
        "optionCounts": {w: len(o) for w, o in by_wave.items()},
        "options": {w: [{"value": o["value"], "label": o["label"],
                         "rank": rank_of(o)} for o in opts]
                    for w, opts in by_wave.items()},
        "categories": categories,
    }


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
