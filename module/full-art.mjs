// Full-size character art (David, 2026-11-08): the whole-figure painting behind each officer's round token.
// Used by the battlefield-active banner and the sheet's "Full art" button (click to view, drag onto the map as a tile).
// The art is private (it ships with the characters module, not the system): modules/qin-3k-characters/data/full-art.json
// maps actor ids to image paths ({ version, byId: { actorId: path }, byName?: { name: path } }). A world copy of a
// compendium character finds its art through the compendium id it came from; a GM can also set any actor's full art
// by hand (right-click the button), stored in flags.qin.fullArt.
export const FULL_ART_PATHS = ["modules/qin-3k-characters/data/full-art.json", "qin-data/full-art.json"];
let map = null;

export function setFullArtMap(d) { map = d && (d.byId || d.byName) ? { byId: d.byId ?? {}, byName: d.byName ?? {} } : null; }
export async function loadFullArt(fetchFn = globalThis.fetch) {
  for (const path of FULL_ART_PATHS) {
    try {
      const r = await fetchFn(path + "?v=" + Date.now());
      if (!r.ok) continue;
      setFullArtMap(await r.json());
      if (map) return Object.keys(map.byId).length + Object.keys(map.byName).length;
    } catch { /* try the next place */ }
  }
  setFullArtMap(null); return 0;
}

/** The id at the end of a document uuid ("Compendium.x.y.Actor.abc" → "abc"). */
const lastId = (uuid) => (typeof uuid === "string" ? uuid.split(".").pop() : null);

/** The full art path for an actor (or plain { id, name, flags, _stats }), or null. Pure apart from the loaded map. */
export function fullArtFor(actor) {
  if (!actor) return null;
  const own = actor.flags?.qin?.fullArt;
  if (own) return own;
  if (!map) return null;
  const src = actor._stats?.compendiumSource ?? actor.flags?.core?.sourceId ?? null;
  return map.byId[actor.id ?? actor._id] ?? map.byId[lastId(src)] ?? map.byId[lastId(actor._stats?.duplicateSource)] ?? map.byName[actor.name] ?? null;
}
