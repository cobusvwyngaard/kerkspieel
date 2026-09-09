/* Counts of ministers by credential category, for a ring, a synod or the
   whole church, and per congregation within the chosen scope. */

const ALL_SYNODS = "__all_synods__";
// The register carries deceased ministers in some years and not others
// (none at all in 2015-2019 or 2023, several hundred in the rest), so
// leaving them in makes year-on-year totals incomparable.
const DECEASED = "F";

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
  ["synod", "ring", "year", "live"].forEach((id) =>
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

const includeDeceased = () => el("live").value === "all";

/** Count for a scope and year, honouring the deceased filter. */
function totalOf(bucket) {
  if (!bucket) return 0;
  const dead = includeDeceased() ? 0 : (bucket.groups[DECEASED] || 0);
  return bucket.total - dead;
}

function render() {
  const key = scopeKey();
  const year = el("year").value;
  const years = state.data.years;
  const byYear = state.data.byScope[key] || {};
  const bucket = byYear[year];

  renderTiles(bucket, byYear, year);
  renderTrend(byYear, years);
  renderServing(byYear, years);
  renderCategories(bucket, year);
  renderCongregations(year);

  el("footer").textContent =
    `Bron: ABR-register ${years[0]}–${years[years.length - 1]}. ` +
    `Name, geboortedatums en ID-nommers word nooit gepubliseer nie; slegs tellings.`;

  addExportButtons();
}

function renderTiles(bucket, byYear, year) {
  if (!bucket) {
    el("tiles").innerHTML = `<div class="tile"><div class="k">Geen data</div>
      <div class="v">—</div><div class="s">vir hierdie keuse</div></div>`;
    return;
  }
  const groups = bucket.groups || {};
  const first = state.data.years[0];
  const before = byYear[first];
  const change = before
    ? totalOf(bucket) - totalOf(before) : null;
  const sets = bucket.sets || {};
  const serving = sets.gemeente || 0;
  const tiles = [
    ["Predikante", totalOf(bucket), `${scopeName()} · ${year}`],
    ["Gemeentepredikante", serving, "wat 'n gemeente bedien"],
    ["waarvan A01", sets.gemeenteA01 || 0, "beroep en bevestig"],
    ["nie A01", sets.gemeenteNieA01 || 0,
      serving ? `${round1(100 * (sets.gemeenteNieA01 || 0) / serving)}% van gemeentepredikante` : "—"],
    ["Emeriti (C)", groups.C || 0, "afgetree"],
  ].map(([k, v, s]) => `<div class="tile"><div class="k">${k}</div>
      <div class="v">${v}</div><div class="s">${escapeHtml(s)}</div></div>`);
  if (change !== null) {
    tiles.push(`<div class="tile"><div class="k">Sedert ${first}</div>
      <div class="v">${change > 0 ? "+" : ""}${change}</div>
      <div class="s">verandering in totaal</div></div>`);
  }
  el("tiles").innerHTML = tiles.join("");
}

function renderTrend(byYear, years) {
  const groups = state.data.categoryGroups;
  const shown = ["A", "C", "B"].filter((g) =>
    years.some((y) => (byYear[y]?.groups || {})[g]));
  const series = shown.map((g) => ({
    name: `${g} — ${groups[g]}`,
    values: years.map((y) => (byYear[y]?.groups || {})[g] ?? 0),
  }));
  el("trend-sub").textContent =
    `${scopeName()} · die drie groepe wat die bediening dra, jaar vir jaar.`;
  legend(el("trend-legend"), series);
  lineChart(el("trend"), years.map(String), series, { unit: "", zeroBased: true });
}

/** The three congregation-serving sets, which cut across the letter groups. */
function renderServing(byYear, years) {
  const defs = state.data.ministrySets || {};
  const order = ["gemeente", "gemeenteA01", "gemeenteNieA01"];
  const series = order.filter((k) => defs[k]).map((k) => ({
    name: defs[k].label,
    values: years.map((y) => (byYear[y]?.sets || {})[k] ?? 0),
  }));
  const codes = (defs.gemeente?.codes || []).join(", ");
  el("serving-sub").textContent =
    `${scopeName()} · predikante wat 'n gemeente bedien (${codes}), ` +
    `en die verdeling tussen A01 en die res.`;
  legend(el("serving-legend"), series);
  lineChart(el("serving"), years.map(String), series, { unit: "", zeroBased: true });
}

function renderCategories(bucket, year) {
  el("cat-title").textContent = `Kategorieë in ${year}`;
  if (!bucket) { el("cat-table").innerHTML = ""; return; }
  const rows = state.data.categories
    .map((c) => ({ ...c, n: (bucket.categories || {})[c.code] || 0 }))
    .filter((c) => c.n > 0 && (includeDeceased() || c.group !== DECEASED))
    .sort((a, b) => b.n - a.n);
  const total = rows.reduce((a, r) => a + r.n, 0) || 1;
  el("cat-table").innerHTML =
    `<thead><tr><th>Kode</th><th class="col-text">Beskrywing</th><th>Getal</th><th>Aandeel</th></tr></thead>` +
    `<tbody>${rows.map((r) => `<tr>
      <td>${r.code}</td>
      <td class="col-text"${r.description ? ` title="${escapeHtml(r.description)}"` : ""}>${escapeHtml(r.label || "—")}</td>
      <td>${r.n}</td>
      <td>${round1(100 * r.n / total)}%</td></tr>`).join("")}
      <tr><td>Totaal</td><td></td><td>${total}</td><td>100%</td></tr></tbody>`;
}

const LIMIT = 50;

function renderCongregations(year) {
  const synod = el("synod").value;
  const ring = el("ring").value;
  const meta = state.data.congregations || {};

  const rows = [];
  for (const [code, byYear] of Object.entries(state.data.byCongregation)) {
    const bucket = byYear[year];
    const where = meta[code];
    if (!bucket || !where) continue;
    if (synod !== ALL_SYNODS && where.synod !== synod) continue;
    if (ring && where.ring !== ring) continue;
    rows.push({ code, name: where.name, ring: where.ring, total: bucket.total,
                categories: bucket.categories, sets: bucket.sets });
  }
  rows.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "af"));
  const list = rows.slice(0, LIMIT);

  el("cong-sub").textContent = rows.length > LIMIT
    ? `Die ${LIMIT} gemeentes met die meeste predikante in ${year}, van ${rows.length} in hierdie keuse.`
    : `${rows.length} gemeentes met predikante in ${year}.`;
  if (!list.length) { el("cong-table").innerHTML = ""; return; }
  el("cong-table").innerHTML =
    `<thead><tr><th>Gemeente</th><th class="col-text">Ring</th><th>Predikante</th>` +
    `<th>Gemeente&shy;predikante</th><th>A01</th><th class="col-text">Kategorieë</th></tr></thead>` +
    `<tbody>${list.map((r) => `<tr>
      <td>${escapeHtml(r.name || r.code)}</td>
      <td class="col-text">${escapeHtml(r.ring || "—")}</td>
      <td>${r.total}</td>
      <td>${(r.sets || {}).gemeente || 0}</td>
      <td>${(r.sets || {}).gemeenteA01 || 0}</td>
      <td class="col-text">${escapeHtml(Object.entries(r.categories)
        .sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}×${n}`).join("  "))}</td>
    </tr>`).join("")}</tbody>`;
}

boot();
