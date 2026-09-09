# Kerkspieël

Four reports over the NG Kerk's own data, behind one navigation:

| Page | What it shows |
|---|---|
| `index.html` | Landing page: what the tool is and how to read it |
| `kerkprofiel.html` | Nine qualities of church life, the NCLS vitality framework read off this data |
| `ring.html` | Ringsverslag — a ring against its synod and the whole church, across three survey waves; the published report's own four questions lead the dropdown |
| `kaart.html` | Congregations on a map, coloured or sized by their own answer |
| `predikante.html` | Ministers by credential category, per congregation, ring, synod or nationally |
| `predikanteprofiel.html` | Age profile of ministers, filterable by gender, congregation-ministry set and individual credential codes |

It draws on the **Gemeentevraelys** of 2018, 2022 and 2026, and on the
**ABR ministers registers** of 2015-2026.

Everything is static: the data is precomputed into JSON and aggregated in
the browser. There is no server and no database. Leaflet is vendored into
`web/public/vendor/`, so the site has no third-party runtime dependency
either; the map's basemap tiles are the one external request it makes.

## The one thing to know about the data

**Variable codes are renumbered every wave.** "Belydende lidmate" is `V05`
in 2018 and 2022 but `V02` in 2026; "Hoe sou u die gemeente se huidige
rigting tipeer" is `V160`, then `V179`, then `V118`. 348 column names are
shared between the 2018 and 2022 files while meaning different questions,
so joining the waves on column name produces silently wrong answers. A
code is only meaningful together with its year, and
`data/lookup/crosswalk.csv` is what connects them.

Two further traps the pipeline handles:

- **Each wave is counted against its own scale.** 2022 inserts *Gereeld*
  into grids that read *Altyd / Soms / Nooit* either side of it. Counting a
  2022 answer against 2026's shorter list dropped every *Nooit* and filed
  every *Soms* under the wrong name -- 18,143 answers discarded and 34,267
  relabelled across 94 question-waves. `aggregates.json` and `map.json` now
  carry one option list per wave, and a chart's axis is the merged order of
  all of them, so a wave that never offered an option simply has no bar
  there.

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
python3 scripts/build_dataset.py     # -> data/build (congregation level, not published)
python3 scripts/build_aggregates.py  # -> web/public/data/aggregates.json + numeric.json
python3 scripts/build_profile.py     # -> web/public/data/profile.json
python3 scripts/build_map.py         # -> web/public/data/map.json
python3 scripts/build_ministers.py   # -> web/public/data/ministers.json
python3 scripts/validate_pipeline.py # decode path vs the published report
python3 scripts/validate_dataset.py  # built dataset vs the published report
cd web/public && python3 -m http.server 8788
```

`build_dataset.py` writes to `data/build/`, which is **not** published:
it holds one row per congregation. `build_aggregates.py` reduces that to
the ring, synod and national counts the dashboard actually shows, and
only `web/public/data/aggregates.json` is committed and deployed.

## Deploying

Cloudflare's unified Workers & Pages dashboard, connected directly to
this GitHub repo (Workers & Pages → Create → **Connect to Git**). No
build step runs on Cloudflare's side — the data is committed as JSON —
the project just serves `web/public` as static assets, per
`wrangler.toml`:

```toml
name = "kerkspieel"
compatibility_date = "2026-09-01"

[assets]
directory = "./web/public"
```

This is the newer `[assets]`-based config a git-connected **Worker**
deploy expects (it runs `wrangler deploy`). It is *not* the classic Pages
`pages_build_output_dir` key. `wrangler deploy` only reads the config
file sitting in its actual working directory — which is the project's
"Root directory" build setting, not necessarily the repo root — so an
identical `wrangler.toml` (with the path adjusted) lives at **both**
the repo root and in `web/`, covering either setting rather than relying
on knowing which one the dashboard is using.

If the repo picker shows **"Missing git connection,"** Cloudflare's
GitHub App isn't authorized for this repo yet: go to
[github.com/settings/installations](https://github.com/settings/installations),
find **Cloudflare Pages** (or **Cloudflare Workers and Pages**), click
**Configure**, and grant it access to `cobusvwyngaard/kerkspieel` (or all
repos). Then reselect the repo in Cloudflare.

Once the project exists, every push gets deployed automatically: the
production branch (whatever the project is configured with, typically
`main`) gets the production URL, and every other branch — including this
one — gets its own **preview** URL. When a wave is refreshed, regenerate
`aggregates.json` locally, commit it, and push; no manual redeploy step.

### If the dashboard stops triggering builds

`.github/workflows/deploy.yml` runs the same deploy manually (Actions →
Deploy dashboard → Run workflow), so a deploy can be run and its log read
without the dashboard. It is `workflow_dispatch` only, so it never races
the dashboard's own builds. It needs two repository secrets under
Settings → Secrets and variables → Actions:

| Secret | Where it comes from |
|---|---|
| `CLOUDFLARE_API_TOKEN` | My Profile → API Tokens → Create Token, with **Workers Scripts: Edit** — this project is a Worker, so *not* Cloudflare Pages: Edit |
| `CLOUDFLARE_ACCOUNT_ID` | Workers & Pages, in the right-hand sidebar |

### Verifying a change before pushing

`wrangler` validates the whole thing locally without any credentials:

```
npx wrangler@4 deploy --dry-run   # config parses, assets resolve
npx wrangler@4 dev --local        # serves the real site on the Workers runtime
```

> **A Pages URL is public by default.** The published data includes ring
> cells where only one or two congregations responded, and in those the
> distribution *is* that congregation's answer. Turn on Cloudflare Access
> for the project (Workers & Pages → the project → Settings → Access
> policy) before sharing the link. Alternatively, suppress those cells at
> build time — 31 of 390 ring/wave cells have fewer than three responding
> congregations.

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
| `JAARLIKSE_AANMELDING_<year>.pdf` | the ABR's annual circular; the source of `data/lookup/abr_codes.csv` |
| `kerkspieel_geolocation_match.xlsx`, `Gemeentes1.xlsx`, `Ontbinde_gemeentes.xlsx` | congregation coordinates |
| `WK__George.pdf`, `Skuiwe_in_die_Kerk__PTA_Oos_Ring.pptx` | the published reports; the source of the ring page's recommended questions |

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
| ABR circular, `A02` | the definition runs "gekoppel is aan 'n gemeente met geen wedersydse verpligtinge nie beroep is na 'n gemeente en voltyds in diens is" -- the second half is `A01`'s text, pasted in. `abr_codes.csv` keeps the first half |

Fixed in the pipeline, and worth knowing about:

- **`KS_lookup` labels were keyed by whichever wave's code a row carried.**
  Rows that start at 2022 have a blank 2018 code, so they were keyed by
  the 2022 code -- into the same dict the 2018 codes are looked up in.
  `V241` exists in both waves and names a different question in each, so
  seven questions were charted under someone else's label: the hospitality
  grid's wording (question 6.4) over the catechesis grid's columns
  (question 7.1), whose values are counts running to 602. Labels are keyed
  by wave now. `scripts/scales.py` keeps the check that caught it -- a
  question-wave whose answers mostly fall outside its own option list, or
  whose three-point scale only ever records 1 and 2 -- and both
  `build_aggregates.py` and `build_map.py` run it.

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
- **Grid options spanning three lines.** A grid row wraps: the item text
  on one line, the option digits on the next, the rest of the text and the
  variable code on a third. `extract_options.py` used to require the
  digits and the code on one line, so 42 questions reached the reports
  with no option list at all and were filed as counts. It now carries a
  stranded run of digits forward to the code that claims it, and reads the
  transposed grids -- where the columns are the variables and the rows are
  the options -- in a second pass. 211 variables gained their options.

- **105 congregations have no coordinate**, mostly amalgamations and
  renamings the geolocation match sheet has not caught up with. Run
  `scripts/audit_geo.py` for the list.
- `KS_Ring_Lookup` carries ring-name spelling variants (`Belville` /
  `Bellville`) and one duplicated code (`NS-QUA001` names both
  Quaggapoort and Queenswood).

## Exporting to PowerPoint

Every chart panel carries a **Stoor as PowerPoint** button. It writes a
one-slide `.pptx` containing a **native PowerPoint chart**, not a picture
of one -- so the recipient can restyle it, read the numbers off it, and
paste it into an existing deck. The slide carries the panel's title, its
subtitle (which names the scope and year), and a source line.

The map exports through the same button, but a map is a picture rather
than a chart, so that one slide holds an image: the basemap tiles and the
pins are redrawn onto a canvas at exactly the framing on screen, at twice
the screen's resolution where that stays within a polite number of tile
requests. Only the picture is pixels -- the legend is rebuilt out of
PowerPoint shapes and text, so it stays editable. Tiles are fetched as
CORS requests (`crossOrigin` is set on the tile layer, so the map's own
tiles and the exporter's share one cache entry, and the canvas is never
tainted); a tile that fails or is slow is left out rather than failing the
export, and OpenStreetMap's attribution is drawn into the image and
repeated in the source line.

PptxGenJS is vendored into `web/public/vendor/` for the same reason as
Leaflet. Charts record what they drew when they render, so the exporter
never re-derives the data; CSS custom properties are resolved to hex at
export time, so an exported chart keeps the palette of the theme it was
exported from.

Generated files are checked with the pptx skill's validator, which catches
the chart XML PowerPoint refuses to open. Note that LibreOffice cannot
convert any `.pptx` in this development sandbox -- a trivial control deck
fails identically -- so exports are verified structurally rather than by
rendering them.

## The nine qualities

`kerkprofiel.html` applies **NCLS Research's church vitality framework** --
nine Core Qualities in three groups, which their *Church Life Profile*
reports on -- to the Gemeentevraelys. The indicator table is
`data/lookup/profile_indicators.csv`: one row per indicator, naming its
question by wording rather than by id, and its positive answers by their
*label* rather than their number -- the number means different answers in
different waves, the label does not. `build_profile.py` resolves each
pattern and **fails the build** if one matches no question or more than
one, or if a positive label matches more than one option in a wave. Where
a wave words a long option differently, it falls back to matching by
position and says so.

Two things it is not:

- **It is not the NCLS instrument.** NCLS surveys attenders and can ask a
  person whether their own faith grew this year. The Gemeentevraelys
  surveys congregations, and the leadership answers, so it can only ask
  whether the congregation runs a prayer ministry, small groups, faith
  formation in homes. Every indicator here measures *provision*, not
  *experience*.
- **The score is not NCLS's score.** NCLS does not publish how it
  standardises its 1-to-10 scale. This one is defined from scratch: each
  indicator is standardised against the spread of *rings* in the same wave,
  two points to a standard deviation, and a quality's score is the mean of
  its indicators' scores. Five is the average ring. A synod is an average
  of its own rings, so its score sits closer to 5 by construction.

## The ministers data

The ABR registers name every minister, and the 2015-2019 and 2023 files
carry South African ID numbers. `build_ministers.py` reads them and emits
only counts: no name, date of birth or ID number reaches
`web/public`. Age is published for a ring, a synod or the whole church,
never per congregation, where one minister's age band would identify
them; category counts are published per congregation, since how many
ministers a congregation has is not personal information.

### What the credential codes mean

`data/lookup/abr_codes.csv` carries the ABR's own bevoegdheidstabel --
the 22 codes `A01`-`E02`, each with its short name and its full
definition -- transcribed from the annual JAARLIKSE AANMELDING circular.
It is the authority for how a code is labelled, and the register's own
description column is only a fallback: that column is truncated,
disagrees between years, and is **blank for `A08`, `A10`, `C03`, `C04`
and `D03`**, which are five of the eight non-`A01` congregation-ministry
codes. Six codes appear in the register but not in the ABR's table --
`A00` and `B00` (an unrecorded code within a letter group), `B04`,
`F01`, `V01` and `ZZZ` -- and those keep the register's own wording.
The letter-group headings are the table's own.

When the circular is reissued, update the CSV; nothing else needs to
change.

### Ministers serving a congregation

Three sets cut across the letter groups, carried over unchanged from the
Power BI report so the two agree:

| Set | Codes |
|---|---|
| Gemeentepredikante | `A01 A02 A03 A08 A10 D03 C01 C03 C04` |
| Gemeentepredikante A01 | `A01` |
| Gemeentepredikante nie A01 | the balance |

They include the emeritus who still works in a congregation (`C01`) and
exclude codes like `A05` (lecturer), so they are not the same as the
letter-A group. The split matters: `A01` posts fall from 1,304 to 704
between 2015 and 2026 while the rest rise from 315 to 460, so the
non-`A01` share of congregation ministry roughly doubles, from 19.5% to
39.5%.

### Gender

Gender is not in the register at all. It comes from the 2022 detail
extract, joined on the ABR number, which is also where the 2020-2022 birth
years come from. **The join is thin before 2020**: the register renumbered
between waves, so gender is known for only 42-46% of 2015-2019 rows, and
that matched part is 98.8% male -- the female count sits at exactly 23 in
every one of those five years, which is an artefact of who the join
reaches, not a fact about the ministry. From 2020 the coverage is 87-99%.
The profile page warns on any year where coverage falls below 80% of the
current selection.

Two further quirks the pipeline handles:

- **2020, 2021 and 2022 have no age column at all**, nor an ID column.
  Those ages are derived by joining birth years from the 2022 detail
  extract on the ABR number, which recovers them at the same ~80%
  coverage the other years reach on their own. The derivation only
  reaches ministers who also appear in that extract — a slightly older
  group — so the mean age jumps at that boundary for reasons that are not
  real ageing. The report says so, and marks those years.
- **Deceased ministers (group F) appear in some registers and not
  others** — none in 2015-2019 or 2023, several hundred elsewhere — so
  totals are not comparable year on year unless they are excluded. The
  report excludes them by default.

Ages outside 20-105 are dropped as data errors; the later files contain
ages in the 900s.

## Still open

- **Two rows of the 2018 hospitality grid look crossed against their
  later selves.** 2022 and 2026 ask seven items there where 2018 asks six,
  and the crosswalk pairs them by wording; five of the six line up (their
  distributions track across the waves), but "van gasvryheid ... te kweek"
  reads 69% *Altyd* in 2018 against 8% and 14% later, and "mense te besoek
  en te nooi" runs the other way. Both are almost certainly matched to the
  wrong row of the later grid. Grids whose row count changes between waves
  need matching on the block, not row by row.

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
