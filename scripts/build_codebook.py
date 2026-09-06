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
CODE = re.compile(r"\(?\b((?:[Vv]\d{1,3}[a-zA-Z]?)(?:\s*,\s*[Vv]?\s*\d{1,3}[a-zA-Z]?)*)\s*\)")
SECTION = re.compile(r"^\s*(\d{1,2})\s{2,}([A-ZŉÊÈÉÎÔÛ][A-ZŉÊÈÉÎÔÛ' \-/]{4,})\s*$")
QNUM = re.compile(r"^\s*(\d{1,2}\.\d{1,2})\.?\s+(.*)$")
GENDER_GRID = re.compile(r"\bMans\b.*\bVrou", re.I)
TRAILING_SCALE = re.compile(r"(\s+\d+){1,8}\s*$")

ADMIN_COLUMNS = {"Gemeentenaam", "RING NAAM", "DP", "BL", "V00 (Ring)"}

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
        for part in m.group(1).split(","):
            part = part.strip().replace(" ", "")
            if not part:
                continue
            if part[0].lower() != "v":
                part = "V" + part
            m2 = re.fullmatch(r"[Vv](\d{1,3})([a-zA-Z]?)", part)
            if m2:
                found.append("V" + m2.group(1) + m2.group(2))
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


def data_columns(path, sheet, header_row):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    header = list(wb[sheet].iter_rows(min_row=header_row, max_row=header_row,
                                      values_only=True))[0]
    wb.close()
    return [(j, h.strip()) for j, h in enumerate(header)
            if isinstance(h, str) and h.strip() and h.strip() not in ADMIN_COLUMNS]


def normalise(text):
    text = unicodedata.normalize("NFKD", str(text or "")).lower()
    text = text.replace("?", "'").replace("’", "'").replace("\xa0", " ")
    return re.sub(r"[^a-z0-9 ]+", " ", text).strip()


def match_by_code(columns, codebook):
    """2018 and 2022: the data column name is the variable code."""
    by_code = {r["code"]: r for r in codebook}
    resolved, unresolved = {}, []
    for _, col in columns:
        if col in by_code:
            resolved[col] = by_code[col]
        elif col + "a" in by_code:
            # "ander (spesifiseer)" fields written Vnnna where data uses Vnnn
            resolved[col] = dict(by_code[col + "a"], aliased_from=col + "a")
        else:
            unresolved.append(col)
    return resolved, unresolved


def match_by_text(columns, codebook, threshold=0.85):
    """2026: the data column name is the question text, so match on that."""
    # The export sometimes names a field by its own label, sometimes by the
    # question stem, and sometimes by both run together.
    candidates = [(r, [normalise(t) for t in
                       (r["item"] or r["stem"], r["stem"],
                        (r["stem"] + " " + r["item"]).strip())])
                  for r in codebook]
    resolved, unresolved = {}, []
    for _, col in columns:
        target = normalise(col)
        best_score, best_row = 0.0, None
        for row, targets in candidates:
            score = max(difflib.SequenceMatcher(None, target, t).ratio()
                        for t in targets if t)
            if score > best_score:
                best_score, best_row = score, row
        if best_score >= threshold:
            resolved[col] = dict(best_row, match_score=round(best_score, 3))
        else:
            unresolved.append(col)
    return resolved, unresolved


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", default="data/raw")
    ap.add_argument("--questionnaire-dir", default="data/questionnaires")
    ap.add_argument("--out-dir", default="data/codebook")
    args = ap.parse_args()

    data_dir = pathlib.Path(args.data_dir)
    q_dir = pathlib.Path(args.questionnaire_dir)
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
        columns = data_columns(data_path, spec["sheet"], spec["header_row"])
        matcher = match_by_text if year == "2026" else match_by_code
        resolved, unresolved = matcher(columns, codebook)

        (out_dir / f"codebook_{year}.json").write_text(
            json.dumps({"year": year, "variables": codebook,
                        "resolved": resolved, "unresolved": unresolved},
                       ensure_ascii=False, indent=1), encoding="utf-8")

        pct = 100 * len(resolved) / len(columns)
        print(f"{year}: {len(resolved)}/{len(columns)} data columns labelled ({pct:.0f}%)"
              f"  [{len(codebook)} codes in questionnaire, matched by "
              f"{'text' if year == '2026' else 'code'}]")
        if unresolved:
            print(f"    unresolved: {', '.join(unresolved[:12])}"
                  f"{' ...' if len(unresolved) > 12 else ''}")
        report[year] = {"columns": len(columns), "labelled": len(resolved),
                        "unresolved": unresolved}

    (out_dir / "coverage.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
