#!/usr/bin/env python3
"""
Resolve 2026 congregation keys onto the standing V03 congregation codes.

The 2026 export's "Gemeente kode" is self-entered and unreliable: it mixes
several formats, 12 codes are used by more than one congregation, and
"V01" (the questionnaire's placeholder) was submitted by six different
congregations. The congregation name is the stronger identifier, so this
resolves on both and reports where they disagree.

This is an interim bridge. When an authoritative old-key/new-key lookup
becomes available, drop it in as data/lookup/key_2026_authoritative.csv
(columns: key_2026,V03) and it takes precedence over every heuristic
below; manual decisions live in data/lookup/key_2026_overrides.csv with
the same columns and take precedence over everything.

Usage:  python3 scripts/resolve_2026_keys.py
"""

import argparse
import collections
import csv
import difflib
import pathlib
import re
import sys
import unicodedata

import openpyxl

SHEET_2026 = "Sheet 1 - Congregational_survey"
# Denominational prefixes that carry no identifying information.
NOISE = re.compile(r"^(ng\s*kerk|ng\s*gemeente|ngk|n\s*g\s*kerk|n\s*g\s*gemeente|"
                   r"nederduitse\s+gereformeerde\s+kerk|gemeente|ng)\b[\s.\-]*", re.I)
STUB = re.compile(r"([A-Za-z]{3})\s*(\d{1,3})\s*$")
FUZZY_CUTOFF = 0.88


def load(path, sheet, header_row=1):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    rows = list(wb[sheet].iter_rows(values_only=True))
    wb.close()
    return rows[header_row - 1], [r for r in rows[header_row:]
                                  if any(v not in (None, "") for v in r)]


def normalise_name(value):
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = text.encode("ascii", "ignore").decode().lower().replace("\xa0", " ").strip()
    for _ in range(3):                       # "NG Kerk NG Gemeente X"
        text = NOISE.sub("", text).strip()
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def key_stub(value):
    """The LLLNNN tail shared with the standing codes: 05063WAR001 -> WAR001."""
    m = STUB.search(str(value or "").strip())
    return f"{m.group(1).upper()}{int(m.group(2)):03d}" if m else None


def read_overrides(path):
    """Map (key, name) and (key, "") to a V03 code, ignoring # comment lines.

    The same key was submitted by several congregations, so an override may
    have to name the congregation as well to be unambiguous.
    """
    if not path.exists():
        return {}
    lines = [ln for ln in path.read_text(encoding="utf-8").splitlines()
             if not ln.lstrip().startswith("#")]
    out = {}
    for r in csv.DictReader(lines):
        key, v03 = (r.get("key_2026") or "").strip(), (r.get("V03") or "").strip()
        if key and v03:
            out[(key, (r.get("name_2026") or "").strip())] = v03
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", default="data/raw")
    ap.add_argument("--lookup-dir", default="data/lookup")
    ap.add_argument("--out", default="data/lookup/key_2026_resolved.csv")
    args = ap.parse_args()

    data_dir = pathlib.Path(args.data_dir)
    lookup_dir = pathlib.Path(args.lookup_dir)
    lookup_dir.mkdir(parents=True, exist_ok=True)

    _, ring_rows = load(data_dir / "KS_Ring_Lookup.xlsx", "Sheet1")
    _, rows_2026 = load(data_dir / "CS_2026_NGK_14072026.xlsx", SHEET_2026, 2)

    valid = {r[1] for r in ring_rows}
    by_name = collections.defaultdict(list)
    by_stub = collections.defaultdict(list)
    for r in ring_rows:
        by_name[normalise_name(r[2])].append(r[1])
        stub = key_stub(r[1])
        if stub:
            by_stub[stub].append(r[1])
    names = list(by_name)

    authoritative = read_overrides(lookup_dir / "key_2026_authoritative.csv")
    overrides = read_overrides(lookup_dir / "key_2026_overrides.csv")

    resolved, counts = [], collections.Counter()
    for i, row in enumerate(rows_2026):
        raw_key = str(row[2]).strip() if row[2] else ""
        raw_name = str(row[1]).strip() if row[1] else ""

        manual = next((table[k] for table, label in
                       ((overrides, "override"), (authoritative, "authoritative"))
                       for k in ((raw_key, raw_name), (raw_key, ""))
                       if k in table), None)
        if manual:
            label = "override" if any(k in overrides for k in
                                      ((raw_key, raw_name), (raw_key, ""))) else "authoritative"
            resolved.append((i, raw_key, raw_name, manual, label, ""))
            counts[label] += 1
            continue

        # Candidate from the self-entered key.
        from_key = None
        if raw_key in valid:
            from_key = raw_key
        else:
            stub = key_stub(raw_key)
            if stub and len(by_stub.get(stub, [])) == 1:
                from_key = by_stub[stub][0]

        # Candidate from the congregation name.
        from_name, name_method = None, ""
        norm = normalise_name(raw_name)
        if norm and len(by_name.get(norm, [])) == 1:
            from_name, name_method = by_name[norm][0], "exact"
        elif norm:
            close = difflib.get_close_matches(norm, names, n=1, cutoff=FUZZY_CUTOFF)
            if close and len(by_name[close[0]]) == 1:
                from_name, name_method = by_name[close[0]][0], "fuzzy"

        if from_key and from_name and from_key == from_name:
            method, note = "key+name", ""
        elif from_key and from_name:
            # Both fields resolved but disagree. Neither wins reliably -- of
            # the five conflicts in the July 2026 export, three were the key
            # and two the name -- so a conflict is left for a human and the
            # row is held out of the aggregates until an override names it.
            method, note = "conflict", f"key->{from_key} name->{from_name}"
            from_key = from_name = None
        elif from_name:
            method, note = f"name-{name_method}", ""
        elif from_key:
            method, note = "key-only", ""
        else:
            method, note = "unresolved", ""

        v03 = from_name or from_key
        counts[method] += 1
        resolved.append((i, raw_key, raw_name, v03 or "", method, note))

    # A congregation answering twice is a duplicate submission, not a bad
    # key. Keep the fullest response and mark the rest so aggregates count
    # each congregation once.
    answered = {}
    for row in rows_2026:
        answered[id(row)] = sum(1 for v in row[3:] if v not in (None, ""))
    per_code = collections.defaultdict(list)
    for i, r in enumerate(resolved):
        if r[3]:
            per_code[r[3]].append(i)
    superseded = set()
    for idxs in per_code.values():
        if len(idxs) > 1:
            best = max(idxs, key=lambda i: answered[id(rows_2026[resolved[i][0]])])
            superseded |= set(idxs) - {best}
    resolved = [(*r, "superseded" if i in superseded else "keep")
                for i, r in enumerate(resolved)]

    duplicates = {code: len(idxs) for code, idxs in per_code.items() if len(idxs) > 1}

    out = pathlib.Path(args.out)
    with out.open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["row", "key_2026", "name_2026", "V03", "method", "note", "status"])
        w.writerows(resolved)

    total = len(rows_2026)
    placed = sum(1 for r in resolved if r[3])
    print(f"2026 rows: {total}")
    for method, n in counts.most_common():
        print(f"  {method:16s} {n:4d}")
    print(f"\nplaced on a standing V03 code: {placed}/{total} "
          f"({100 * placed / total:.0f}%)")
    kept = sum(1 for r in resolved if r[3] and r[6] == "keep")
    print(f"distinct congregations after de-duplication: {kept}")
    print(f"congregations with more than one submission: {len(duplicates)}")
    if duplicates:
        print("  " + ", ".join(f"{k} x{c}" for k, c in sorted(duplicates.items())[:12]))
    print(f"\nwrote {out}")
    unresolved = [r for r in resolved if not r[3]]
    if unresolved:
        print(f"\n{len(unresolved)} rows need a manual decision; add them to "
              f"{lookup_dir / 'key_2026_overrides.csv'}:")
        for r in unresolved[:20]:
            print(f"  row {r[0]:3d}  key={r[1]!r:16s} name={r[2]!r}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
