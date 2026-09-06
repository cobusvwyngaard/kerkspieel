# Kerkspieël

A dashboard over the Kerkspieël congregational survey (Gemeentevraelys),
covering the 2018, 2022 and 2026 waves. It reproduces the per-ring
Ringsverslag that was previously produced in Power BI, and adds the third
wave.

The dashboard is static: all three waves compress to well under a
megabyte, so everything is precomputed into JSON and aggregated in the
browser. There is no server and no database.

## The one thing to know about the data

**Variable codes are renumbered every wave.** "Belydende lidmate" is `V05`
in 2018 and 2022 but `V02` in 2026; "Hoe sou u die gemeente se huidige
rigting tipeer" is `V160`, then `V179`, then `V118`. 348 column names are
shared between the 2018 and 2022 files while meaning different questions,
so joining the waves on column name produces silently wrong answers. A
code is only meaningful together with its year, and
`data/lookup/crosswalk.csv` is what connects them.

Two further traps the pipeline handles:

- **Some scales are stored in reverse.** For the financial-position and
  Likert questions the raw code `1` is the *best* answer, not the worst.
  `KS_lookup` records the intended display order and the pipeline applies
  it; ignoring it inverts the chart.
- **A matched question is not always a comparable one.** The
  youth-ministry grids keep their wording but drop from four options in
  2022 to three in 2026. The crosswalk carries a `comparable` verdict and
  the dashboard warns where the scale moved.

## Running it

```
pip install openpyxl                 # and poppler-utils for pdftotext
python3 scripts/build_codebook.py    # questionnaires -> labels for every column
python3 scripts/extract_options.py   # questionnaires -> response options
python3 scripts/resolve_2026_keys.py # 2026's self-entered keys -> V03 codes
python3 scripts/build_crosswalk.py   # match questions across waves
python3 scripts/build_dataset.py     # -> web/public/data/*.json
python3 scripts/validate_pipeline.py # decode path vs the published report
python3 scripts/validate_dataset.py  # built dataset vs the published report
cd web/public && python3 -m http.server 8788
```

Deployment is Cloudflare Pages, serving `web/public` as-is
(`web/wrangler.toml`).

## Inputs

Raw extracts are **not** committed: they carry free-text comment fields
that can identify individual ministers and congregations. Put them in
`data/raw/` and the questionnaires in `data/questionnaires/`.

| File | What it is |
|---|---|
| `Gemdata_2018_finaal.xlsx`, `Gemdata_2022_finaal.xlsx` | wave extracts, columns named by variable code |
| `CS_2026_NGK_14072026.xlsx` | 2026 extract, columns named by question text |
| `Gemeentevraelys_{2018,2022,2026}.pdf` | the questionnaires; the source of every label |
| `KS_lookup.xlsx` | 106 hand-verified question pairs and the scale definitions |
| `KS_Ring_Lookup.xlsx`, `sinode_lookup.xlsx` | congregation register; ring and synod |
| `kerkspieel_geolocation_match.xlsx`, `Gemeentes1.xlsx`, `Ontbinde_gemeentes.xlsx` | congregation coordinates |

## What is verified, and what is not

`validate_pipeline.py` reproduces eight figures from the published WK /
George Ringsverslag directly off the workbooks.
`validate_dataset.py` reproduces the George ring's participation and
distributions out of the JSON the browser reads. Both pass exactly.

The 2018-to-2022 crosswalk agrees with `KS_lookup`'s verified pairs on
87 of 89. The **2022-to-2026 crosswalk has no ground truth** — the same
method scores 98% where it can be checked, and the report questions were
confirmed by hand, but the rest is derived and unaudited.

Two published figures are deliberately not reproduced:

- the published *synod* figures include `WK_TOE001` "Toetsgemeente", a
  test record whose ring reads `#N/A`. It is excluded here, which moves
  the WK 2018 base from 190 to 189.
- the published *national* base is 849 where this extract holds 846
  congregations answering the question, so national shares differ in the
  second decimal.

## Known defects in the source files

Corrected at read time from `data/lookup/column_corrections.csv`:

| Where | Defect |
|---|---|
| 2018 cols 187, 252 | duplicate their neighbour, values stored as text |
| 2022 col 66 | named `V62b`; sits between `V61a` and `V62a` and is `V61b` |
| 2022 col 95 | named `V62`; carries Ja/Nee between `V81` and `V82b`, so is `V82a` |
| 2022 col 413 | named `V284`; sits in the `V381`-`V386` run, so is `V384` |
| 2022 `V389` | holds no value in any of the 1075 rows |

Not corrected, and needing a decision:

- **2026 congregation keys are self-entered and unreliable.** Twelve were
  submitted by more than one congregation and the questionnaire's
  placeholder `V01` was submitted by six.
  `scripts/resolve_2026_keys.py` places 656 of 658 rows by resolving the
  key and the name together; the two it cannot place are in
  `data/lookup/key_2026_unresolved.md`. This is an interim bridge — drop
  an authoritative old/new key lookup in as
  `data/lookup/key_2026_authoritative.csv` and it supersedes every
  heuristic.
- **105 congregations have no coordinate**, mostly amalgamations and
  renamings the geolocation match sheet has not caught up with. Run
  `scripts/audit_geo.py` for the list.
- `KS_Ring_Lookup` carries ring-name spelling variants (`Belville` /
  `Bellville`) and one duplicated code (`NS-QUA001` names both
  Quaggapoort and Queenswood).

## Still open

- **Small numbers.** A ring can have four responding congregations, where
  every answer moves the share by 25 points. The dashboard says so, but
  there is no suppression rule yet.
- **POPIA.** The built dataset holds one row per congregation, so a named
  congregation's answers are readable from the JSON even though the UI
  only shows aggregates. Free text is dropped at build time, but decide
  between shipping per-congregation rows and pre-aggregated ones before
  deploying anywhere public.
- **Access.** Public, or authenticated per ring? Static Pages cannot do
  the latter on its own.
- **Output.** The previous artefact was a PDF per ring. Whether the
  dashboard should also generate those changes the architecture.
