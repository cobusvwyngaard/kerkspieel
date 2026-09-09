#!/usr/bin/env python3
"""
Score every ring, synod and the church on nine qualities of church life.

This is the NCLS Research vitality framework -- nine Core Qualities in three
groups, which their Church Life Profile reports on -- applied to the
Gemeentevraelys. It is an analogue, not the NCLS instrument, and the two
differ in a way that decides how every number here should be read:

    NCLS surveys attenders. It can ask a person whether their own faith
    grew this year. The Gemeentevraelys surveys congregations, and the
    leadership answers. It can only ask whether the congregation runs a
    prayer ministry, small groups, faith formation in homes.

So these indicators measure provision, not experience: what a congregation
offers, not what its members receive. A ring that scores well on "Geloof"
is one whose congregations organise the means of faith formation.

NCLS does not publish how it standardises its own scores -- that is held
back for commercial reasons -- so the score here is defined from scratch
and stated on the page: each indicator is standardised against the spread
of *rings* in the same wave, and a quality's score is the mean of its
indicators' standardised scores. Five is the middle of that spread, which
is what NCLS's 5 also means, but the numbers are not comparable to theirs.

Reads web/public/data/aggregates.json, so run build_aggregates.py first.

Usage:  python3 scripts/build_profile.py
"""

import argparse
import csv
import gzip
import json
import math
import pathlib
import re
import statistics
import sys

NATIONAL = "__all__"
# A ring with fewer responding congregations than this is too noisy to help
# define what an average ring looks like. It still gets scored against that
# spread; it just does not shape it.
MIN_REFERENCE = 5
# Two points per standard deviation, so a ring one SD above the average
# scores 7 out of 10.
POINTS_PER_SD = 2.0

GROUPS = [
    {"key": "intern", "label": "Interne kwaliteite",
     "blurb": "Die binnelewe van die geloofsgemeenskap: 'n lewende geloof, "
              "'n erediens wat voed, en 'n groeiende gevoel van behoort."},
    {"key": "buite", "label": "Kwaliteite na buite",
     "blurb": "Die gemeente se lewe na buite: praktiese en veelsydige diens, "
              "gewillige geloofsdeling, en doelbewuste insluiting."},
    {"key": "inspirasie", "label": "Inspirerende kwaliteite",
     "blurb": "Wat 'n gemeente vorentoe dra: 'n helder roeping, ruimte vir "
              "vernuwing, en leierskap wat lidmate bemagtig."},
    {"key": "meting", "label": "Drie metings",
     "blurb": "Naas die nege kwaliteite hou NCLS drie metings by wat die "
              "rigting van 'n gemeente aandui. Hierdie drie is die naaste "
              "wat die Gemeentevraelys daaraan kom."},
]

QUALITIES = [
    {"key": "geloof", "group": "intern", "label": "Geloof",
     "subtitle": "lewend en groeiend",
     "blurb": "NCLS vra die lidmaat of sy geloof die afgelope jaar gegroei het. "
              "Die Gemeentevraelys kan net vra of die gemeente die middele "
              "daarvoor organiseer: gebed, kleingroepe, geloofvorming buite "
              "die kategese."},
    {"key": "erediens", "group": "intern", "label": "Erediens",
     "subtitle": "lewegewend en voedend",
     "blurb": "NCLS vra of die aanbidder inspirasie in die erediens beleef. "
              "Hier staan die erediens se breedte in die plek daarvan: "
              "preekreekse, die kerkjaar, en dienste vir wie nie by die "
              "gewone erediens inpas nie."},
    {"key": "behoort", "group": "intern", "label": "Behoort",
     "subtitle": "sterk en groeiend",
     "blurb": "Of die gemeente doelbewus werk aan gasvryheid en aan die "
              "inskakeling van wie nuut is."},
    {"key": "diens", "group": "buite", "label": "Diens",
     "subtitle": "prakties en veelsydig",
     "blurb": "Wat die gemeente werklik doen aan armoede, en of sy geboue en "
              "vennootskappe die gemeenskap dien."},
    {"key": "geloofsdeling", "group": "buite", "label": "Geloofsdeling",
     "subtitle": "gewillig en doeltreffend",
     "blurb": "Of die gemeente die geloof buite haar eie kring deel, en of sy "
              "wie weggeraak het, opsoek."},
    {"key": "insluiting", "group": "buite", "label": "Insluiting",
     "subtitle": "doelbewus en verwelkomend",
     "blurb": "Of die gemeente ruimte maak vir wie anders is -- ander taal, "
              "ander agtergrond -- en of sy die kwessies aanspreek wat mense "
              "buite hou."},
    {"key": "visie", "group": "inspirasie", "label": "Visie",
     "subtitle": "helder en gedeel",
     "blurb": "Of die gemeente weet waarvoor sy daar is, en of dit gesê word "
              "op maniere wat die gemeente kan hoor."},
    {"key": "innovasie", "group": "inspirasie", "label": "Vernuwing",
     "subtitle": "verbeeldingryk en buigsaam",
     "blurb": "Of die bediening saam met sy konteks verander, en of die "
              "gemeente die middele gebruik wat vandag beskikbaar is."},
    {"key": "leierskap", "group": "inspirasie", "label": "Leierskapskultuur",
     "subtitle": "inspirerend en bemagtigend",
     "blurb": "Of leierskap lidmate se gawes ontsluit eerder as om die werk "
              "self te doen, en of geld en bedieninge die roeping dien."},
    {"key": "rigting", "group": "meting", "label": "Rigting",
     "subtitle": "hoe die gemeente haarself sien",
     "blurb": "Die gemeente se eie tipering van haar rigting."},
    {"key": "finansies", "group": "meting", "label": "Finansies",
     "subtitle": "teenoor inflasie",
     "blurb": "Of inkomste tred hou met inflasie."},
    {"key": "gemeenskap", "group": "meting", "label": "Gemeenskap",
     "subtitle": "betrokkenheid buite die gemeente",
     "blurb": "Of die gemeente as gemeente deelneem aan wat in die gemeenskap "
              "gebeur."},
]


def load_indicators(path, questions):
    """The indicator table, each row resolved to exactly one question.

    Indicators name their question by wording rather than by id: the ids
    are regenerated whenever the crosswalk is rebuilt, and a stale id would
    quietly point at a different question. A pattern that matches no
    question, or more than one, stops the build.
    """
    resolved, failures = [], []
    with path.open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            hits = [q for q in questions if re.search(row["pattern"], q["label"])]
            if len(hits) != 1:
                failures.append(f"  {row['indicator']!r}: {len(hits)} matches "
                                f"for {row['pattern']!r}")
                continue
            question = hits[0]
            wanted = {int(v) for v in row["positive"].split(",")}
            values = [o["value"] for o in question["options"]]
            unknown = wanted - set(values)
            if unknown:
                failures.append(f"  {row['indicator']!r}: option(s) {sorted(unknown)} "
                                f"are not offered by {question['id']}")
                continue
            resolved.append({
                "key": f"i{len(resolved):02d}",
                "quality": row["quality"],
                "label": row["indicator"],
                "headline": row["headline"] == "1",
                "question": question["id"],
                "questionLabel": question["label"],
                "codes": question["codes"],
                "answer": " of ".join(o["label"] for o in question["options"]
                                      if o["value"] in wanted),
                "slots": [i for i, v in enumerate(values) if v in wanted],
            })
    if failures:
        sys.exit("indicator table does not resolve:\n" + "\n".join(failures))
    return resolved


def clamp(value, low, high):
    return max(low, min(high, value))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in-dir", default="web/public/data")
    ap.add_argument("--out-dir", default="web/public/data")
    ap.add_argument("--indicators", default="data/lookup/profile_indicators.csv")
    args = ap.parse_args()
    in_dir = pathlib.Path(args.in_dir)
    out_dir = pathlib.Path(args.out_dir)

    source = in_dir / "aggregates.json"
    if not source.exists():
        sys.exit(f"missing {source}; run scripts/build_aggregates.py first")
    aggregates = json.loads(source.read_text(encoding="utf-8"))
    waves = aggregates["waves"]
    counts = aggregates["counts"]

    indicators = load_indicators(pathlib.Path(args.indicators),
                                 aggregates["questions"])
    print(f"indicators: {len(indicators)} over "
          f"{len({i['quality'] for i in indicators})} qualities")

    # share[indicator][scope][wave] -> [responding congregations, percent]
    share = {}
    for ind in indicators:
        scoped = counts.get(ind["question"], {})
        rows = {}
        for scope, by_wave in scoped.items():
            for wave, bucket in by_wave.items():
                n = sum(bucket)
                if not n:
                    continue
                positive = sum(bucket[i] for i in ind["slots"])
                rows.setdefault(scope, {})[wave] = [n, round(100 * positive / n, 1)]
        share[ind["key"]] = rows

    # What an average ring looks like, indicator by indicator and wave by
    # wave. Rings are the reference for every scope, so a synod's score and
    # a ring's score mean the same thing -- though a synod averages over its
    # rings, which pulls it towards the middle.
    ring_keys = [s["key"] for s in aggregates["scopes"] if s["kind"] == "ring"]
    reference = {}
    for ind in indicators:
        rows = share[ind["key"]]
        for wave in waves:
            values = [rows[k][wave][1] for k in ring_keys
                      if k in rows and wave in rows[k]
                      and rows[k][wave][0] >= MIN_REFERENCE]
            if len(values) < 3:
                continue
            spread = statistics.pstdev(values)
            if spread <= 0:
                continue
            reference.setdefault(wave, {})[ind["key"]] = [
                round(statistics.fmean(values), 1), round(spread, 2), len(values)]

    def score_of(key, scope, wave):
        row = share[key].get(scope, {}).get(wave)
        ref = reference.get(wave, {}).get(key)
        if not row or not ref:
            return None
        return round(clamp(5 + POINTS_PER_SD * (row[1] - ref[0]) / ref[1], 1, 10), 1)

    by_quality = {}
    for ind in indicators:
        by_quality.setdefault(ind["quality"], []).append(ind)

    scopes = [s["key"] for s in aggregates["scopes"]]
    data, scores = {}, {}
    for scope in scopes:
        for wave in waves:
            cells = {ind["key"]: share[ind["key"]][scope][wave]
                     for ind in indicators
                     if wave in share[ind["key"]].get(scope, {})}
            if not cells:
                continue
            data.setdefault(scope, {})[wave] = cells
            marks = {}
            for quality, members in by_quality.items():
                got = [score_of(m["key"], scope, wave) for m in members]
                got = [g for g in got if g is not None]
                pcts = [cells[m["key"]][1] for m in members if m["key"] in cells]
                if got:
                    marks[quality] = [round(statistics.fmean(got), 1),
                                      round(statistics.fmean(pcts), 1), len(got)]
            scores.setdefault(scope, {})[wave] = marks

    payload = {
        "waves": waves,
        "scopes": aggregates["scopes"],
        "groups": GROUPS,
        "qualities": QUALITIES,
        "indicators": [{k: v for k, v in ind.items() if k != "slots"}
                       for ind in indicators],
        "reference": reference,
        "minReference": MIN_REFERENCE,
        "pointsPerSd": POINTS_PER_SD,
        "data": data,
        "scores": scores,
    }
    named = {q["key"] for q in QUALITIES}
    missing = {i["quality"] for i in indicators} - named
    if missing:
        sys.exit(f"indicators name qualities that are not defined: {sorted(missing)}")

    path = out_dir / "profile.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
                    encoding="utf-8")
    packed = len(gzip.compress(path.read_bytes(), 9))
    print(f"  {path}  {path.stat().st_size / 1e6:.2f} MB "
          f"({packed / 1e6:.2f} MB gzipped)")

    national = scores.get(NATIONAL, {}).get(waves[-1], {})
    print(f"scopes scored: {len(scores)}   "
          f"reference rings in {waves[-1]}: "
          f"{max((v[2] for v in reference.get(waves[-1], {}).values()), default=0)}")
    for q in QUALITIES:
        row = national.get(q["key"])
        if row:
            print(f"  {q['label']:<20} {waves[-1]} landwyd  "
                  f"telling {row[0]:>4}   gemiddeld {row[1]:>5}%  "
                  f"({row[2]} aanwysers)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
