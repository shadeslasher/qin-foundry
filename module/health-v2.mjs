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
  if (game.settings.get(SYSTEM_ID, KEY)) return;
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
