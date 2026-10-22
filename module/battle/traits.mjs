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
