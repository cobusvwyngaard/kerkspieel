/* Kerkspieël Ringsverslag — reads the precomputed dataset and renders a
   ring's answers against its synod and the church as a whole. */

const WAVES = ["2018", "2022", "2026"];
const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)"];
const ALL_RINGS = "__all__";
// Below this, a single congregation moves the share by 10 points or more.
const SMALL_N = 10;

const el = (id) => document.getElementById(id);
const state = { congregations: [], questions: [], responses: [], byCode: new Map() };

async function boot() {
  const [congregations, questions, responses] = await Promise.all(
    ["congregations", "questions", "responses"].map((n) =>
      fetch(`data/${n}.json`).then((r) => r.json())));

  state.congregations = congregations;
  state.questions = questions;
  state.responses = responses;
  state.byCode = new Map(congregations.map((c) => [c.code, c]));

  fillSynods();
  fillQuestions();
  ["synod", "ring", "question"].forEach((id) =>
    el(id).addEventListener("change", id === "synod" ? onSynodChange : render));
  onSynodChange();
}

function synodList() {
  return [...new Set(state.congregations.map((c) => c.synod))].sort();
}

function ringList(synod) {
  return [...new Set(state.congregations
    .filter((c) => c.synod === synod && c.ring)
    .map((c) => c.ring))].sort();
}

function fillSynods() {
  el("synod").innerHTML = synodList()
    .map((s) => `<option value="${s}">${s}</option>`).join("");
}

function fillQuestions() {
  // A question is only offered where at least two waves asked it on the
  // same scale, or where it is a straightforward count.
  const usable = state.questions
    .filter((q) => q.comparable === "yes" || q.comparable === "scale-changed")
    // Questions asked the same way in every wave come first; the ones whose
    // scale moved are still offered, but behind a warning.
    .sort((a, b) => (a.comparable === b.comparable ? 0
                     : a.comparable === "yes" ? -1 : 1));
  el("question").innerHTML = usable
    .map((q) => `<option value="${q.id}">${escapeHtml(trim(q.label, 110))}` +
                `${q.comparable === "scale-changed" ? " ⚠" : ""}</option>`).join("");
  const opener = usable.find((q) => /huidige rigting/i.test(q.label));
  if (opener) el("question").value = opener.id;
}

function onSynodChange() {
  const synod = el("synod").value;
  el("ring").innerHTML = [`<option value="${ALL_RINGS}">Hele sinode</option>`]
    .concat(ringList(synod).map((r) => `<option value="${r}">${escapeHtml(r)}</option>`))
    .join("");
  render();
}

/* ---------- selection ---------- */

function scopes() {
  const synod = el("synod").value;
  const ring = el("ring").value;
  const inSynod = (c) => c.synod === synod;
  const inRing = ring === ALL_RINGS ? inSynod : (c) => c.ring === ring;
  const all = [
    { key: "ring", label: `Ring ${ring}`, short: "Ring", test: inRing },
    { key: "synod", label: `Sinode ${synod}`, short: "Sinode", test: inSynod },
    { key: "national", label: "Algemene Sinode", short: "AS", test: () => true },
  ];
  // Choosing the whole synod makes the ring scope the synod scope; showing
  // both would just repeat every column.
  return ring === ALL_RINGS ? all.slice(1) : all;
}

function responsesFor(test, wave) {
  return state.responses.filter((r) => {
    if (r.wave !== wave) return false;
    const c = state.byCode.get(r.code);
    return c && test(c);
  });
}

/* ---------- aggregation ---------- */

function optionsFor(question) {
  // Options can be worded differently between waves; show the most recent
  // wording, and order it the way the published report does where the
  // scale's direction is known.
  for (const wave of [...WAVES].reverse()) {
    const listed = question.options[wave];
    if (listed && listed.length) {
      const order = question.order || {};
      return [...listed]
        .map((o) => ({ ...o, rank: order[o.value] ?? o.value }))
        .sort((a, b) => a.rank - b.rank);
    }
  }
  return null;
}

function distribution(question, test, wave) {
  const options = optionsFor(question);
  if (!options) return null;
  const values = responsesFor(test, wave)
    .map((r) => r.values[question.id])
    .filter((v) => options.some((o) => o.value === v));
  if (!values.length) return null;
  const counts = new Map(options.map((o) => [o.value, 0]));
  values.forEach((v) => counts.set(v, counts.get(v) + 1));
  return {
    n: values.length,
    share: options.map((o) => (100 * counts.get(o.value)) / values.length),
  };
}

/* ---------- render ---------- */

function render() {
  const question = state.questions.find((q) => q.id === el("question").value);
  const scopeList = scopes();
  const primary = scopeList[0];

  renderTiles(primary);
  if (!question) return;

  el("chart-title").textContent = trim(question.label, 150);
  el("chart-sub").textContent = primary.label;

  el("note-slot").innerHTML = question.comparable === "scale-changed"
    ? `<p class="note"><strong>Skale verskil tussen jare.</strong> Hierdie vraag
       is nie in elke jaar met dieselfde aantal antwoordopsies gevra nie
       (${WAVES.filter((w) => question.options[w])
              .map((w) => `${w}: ${question.options[w].length}`).join(", ")}),
       so die jare is nie direk vergelykbaar nie.</p>`
    : "";

  const options = optionsFor(question);
  const series = WAVES
    .map((wave) => ({ wave, data: distribution(question, primary.test, wave) }))
    .filter((s) => s.data);

  const thin = series.filter((s) => s.data.n < SMALL_N);
  if (thin.length) {
    el("note-slot").insertAdjacentHTML("beforeend",
      `<p class="note"><strong>Klein getalle.</strong> ${
        thin.map((s) => `${s.wave} (n=${s.data.n})`).join(", ")} — met so min
        gemeentes skuif elke antwoord die persentasie met
        ${round1(100 / Math.min(...thin.map((s) => s.data.n)))} persentasiepunte.
        Lees die getalle, nie die persentasies nie.</p>`);
  }

  renderLegend(series);
  renderChart(options, series);
  renderTable(question, options, scopeList);
  renderFooter(question);
}

function renderTiles(scope) {
  const total = state.congregations.filter(scope.test).length;
  const tiles = [`<div class="tile"><div class="k">Gemeentes</div>
     <div class="v">${total}</div><div class="s">in hierdie keuse</div></div>`];
  WAVES.forEach((wave) => {
    const n = responsesFor(scope.test, wave).length;
    const pct = total ? Math.round((100 * n) / total) : 0;
    tiles.push(`<div class="tile"><div class="k">${wave} deelname</div>
      <div class="v">${n}</div><div class="s">${pct}% van gemeentes</div></div>`);
  });
  el("tiles").innerHTML = tiles.join("");
}

function renderLegend(series) {
  el("legend").innerHTML = series.map((s, i) =>
    `<span><i class="swatch" style="background:${SERIES[i]}"></i>${s.wave} (n=${s.data.n})</span>`
  ).join("");
}

function renderChart(options, series) {
  if (!options || !series.length) {
    el("chart").innerHTML = `<p class="empty">Geen antwoorde vir hierdie keuse nie.</p>`;
    return;
  }
  const pad = { top: 12, right: 12, bottom: 64, left: 42 };
  const groupW = Math.max(96, Math.min(190, 700 / options.length));
  const width = pad.left + pad.right + groupW * options.length;
  const height = 300;
  const plotH = height - pad.top - pad.bottom;
  const max = niceMax(Math.max(20, ...series.flatMap((s) => s.data.share)));
  const y = (v) => pad.top + plotH - (v / max) * plotH;

  const step = max / 4;
  const ticks = [0, 1, 2, 3, 4].map((i) => i * step);
  const gridlines = ticks.map((t) => `
    <line class="axis-line" x1="${pad.left}" x2="${width - pad.right}"
          y1="${y(t)}" y2="${y(t)}"></line>
    <text x="${pad.left - 7}" y="${y(t) + 4}" text-anchor="end">${round1(t)}%</text>`).join("");

  // 2px of surface between neighbouring bars keeps the groups legible.
  const gap = 2;
  const inner = groupW - 18;
  const barW = (inner - gap * (series.length - 1)) / series.length;

  const bars = options.map((opt, oi) => {
    const x0 = pad.left + oi * groupW + 9;
    return series.map((s, si) => {
      const v = s.data.share[oi];
      const h = Math.max(v > 0 ? 2 : 0, (v / max) * plotH);
      const x = x0 + si * (barW + gap);
      return `<rect class="bar" x="${x}" y="${y(v)}" width="${barW}" height="${h}"
        fill="${SERIES[si]}" tabindex="0" role="img"
        aria-label="${escapeHtml(opt.label || "Opsie " + opt.value)}, ${s.wave}: ${v.toFixed(1)} persent"
        data-tip="${escapeHtml(`${s.wave} · ${opt.label || "Opsie " + opt.value}: ${v.toFixed(1)}% (n=${s.data.n})`)}"></rect>`;
    }).join("");
  }).join("");

  const labels = options.map((opt, oi) => {
    const cx = pad.left + oi * groupW + groupW / 2;
    return wrap(opt.label || `Opsie ${opt.value}`, Math.floor(groupW / 6), 3)
      .map((line, li) =>
        `<text x="${cx}" y="${height - pad.bottom + 16 + li * 13}"
               text-anchor="middle">${escapeHtml(line)}</text>`).join("");
  }).join("");

  el("chart").innerHTML =
    `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"
          role="img" aria-label="Verspreiding van antwoorde per jaar">
       ${gridlines}${bars}${labels}
     </svg>`;
  attachTooltips();
}

function renderTable(question, options, scopeList) {
  if (!options) { el("table").innerHTML = ""; return; }
  const cols = [];
  scopeList.forEach((sc) => WAVES.forEach((wave) => {
    const d = distribution(question, sc.test, wave);
    if (d) cols.push({ head: `${sc.short} ${wave}`, d });
  }));
  if (!cols.length) { el("table").innerHTML = ""; return; }

  const head = `<thead><tr><th>Beskrywing</th>${
    cols.map((c) => `<th>${escapeHtml(c.head)}</th>`).join("")}</tr></thead>`;
  const body = options.map((opt, oi) => `<tr>
      <td>${escapeHtml(opt.label || `Opsie ${opt.value}`)}</td>
      ${cols.map((c) => `<td>${c.d.share[oi].toFixed(2)}%</td>`).join("")}
    </tr>`).join("");
  const foot = `<tr><td>Aantal gemeentes</td>${
    cols.map((c) => `<td>${c.d.n}</td>`).join("")}</tr>`;
  el("table").innerHTML = `${head}<tbody>${body}${foot}</tbody>`;
}

function renderFooter(question) {
  const codes = WAVES.filter((w) => question.codes[w])
    .map((w) => `${w}: ${question.codes[w]}`).join(" · ");
  el("footer").textContent =
    `Veranderlike ${codes}. Kodes word elke opname hernommer, so 'n kode geld net saam met sy jaar.`;
}

/* ---------- helpers ---------- */

function attachTooltips() {
  const tip = el("tooltip");
  const show = (e) => {
    const t = e.target.dataset.tip;
    if (!t) return;
    const box = e.target.getBoundingClientRect();
    tip.textContent = t;
    tip.style.opacity = "1";
    tip.style.left = `${Math.min(box.left, window.innerWidth - 240)}px`;
    tip.style.top = `${box.top - 34}px`;
  };
  const hide = () => { tip.style.opacity = "0"; };
  el("chart").querySelectorAll("[data-tip]").forEach((node) => {
    node.addEventListener("mouseenter", show);
    node.addEventListener("focus", show);
    node.addEventListener("mouseleave", hide);
    node.addEventListener("blur", hide);
  });
}

function wrap(text, perLine, maxLines) {
  const out = [];
  let line = "";
  for (const word of String(text).split(/\s+/)) {
    if ((line + " " + word).trim().length > perLine && line) {
      out.push(line);
      line = word;
      if (out.length === maxLines - 1 && out.length) break;
    } else {
      line = (line + " " + word).trim();
    }
  }
  if (line) out.push(line);
  return out.slice(0, maxLines);
}

function niceMax(value) {
  // Round the axis up to something a reader can divide into quarters.
  for (const candidate of [20, 25, 40, 50, 60, 75, 80, 100]) {
    if (value <= candidate) return candidate;
  }
  return 100;
}

const round1 = (v) => (Math.round(v * 10) / 10).toString().replace(/\.0$/, "");
const trim = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + "…" : String(s));
const escapeHtml = (s) => String(s).replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

boot();
