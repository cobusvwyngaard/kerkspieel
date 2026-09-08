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
  registerChart(target, {
    type: "bar", categories, unit,
    series: series.map((s, i) => ({ name: s.name, values: s.values,
                                    colour: SERIES[i % SERIES.length] })),
  });
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
  registerChart(target, {
    type: "line", categories: xs, unit,
    series: series.map((s, i) => ({ name: s.name, values: s.values,
                                    colour: SERIES[i % SERIES.length] })),
  });
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
  registerChart(target, {
    type: "stacked", categories: xs, unit: asShare ? "%" : "",
    series: segments.map((s, i) => ({ name: s.name, values: s.values,
                                      colour: RAMP[i % RAMP.length] })),
  });
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

/* ---------- PowerPoint export ----------
   Charts are exported as native PowerPoint charts rather than pictures, so
   the recipient can restyle them, read the numbers, and paste them into an
   existing deck. Each chart records what it drew; the exporter turns that
   into a one-slide .pptx. */

const chartRegistry = new Map();

function registerChart(target, spec) {
  if (target && target.id) chartRegistry.set(target.id, spec);
}

/** Resolve a CSS custom property to the hex PowerPoint needs. */
function resolveColour(value) {
  const name = /var\((--[\w-]+)\)/.exec(value);
  const raw = name
    ? getComputedStyle(document.documentElement).getPropertyValue(name[1]).trim()
    : value;
  const hex = raw.replace("#", "").trim();
  if (/^[0-9a-f]{6}$/i.test(hex)) return hex.toUpperCase();
  // Fall back through a canvas for rgb()/named colours.
  const probe = document.createElement("canvas").getContext("2d");
  probe.fillStyle = raw || "#888888";
  return probe.fillStyle.replace("#", "").toUpperCase();
}

/** Add an export button to every panel that contains a registered chart. */
function addExportButtons() {
  chartRegistry.forEach((_, id) => {
    const target = el(id);
    const panel = target && target.closest(".panel");
    if (!panel || panel.querySelector(".export-pptx")) return;
    const button = document.createElement("button");
    button.className = "export-pptx";
    button.type = "button";
    button.textContent = "Stoor as PowerPoint";
    button.addEventListener("click", () => exportChart(id, button));
    (panel.querySelector("h2") || panel).insertAdjacentElement("afterend", button);
  });
}

async function exportChart(id, button) {
  const spec = chartRegistry.get(id);
  if (!spec || typeof PptxGenJS === "undefined") return;
  const panel = el(id).closest(".panel");
  const title = (panel.querySelector("h2")?.textContent || "Kerkspieël").trim();
  const subtitle = (panel.querySelector(".sub")?.textContent || "").trim();
  const label = button.textContent;
  button.disabled = true;
  button.textContent = "Besig…";

  try {
    const pptx = new PptxGenJS();
    pptx.layout = "LAYOUT_16x9";
    pptx.author = "Kerkspieël";
    const slide = pptx.addSlide();

    slide.addText(title, {
      x: 0.5, y: 0.35, w: 9, h: 0.6, fontSize: 24, bold: true, color: "1A1A19",
    });
    if (subtitle) {
      slide.addText(subtitle, {
        x: 0.5, y: 0.95, w: 9, h: 0.5, fontSize: 12, color: "52514E",
      });
    }

    const colours = spec.series.map((s) => resolveColour(s.colour));
    const data = spec.series.map((s) => ({
      name: s.name,
      labels: spec.categories,
      // PowerPoint cannot plot a gap, so a missing point becomes null and
      // the chart is told to leave it blank rather than read it as zero.
      values: s.values.map((v) => (v == null ? null : v)),
    }));

    const options = {
      x: 0.5, y: subtitle ? 1.5 : 1.15, w: 9, h: subtitle ? 4.0 : 4.35,
      chartColors: colours,
      showLegend: spec.series.length > 1,
      legendPos: "b",
      showValue: false,
      catAxisLabelFontSize: 10,
      valAxisLabelFontSize: 10,
      dataLabelFontSize: 10,
      displayBlanksAs: "gap",
      valAxisTitle: spec.unit ? spec.unit.trim() : undefined,
      showValAxisTitle: Boolean(spec.unit && spec.unit.trim()),
    };

    if (spec.type === "line") {
      slide.addChart(pptx.ChartType.line, data,
        { ...options, lineDataSymbol: "circle", lineSize: 2, lineSmooth: false });
    } else {
      slide.addChart(pptx.ChartType.bar, data, {
        ...options,
        barDir: "col",
        barGrouping: spec.type === "stacked" ? "percentStacked" : "clustered",
        barGapWidthPct: spec.type === "stacked" ? 60 : 40,
      });
    }

    slide.addText(spec.source || "Bron: Kerkspieël · Taakspan Navorsing", {
      x: 0.5, y: 5.05, w: 9, h: 0.35, fontSize: 9, color: "78766F",
    });

    const stamp = new Date().toISOString().slice(0, 10);
    await pptx.writeFile({
      fileName: `kerkspieel-${id}-${stamp}.pptx`.replace(/[^\w.-]+/g, "-"),
    });
  } catch (e) {
    button.textContent = "Kon nie stoor nie";
    setTimeout(() => { button.textContent = label; button.disabled = false; }, 2500);
    return;
  }
  button.textContent = label;
  button.disabled = false;
}
