/* The Kerkprofiel: the NCLS nine-quality vitality framework read off the
   Gemeentevraelys, for a ring, a synod or the whole church.

   Everything here is computed at build time by scripts/build_profile.py --
   the page only chooses a scope and a year and draws what is already in
   profile.json. */

const ALL_SYNODS = "__all_synods__";
// Below this many responding congregations, a ring's percentages move by
// more than 10 points per congregation and the profile says so.
const SMALL_N = 10;
// The middle of the ring distribution, by construction.
const AVERAGE = 5;

const state = { data: null, byKey: new Map(), qualities: [], indicators: [] };

async function boot() {
  try {
    state.data = await loadJSON("profile.json");
  } catch (e) {
    failed(e.message);
    return;
  }
  state.byKey = new Map(state.data.scopes.map((s) => [s.key, s]));
  state.qualities = state.data.qualities;
  state.indicators = state.data.indicators;
  fillSynods();
  fillYears();
  ["synod", "ring", "year"].forEach((id) =>
    el(id).addEventListener("change", id === "synod" ? onSynodChange : render));
  onSynodChange();
}

/* ---------- scope ---------- */

const synodScopes = () => state.data.scopes.filter((s) => s.kind === "synod");
const ringScopes = (synod) =>
  state.data.scopes.filter((s) => s.kind === "ring" && s.synod === synod);

function fillSynods() {
  el("synod").innerHTML = `<option value="${ALL_SYNODS}">Algemene Sinode (almal)</option>` +
    synodScopes().sort((a, b) => a.name.localeCompare(b.name, "af"))
      .map((s) => `<option value="${s.key}">${escapeHtml(s.name)}</option>`).join("");
}

function fillYears() {
  el("year").innerHTML = state.data.waves
    .map((w) => `<option value="${w}">${w}</option>`).join("");
  el("year").value = state.data.waves[state.data.waves.length - 1];
}

function onSynodChange() {
  const chosen = el("synod").value;
  const ring = el("ring");
  if (chosen === ALL_SYNODS) {
    ring.innerHTML = `<option value="${NATIONAL}">Alle gemeentes</option>`;
    ring.disabled = true;
  } else {
    const synod = state.byKey.get(chosen);
    ring.disabled = false;
    ring.innerHTML = [`<option value="${synod.key}">Hele sinode</option>`]
      .concat(ringScopes(synod.name)
        .sort((a, b) => a.name.localeCompare(b.name, "af"))
        .map((r) => `<option value="${r.key}">${escapeHtml(r.name)}</option>`))
      .join("");
  }
  render();
}

function scope() {
  if (el("synod").value === ALL_SYNODS) return state.byKey.get(NATIONAL);
  return state.byKey.get(el("ring").value) || state.byKey.get(el("synod").value);
}

function scopeName(sc = scope()) {
  return sc.kind === "national" ? "Algemene Sinode"
    : sc.kind === "synod" ? `Sinode ${sc.name}` : `Ring ${sc.name}`;
}

/* ---------- reading the payload ---------- */

const cells = (key, wave) => (state.data.data[key] || {})[wave] || {};
const marks = (key, wave) => (state.data.scores[key] || {})[wave] || {};

/** The qualities that carry a score for this scope and year, best first. */
function ranked(key, wave) {
  const scored = marks(key, wave);
  return state.qualities
    .filter((q) => q.group !== "meting" && scored[q.key])
    .map((q) => ({ ...q, score: scored[q.key][0], pct: scored[q.key][1],
                   n: scored[q.key][2], rank: scored[q.key][3] ?? null }))
    .sort((a, b) => b.score - a.score);
}

const measures = (key, wave) => {
  const scored = marks(key, wave);
  return state.qualities
    .filter((q) => q.group === "meting" && scored[q.key])
    .map((q) => ({ ...q, score: scored[q.key][0], pct: scored[q.key][1],
                   n: scored[q.key][2], rank: scored[q.key][3] ?? null }));
};

const headlineOf = (quality) =>
  state.indicators.find((i) => i.quality === quality && i.headline);

/** The first year this scope has an answer for, so change has a baseline. */
function baseline(key, wave) {
  return state.data.waves.find((w) => w !== wave &&
    Object.keys(cells(key, w)).length) || null;
}

/* ---------- render ---------- */

function render() {
  const sc = scope();
  const wave = el("year").value;
  const list = ranked(sc.key, wave);

  renderTiles(sc, wave, list);
  renderNote(sc, wave, list);
  renderScale(sc, wave, list);
  renderCircle(sc, wave, list);
  renderRankTable(sc, wave, list);
  renderSpread(sc, wave, list);
  renderChange(sc, wave);
  renderDetail(sc, wave);

  el("footer").textContent =
    `Bron: Gemeentevraelys ${state.data.waves.join(", ")}. Die nege kwaliteite ` +
    `is die NCLS Research-raamwerk; die aanwysers en die telling is hier ` +
    `gedefinieer en is nie NCLS se eie nie.`;
  addExportButtons();
}

function renderTiles(sc, wave, list) {
  const responded = sc.responded[wave] || 0;
  const pct = sc.congregations ? Math.round((100 * responded) / sc.congregations) : 0;
  const best = list[0];
  const worst = list[list.length - 1];
  const tiles = [
    ["Gemeentes", sc.congregations, scopeName(sc)],
    [`${wave} deelname`, responded, `${pct}% van gemeentes`],
  ];
  if (best) {
    tiles.push(["Sterkste kwaliteit", best.label, `telling ${best.score} uit 10`]);
    tiles.push(["Grootste ruimte", worst.label, `telling ${worst.score} uit 10`]);
  }
  el("tiles").innerHTML = tiles.map(([k, v, s]) =>
    `<div class="tile"><div class="k">${escapeHtml(k)}</div>
     <div class="v${String(v).length > 8 ? " v--text" : ""}">${escapeHtml(String(v))}</div>
     <div class="s">${escapeHtml(s)}</div></div>`).join("");
}

function renderNote(sc, wave, list) {
  const notes = [];
  const responded = sc.responded[wave] || 0;
  if (!list.length) {
    notes.push(`<p class="note"><strong>Geen profiel vir hierdie keuse nie.</strong>
      ${escapeHtml(scopeName(sc))} het geen bruikbare antwoorde in ${wave} nie.</p>`);
  } else if (responded && responded < SMALL_N) {
    notes.push(`<p class="note"><strong>Klein getalle.</strong> Net ${responded}
      gemeentes in ${escapeHtml(scopeName(sc))} het die ${wave}-vraelys ingevul, so
      elke gemeente skuif 'n aanwyser met ${round1(100 / responded)} persentasiepunte.
      Lees die profiel as 'n indruk, nie as 'n meting nie.</p>`);
  }
  if (sc.kind === "synod") {
    notes.push(`<p class="note"><strong>'n Sinode middel na 5 toe.</strong> Die
      telling word teen die verspreiding van <em>ringe</em> bereken. 'n Sinode is
      'n gemiddeld van sy eie ringe, so sy telling lê nader aan die middel as
      wat enige van sy ringe s'n lê. Vergelyk sinodes met sinodes.</p>`);
  }
  if (sc.kind === "national") {
    notes.push(`<p class="note"><strong>Die Algemene Sinode <em>is</em> die
      gemiddeld.</strong> Vyf is per definisie waar die hele kerk lê, so die
      tellings hier is almal naby 5. Wat hier lees, is die persentasies en die
      verandering oor tyd; die tellings begin eers by 'n ring iets beteken.</p>`);
  }
  el("note-slot").innerHTML = notes.join("");
}

/* ---------- what the score means ----------
   The bands and the spread come from the build, measured off the scores
   the rings actually took, so the wording cannot drift from the numbers. */

const bandOf = (score) => state.data.bands.find(
  (b) => score >= b.from && (score < b.to || b.to === 10)) || null;

const bandColour = (score) => {
  const i = state.data.bands.indexOf(bandOf(score));
  return ["var(--score-1)", "var(--score-2)", "var(--score-3)",
          "var(--score-4)", "var(--score-5)"][i] || "var(--series-1)";
};

function renderScale(sc, wave, list) {
  const bands = state.data.bands;
  const spread = state.data.scoreSpread;
  el("scale-sub").textContent =
    `Elke kwaliteit kry 'n telling van 1 tot 10. Vyf is die gemiddelde ring; ` +
    `elke twee punte is een standaardafwyking tussen ringe.`;

  const width = 820, height = 96, pad = 12;
  const x = (v) => pad + ((v - 1) / 9) * (width - 2 * pad);
  const blocks = bands.map((b, i) => `
    <rect x="${x(b.from)}" y="18" width="${x(b.to) - x(b.from) - 2}" height="26"
      rx="4" fill="${["var(--score-1)", "var(--score-2)", "var(--score-3)",
                     "var(--score-4)", "var(--score-5)"][i]}"
      tabindex="0" role="img"
      aria-label="${escapeHtml(`${b.label}: ${b.from} tot ${b.to}`)}"
      data-tip="${escapeHtml(`${b.label} · ${b.from}–${b.to} · ${b.share}% van ringe`)}"></rect>
    <text x="${(x(b.from) + x(b.to)) / 2}" y="60" text-anchor="middle"
      class="scale-band">${escapeHtml(b.short)}</text>
    <text x="${(x(b.from) + x(b.to)) / 2}" y="75" text-anchor="middle"
      class="scale-share">${b.share}% van ringe</text>`).join("");
  const ticks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) =>
    `<text x="${x(v)}" y="12" text-anchor="middle" class="scale-tick">${v}</text>`).join("");

  // Where this scope's own qualities fall, so the bands are not abstract.
  const pins = list.map((q) => `
    <circle cx="${x(q.score)}" cy="31" r="5" fill="var(--text-primary)"
      stroke="var(--surface-1)" stroke-width="2" tabindex="0" role="img"
      aria-label="${escapeHtml(`${q.label}: ${q.score}`)}"
      data-tip="${escapeHtml(`${q.label} — ${q.score} uit 10`)}"></circle>`).join("");

  el("scale").innerHTML =
    `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"
          role="img" aria-label="Skaal van 1 tot 10">${ticks}${blocks}${pins}</svg>`;
  attachTooltips(el("scale"));

  el("scale-note").innerHTML =
    `Die telling vergelyk, dit meet nie. Vir elke aanwyser word die persentasie ` +
    `gemeentes wat so geantwoord het, vergelyk met dieselfde persentasie in al ` +
    `die ander <strong>ringe</strong> van daardie jaar. 'n Kwaliteit se telling ` +
    `is die gemiddeld van sy aanwysers s'n. Die helfte van alle ringe lê tussen ` +
    `${spread.p25} en ${spread.p75}; een uit tien lê onder ${spread.p10} en een ` +
    `uit tien bo ${spread.p90}. Die swart kolletjies hierbo is ` +
    `${escapeHtml(scopeName(sc))} se eie nege kwaliteite in ${wave}. ` +
    `<strong>Dit is nie NCLS se telling nie</strong> — NCLS publiseer nie hoe ` +
    `hulle eie telling bereken word nie.`;
}

/* The circle of strengths: the qualities around a ring, strongest at the
   top and running clockwise, which is how the NCLS profile lays it out. */
function renderCircle(sc, wave, list) {
  el("circle-sub").textContent = list.length
    ? `${scopeName(sc)} · ${wave} · van die sterkste kwaliteit af, met die klok mee. `
      + `Vyf is die gemiddelde ring.`
    : "";
  if (!list.length) { el("circle").innerHTML = ""; return; }

  const width = 860, height = 500;
  const cx = width / 2, cy = height / 2 + 4, r = 132;
  const dot = (score) => 7 + 1.6 * Math.max(0, score - 1);
  const colour = bandColour;

  const points = list.map((q, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / list.length;
    return { ...q, x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle), angle };
  });

  const nodes = points.map((p) => {
    // The label sits just outside its own dot, on the same spoke. A dot near
    // the top or bottom gets its label centred over it instead, where there
    // is no room to set it beside.
    const out = r + dot(p.score) + 16;
    const upright = Math.abs(Math.cos(p.angle)) < 0.35;
    const lx = cx + out * Math.cos(p.angle);
    const ly = cy + (upright ? out + 8 : out) * Math.sin(p.angle)
      + (upright && p.angle < 0 ? -8 : 8);
    const anchor = upright ? "middle" : lx > cx ? "start" : "end";
    return `<circle cx="${p.x}" cy="${p.y}" r="${dot(p.score)}"
        fill="${colour(p.score)}" stroke="var(--surface-1)" stroke-width="2"
        tabindex="0" role="img"
        aria-label="${escapeHtml(`${p.label}: telling ${p.score} uit 10`)}"
        data-tip="${escapeHtml(`${p.label} — ${p.score} uit 10, ${bandOf(p.score).label.toLowerCase()}` +
          (p.rank == null ? "" : ` · beter as ${p.rank}% van ringe`) +
          ` · gemiddeld ${p.pct}% oor ${p.n} aanwysers`)}"></circle>
      <text class="circle-name" x="${lx}" y="${ly - 4}" text-anchor="${anchor}">${escapeHtml(p.label)}</text>
      <text class="circle-score" x="${lx}" y="${ly + 12}" text-anchor="${anchor}">${p.score} / 10</text>`;
  }).join("");

  const mean = Math.round(
    (list.reduce((a, q) => a + q.score, 0) / list.length) * 10) / 10;
  el("circle").innerHTML =
    `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"
          role="img" aria-label="Sirkel van sterkpunte">
       <circle cx="${cx}" cy="${cy}" r="${r}" fill="none"
               stroke="var(--border)" stroke-width="1.5"></circle>
       <text class="circle-lead" x="${cx}" y="${cy - 24}" text-anchor="middle">Sterkste bo, met die klok mee</text>
       <text class="circle-lead-name" x="${cx}" y="${cy + 3}" text-anchor="middle">${escapeHtml(scopeName(sc))}</text>
       <text class="circle-lead" x="${cx}" y="${cy + 26}" text-anchor="middle">${wave} · gemiddelde telling ${mean}</text>
       ${nodes}
     </svg>`;
  attachTooltips(el("circle"));
}

function renderRankTable(sc, wave, list) {
  el("rank-sub").textContent =
    `${scopeName(sc)} · ${wave} · elke kwaliteit se hoofaanwyser, met die ` +
    `persentasie gemeentes wat so geantwoord het. "Beter as" tel hoeveel van ` +
    `die ander ringe hierdie keuse verbysteek.`;
  const rows = list.concat(measures(sc.key, wave));
  if (!rows.length) { el("rank-table").innerHTML = ""; return; }
  const nat = cells(NATIONAL, wave);
  el("rank-table").className = "table--plain";
  el("rank-table").innerHTML =
    `<thead><tr><th>Kwaliteit</th><th class="col-text">Hoofaanwyser</th>
      <th>${escapeHtml(sc.kind === "national" ? "Landwyd" : "Hierdie keuse")}</th>
      <th>Algemene Sinode</th><th>Telling</th>
      <th>Wat dit beteken</th></tr></thead>` +
    `<tbody>${rows.map((q, i) => {
      const ind = headlineOf(q.key);
      const here = ind ? cells(sc.key, wave)[ind.key] : null;
      const there = ind ? nat[ind.key] : null;
      const band = bandOf(q.score);
      return `<tr>
        <td>${q.group === "meting" ? "" : `${i + 1}. `}${escapeHtml(q.label)}</td>
        <td class="col-text">${escapeHtml(ind ? ind.label : "—")}</td>
        <td>${here ? `${round1(here[1])}% <span style="color:var(--text-muted)">(n=${here[0]})</span>` : "—"}</td>
        <td>${there ? `${round1(there[1])}%` : "—"}</td>
        <td><span class="score-chip" style="background:${bandColour(q.score)}">${q.score}</span></td>
        <td>${escapeHtml(band ? band.short : "—")}${
          q.rank == null ? "" : ` <span style="color:var(--text-muted)">· beter as ${q.rank}%</span>`}</td>
      </tr>`;
    }).join("")}</tbody>`;
}

/* How far each quality sits from the average ring, in points. */
function renderSpread(sc, wave, list) {
  el("spread-sub").textContent =
    `${scopeName(sc)} · ${wave} · afstand van 5, wat die gemiddelde ring is. ` +
    `Elke twee punte is een standaardafwyking tussen ringe.`;
  divergingBars(el("spread"), list.map((q) => ({
    name: q.label,
    value: Math.round((q.score - AVERAGE) * 10) / 10,
    tip: `${q.label}: telling ${q.score} uit 10 (${q.n} aanwysers, gemiddeld ${q.pct}%)`,
  })), { unit: "", span: 5 });
}

/** How far each quality has moved since the scope's first year with answers.
 *
 *  Only the indicators both years carry are counted. A quality whose
 *  indicator set differs between the waves would otherwise appear to move
 *  because the question list moved, not because the congregations did.
 */
function renderChange(sc, wave) {
  const before = baseline(sc.key, wave);
  if (!before) {
    el("change-sub").textContent =
      `${scopeName(sc)} · net een jaar met antwoorde, so daar is niks om mee te vergelyk nie.`;
    el("change").innerHTML = `<p class="empty">Te min jare vir 'n vergelyking.</p>`;
    el("change-legend").innerHTML = "";
    return;
  }
  const now = cells(sc.key, wave);
  const then = cells(sc.key, before);
  const change = state.qualities.map((q) => {
    const both = state.indicators.filter((i) => i.quality === q.key
      && now[i.key] && then[i.key]);
    if (!both.length) return null;
    const mean = (rows) => rows.reduce((a, b) => a + b, 0) / rows.length;
    const nowPct = mean(both.map((i) => now[i.key][1]));
    const thenPct = mean(both.map((i) => then[i.key][1]));
    return {
      name: q.label,
      value: Math.round((nowPct - thenPct) * 10) / 10,
      tip: `${q.label}: ${before} ${round1(thenPct)}% → ${wave} ${round1(nowPct)}% ` +
           `(oor ${both.length} aanwyser${both.length === 1 ? "" : "s"} wat albei jare gevra is)`,
    };
  }).filter(Boolean);
  el("change-sub").textContent =
    `${scopeName(sc)} · die gemiddelde persentasie oor elke kwaliteit se aanwysers, ` +
    `${before} teenoor ${wave}. Net aanwysers wat albei jare gevra is, tel mee.`;
  el("change-legend").innerHTML =
    `<span>Verandering in persentasiepunte, ${before} → ${wave}</span>`;
  divergingBars(el("change"), change, { unit: "pp", span: null });
}

/* ---------- a bar per item, running left or right of zero ---------- */

function divergingBars(target, items, { unit = "", span = null } = {}) {
  if (!items.length) {
    target.innerHTML = `<p class="empty">Geen data vir hierdie keuse nie.</p>`;
    return;
  }
  const rowH = 26, pad = { top: 10, right: 72, bottom: 26, left: 168 };
  const width = 720;
  const height = pad.top + pad.bottom + rowH * items.length;
  const plotW = width - pad.left - pad.right;
  const reach = span || niceMax(Math.max(1, ...items.map((i) => Math.abs(i.value))));
  const zero = pad.left + plotW / 2;
  const x = (v) => zero + (v / reach) * (plotW / 2);

  const ticks = [-reach, -reach / 2, 0, reach / 2, reach];
  const grid = ticks.map((t) => `
    <line class="axis-line" x1="${x(t)}" x2="${x(t)}" y1="${pad.top}"
          y2="${height - pad.bottom}"${t === 0 ? ' stroke-width="1.5"' : ""}></line>
    <text x="${x(t)}" y="${height - pad.bottom + 16}" text-anchor="middle">${round1(t)}</text>`
  ).join("");

  const bars = items.map((item, i) => {
    const y = pad.top + i * rowH + 4;
    const w = Math.abs(x(item.value) - zero);
    const colour = item.value >= 0 ? "var(--series-3)" : "var(--series-2)";
    return `
      <text class="row-name" x="${pad.left - 10}" y="${y + 12}" text-anchor="end">${escapeHtml(item.name)}</text>
      <rect class="bar" x="${item.value >= 0 ? zero : zero - w}" y="${y}"
        width="${Math.max(w, item.value ? 2 : 0)}" height="${rowH - 8}" fill="${colour}"
        tabindex="0" role="img" aria-label="${escapeHtml(`${item.name}: ${round1(item.value)}${unit}`)}"
        data-tip="${escapeHtml(item.tip || `${item.name}: ${round1(item.value)}${unit}`)}"></rect>
      ${valueLabel(item, zero, w, y, unit, pad, width)}`;
  }).join("");

  target.innerHTML =
    `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"
          role="img" aria-label="Staafgrafiek om nul">${grid}${bars}</svg>`;
  attachTooltips(target);
  registerChart(target, {
    type: "bar", unit,
    categories: items.map((i) => i.name),
    series: [{ name: unit === "pp" ? "Verandering" : "Teenoor die gemiddelde ring",
               values: items.map((i) => i.value), colour: "var(--series-1)" }],
  });
}

/* ---------- the indicators behind each quality ---------- */

/** The number at the end of a bar, moved inside it where there is no room. */
function valueLabel(item, zero, w, y, unit, pad, width) {
  const positive = item.value >= 0;
  const end = positive ? zero + w : zero - w;
  const outside = positive ? end + 7 : end - 7;
  const room = positive ? width - pad.right + 60 - outside : outside - pad.left;
  const inside = room < 36 && w > 40;
  const text = `${item.value > 0 ? "+" : ""}${round1(item.value)}${unit}`;
  return `<text class="row-value${inside ? " row-value--in" : ""}"
    x="${inside ? (positive ? end - 7 : end + 7) : outside}" y="${y + 12}"
    text-anchor="${inside === positive ? "end" : "start"}">${text}</text>`;
}

function renderDetail(sc, wave) {
  const before = baseline(sc.key, wave);
  const here = cells(sc.key, wave);
  const then = before ? cells(sc.key, before) : {};
  const nat = cells(NATIONAL, wave);

  el("detail").innerHTML = state.data.groups.map((group) => {
    const qualities = state.qualities.filter((q) => q.group === group.key);
    const blocks = qualities.map((q) => {
      const rows = state.indicators.filter((i) => i.quality === q.key);
      const usable = rows.filter((i) => here[i.key] || then[i.key]);
      if (!usable.length) return "";
      const mark = marks(sc.key, wave)[q.key];
      return `
        <h3>${escapeHtml(q.label)} <span class="quality-sub">${escapeHtml(q.subtitle)}</span>
          ${mark ? `<span class="quality-score">${mark[0]} / 10</span>` : ""}</h3>
        <p class="quality-blurb">${escapeHtml(q.blurb)}</p>
        <div class="scroller"><table class="table--plain">
          <thead><tr><th class="col-text">Aanwyser</th><th class="col-text">Tel as</th>
            <th>${wave}</th>${before ? `<th>${before}</th>` : ""}<th>AS ${wave}</th></tr></thead>
          <tbody>${usable.map((i) => `<tr>
            <td class="col-text" title="${escapeHtml(i.questionLabel)}">${escapeHtml(i.label)}</td>
            <td class="col-text">${escapeHtml(trim(i.answer, 46))}</td>
            <td>${cell(here[i.key])}</td>
            ${before ? `<td>${cell(then[i.key])}</td>` : ""}
            <td>${cell(nat[i.key], false)}</td></tr>`).join("")}</tbody>
        </table></div>`;
    }).join("");
    if (!blocks) return "";
    return `<section class="panel">
      <h2>${escapeHtml(group.label)}</h2>
      <p class="sub">${escapeHtml(group.blurb)}</p>
      ${blocks}</section>`;
  }).join("");
}

function cell(row, withN = true) {
  if (!row) return "—";
  return `${round1(row[1])}%` + (withN
    ? ` <span style="color:var(--text-muted)">(n=${row[0]})</span>` : "");
}

boot();
