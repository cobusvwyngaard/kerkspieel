/* The minister profile: who the register holds for a ring, a synod or the
   whole church, filtered by gender and by credential code, and how the age
   distribution has shifted across twelve years.

   Every figure on this page is summed from the (category, gender) cross-tab
   rather than from a pre-rolled total, so the filters compose: a gender and
   a set of codes narrow the same numbers. */

const ALL_SYNODS = "__all_synods__";
// Below this many ministers with a known age, a band percentage is noise.
const SMALL_N = 25;
// Below this share of the selection, a gender split says more about the
// register's numbering than about the ministry.
const THIN_GENDER = 0.8;

const state = { data: null, scopes: null, codes: [], selected: new Set() };

async function boot() {
  try {
    state.data = await loadJSON("ministers.json");
  } catch (e) {
    failed(e.message);
    return;
  }
  state.scopes = scopeOptions(state.data.byScope);
  state.codes = state.data.categories.map((c) => c.code);
  fillSynods();
  fillYears();
  fillPresets();
  buildCodeList();
  applyPreset();

  ["synod", "ring", "year", "gender"].forEach((id) =>
    el(id).addEventListener("change", id === "synod" ? onSynodChange : render));
  el("preset").addEventListener("change", applyPreset);
  el("codes-all").addEventListener("click", () => setCodes(state.codes));
  el("codes-none").addEventListener("click", () => setCodes([]));
  onSynodChange();
}

/* ---------- filters ---------- */

function fillSynods() {
  el("synod").innerHTML = `<option value="${ALL_SYNODS}">Algemene Sinode (almal)</option>` +
    state.scopes.synods.map((s) => `<option value="${s}">${escapeHtml(s)}</option>`).join("");
}

function fillYears() {
  const years = state.data.years;
  el("year").innerHTML = years.map((y) => `<option value="${y}">${y}</option>`).join("");
  el("year").value = years[years.length - 1];
}

function fillPresets() {
  const sets = state.data.ministrySets || {};
  el("preset").innerHTML =
    `<option value="all">Alle kodes</option>` +
    Object.entries(sets).map(([k, v]) =>
      `<option value="${k}">${escapeHtml(v.label)}</option>`).join("") +
    // Hand-picking codes lands here, so the select always shows the real state
    // instead of going blank on a value it does not carry.
    `<option value="custom">Eie keuse</option>`;
}

function buildCodeList() {
  const byCode = new Map(state.data.categories.map((c) => [c.code, c]));
  el("codes-grid").innerHTML = state.codes.map((code) => {
    const c = byCode.get(code) || {};
    // The ABR's own definition, where it has one, on hover.
    const tip = c.description ? ` title="${escapeHtml(c.description)}"` : "";
    return `
    <label${tip}><input type="checkbox" value="${code}" checked>
      <span class="code">${code}</span>
      <span>${escapeHtml(trim(c.label || "geen beskrywing", 44))}</span>
    </label>`;
  }).join("");
  el("codes-grid").querySelectorAll("input").forEach((box) =>
    box.addEventListener("change", () => {
      // Hand-picking codes means the preset no longer describes the choice.
      readCodes();
      const preset = presetCodes(el("preset").value);
      if (preset && !sameSet(preset, state.selected)) el("preset").value = "custom";
      render();
    }));
}

const sameSet = (a, b) => a.size === b.size && [...a].every((v) => b.has(v));

function presetCodes(key) {
  if (key === "all") return new Set(state.codes);
  const spec = (state.data.ministrySets || {})[key];
  return spec ? new Set(spec.codes.filter((c) => state.codes.includes(c))) : null;
}

/** The preset drives the checkboxes, so the checked list is always the truth. */
function applyPreset() {
  const codes = presetCodes(el("preset").value);
  if (codes) setCodes([...codes], { keepPreset: true });
  else render();
}

function setCodes(codes, { keepPreset = false } = {}) {
  const want = new Set(codes);
  el("codes-grid").querySelectorAll("input").forEach((box) => {
    box.checked = want.has(box.value);
  });
  readCodes();
  if (!keepPreset) {
    const preset = presetCodes(el("preset").value);
    if (!preset || !sameSet(preset, state.selected)) el("preset").value = "custom";
  }
  render();
}

function readCodes() {
  state.selected = new Set([...el("codes-grid").querySelectorAll("input:checked")]
    .map((box) => box.value));
}

function onSynodChange() {
  const synod = el("synod").value;
  const ring = el("ring");
  if (synod === ALL_SYNODS) {
    ring.innerHTML = `<option value="">Alle gemeentes</option>`;
    ring.disabled = true;
  } else {
    ring.disabled = false;
    ring.innerHTML = `<option value="">Hele sinode</option>` +
      (state.scopes.rings.get(synod) || []).sort((a, b) => a.localeCompare(b, "af"))
        .map((r) => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join("");
  }
  render();
}

function scopeKey() {
  const synod = el("synod").value;
  if (synod === ALL_SYNODS) return NATIONAL;
  const ring = el("ring").value;
  return ring ? `r:${synod}|${ring}` : `s:${synod}`;
}

function scopeName() {
  const synod = el("synod").value;
  if (synod === ALL_SYNODS) return "Algemene Sinode";
  const ring = el("ring").value;
  return ring ? `Ring ${ring}` : `Sinode ${synod}`;
}

/** A short human description of everything the filters currently narrow to. */
function filterName() {
  const parts = [scopeName()];
  const gender = el("gender").value;
  if (gender !== "all") {
    parts.push({ M: "manlik", F: "vroulik", "?": "geslag onbekend" }[gender]);
  }
  const preset = el("preset").value;
  const sets = state.data.ministrySets || {};
  if (preset !== "all" && sets[preset]) parts.push(sets[preset].label.toLowerCase());
  else if (state.selected.size !== state.codes.length) {
    parts.push(state.selected.size <= 4
      ? [...state.selected].sort().join(", ")
      : `${state.selected.size} kodes`);
  }
  return parts.join(" · ");
}

/* ---------- the cross-tab ---------- */

/** Sum the cells a bucket holds that pass the current filters. */
function select(bucket) {
  const empty = { total: 0, withAge: 0, meanAge: null,
                  bands: state.data.ageBands.map(() => 0),
                  codeTotal: 0, genderKnown: 0 };
  if (!bucket || !bucket.cells) return empty;
  const wantGender = el("gender").value;
  const genders = state.data.genders;
  const out = { ...empty, bands: state.data.ageBands.map(() => 0) };
  let ageSum = 0;
  for (const cell of bucket.cells) {
    const code = state.codes[cell[0]];
    if (!state.selected.has(code)) continue;
    const sex = genders[cell[1]];
    // codeTotal and genderKnown answer "how well is gender known here", which
    // is a question about the selection before the gender filter narrows it.
    out.codeTotal += cell[2];
    if (sex !== "?") out.genderKnown += cell[2];
    if (wantGender !== "all" && sex !== wantGender) continue;
    out.total += cell[2];
    out.withAge += cell[3];
    ageSum += cell[4];
    for (let i = 0; i < out.bands.length; i += 1) out.bands[i] += cell[5 + i];
  }
  out.meanAge = out.withAge ? Math.round((ageSum / out.withAge) * 10) / 10 : null;
  return out;
}

const shares = (bands) => {
  const total = bands.reduce((a, b) => a + b, 0) || 1;
  return bands.map((b) => (100 * b) / total);
};

/* ---------- render ---------- */

function render() {
  const key = scopeKey();
  const year = el("year").value;
  const years = state.data.years;
  const bands = state.data.ageBands;
  const byYear = state.data.byScope[key] || {};
  const national = state.data.byScope[NATIONAL] || {};

  const chosen = select(byYear[year]);
  const perYear = Object.fromEntries(years.map((y) => [y, select(byYear[y])]));
  const nationalPerYear = Object.fromEntries(years.map((y) => [y, select(national[y])]));

  updateCodesSummary(byYear[year]);
  renderTiles(chosen, year);
  renderNote(chosen, perYear, years);
  renderBands(chosen, select(national[year]), bands, year);
  renderMean(perYear, nationalPerYear, years);
  renderStack(perYear, years, bands);
  renderTable(perYear, years, bands);

  el("footer").textContent =
    `Bron: ABR-register ${years[0]}–${years[years.length - 1]}. Ouderdomme is ` +
    `slegs op ring-, sinode- en kerkvlak beskikbaar, nooit per gemeente nie.`;

  addExportButtons();
}

function updateCodesSummary(bucket) {
  const n = state.selected.size;
  const chosen = select(bucket);
  el("codes-summary").textContent = n === state.codes.length
    ? `Bevoegdheidskodes — alle ${n}, ${chosen.codeTotal} predikante`
    : `Bevoegdheidskodes — ${n} van ${state.codes.length} gekies, ${chosen.codeTotal} predikante`;
}

function renderTiles(chosen, year) {
  if (!chosen.total) {
    el("tiles").innerHTML = `<div class="tile"><div class="k">Geen predikante</div>
      <div class="v">—</div><div class="s">vir hierdie keuse</div></div>`;
    return;
  }
  const values = shares(chosen.bands);
  const tiles = [
    ["Predikante", chosen.total, `${filterName()} · ${year}`],
    ["Gemiddelde ouderdom", chosen.meanAge ?? "—",
      chosen.withAge ? `uit ${chosen.withAge} met 'n ouderdom` : "geen ouderdomme"],
  ];
  if (chosen.withAge) {
    tiles.push(["Jonger as 40", `${round1(values[0] + values[1])}%`, "van dié met 'n ouderdom"]);
    tiles.push(["65 en ouer", `${round1(values[values.length - 1])}%`, "van dié met 'n ouderdom"]);
  }
  el("tiles").innerHTML = tiles.map(([k, v, s]) =>
    `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div>
     <div class="s">${escapeHtml(s)}</div></div>`).join("");
}

const derivedYears = () => (state.data.quality || [])
  .filter((q) => q.ageDerived).map((q) => q.year);

function renderNote(chosen, perYear, years) {
  const notes = [];
  const derived = derivedYears();
  if (derived.length) {
    notes.push(`<p class="note"><strong>${derived.join(", ")} se ouderdomme is afgelei.</strong>
      Daardie registers het geen ouderdomskolom nie, so die ouderdom is bereken
      uit geboortejare wat aan dieselfde ABR-nommers gekoppel is. Dit dek net
      predikante wat ook in die 2022-uittreksel voorkom — 'n effens ouer groep —
      so die sprong in die gemiddeld by ${derived[0]} en die val daarna weerspieël
      deels die bron, nie net werklike veroudering nie.</p>`);
  }

  // Gender comes only from the 2022 extract, joined on the ABR number. The
  // register renumbered between waves, so the early years match poorly and
  // the matched part skews male -- a split there is an artefact.
  const coverage = chosen.codeTotal ? chosen.genderKnown / chosen.codeTotal : 1;
  if (el("gender").value !== "all" || coverage < THIN_GENDER) {
    const thin = years.filter((y) => {
      const b = perYear[y];
      return b.codeTotal && b.genderKnown / b.codeTotal < THIN_GENDER;
    });
    if (thin.length) {
      notes.push(`<p class="note"><strong>Geslag is nie vir alle jare bekend nie.</strong>
        Geslag kom net uit die 2022-uittreksel, gekoppel op ABR-nommer, en die
        register het sy nommering tussen golwe verander. Vir ${thin.join(", ")}
        is geslag vir minder as ${Math.round(THIN_GENDER * 100)}% van hierdie
        keuse bekend, en die deel wat wel pas is oorwegend manlik. Lees 'n
        geslagsverdeling in daardie jare as 'n eienskap van die register, nie
        van die bediening nie.</p>`);
    }
  }

  if (chosen.withAge && chosen.withAge < SMALL_N) {
    notes.push(`<p class="note"><strong>Klein getalle.</strong> Net
      ${chosen.withAge} predikante in hierdie keuse het 'n bekende ouderdom, so
      elke persoon skuif die persentasie met
      ${round1(100 / chosen.withAge)} persentasiepunte.</p>`);
  }
  if (!state.selected.size) {
    notes.push(`<p class="note"><strong>Geen kodes gekies nie.</strong> Kies
      minstens een bevoegdheidskode hierbo.</p>`);
  }
  el("note-slot").innerHTML = notes.join("");
}

function renderBands(chosen, nationalChosen, bands, year) {
  el("bands-title").textContent = `Ouderdomsverspreiding in ${year}`;
  const series = [];
  if (chosen.withAge) series.push({ name: filterName(), values: shares(chosen.bands) });
  // The whole church, on the same code and gender filter, is the reference.
  if (nationalChosen.withAge && scopeKey() !== NATIONAL) {
    series.push({ name: "Algemene Sinode", values: shares(nationalChosen.bands) });
  }
  legend(el("bands-legend"), series);
  groupedBars(el("bands"), bands, series, { unit: "%", maxLines: 1 });
}

function renderMean(perYear, nationalPerYear, years) {
  const series = [{ name: filterName(), values: years.map((y) => perYear[y].meanAge) }];
  if (scopeKey() !== NATIONAL) {
    series.push({ name: "Algemene Sinode",
                  values: years.map((y) => nationalPerYear[y].meanAge) });
  }
  const derived = derivedYears();
  el("mean-sub").textContent =
    `${filterName()} · gemiddelde ouderdom van dié met 'n bekende ouderdom.` +
    (derived.length ? `  ${derived.join(", ")} is afgelei uit geboortejare — vergelyk oor daardie grens versigtig.` : "");
  legend(el("mean-legend"), series);
  lineChart(el("mean"), years.map(String), series, { unit: " jr" });
}

function renderStack(perYear, years, bands) {
  const usable = years.filter((y) => perYear[y].withAge);
  const segments = bands.map((name, i) => ({
    name, values: usable.map((y) => perYear[y].bands[i] || 0),
  }));
  rampKey(el("stack-legend"), bands);
  stackedBars(el("stack"), usable.map(String), segments, { asShare: true });
}

function renderTable(perYear, years, bands) {
  const usable = years.filter((y) => perYear[y].withAge);
  el("table-sub").textContent =
    `${filterName()} · getalle, met die persentasie van dié met 'n bekende ouderdom.` +
    (derivedYears().length ? `  * = ouderdom afgelei uit geboortejare.` : "");
  if (!usable.length) { el("table").innerHTML = ""; return; }
  el("table").innerHTML =
    `<thead><tr><th>Jaar</th>${bands.map((b) => `<th>${b}</th>`).join("")}` +
    `<th>Predikante</th><th>Met ouderdom</th><th>Gemiddeld</th></tr></thead>` +
    `<tbody>${usable.map((y) => {
      const b = perYear[y];
      const pct = shares(b.bands);
      const mark = derivedYears().includes(Number(y)) ? " *" : "";
      return `<tr><td>${y}${mark}</td>` +
        b.bands.map((n, i) => `<td>${n} <span style="color:var(--text-muted)">(${round1(pct[i])}%)</span></td>`).join("") +
        `<td>${b.total}</td><td>${b.withAge}</td><td>${b.meanAge ?? "—"}</td></tr>`;
    }).join("")}</tbody>`;
}

boot();
