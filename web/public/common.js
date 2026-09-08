/* Shared by every report: the navigation, the palette, and the handful of
   helpers each page would otherwise repeat. */

const PAGES = [
  { href: "index.html", label: "Tuis" },
  { href: "ring.html", label: "Ringsverslag" },
  { href: "kaart.html", label: "Kaart" },
  { href: "predikante.html", label: "Predikante" },
  { href: "ouderdom.html", label: "Ouderdomsprofiel" },
];

// Categorical slots, validated for contrast and colour-vision deficiency
// against both the light and the dark chart surface.
const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)"];
const NATIONAL = "__all__";

const el = (id) => document.getElementById(id);
const escapeHtml = (s) => String(s).replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const trim = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + "…" : String(s));
const round1 = (v) => (Math.round(v * 10) / 10).toString().replace(/\.0$/, "");

function renderNav() {
  // Cloudflare serves these as extensionless URLs and redirects "/ring.html"
  // to "/ring", so match on the stem rather than the filename -- otherwise
  // the current page never highlights once deployed.
  const stem = (path) => (path.split("/").pop() || "index").replace(/\.html$/, "") || "index";
  const here = stem(location.pathname);
  const nav = el("site-nav");
  if (!nav) return;
  nav.innerHTML = PAGES.map((p) =>
    `<a href="${p.href}"${stem(p.href) === here ? ' aria-current="page"' : ""}>${p.label}</a>`
  ).join("");
}

const loadJSON = (name) => fetch(`data/${name}`).then((r) => {
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
  return r.json();
});

function failed(message) {
  const main = document.querySelector("main");
  if (main) {
    main.insertAdjacentHTML("afterbegin",
      `<p class="note"><strong>Kon nie die data laai nie.</strong> ${escapeHtml(message)}</p>`);
  }
}

/** Round an axis maximum up to something a reader can divide into quarters. */
function niceMax(value) {
  if (value <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  for (const step of [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (value <= step * magnitude) return step * magnitude;
  }
  return 10 * magnitude;
}

/** Break a label into at most maxLines lines of roughly perLine characters. */
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

/** A hover/focus tooltip for any element carrying data-tip, inside root. */
function attachTooltips(root) {
  const tip = el("tooltip");
  if (!tip || !root) return;
  const show = (e) => {
    const text = e.target.dataset.tip;
    if (!text) return;
    const box = e.target.getBoundingClientRect();
    tip.textContent = text;
    tip.style.opacity = "1";
    tip.style.left = `${Math.max(6, Math.min(box.left, window.innerWidth - 260))}px`;
    tip.style.top = `${Math.max(6, box.top - 34)}px`;
  };
  const hide = () => { tip.style.opacity = "0"; };
  root.querySelectorAll("[data-tip]").forEach((node) => {
    node.addEventListener("mouseenter", show);
    node.addEventListener("focus", show);
    node.addEventListener("mouseleave", hide);
    node.addEventListener("blur", hide);
  });
}

/** Grouped vertical bars: categories along x, one bar per series. */
function groupedBars(target, categories, series, options = {}) {
  const { height = 300, unit = "%", maxLines = 3 } = options;
  if (!categories.length || !series.length) {
    target.innerHTML = `<p class="empty">Geen data vir hierdie keuse nie.</p>`;
    return;
  }
  const pad = { top: 12, right: 12, bottom: 66, left: 52 };
  const groupW = Math.max(74, Math.min(190, 780 / categories.length));
  const width = pad.left + pad.right + groupW * categories.length;
  const plotH = height - pad.top - pad.bottom;
  const max = niceMax(Math.max(...series.flatMap((s) => s.values)));
  const y = (v) => pad.top + plotH - (v / max) * plotH;

  const grid = [0, 1, 2, 3, 4].map((i) => i * (max / 4)).map((t) => `
    <line class="axis-line" x1="${pad.left}" x2="${width - pad.right}"
          y1="${y(t)}" y2="${y(t)}"></line>
    <text x="${pad.left - 7}" y="${y(t) + 4}" text-anchor="end">${round1(t)}${unit}</text>`
  ).join("");

  const gap = 2;                       // surface between neighbouring bars
  const barW = (groupW - 18 - gap * (series.length - 1)) / series.length;
  const bars = categories.map((cat, ci) => series.map((s, si) => {
    const v = s.values[ci] ?? 0;
    const h = Math.max(v > 0 ? 2 : 0, (v / max) * plotH);
    const x = pad.left + ci * groupW + 9 + si * (barW + gap);
    const label = `${s.name} · ${cat}: ${round1(v)}${unit}`;
    return `<rect class="bar" x="${x}" y="${y(v)}" width="${barW}" height="${h}"
      fill="${SERIES[si % SERIES.length]}" tabindex="0" role="img"
      aria-label="${escapeHtml(label)}" data-tip="${escapeHtml(label)}"></rect>`;
  }).join("")).join("");

  const labels = categories.map((cat, ci) => {
    const cx = pad.left + ci * groupW + groupW / 2;
    return wrap(cat, Math.floor(groupW / 6), maxLines).map((line, li) =>
      `<text x="${cx}" y="${height - pad.bottom + 16 + li * 13}"
             text-anchor="middle">${escapeHtml(line)}</text>`).join("");
  }).join("");

  target.innerHTML = `<svg viewBox="0 0 ${width} ${height}" width="${width}"
    height="${height}" role="img" aria-label="Staafgrafiek">${grid}${bars}${labels}</svg>`;
  attachTooltips(target);
}

function legend(target, series) {
  target.innerHTML = series.map((s, i) =>
    `<span><i class="swatch" style="background:${SERIES[i % SERIES.length]}"></i>${escapeHtml(s.name)}</span>`
  ).join("");
}

renderNav();

const RAMP = [1, 2, 3, 4, 5, 6].map((i) => `var(--ramp-${i})`);

/** A line per series over a shared set of x labels. */
function lineChart(target, xs, series, options = {}) {
  const { height = 280, unit = "", zeroBased = false } = options;
  if (!xs.length || !series.length) {
    target.innerHTML = `<p class="empty">Geen data vir hierdie keuse nie.</p>`;
    return;
  }
  const pad = { top: 14, right: 16, bottom: 34, left: 52 };
  const width = Math.max(420, pad.left + pad.right + xs.length * 62);
  const plotH = height - pad.top - pad.bottom;
  const all = series.flatMap((s) => s.values).filter((v) => v != null);
  const hi = niceMax(Math.max(...all));
  const lo = zeroBased ? 0 : Math.max(0, Math.floor(Math.min(...all) / 5) * 5 - 5);
  const y = (v) => pad.top + plotH - ((v - lo) / (hi - lo || 1)) * plotH;
  const x = (i) => pad.left + (xs.length === 1 ? plotH / 2
    : i * (width - pad.left - pad.right) / (xs.length - 1));

  const ticks = [0, 1, 2, 3, 4].map((i) => lo + i * (hi - lo) / 4);
  const grid = ticks.map((t) => `
    <line class="axis-line" x1="${pad.left}" x2="${width - pad.right}"
          y1="${y(t)}" y2="${y(t)}"></line>
    <text x="${pad.left - 7}" y="${y(t) + 4}" text-anchor="end">${round1(t)}${unit}</text>`
  ).join("");

  const lines = series.map((s, si) => {
    const colour = SERIES[si % SERIES.length];
    const points = s.values.map((v, i) => (v == null ? null : [x(i), y(v)]))
      .filter(Boolean);
    const path = points.map((p, i) => `${i ? "L" : "M"}${p[0]} ${p[1]}`).join(" ");
    const dots = s.values.map((v, i) => v == null ? "" :
      `<circle cx="${x(i)}" cy="${y(v)}" r="4.5" fill="${colour}"
        stroke="var(--surface-1)" stroke-width="2" tabindex="0" role="img"
        aria-label="${escapeHtml(`${s.name} ${xs[i]}: ${round1(v)}${unit}`)}"
        data-tip="${escapeHtml(`${s.name} · ${xs[i]}: ${round1(v)}${unit}`)}"></circle>`
    ).join("");
    return `<path d="${path}" fill="none" stroke="${colour}" stroke-width="2"
      stroke-linejoin="round"></path>${dots}`;
  }).join("");

  const labels = xs.map((label, i) =>
    `<text x="${x(i)}" y="${height - pad.bottom + 17}" text-anchor="middle">${escapeHtml(label)}</text>`
  ).join("");

  target.innerHTML = `<svg viewBox="0 0 ${width} ${height}" width="${width}"
    height="${height}" role="img" aria-label="Lyngrafiek">${grid}${lines}${labels}</svg>`;
  attachTooltips(target);
}

/** One bar per x, split into ordered segments sharing a sequential ramp. */
function stackedBars(target, xs, segments, options = {}) {
  const { height = 300, asShare = true } = options;
  if (!xs.length || !segments.length) {
    target.innerHTML = `<p class="empty">Geen data vir hierdie keuse nie.</p>`;
    return;
  }
  const pad = { top: 12, right: 12, bottom: 34, left: 52 };
  const barW = Math.max(26, Math.min(64, 620 / xs.length));
  const step = barW + 12;
  const width = pad.left + pad.right + step * xs.length;
  const plotH = height - pad.top - pad.bottom;
  const totals = xs.map((_, i) => segments.reduce((a, s) => a + (s.values[i] || 0), 0));
  const max = asShare ? 100 : niceMax(Math.max(...totals));
  const y = (v) => pad.top + plotH - (v / max) * plotH;

  const ticks = [0, 1, 2, 3, 4].map((i) => i * max / 4);
  const grid = ticks.map((t) => `
    <line class="axis-line" x1="${pad.left}" x2="${width - pad.right}"
          y1="${y(t)}" y2="${y(t)}"></line>
    <text x="${pad.left - 7}" y="${y(t) + 4}" text-anchor="end">${round1(t)}${asShare ? "%" : ""}</text>`
  ).join("");

  const bars = xs.map((label, i) => {
    const total = totals[i] || 1;
    let cursor = 0;
    return segments.map((s, si) => {
      const raw = s.values[i] || 0;
      const v = asShare ? (100 * raw) / total : raw;
      const top = y(cursor + v);
      // 2px of surface between segments keeps the boundaries readable.
      const h = Math.max(0, y(cursor) - top - 2);
      cursor += v;
      if (h <= 0) return "";
      const tip = `${label} · ${s.name}: ${raw}${asShare ? ` (${round1(v)}%)` : ""}`;
      return `<rect x="${pad.left + i * step + 6}" y="${top}" width="${barW}"
        height="${h}" rx="2" fill="${RAMP[si % RAMP.length]}" tabindex="0" role="img"
        aria-label="${escapeHtml(tip)}" data-tip="${escapeHtml(tip)}"></rect>`;
    }).join("");
  }).join("");

  const labels = xs.map((label, i) =>
    `<text x="${pad.left + i * step + 6 + barW / 2}" y="${height - pad.bottom + 17}"
           text-anchor="middle">${escapeHtml(label)}</text>`).join("");

  target.innerHTML = `<svg viewBox="0 0 ${width} ${height}" width="${width}"
    height="${height}" role="img" aria-label="Gestapelde staafgrafiek">${grid}${bars}${labels}</svg>`;
  attachTooltips(target);
}

function rampKey(target, names) {
  target.innerHTML = names.map((n, i) =>
    `<span class="legend-item"><i class="swatch" style="background:${RAMP[i % RAMP.length]}"></i>${escapeHtml(n)}</span>`
  ).join("");
}

/** Scope pickers shared by the ministers reports, driven by byScope keys. */
function scopeOptions(byScope) {
  const synods = new Set(), rings = new Map();
  Object.keys(byScope).forEach((key) => {
    if (key.startsWith("s:")) synods.add(key.slice(2));
    else if (key.startsWith("r:")) {
      const [synod, ring] = key.slice(2).split("|");
      if (!rings.has(synod)) rings.set(synod, []);
      rings.get(synod).push(ring);
    }
  });
  return { synods: [...synods].sort((a, b) => a.localeCompare(b, "af")), rings };
}
