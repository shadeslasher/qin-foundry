// Reading a unit's trait text ("Name+ - description", one per line) into { "name": tier }. No DOM needed,
// so the engine tests, the map icons and the adapter all share it.
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " ", ndash: "–", mdash: "—" };

export function traitLines(text) {
  return String(text ?? "")
    .replace(/<\/(p|div|li|h\d)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#?\w+);/g, (m, k) => ENTITIES[k] ?? m)
    .split(/\n+/).map(l => l.trim()).filter(Boolean);
}

export function traitTiersOf(text) {
  const out = {};
  for (const line of traitLines(text)) {
    // "Name EX" is the tier above "Name++" (Evasion EX, Disciplined EX, Charging Strike EX: David, 2026-10-29)
    const ex = line.match(/^([A-Za-z][A-Za-z' \-]*?[A-Za-z])\s+EX\s*(?:-\s|–|—|:|$)/);
    if (ex) { const b = ex[1].trim().toLowerCase(); out[b] = Math.max(out[b] || 0, 4); out[b + ' ex'] = 1; continue; }
    // "Name", "Name+", "Name++"; weaker versions end in "-"/"--" (Fragile-, Fragile--: David, 2026-10-29) and keep the
    // minus in their key ("fragile-") so they are never mistaken for the full trait
    const m = line.match(/^([A-Za-z][A-Za-z' \-]*?[A-Za-z])(-{1,2}|\+{0,2})\s*(?:-\s|–|—|:|$)/);
    if (!m) continue;
    const minus = m[2].startsWith('-');
    const base = m[1].trim().toLowerCase() + (minus ? m[2] : ''), tier = minus ? 1 : 1 + m[2].length;
    out[base] = Math.max(out[base] || 0, tier);
  }
  return out;
}

/** Armor from shields, read from the armor breakdown, e.g. "2 + 2 (Shield)" or "3 (Lg Shield)". */
export function shieldArmorOf(note) {
  let n = 0;
  for (const m of String(note ?? "").matchAll(/(\d+)\s*\((?:lg\.?\s*|large\s*)?shields?\)/gi)) n += Number(m[1]);
  return n;
}

// ---- Trait list (one card per trait, optional level locks and upgrades) ----
// entry: { name, desc, level (unlock level, 1 = from the start), upgrades: [{ level, name, desc }],
//         options: [{ name, desc }] + chosen (index, -1 = not yet) for a choice between traits }

/** Choices the unit has reached but not made yet. */
export function pendingTraitChoices(list, level = 1) {
  return (list ?? []).filter(e => e.options?.length && (e.level || 1) <= level && !e.options[e.chosen ?? -1]).length;
}

/** Old one-trait-per-line text ("Name - description") into trait list entries. */
export function parseTraitText(text) {
  return traitLines(text).map(line => {
    const m = line.match(/^(.+?)\s*(?:\s-\s|\s–\s|\s—\s|:\s)\s*(.*)$/);
    return { name: (m ? m[1] : line).trim(), desc: (m ? m[2] : "").trim(), level: 1, upgrades: [] };
  });
}

/** What a trait entry is at a unit level: null if still locked, else the highest unlocked step. */
export function traitAtLevel(entry, level = 1) {
  if ((entry.level || 1) > level) return null;
  if (entry.options?.length) { const o = entry.options[entry.chosen ?? -1]; return o?.name ? { name: o.name, desc: o.desc, step: 0 } : null; }
  let cur = { name: entry.name, desc: entry.desc, step: 0 };
  [...(entry.upgrades ?? [])].sort((a, b) => (a.level || 1) - (b.level || 1)).forEach((u, i) => {
    if ((u.level || 1) <= level && u.name) cur = { name: u.name, desc: u.desc || cur.desc, step: i + 1 };
  });
  return cur;
}

const traitBase = (name) => String(name ?? "").trim().replace(/\+*$/, "").toLowerCase();
const traitPlus = (name) => (String(name ?? "").trim().match(/\++$/) || [""])[0].length;

/** Cards whose trait is replaced by a higher version of the same trait on another card (e.g. Anti-Cavalry by Anti-Cavalry+).
 *  Returns Map(index -> name of the trait replacing it). */
export function replacedTraits(list, level = 1) {
  const cur = (list ?? []).map(e => traitAtLevel(e, level));
  const best = new Map();
  cur.forEach((t, i) => { if (!t?.name) return; const b = traitBase(t.name), p = traitPlus(t.name), o = best.get(b);
    if (!o || p > o.p) best.set(b, { p, i, name: t.name }); });
  const out = new Map();
  cur.forEach((t, i) => { if (!t?.name) return; const o = best.get(traitBase(t.name)); if (o && o.i !== i) out.set(i, o.name); });
  return out;
}

/** The unit's working trait text at a level (what the engine, bars and hover card read). */
export function traitTextOf(list, level = 1) {
  const gone = replacedTraits(list, level);
  return (list ?? []).map((e, i) => gone.has(i) ? null : traitAtLevel(e, level)).filter(t => t?.name)
    .map(t => t.desc ? `${t.name} - ${t.desc}` : t.name).join("\n");
}

/** Pick every unmade trait choice the unit has reached at `level`, at random (enemy, allied and neutral units: David, 2026-10-30).
 * Changes `list` in place and returns the names picked. */
export function pickRandomChoices(list, level, rand = Math.random) {
  const picks = [];
  for (const e of list ?? []) {
    if (!e.options?.length || (e.chosen ?? -1) >= 0 || (e.level || 1) > level) continue;
    e.chosen = Math.min(e.options.length - 1, Math.floor(rand() * e.options.length));
    picks.push(e.options[e.chosen]?.name || "?");
  }
  return picks;
}
