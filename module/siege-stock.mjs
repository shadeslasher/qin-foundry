// Players' siege equipment stock (David, 2026-11-13): kept on each player's character (flag qin.siegeStock), at most
// their max unit count in all (the rtk13-map module's command limit; no cap without it). See battle/siege-deploy.mjs.
import { SYSTEM_ID } from "./config.mjs";
import { cleanStock, stockTotal, afterLosses, siegeLosses, SIEGE_KINDS, SIEGE_LABEL } from "./battle/siege-deploy.mjs";

export const STOCK_FLAG = "siegeStock";

/** The character a player's stock lives on (their assigned character). */
export const stockHolder = (user) => user?.character ?? null;
export const getStock = (user) => cleanStock(stockHolder(user)?.getFlag?.(SYSTEM_ID, STOCK_FLAG));
export async function setStock(user, stock) {
  const pc = stockHolder(user);
  if (!pc) throw new Error(`${user?.name ?? "That player"} has no character to keep siege equipment on.`);
  await pc.setFlag(SYSTEM_ID, STOCK_FLAG, cleanStock(stock));
}
/** Max unit count (the cap on the whole stock), or null when there's no cap. */
export function stockCap(user) {
  try { const c = game.modules.get("rtk13-map")?.api?.commandLimit?.(user), n = typeof c === "object" ? c?.limit : c; return n != null && Number.isFinite(Number(n)) ? Number(n) : null; } catch { return null; }
}
/** Every non-GM player's stock, by user id (the battle engine checks hand-outs against it). */
export function allStocks() {
  const out = {};
  for (const u of game.users ?? []) if (!u.isGM) out[u.id] = getStock(u);
  return out;
}

/** End of a battle (GM): take what was used out of each player's stock, and say so in chat. */
export async function settleSiegeLosses(battle, back) {
  const lost = siegeLosses(battle.siegeIssued ?? {}, back);
  const lines = [];
  for (const [uid, l] of Object.entries(lost)) {
    const user = game.users.get(uid); if (!user || !stockHolder(user)) continue;
    await setStock(user, afterLosses(getStock(user), l));
    lines.push(`<b>${foundry.utils.escapeHTML(user.name)}</b>: ${SIEGE_KINDS.filter(k => l[k]).map(k => `${l[k]} ${SIEGE_LABEL[k].toLowerCase()}`).join(", ")}`);
  }
  if (lines.length) ChatMessage.create({ content: `<p><b>Siege equipment used up in the battle</b></p><p>${lines.join("<br>")}</p>`, speaker: { alias: "Battle" } });
  return lost;
}

/**
 * One-time move (GM, on ready): ladders and engines that players' units carried as Equipment go into the owner's
 * stock (siege equipment no longer sits on units). Units nobody owns keep theirs (the GM's enemies).
 */
export async function migrateSiegeEquipment() {
  if (!game.user.isGM || game.users.activeGM?.id !== game.user.id) return;
  if (game.settings.get(SYSTEM_ID, "siegeStockMigrated")) return;
  const add = new Map();
  for (const a of game.actors.filter(a => a.type === "unit")) {
    const owner = game.users.find(u => !u.isGM && a.testUserPermission(u, "OWNER"));
    if (!owner) continue;
    const list = a._source?.system?.traitList ?? [];
    const siege = list.filter(e => e.equip && (e.name === "Siege Ladders" || e.name === "Siege Engine"));
    if (!siege.length) continue;
    const n = add.get(owner.id) ?? { ladders: 0, engine: 0, catapult: 0 };
    for (const e of siege) n[e.name === "Siege Ladders" ? "ladders" : "engine"]++;
    add.set(owner.id, n);
    await a.update({ "system.traitList": list.filter(e => !siege.includes(e)) });
  }
  for (const [uid, n] of add) {
    const user = game.users.get(uid);
    if (!stockHolder(user)) continue;
    const st = getStock(user);
    for (const k of SIEGE_KINDS) st[k] += n[k];
    await setStock(user, st);
  }
  await game.settings.set(SYSTEM_ID, "siegeStockMigrated", true);
  if (add.size) console.log("Qin | siege equipment moved into players' stock", Object.fromEntries(add));
}

export function registerSiegeStock() {
  game.settings.register(SYSTEM_ID, "siegeStockMigrated", { scope: "world", config: false, type: Boolean, default: false });
  Hooks.once("ready", () => migrateSiegeEquipment().catch(e => console.warn("Qin | moving siege equipment into stock", e)));
  // the rtk13-map shop and others: game.qinSiege
  game.qinSiege = { getStock, setStock, stockCap, stockTotal, allStocks };
}
