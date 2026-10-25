/* The Opsomming entrance: what this set of tables contains, and how large
   a congregation is.

   Congregation size is the one thing Bylaag 3 does not tabulate but every
   reader asks about, so it is answered here, from the counted questions in
   the same list. */

const NATIONAL_KEY = "__all__";

const state = { set: null, numeric: null };

async function boot() {
  try {
    [state.set, state.numeric] = await Promise.all([
      loadJSON("opsomming.json"),
      loadJSON("numeric.json"),
    ]);
  } catch (e) {
    failed(e.message);
    return;
  }
  renderCards();
  renderSize();
  renderSections();
  el("footer").textContent = `${state.set.source}. Bron: Gemeentevraelys ` +
    `${state.set.waves.join(", ")}.`;
}

const entryOf = (key) => state.set.entries.find((e) => e.key === key);

function renderCards() {
  const choices = state.set.entries.filter((e) => e.kind === "choice").length;
  const counted = state.set.entries.filter((e) => e.kind === "number").length;
  const mappable = state.set.entries.filter((e) => e.mappable.length).length;
  el("ring-meta").textContent =
    `${choices} tabelle · ${counted} getalle · ${state.set.waves.join(" · ")}`;
  el("kaart-meta").textContent = `${mappable} van hulle op die kaart`;
}

/* ---------- congregation size ---------- */

/** [congregations answering, total, median] for a counted entry nationally. */
function sizeRow(entry, wave) {
  const stats = state.numeric.stats[entry.sources[wave]];
  return stats && stats[NATIONAL_KEY] && stats[NATIONAL_KEY][wave];
}

function renderSize() {
  const waves = state.set.waves;
  const last = waves[waves.length - 1];
  const counted = state.set.size.map(entryOf).filter(Boolean);
  const members = counted.find((e) => /Belydende/i.test(e.title));
  const baptised = counted.find((e) => /^Dooplidmate/i.test(e.title));
  const attendance = counted.find((e) => /erediensbywoning/i.test(e.title));

  const tiles = [];
  const tile = (entry, label) => {
    const row = entry && sizeRow(entry, last);
    if (!row) return;
    tiles.push([label, Math.round(row[1] / row[0]),
                `gemiddeld per gemeente · mediaan ${round1(row[2])} · ${last}`]);
  };
  tile(members, "Belydende lidmate");
  tile(baptised, "Dooplidmate");
  tile(attendance, "Erediensbywoning");
  const row = members && sizeRow(members, last);
  if (row) {
    tiles.push(["Belydende lidmate in totaal", row[1].toLocaleString("af-ZA"),
                `oor ${row[0]} gemeentes wat geantwoord het`]);
  }
  el("size-tiles").innerHTML = tiles.map(([k, v, s]) =>
    `<div class="tile"><div class="k">${escapeHtml(k)}</div>
     <div class="v">${escapeHtml(String(v))}</div>
     <div class="s">${escapeHtml(s)}</div></div>`).join("");

  el("size-sub").textContent =
    `Landwyd, uit die gemeentes wat die betrokke jaar geantwoord het. Die ` +
    `mediaan is die middelste gemeente; dit lê heelwat onder die gemiddeld, ` +
    `want 'n paar groot gemeentes trek die gemiddeld op.`;

  // The mean with the median beside it, because the two are far apart and
  // quoting either alone misleads. Totals go in their own column for the
  // most recent year only, where they are a figure for the whole church.
  el("size-table").className = "table--plain";
  el("size-table").innerHTML =
    `<thead><tr><th>Getal</th>${waves.map((w) =>
      `<th>${w}<br><span class="th-note">gemiddeld (mediaan)</span></th>`).join("")}` +
    `<th>${last}<br><span class="th-note">totaal</span></th>` +
    `<th>${last}<br><span class="th-note">gemeentes</span></th></tr></thead>` +
    `<tbody>${counted.map((entry) => {
      const latest = sizeRow(entry, last);
      return `<tr>
        <td>${escapeHtml(entry.title)}</td>
        ${waves.map((wave) => {
          const r = sizeRow(entry, wave);
          return r
            ? `<td>${round1(r[1] / r[0])} <span style="color:var(--text-muted)">(${round1(r[2])})</span></td>`
            : `<td>—</td>`;
        }).join("")}
        <td>${latest ? Math.round(latest[1]).toLocaleString("af-ZA") : "—"}</td>
        <td>${latest ? latest[0] : "—"}</td></tr>`;
    }).join("")}</tbody>`;
}

function renderSections() {
  el("sections").innerHTML = state.set.sections.map((section) => `
    <h3>${escapeHtml(section.label)}</h3>
    <ul class="set-list">${section.keys.map((key) => {
      const entry = entryOf(key);
      if (!entry) return "";
      const codes = entry.waves.map((w) => `${w}: ${entry.codes[w]}`).join(" · ");
      return `<li>${escapeHtml(entry.title)}
        <span class="set-codes">${escapeHtml(codes)}${
          entry.kind === "number" ? " · getal" : ""}</span></li>`;
    }).join("")}</ul>`).join("");
}

boot();
