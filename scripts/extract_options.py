#!/usr/bin/env python3
"""
Extract the response options each question offers, per wave.

Two questions can match across waves and still not be comparable, because
the scale underneath them changed -- the youth-ministry grids drop from
four options (Altyd/Gereeld/Soms/Nooit) in 2022 to three (Altyd/Soms/
Nooit) in 2026. Charting those side by side would be wrong, so the
options have to be read off the questionnaires rather than guessed from
the range of values that happen to appear in the data.

The questionnaires state options in two shapes:

    2.12 Word persone ... (V91)          a stacked list, one per line
                            Ja      1
                            Nee     2

    2.11 Het u diensooreenkomste ...     a grid: options named in a header
                                Ja   Nee row, values trailing each item row
         Musiekleier (V84)       1    2

Usage:  python3 scripts/extract_options.py
"""

import argparse
import collections
import json
import pathlib
import re
import sys

from build_codebook import codes_in

# "Ons inkomste hou tred met inflasie        2"
OPTION_LINE = re.compile(r"^\s{2,}(\S.*?)\s{2,}(\d)\s*$")
# A grid header naming the options, e.g. "Ja   Nee" or "Altyd  Soms  Nooit".
GRID_WORDS = ("ja", "nee", "altyd", "gereeld", "soms", "nooit", "mans", "vrouens",
              "vroue", "getal", "geen", "geringe", "belangrike", "swakker",
              "dieselfde", "beter", "meer", "minder")
CODE_ANY = re.compile(r"\([Vv]\d{1,3}[a-zA-Z]?")
NEXT_QUESTION = re.compile(r"^\s*\d{1,2}\.\d{1,2}\.?\s")


def grid_header(line):
    """Option labels if the line is a grid header, else None."""
    if CODE_ANY.search(line) or not line.strip():
        return None
    # Column headings may be separated by runs of spaces or by single ones
    # ("Ja Nee"), so fall back to plain whitespace when the wide split
    # leaves a single cell.
    parts = [p.strip() for p in re.split(r"\s{2,}", line.strip()) if p.strip()]
    if len(parts) < 2:
        parts = line.split()
    if not 2 <= len(parts) <= 6:
        return None
    if all(p.lower() in GRID_WORDS for p in parts):
        return parts
    return None


def extract(text_path):
    """code -> ordered list of (value, label)."""
    lines = pathlib.Path(text_path).read_text(encoding="utf-8").splitlines()
    options = {}
    header = None

    for i, line in enumerate(lines):
        found = codes_in(line)
        maybe_header = grid_header(line)
        if maybe_header:
            header = maybe_header
            continue
        if not found:
            if line.strip() and not OPTION_LINE.match(line):
                header = header if not line.strip()[0].isdigit() else None
            continue

        codes = found

        # Grid row: the option values trail the item text. A run of digits
        # reading 1..N is a scale whether or not a header was recognised --
        # the Likert grids label their columns several lines further up.
        trailing = [int(t) for t in re.findall(r"(?<=\s)(\d)(?=\s|$)", line.rstrip())]
        scale = len(trailing) >= 2 and trailing == list(range(1, len(trailing) + 1))
        # A header may name more columns than a row fills -- "Ja Nee Getal"
        # sits above rows carrying only the Ja/Nee codes -- so take the
        # header labels the row actually reaches.
        # The digits describe one variable's scale. Any further codes on the
        # row are separate columns -- "Musiekleier (V66,V67) 1 2" is a Ja/Nee
        # answer followed by a count -- and carry no scale of their own.
        if header and trailing and len(trailing) <= len(header):
            options[codes[0]] = list(zip(trailing, header[:len(trailing)]))
            continue
        if scale:
            options[codes[0]] = [(v, "") for v in trailing]
            continue

        # Stacked list: consecutive "<label>  <n>" lines below the question.
        stack, carried = [], []
        for follower in lines[i + 1:]:
            # Stop at the next question; an option list never spans one.
            if CODE_ANY.search(follower) or NEXT_QUESTION.match(follower):
                break
            m = OPTION_LINE.match(follower)
            bare = re.fullmatch(r"\s+(\d)\s*", follower)
            if m or bare:
                # Options are numbered 1..N in order. Page furniture strays
                # into this shape -- a lone "9" sits under one 2022 list -- so
                # anything that does not continue the run ends it.
                value = int((m or bare).group(2 if m else 1))
                if value != len(stack) + 1:
                    break
                if m:
                    text = " ".join(carried + [m.group(1)])
                else:
                    # A long option wraps and leaves its number stranded on a
                    # line of its own, with the text above and below it.
                    text = " ".join(carried)
                carried = []
                stack.append((value, re.sub(r"\s+", " ", text).strip()))
            elif follower.strip():
                # A wrapped option puts text either side of its number, so
                # hold unnumbered lines until the next number claims them.
                carried.append(follower.strip())
                if len(carried) > 3:
                    break
        if carried and stack:
            # Whatever is left over trails the final option.
            value, text = stack[-1]
            stack[-1] = (value, re.sub(r"\s+", " ",
                                       f"{text} {' '.join(carried)}").strip())
        if len(stack) >= 2:
            options[codes[0]] = stack
    return options


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--codebook-dir", default="data/codebook")
    args = ap.parse_args()
    cb_dir = pathlib.Path(args.codebook_dir)

    out = {}
    for year in ("2018", "2022", "2026"):
        text = cb_dir / f"Gemeentevraelys_{year}.txt"
        if not text.exists():
            sys.exit(f"missing {text}; run scripts/build_codebook.py first")
        opts = extract(text)
        book = json.loads((cb_dir / f"codebook_{year}.json").read_text(encoding="utf-8"))
        known = {v["code"] for v in book["resolved"].values()}
        hit = {c: o for c, o in opts.items() if c in known}
        sizes = collections.Counter(len(o) for o in hit.values())
        out[year] = hit
        print(f"{year}: options found for {len(hit)}/{len(known)} variables "
              f"({100 * len(hit) / len(known):.0f}%); sizes {dict(sorted(sizes.items()))}")

    path = cb_dir / "options.json"
    path.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"wrote {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
