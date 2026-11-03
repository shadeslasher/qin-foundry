// Health v2 (David, 2026-11-01): battle units have less health (100 → 75, 75 → 50, 50 → 40, 25 → 20) so fights end
// sooner. This brings the units already in the world into line once, keeping each unit's share of its health
// (a unit at 80/100 becomes 60/75). Run by the GM on load; remembered in a world setting.
import { SYSTEM_ID } from "./config.mjs";

export const HEALTH_V2 = { 100: 75, 75: 50, 50: 40, 25: 20 };
const KEY = "healthV2";

/** The new { value, max } for an old one, or null when it isn't one of the old sizes (pure, for tests). */
export function healthV2(men) {
  const max = Number(men?.max), to = HEALTH_V2[max];
  if (!to) return null;
  const value = Math.max(0, Math.min(to, Math.round((Number(men.value) || 0) * to / max)));
  return { value, max: to };
}

export function registerHealthV2() {
  game.settings.register(SYSTEM_ID, KEY, { scope: "world", config: false, type: Boolean, default: false });
  game.settings.register(SYSTEM_ID, KEY + "b", { scope: "world", config: false, type: Boolean, default: false });
  game.settings.register(SYSTEM_ID, KEY + "c", { scope: "world", config: false, type: Boolean, default: false });
  game.settings.register(SYSTEM_ID, "healthV3", { scope: "world", config: false, type: Boolean, default: false });
}

/**
 * Health v3 (David, 2026-11-03): health back up to 100 / 75 / 50 (cavalry 65) with re-tuned damage, pen and armor.
 * A compendium unit carries the stats it had before (flags.<module>.prevStats); a world copy moves by the same
 * difference, so level-ups stay, and keeps its share of health. Returns the update for a unit's system data, or null
 * (pure, for tests). `own` is the actor's system (or a token's delta.system); `tmpl` the compendium unit's system.
 */
export function healthV3Update(own, tmpl, prev, prefix = "system.") {
  if (!own || !tmpl || !prev) return null;
  const up = {};
  const men = own.men;
  if (men && Number(men.max) === Number(prev.health) && Number(tmpl.men?.max) > 0 && Number(tmpl.men.max) !== Number(men.max)) {
    const to = Number(tmpl.men.max);
    up[prefix + "men.max"] = to;
    up[prefix + "men.value"] = Math.max(0, Math.min(to, Math.round((Number(men.value) || 0) * to / Number(men.max))));
  }
  for (const k of ["damage", "armorPen", "armor"]) {
    if (own[k] === undefined || own[k] === null) continue;
    const d = (Number(tmpl[k]) || 0) - (Number(prev[k]) || 0);
    if (d) up[prefix + k] = Math.max(0, (Number(own[k]) || 0) + d);
  }
  // new traits the template starts with (War Elephants: Colossal)
  const list = own.traitList;
  if (Array.isArray(list) && list.length && Array.isArray(tmpl.traitList)) {
    const have = new Set(list.map(e => String(e.name).toLowerCase()));
    const add = tmpl.traitList.filter(e => /^colossal$/i.test(e.name) && !have.has("colossal"));
    if (add.length) up[prefix + "traitList"] = [...structuredClone(add), ...list];
  }
  return Object.keys(up).length ? up : null;
}

async function migrateHealthV3() {
  if (game.settings.get(SYSTEM_ID, "healthV3")) return;
  const tmpl = new Map();
  for (const pack of game.packs ?? []) {
    if (pack.documentName !== "Actor") continue;
    let index; try { index = await pack.getIndex({ fields: ["type", "flags", "system.men", "system.damage", "system.armorPen", "system.armor", "system.traitList"] }); } catch { continue; }
    for (const e of index) {
      if (e.type !== "unit") continue;
      const prev = Object.values(e.flags ?? {}).map(f => f?.prevStats).find(p => p?.v === 3);
      if (prev && !tmpl.has(e.name)) tmpl.set(e.name, { sys: e.system, prev });
    }
  }
  if (!tmpl.size) return; // the unit pack isn't installed or isn't updated yet: try again next load
  let n = 0;
  const up = [];
  for (const a of game.actors) {
    if (a.type !== "unit") continue;
    const t = tmpl.get(a.name); if (!t) continue;
    const row = healthV3Update(a.system._source ?? a._source.system, t.sys, t.prev);
    if (row) up.push({ _id: a.id, ...row });
  }
  if (up.length) { await Actor.updateDocuments(up); n += up.length; }
  for (const scene of game.scenes) {
    const tu = [];
    for (const tok of scene.tokens) {
      if (tok.actorLink || tok.actor?.type !== "unit") continue;
      const base = game.actors.get(tok.actorId); const t = tmpl.get(base?.name ?? tok.actor?.name); if (!t) continue;
      const own = foundry.utils.getProperty(tok._source ?? tok, "delta.system"); if (!own) continue;
      const row = healthV3Update(own, t.sys, t.prev, "delta.system.");
      if (row) tu.push({ _id: tok.id, ...row });
    }
    if (tu.length) { try { await scene.updateEmbeddedDocuments("Token", tu, { qinBattle: true }); n += tu.length; } catch (e) { console.warn("Qin | health v3 tokens", scene.name, e); } }
  }
  await game.settings.set(SYSTEM_ID, "healthV3", true);
  if (n) ui.notifications.info(`Battle units now use the new health (100 / 75 / 50, cavalry 65) and re-tuned stats: ${n} unit${n === 1 ? "" : "s"} updated.`);
}

/** Damage and armor pen +1 for every battle unit (David, 2026-11-01), once, for units already in the world. */
async function damagePenUp() {
  if (game.settings.get(SYSTEM_ID, KEY + "c")) return;
  let n = 0;
  const up = [];
  for (const a of game.actors) if (a.type === "unit") up.push({ _id: a.id, "system.damage": (Number(a.system.damage) || 0) + 1, "system.armorPen": (Number(a.system.armorPen) || 0) + 1 });
  if (up.length) { await Actor.updateDocuments(up); n += up.length; }
  for (const scene of game.scenes) {
    const tu = [];
    for (const t of scene.tokens) {
      if (t.actorLink || t.actor?.type !== "unit") continue;
      const d = foundry.utils.getProperty(t, "delta.system.damage"), p = foundry.utils.getProperty(t, "delta.system.armorPen");
      const row = { _id: t.id };
      if (d !== undefined) row["delta.system.damage"] = (Number(d) || 0) + 1;
      if (p !== undefined) row["delta.system.armorPen"] = (Number(p) || 0) + 1;
      if (Object.keys(row).length > 1) tu.push(row);
    }
    if (tu.length) { try { await scene.updateEmbeddedDocuments("Token", tu, { qinBattle: true }); } catch (e) { console.warn("Qin | damage +1 tokens", e); } }
  }
  await game.settings.set(SYSTEM_ID, KEY + "c", true);
  if (n) ui.notifications.info(`Battle units now hit harder (damage and armor pen +1): ${n} unit${n === 1 ? "" : "s"} updated.`);
}

/** Protectors of Heaven: 60 → 50 health (David, 2026-11-01), once, keeping the share left. */
async function protectorsTo50() {
  if (game.settings.get(SYSTEM_ID, KEY + "b")) return;
  const fix = (men) => (Number(men?.max) === 60 ? { value: Math.max(0, Math.min(50, Math.round((Number(men.value) || 0) * 50 / 60))), max: 50 } : null);
  const up = [];
  for (const a of game.actors) if (a.type === "unit" && a.name === "Protectors of Heaven") { const to = fix(a.system.men); if (to) up.push({ _id: a.id, "system.men.value": to.value, "system.men.max": to.max }); }
  if (up.length) await Actor.updateDocuments(up);
  for (const scene of game.scenes) {
    const tu = [];
    for (const t of scene.tokens) {
      if (t.actorLink || t.actor?.name !== "Protectors of Heaven") continue;
      const own = foundry.utils.getProperty(t, "delta.system.men"); const to = own ? fix(own) : null;
      if (to) tu.push({ _id: t.id, "delta.system.men.value": to.value, "delta.system.men.max": to.max });
    }
    if (tu.length) { try { await scene.updateEmbeddedDocuments("Token", tu, { qinBattle: true }); } catch (e) { console.warn("Qin | Protectors health", e); } }
  }
  await game.settings.set(SYSTEM_ID, KEY + "b", true);
}

export async function migrateHealthV2() {
  if (!game.user.isGM) return;
  if (game.users.activeGM && game.users.activeGM !== game.user) return;
  await protectorsTo50();
  await damagePenUp();
  if (!game.settings.get(SYSTEM_ID, KEY)) await healthV2Units();
  await migrateHealthV3();
}

async function healthV2Units() {
  let n = 0;
  const updates = [];
  for (const a of game.actors) {
    if (a.type !== "unit") continue;
    const to = healthV2(a.system.men);
    if (to) updates.push({ _id: a.id, "system.men.value": to.value, "system.men.max": to.max });
  }
  if (updates.length) { await Actor.updateDocuments(updates); n += updates.length; }
  // unlinked unit tokens that keep their own health
  for (const scene of game.scenes) {
    const tu = [];
    for (const t of scene.tokens) {
      if (t.actorLink || t.actor?.type !== "unit") continue;
      const own = foundry.utils.getProperty(t, "delta.system.men");
      if (!own || own.max === undefined) continue;
      const to = healthV2(own);
      if (to) tu.push({ _id: t.id, "delta.system.men.value": to.value, "delta.system.men.max": to.max });
    }
    if (tu.length) { try { await scene.updateEmbeddedDocuments("Token", tu, { qinBattle: true }); n += tu.length; } catch (e) { console.warn("Qin | health v2 tokens", scene.name, e); } }
  }
  await game.settings.set(SYSTEM_ID, KEY, true);
  if (n) ui.notifications.info(`Battle units now use the lower health (100 → 75, 75 → 50, 50 → 40): ${n} unit${n === 1 ? "" : "s"} updated.`);
}
