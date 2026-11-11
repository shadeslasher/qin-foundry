// Officers' battlefield skill specs (David, 2026-11-05): which spec goes with which Battle Passive / Battle Active item.
// The specs are private (they describe the characters' skills), so they don't ship with the system: they live beside
// the private characters module, at modules/qin-3k-characters/data/battle-skill-specs.json (or Data/qin-data/).
// File: { version, specs: { key: spec }, byItem: { itemId: key }, byText: { hash of the item's text: key } }.
// A skill without a spec is still used the old way: its text is shown, the GM applies it.
export const SPEC_PATHS = ['modules/qin-3k-characters/data/battle-skill-specs.json', 'qin-data/battle-skill-specs.json'];
let data = null;

/** Letters and digits only, lower case: the same text however its HTML is written. */
export function normText(t) { return String(t || '').toLowerCase().replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;|&#\d+;/g, ' ').replace(/[^a-z0-9]+/g, ''); }
export function textHash(t) { let h = 5381; for (let i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0; return h.toString(16); }

export function setSpecData(d) { data = d && d.specs ? d : null; }
export async function loadSpecData(fetchFn = globalThis.fetch) {
  for (const path of SPEC_PATHS) {
    try {
      const r = await fetchFn(path + '?v=' + Date.now());
      if (!r.ok) continue;
      setSpecData(await r.json());
      if (data) return true;
    } catch { /* try the next place */ }
  }
  setSpecData(null); return false;
}
export const specCount = () => (data ? Object.keys(data.specs).length : 0);

/** The spec for a signature item ({ _id or id, system.description }), or null. */
export function specForItem(item) {
  if (!data || !item) return null;
  const own = item.flags?.qin?.specKey;               // a skill taken from another officer remembers its spec
  const key = (own && data.specs[own] ? own : null) ?? data.byItem[item._id ?? item.id] ?? data.byText[textHash(normText(item.system?.description))];
  return key ? data.specs[key] ?? null : null;
}
/** The spec key for a signature item, or null (kept on a copy so it stays automated whatever its id). */
export function specKeyForItem(item) {
  if (!data || !item) return null;
  const own = item.flags?.qin?.specKey;
  return (own && data.specs[own] ? own : null) ?? data.byItem[item._id ?? item.id] ?? data.byText[textHash(normText(item.system?.description))] ?? null;
}
