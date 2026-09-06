#!/usr/bin/env python3
"""
Build a codebook for each Kerkspieel wave and reconcile it with the data.

The 2018 and 2022 questionnaires print the variable code against every
field ("Belydende lidmate (V05)"), so a codebook can be lifted straight
out of the PDF and joined to the data by code. The 2026 export does not
carry codes at all -- its header row is question text -- so that wave is
matched by text similarity instead, and the residue is reported for
manual reconciliation.

Codes are renumbered every wave (belydende lidmate is V05 in 2018 and
2022, V02 in 2026), so a code is only ever meaningful together with its
year.

Requires poppler's pdftotext on PATH.

Usage:  python3 scripts/build_codebook.py
"""

import argparse
import collections
import csv
import difflib
import json
import pathlib
import re
import subprocess
import sys
import unicodedata

import openpyxl

# Accepts "(V05)", "(V57a, V57b)", "(V66,V67)" and the malformed "V153)"
# that appears where the source PDF lost an opening bracket.
CODE = re.compile(r"\(?\b((?:[Vv]\d{1,3}[a-zA-Z]?)(?:\s*,\s*(?:[Vv]?\s*\d{1,3}[a-zA-Z]?|[a-zA-Z]\b))*)\s*\)")
SECTION = re.compile(r"^\s*(\d{1,2})\s{2,}([A-ZŉÊÈÉÎÔÛ][A-ZŉÊÈÉÎÔÛ' \-/]{4,})\s*$")
QNUM = re.compile(r"^\s*(\d{1,2}\.\d{1,2})\.?\s+(.*)$")
GENDER_GRID = re.compile(r"\bMans\b.*\bVrou", re.I)
TRAILING_SCALE = re.compile(r"(\s+\d+){1,8}\s*$")

ADMIN_COLUMNS = {"Gemeentenaam", "RING NAAM", "DP", "BL", "V00 (Ring)"}
# Export plumbing in the 2026 file, not questions.
METADATA_COLUMNS_2026 = {"Sheet", "Gemeente naam", "Gemeente kode",
                         "timestamp", "Source of dataset"}

WAVES = {
    "2018": {"data": "Gemdata_2018_finaal.xlsx", "sheet": "KS2018",
             "header_row": 1, "questionnaire": "Gemeentevraelys_2018.pdf"},
    "2022": {"data": "Gemdata_2022_finaal.xlsx", "sheet": "Sheet1",
             "header_row": 1, "questionnaire": "Gemeentevraelys_2022.pdf"},
    "2026": {"data": "CS_2026_NGK_14072026.xlsx",
             "sheet": "Sheet 1 - Congregational_survey",
             "header_row": 2, "questionnaire": "Gemeentevraelys_2026.pdf"},
}


def pdf_text(pdf, cache_dir):
    out = cache_dir / (pdf.stem + ".txt")
    if not out.exists():
        subprocess.run(["pdftotext", "-layout", str(pdf), str(out)], check=True)
    return out


def codes_in(text):
    found = []
    for m in CODE.finditer(text):
        number = None
        for part in m.group(1).split(","):
            part = part.strip().replace(" ", "")
            if not part:
                continue
            # "(V65a, V65,b)" -- a stray comma orphans the suffix letter from
            # its number, so re-attach a bare letter to the preceding code.
            if re.fullmatch(r"[a-zA-Z]", part) and number:
                found.append("V" + number + part)
                continue
            if part[0].lower() != "v":
                part = "V" + part
            m2 = re.fullmatch(r"[Vv](\d{1,3})([a-zA-Z]?)", part)
            if m2:
                number = m2.group(1)
                found.append("V" + number + m2.group(2))
    return found


def clean(text):
    return re.sub(r"\s{2,}", " ", CODE.sub("", text)).strip(" .:\t")


def parse_questionnaire(path):
    """One row per variable code, carrying its section, question and label."""
    lines = pathlib.Path(path).read_text(encoding="utf-8").splitlines()
    section = qnum = stem = ""
    gendered = False
    rows, seen = [], set()

    for i, line in enumerate(lines):
        if not line.strip():
            continue
        ms = SECTION.match(line)
        if ms and not CODE.search(line):
            section = f"{ms.group(1)} {ms.group(2).strip().title()}"
            continue
        if GENDER_GRID.search(line) and not CODE.search(line):
            gendered = True
            continue

        mq = QNUM.match(line)
        if mq:
            gendered = False
            qnum, stem = mq.group(1), clean(mq.group(2))
            j = i + 1
            while (j < len(lines) and lines[j].strip() and len(stem) < 160
                   and not QNUM.match(lines[j]) and not CODE.search(lines[j])
                   and not SECTION.match(lines[j])
                   and not GENDER_GRID.search(lines[j])
                   and len(lines[j]) - len(lines[j].lstrip()) >= 4):
                stem += " " + lines[j].strip()
                j += 1
            stem = re.sub(r"\s+", " ", stem).strip()

        found = codes_in(line)
        if not found:
            continue
        item = TRAILING_SCALE.sub("", clean(line)).strip()
        # A Mans/Vrouens grid prints one code for a two-column table; the
        # data splits it into an "a" (mans) and "b" (vrouens) column.
        split = gendered and len(found) == 1 and not found[0][-1].isalpha()
        if split:
            found = [found[0] + "a", found[0] + "b"]

        for code in found:
            if code in seen:
                continue
            seen.add(code)
            suffix = " (mans)" if split and code.endswith("a") else (
                " (vrouens)" if split and code.endswith("b") else "")
            rows.append({"code": code, "section": section, "qnum": qnum,
                         "stem": stem,
                         "item": (item + suffix) if item != stem else suffix.strip()})
    return rows


def read_corrections(path, year):
    """Header fixes for known defects in the raw files, keyed by position."""
    if not path.exists():
        return {}
    lines = [ln for ln in path.read_text(encoding="utf-8").splitlines()
             if not ln.lstrip().startswith("#")]
    return {int(r["position"]): r["code"].strip()
            for r in csv.DictReader(lines) if r["year"].strip() == year}


def data_columns(path, sheet, header_row, corrections=None):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    header = list(wb[sheet].iter_rows(min_row=header_row, max_row=header_row,
                                      values_only=True))[0]
    wb.close()
    skip = ADMIN_COLUMNS | (METADATA_COLUMNS_2026 if header_row > 1 else set())
    # The 2026 export is littered with non-breaking spaces; fold them to
    # ordinary spaces so a column name is comparable to anything else.
    corrections = corrections or {}
    cleaned = [(j, corrections.get(j, re.sub(r"\s+", " ", h.replace("\xa0", " ")).strip()))
               for j, h in enumerate(header) if isinstance(h, str)]
    return [(j, h) for j, h in cleaned if h and h != "DROP" and h not in skip]


def normalise(text):
    text = unicodedata.normalize("NFKD", str(text or "")).lower()
    text = text.replace("?", "'").replace("’", "'").replace("\xa0", " ")
    return re.sub(r"[^a-z0-9 ]+", " ", text).strip()


def read_manual(path, columns, codebook):
    """Hand-made column->code decisions, resolved to sheet positions.

    Applied before the automatic matchers so an override locks its code and
    the matchers cannot hand that code to some other column.
    """
    if not path.exists():
        return {}
    lines = [ln for ln in path.read_text(encoding="utf-8").splitlines()
             if not ln.lstrip().startswith("#")]
    valid = {r["code"] for r in codebook}
    out = {}
    for entry in csv.DictReader(lines):
        name, code = entry["column"].strip(), entry["code"].strip()
        nth = int(entry.get("occurrence") or 1)
        hits = [j for j, col in columns if col == name]
        if code in valid and len(hits) >= nth:
            out[hits[nth - 1]] = code
    return out


def match_by_code(columns, codebook, manual=None):
    """2018 and 2022: the data column name is the variable code.

    Keyed on sheet position, not name: both files carry repeated column
    names, and keying on the name silently drops the later ones.
    """
    by_code = {r["code"]: r for r in codebook}
    manual = manual or {}
    resolved = {j: dict(by_code[c], column=dict(columns)[j], match_method="manual")
                for j, c in manual.items() if c in by_code}
    unresolved = []
    for j, col in columns:
        if j in resolved:
            continue
        if col in by_code:
            resolved[j] = dict(by_code[col], column=col)
        elif col + "a" in by_code:
            # "ander (spesifiseer)" written Vnnna in the questionnaire where
            # the data uses the bare Vnnn.
            resolved[j] = dict(by_code[col + "a"], column=col,
                               aliased_from=col + "a")
        elif col[-1].isalpha() and col[:-1] in by_code:
            # The mirror case: the questionnaire prints one code against an
            # "Ander:" row and the data splits it into the coded answer plus
            # a suffixed column holding the typed-in specification.
            base = by_code[col[:-1]]
            resolved[j] = dict(base, code=col, column=col, aliased_from=col[:-1],
                               item=(base["item"] + " (spesifiseer)").strip())
        else:
            unresolved.append((j, col))
    return resolved, unresolved


def longest_increasing(pairs):
    """Longest strictly-increasing-by-code-index run of (column, code) anchors."""
    if not pairs:
        return []
    best = [1] * len(pairs)
    prev = [-1] * len(pairs)
    for i in range(len(pairs)):
        for j in range(i):
            if pairs[j][1] < pairs[i][1] and best[j] + 1 > best[i]:
                best[i], prev[i] = best[j] + 1, j
    i = max(range(len(pairs)), key=lambda k: best[k])
    chain = []
    while i != -1:
        chain.append(pairs[i])
        i = prev[i]
    return chain[::-1]


def match_by_text(columns, codebook, manual=None, threshold=0.85):
    """2026: the data column name is the question text, so match on that."""
    # The export sometimes names a field by its own label, sometimes by the
    # question stem, and sometimes by both run together.
    candidates = [(r, [normalise(t) for t in
                       (r["item"] or r["stem"], r["stem"],
                        (r["stem"] + " " + r["item"]).strip())])
                  for r in codebook]
    by_code = {r["code"]: r for r in codebook}
    manual = manual or {}
    resolved = {j: dict(by_code[c], column=dict(columns)[j], label=dict(columns)[j],
                        match_method="manual")
                for j, c in manual.items() if c in by_code}
    locked = set(manual.values())
    unresolved = []
    for j, col in columns:
        if j in resolved:
            continue
        target = normalise(col)
        best_score, best_row = 0.0, None
        for row, targets in candidates:
            if row["code"] in locked:
                continue
            score = max(difflib.SequenceMatcher(None, target, t).ratio()
                        for t in targets if t)
            if score > best_score:
                best_score, best_row = score, row
        if best_score >= threshold:
            resolved[j] = dict(best_row, column=col, label=col,
                               match_score=round(best_score, 3))
        else:
            unresolved.append((j, col))

    # Several grids repeat their row labels verbatim -- the laerskool and
    # hoerskool blocks ask the same seven things -- so text alone hands the
    # same code to two columns. A code belongs to exactly one column, so
    # release every contested one and let position decide below.
    claimed = collections.Counter(r["code"] for r in resolved.values())
    for j in [j for j, r in resolved.items() if claimed[r["code"]] > 1]:
        unresolved.append((j, resolved.pop(j)["column"]))
    unresolved.sort()

    # The export runs in questionnaire order, so a column sitting between two
    # confidently matched neighbours can be placed by position. Anchor on the
    # longest run that respects that order, then fill a gap only where it
    # holds exactly as many unmatched columns as unclaimed codes.
    order = {r["code"]: k for k, r in enumerate(codebook)}
    anchors = longest_increasing(
        [(n, order[resolved[j]["code"]]) for n, (j, _) in enumerate(columns)
         if j in resolved and resolved[j]["code"] in order])
    stuck = dict(unresolved)
    for (slot_a, code_a), (slot_b, code_b) in zip(anchors, anchors[1:]):
        gap_slots = [columns[n][0] for n in range(slot_a + 1, slot_b)]
        gap_codes = [codebook[k] for k in range(code_a + 1, code_b)]
        taken = {r["code"] for r in resolved.values()}
        gap_codes = [c for c in gap_codes if c["code"] not in taken]
        if gap_slots and len(gap_slots) == len(gap_codes) \
                and all(j in stuck for j in gap_slots):
            for j, row in zip(gap_slots, gap_codes):
                resolved[j] = dict(row, column=stuck[j], label=stuck[j],
                                   match_method="position")
                unresolved.remove((j, stuck[j]))
    return resolved, unresolved


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", default="data/raw")
    ap.add_argument("--questionnaire-dir", default="data/questionnaires")
    ap.add_argument("--lookup-dir", default="data/lookup")
    ap.add_argument("--out-dir", default="data/codebook")
    args = ap.parse_args()

    data_dir = pathlib.Path(args.data_dir)
    q_dir = pathlib.Path(args.questionnaire_dir)
    lookup_dir = pathlib.Path(args.lookup_dir)
    out_dir = pathlib.Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    report = {}
    for year, spec in WAVES.items():
        data_path = data_dir / spec["data"]
        pdf_path = q_dir / spec["questionnaire"]
        if not data_path.exists() or not pdf_path.exists():
            print(f"{year}: skipped (missing {data_path if not data_path.exists() else pdf_path})")
            continue

        codebook = parse_questionnaire(pdf_text(pdf_path, out_dir))
        columns = data_columns(data_path, spec["sheet"], spec["header_row"],
                               read_corrections(lookup_dir / "column_corrections.csv",
                                                year))
        manual = read_manual(lookup_dir / f"codebook_{year}_overrides.csv",
                             columns, codebook)
        matcher = match_by_text if year == "2026" else match_by_code
        resolved, unresolved = matcher(columns, codebook, manual)

        (out_dir / f"codebook_{year}.json").write_text(
            json.dumps({"year": year, "variables": codebook,
                        "resolved": {str(j): v for j, v in sorted(resolved.items())},
                        "unresolved": [{"position": j, "column": c}
                                       for j, c in unresolved]},
                       ensure_ascii=False, indent=1), encoding="utf-8")

        pct = 100 * len(resolved) / len(columns)
        print(f"{year}: {len(resolved)}/{len(columns)} data columns labelled ({pct:.0f}%)"
              f"  [{len(codebook)} codes in questionnaire, matched by "
              f"{'text' if year == '2026' else 'code'}]")
        if unresolved:
            print(f"    unresolved: {', '.join(c for _, c in unresolved[:12])}"
                  f"{' ...' if len(unresolved) > 12 else ''}")
        report[year] = {"columns": len(columns), "labelled": len(resolved),
                        "unresolved": [c for _, c in unresolved]}

    (out_dir / "coverage.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
