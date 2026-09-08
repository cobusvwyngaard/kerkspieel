/* The age profile: how old ministers are in a ring, a synod or the whole
   church, and how that has shifted across twelve years of the register. */

const ALL_SYNODS = "__all_synods__";
// Below this many ministers with a known age, a band percentage is noise.
const SMALL_N = 25;

const state = { data: null, scopes: null };

async function boot() {
  try {
    state.data = await loadJSON("ministers.json");
  } catch (e) {
    failed(e.message);
    return;
  }
  state.scopes = scopeOptions(state.data.byScope);
  fillSynods();
  fillYears();
  onSynodChange();
  ["synod", "ring", "year"].forEach((id) =>
    el(id).addEventListener("change", id === "synod" ? onSynodChange : render));
}

function fillSynods() {
  el("synod").innerHTML = `<option value="${ALL_SYNODS}">Algemene Sinode (almal)</option>` +
    state.scopes.synods.map((s) => `<option value="${s}">${escapeHtml(s)}</option>`).join("");
}

function fillYears() {
  const years = state.data.years;
  el("year").innerHTML = years.map((y) => `<option value="${y}">${y}</option>`).join("");
  el("year").value = years[years.length - 1];
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

const shares = (bands) => {
  const total = bands.reduce((a, b) => a + b, 0) || 1;
  return bands.map((b) => (100 * b) / total);
};

function render() {
  const key = scopeKey();
  const year = el("year").value;
  const years = state.data.years;
  const bands = state.data.ageBands;
  const byYear = state.data.byScope[key] || {};
  const national = state.data.byScope[NATIONAL] || {};
  const bucket = byYear[year];

  renderTiles(bucket, year);
  renderNote(bucket, byYear, years);
  renderBands(bucket, national[year], bands, year);
  renderMean(byYear, national, years);
  renderStack(byYear, years, bands);
  renderTable(byYear, years, bands);

  el("footer").textContent =
    `Bron: ABR-register ${years[0]}–${years[years.length - 1]}. Ouderdomme is ` +
    `slegs op ring-, sinode- en kerkvlak beskikbaar, nooit per gemeente nie.`;

  addExportButtons();
}

function renderTiles(bucket, year) {
  if (!bucket || !bucket.withAge) {
    el("tiles").innerHTML = `<div class="tile"><div class="k">Geen ouderdomme</div>
      <div class="v">—</div><div class="s">vir hierdie keuse</div></div>`;
    return;
  }
  const values = shares(bucket.bands);
  const under40 = values[0] + values[1];
  const over65 = values[values.length - 1];
  el("tiles").innerHTML = [
    ["Gemiddelde ouderdom", bucket.meanAge, `${scopeName()} · ${year}`],
    ["Met bekende ouderdom", bucket.withAge, `van ${bucket.total} predikante`],
    ["Jonger as 40", `${round1(under40)}%`, "van dié met 'n ouderdom"],
    ["65 en ouer", `${round1(over65)}%`, "van dié met 'n ouderdom"],
  ].map(([k, v, s]) => `<div class="tile"><div class="k">${k}</div>
      <div class="v">${v}</div><div class="s">${escapeHtml(s)}</div></div>`).join("");
}

const derivedYears = () => (state.data.quality || [])
  .filter((q) => q.ageDerived).map((q) => q.year);

function renderNote(bucket, byYear, years) {
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
  if (bucket && bucket.withAge && bucket.withAge < SMALL_N) {
    notes.push(`<p class="note"><strong>Klein getalle.</strong> Net
      ${bucket.withAge} predikante in hierdie keuse het 'n bekende ouderdom, so
      elke persoon skuif die persentasie met
      ${round1(100 / bucket.withAge)} persentasiepunte.</p>`);
  }
  const coverage = years.map((y) => byYear[y])
    .filter(Boolean)
    .map((b) => (b.total ? b.withAge / b.total : 0));
  if (coverage.length && Math.min(...coverage) < 0.6) {
    notes.push(`<p class="note"><strong>Ouderdom is nie vir almal bekend nie.</strong>
      Die register gee vir sowat 'n vyfde van predikante geen ouderdom nie. Die
      persentasies hier onder is van dié met 'n bekende ouderdom, nie van almal
      nie.</p>`);
  }
  el("note-slot").innerHTML = notes.join("");
}

function renderBands(bucket, nationalBucket, bands, year) {
  el("bands-title").textContent = `Ouderdomsverspreiding in ${year}`;
  const series = [];
  if (bucket && bucket.bands) {
    series.push({ name: scopeName(), values: shares(bucket.bands) });
  }
  // The whole church is the reference a ring is read against; repeating it
  // when the whole church is what was chosen would just draw it twice.
  if (nationalBucket && nationalBucket.bands && scopeKey() !== NATIONAL) {
    series.push({ name: "Algemene Sinode", values: shares(nationalBucket.bands) });
  }
  legend(el("bands-legend"), series);
  groupedBars(el("bands"), bands, series, { unit: "%", maxLines: 1 });
}

function renderMean(byYear, national, years) {
  const series = [{
    name: scopeName(),
    values: years.map((y) => byYear[y]?.meanAge ?? null),
  }];
  if (scopeKey() !== NATIONAL) {
    series.push({ name: "Algemene Sinode",
                  values: years.map((y) => national[y]?.meanAge ?? null) });
  }
  const derived = derivedYears();
  el("mean-sub").textContent =
    `${scopeName()} · gemiddelde ouderdom van dié met 'n bekende ouderdom.` +
    (derived.length ? `  ${derived.join(", ")} is afgelei uit geboortejare — vergelyk oor daardie grens versigtig.` : "");
  legend(el("mean-legend"), series);
  lineChart(el("mean"), years.map(String), series, { unit: " jr" });
}

function renderStack(byYear, years, bands) {
  const usable = years.filter((y) => byYear[y]?.bands);
  const segments = bands.map((name, i) => ({
    name, values: usable.map((y) => byYear[y].bands[i] || 0),
  }));
  rampKey(el("stack-legend"), bands);
  stackedBars(el("stack"), usable.map(String), segments, { asShare: true });
}

function renderTable(byYear, years, bands) {
  const usable = years.filter((y) => byYear[y]?.bands);
  el("table-sub").textContent =
    `${scopeName()} · getalle, met die persentasie van dié met 'n bekende ouderdom.` +
    (derivedYears().length ? `  * = ouderdom afgelei uit geboortejare.` : "");
  if (!usable.length) { el("table").innerHTML = ""; return; }
  el("table").innerHTML =
    `<thead><tr><th>Jaar</th>${bands.map((b) => `<th>${b}</th>`).join("")}` +
    `<th>Met ouderdom</th><th>Gemiddeld</th></tr></thead>` +
    `<tbody>${usable.map((y) => {
      const b = byYear[y];
      const pct = shares(b.bands);
      const mark = derivedYears().includes(Number(y)) ? " *" : "";
      return `<tr><td>${y}${mark}</td>` +
        b.bands.map((n, i) => `<td>${n} <span style="color:var(--text-muted)">(${round1(pct[i])}%)</span></td>`).join("") +
        `<td>${b.withAge}</td><td>${b.meanAge}</td></tr>`;
    }).join("")}</tbody>`;
}

boot();
