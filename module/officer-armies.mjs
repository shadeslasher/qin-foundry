// Officers open their old lord's army (David, 2026-11-13): a party officer whose home faction has its own army (Luo Jun:
// Liu Chong) lets the party get ONE unit of that army — by recruiting, or by promoting / side-grading a Han unit into it —
// under the normal rules (the party's own faction's city, Prosperity, features). The unit is marked with the officer
// (flag viaOfficer = his uuid) and only he can lead it; he can still lead other units. The slot is free again once no
// serving unit carries his mark. Han, Mercenary, Imperial, Northern and frontier troops are never opened this way.
// Home faction: the GM's flag homeFaction on the officer, else the compendium folder he comes from ("Characters / Liu
// Chong" → Liu Chong), else the faction the Officers window filed him under.
import { SYSTEM_ID } from "./config.mjs";

export const VIA_FLAG = "viaOfficer";
// folder names that aren't army names
export const HOME_ALIASES = { Shu: ["Liu Bei"], "Yuan Shao": ["Song"], "Zhang Yan": ["Bandits"], "Cao Cao": ["Cao Cao", "Wei"], Wei: ["Wei", "Cao Cao"], "Dong Zhuo": ["Lu Bu"] };
export const NEVER = ["Han", "Mercenary", "Imperial", "Northern", "Qiang", "Xiliang", "Xiongnu", "Xianbei"];

/** The armies a home faction opens (pure). known = the army names that exist. */
export function homeArmies(home, known) {
  if (!home) return [];
  return (HOME_ALIASES[home] ?? [home]).filter(a => known.includes(a) && !NEVER.includes(a));
}

/** Free grants (pure): officers = [{ uuid, name, armies }], units = [{ via }]. An officer whose mark is on a unit has none left. */
export function freeGrants(officers, units) {
  const used = new Set(units.map(u => u.via).filter(Boolean));
  return officers.filter(o => o.armies.length && !used.has(o.uuid));
}

/** The officer's home faction name (async: may read the compendium's folders). */
export async function homeOf(off) {
  const own = off.getFlag?.(SYSTEM_ID, "homeFaction"); if (own) return own;
  const src = off.getFlag?.(SYSTEM_ID, "codexOf") || off.getFlag?.(SYSTEM_ID, "officerOf");
  if (String(src ?? "").startsWith("Compendium.")) {
    try {
      const { collection, id } = foundry.utils.parseUuid(src), pack = game.packs.get(collection);
      const idx = (await pack.getIndex({ fields: ["folder"] })).get(id);
      const path = []; let f = idx?.folder ? pack.folders.get(idx.folder) : null;
      while (f) { path.unshift(f.name); f = f.folder; }
      if (path.length >= 2 && !/^minor/i.test(path[0])) return path[1];
    } catch { /* fall through */ }
  }
  return off.getFlag?.(SYSTEM_ID, "codexFaction") || "";
}

/** The party officers' open grants: [{ uuid, name, armies }] (only officers whose unit isn't serving yet). */
export async function officerGrants(known) {
  const { partyOfficers } = await import("./officer-codex.mjs");
  const offs = [];
  for (const o of partyOfficers()) offs.push({ uuid: o.uuid, name: o.name, armies: homeArmies(await homeOf(o), known) });
  const units = (game.actors?.contents ?? []).filter(a => a.type === "unit").map(a => ({ via: a.getFlag(SYSTEM_ID, VIA_FLAG) }));
  return freeGrants(offs, units);
}
/** The officer whose grant covers this army (first one), or null (pure). */
export const grantFor = (army, grants) => grants.find(g => g.armies.includes(army)) ?? null;
