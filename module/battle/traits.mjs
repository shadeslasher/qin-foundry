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
    const m = line.match(/^([A-Za-z][A-Za-z' \-]*?[A-Za-z])(\+{0,2})\s*(?:-\s|–|—|:|$)/);
    if (!m) continue;
    const base = m[1].trim().toLowerCase(), tier = 1 + m[2].length;
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

/** The unit's working trait text at a level (what the engine, bars and hover card read). */
export function traitTextOf(list, level = 1) {
  return (list ?? []).map(e => traitAtLevel(e, level)).filter(t => t?.name)
    .map(t => t.desc ? `${t.name} - ${t.desc}` : t.name).join("\n");
}
