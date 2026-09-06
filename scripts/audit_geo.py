#!/usr/bin/env python3
"""
Audit the congregation -> coordinate join.

kerkspieel_geolocation_match.xlsx reconciles the survey's congregation
names with the names used in the two placemark exports (Gemeentes1 =
active, Ontbinde_gemeentes = dissolved). This reports how much of the
survey population can actually be placed on a map, and which
congregations still need a coordinate.

Usage:  python3 scripts/audit_geo.py [--data-dir data/raw]
"""

import argparse
import pathlib
import sys
import unicodedata

import openpyxl

PREFIX = "ng gemeente "


def load(path, sheet):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb[sheet]
    rows = list(ws.iter_rows(values_only=True))
    wb.close()
    return rows[0], [r for r in rows[1:] if any(v not in (None, "") for v in r)]


def norm(value):
    """Normalise a congregation name for joining.

    The exports carry non-breaking spaces and an 'NG Gemeente ' prefix;
    the match sheet holds live formulas, so unresolved cells arrive as
    the boolean False rather than as text.
    """
    if value is None or isinstance(value, bool):
        return None
    s = unicodedata.normalize("NFKC", str(value)).replace("\xa0", " ").strip()
    if s.lower().startswith(PREFIX):
        s = s[len(PREFIX):].strip()
    return s or None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", default="data/raw")
    args = ap.parse_args()
    d = pathlib.Path(args.data_dir)

    files = {
        "match": d / "kerkspieel_geolocation_match.xlsx",
        "active": d / "Gemeentes1.xlsx",
        "dissolved": d / "Ontbinde_gemeentes.xlsx",
        "2018": d / "Gemdata_2018_finaal.xlsx",
    }
    absent = [str(p) for p in files.values() if not p.exists()]
    if absent:
        sys.exit("missing input files:\n  " + "\n  ".join(absent))

    _, match = load(files["match"], "Sheet1")
    _, active = load(files["active"], "sql_statement")
    _, dissolved = load(files["dissolved"], "sql_statement")

    points = {}
    for rows, status in ((active, "active"), (dissolved, "dissolved")):
        for r in rows:
            points.setdefault(norm(r[3]), (float(r[0]), float(r[1]), status))
    points.pop(None, None)
    folded = {k.lower(): v for k, v in points.items()}

    placed, unplaced = [], []
    for r in match:
        # The match sheet spreads candidate names across several columns;
        # take the first that resolves.
        for col in (3, 5, 1, 2, 4):
            key = norm(r[col] if col < len(r) else None)
            if key and (key in points or key.lower() in folded):
                placed.append(r[0])
                break
        else:
            unplaced.append((r[0], r[1]))

    total = len(match)
    print(f"coordinate sources : {len(active)} active + {len(dissolved)} dissolved "
          f"= {len(points)} distinct names")
    print(f"match sheet        : {total} congregations")
    print(f"placed on a map    : {len(placed)} ({100 * len(placed) / total:.0f}%)")
    print(f"still unplaced     : {len(unplaced)}")

    h18, d18 = load(files["2018"], "KS2018")
    i18 = {h.strip(): i for i, h in enumerate(h18) if isinstance(h, str) and h.strip()}
    keys18 = {r[i18["V03"]] for r in d18}
    keys_match = {r[0] for r in match}
    print(f"2018 congregations absent from match sheet : {len(keys18 - keys_match)} "
          f"(match sheet is keyed on the 2022 population)")

    if unplaced:
        print("\nunplaced congregations:")
        for code, name in unplaced:
            print(f"  {code:12s} {name}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
