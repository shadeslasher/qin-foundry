// Unit promotion tree (David, 2026-11-12). Built from the units themselves, no hand-made tree:
// - Branch: cavalry, ranged (mounted shooters side-grade with both, promote as cavalry), spear infantry (spear / ji / halberd units: weapon skill qiangshu) or blade infantry
//   (swords, sabres, axes, maces: every other infantry). Axe Band ↔ Sabre Militia, Spear Guards ↔ Ji Infantry.
// - Side-grade: same army, same branch, same tier; needs Level 2; keeps level and XP. Costs the price difference
//   half the new unit's recruitment cost (David, 2026-11-12).
// - Promote: same army, same branch, next tier; needs Level 4; back to Level 1. Costs the price difference.
// - Only in a city of the player's own faction (the world map's recruitOptions), when the world map module is active;
//   otherwise anywhere. A promotion also needs the branch's feature in that city, at any Prosperity (David, 2026-11-12;
//   first version also needed Low/Mid/High for Tier 2/3/4). Spear infantry: Armorsmith; blade infantry: Weaponsmith; ranged: Fletcher;
//   cavalry: Horse Pastures; mounted shooters: Pastures or Fletcher; infantry that also shoots: its own or a Fletcher.
//   Side-grades need no feature.
// - The GM can add or block single paths in the setting "Promotion exceptions" (lines "A > B" add, "!A > B" block).
// The unit keeps its name (unless it was just the unit's type name), owner, officer, side, equipment (a Saddle or
// Fine Arrows it can no longer use is dropped), and its health as a share; trait choices start over.
import { SYSTEM_ID } from "./config.mjs";
import { templates } from "./new-unit.mjs";


const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");
const QUERY = `${SYSTEM_ID}.promote`;
export const SIDE_SHARE = 0.5, SIDE_LEVEL = 2, PROMOTE_LEVEL = 4;
export const BRANCH_NAMES = { cavalry: "Cavalry", ranged: "Ranged", spear: "Spear infantry", blade: "Blade infantry" };

/** A unit's branch (pure): cavalry, ranged, spear or blade. */
export function branchOf(t) {
  if (t.category === "cavalry" || t.category === "ranged") return t.category;
  return t.weaponSkill === "qiangshu" ? "spear" : "blade";
}
/** Its branches for side-grades (pure): mounted shooters (cavalry with range 2+: Mounted Archers, Mounted Crossbows, Heavy
 *  Mounted Archers…) side-grade with both Cavalry and Ranged of their tier; they promote as cavalry (David, 2026-11-12). */
export function branchesOf(t) {
  return t.category === "cavalry" && (t.range ?? 1) > 1 ? ["cavalry", "ranged"] : [branchOf(t)];
}
export const isMountedShooter = (t) => t.category === "cavalry" && (t.range ?? 1) > 1;
const shareBranch = (a, b) => branchesOf(a).some(x => branchesOf(b).includes(x));

/** "A > B" adds, "!A > B" blocks (pure). Returns { add: Set, block: Set } of "a>b" keys (lower case). */
export function parseExceptions(text) {
  const add = new Set(), block = new Set();
  for (const raw of String(text ?? "").split(/\n|;/)) {
    const line = raw.trim(); if (!line.includes(">")) continue;
    const neg = line.startsWith("!"), [a, b] = line.replace(/^!/, "").split(">").map(x => x.trim().toLowerCase());
    if (a && b) (neg ? block : add).add(`${a}>${b}`);
  }
  return { add, block };
}

/**
 * Where a unit may go (pure). from = the unit's current template-like record { name, faction, tier, category, weaponSkill, cost },
 * level = its level, list = all templates, ex = parseExceptions(...).
 * Returns [{ t, kind: "side"|"promote", cost, needLevel }] sorted by kind, tier, cost.
 */
export function promotionPaths(from, list, ex = { add: new Set(), block: new Set() }) {
  const key = (t) => `${from.name.toLowerCase()}>${t.name.toLowerCase()}`, out = [];
  for (const t of list) {
    if (t.name === from.name || !(t.cost > 0)) continue;
    if (ex.block.has(key(t))) continue;
    let kind = null;
    // side-grades: any shared branch (mounted shooters ↔ cavalry or ranged); promotions: the unit's own branch, or into
    // mounted shooters from ranged infantry too (David, 2026-11-12)
    if (t.faction === from.faction) kind = t.tier === from.tier && shareBranch(t, from) ? "side"
      : t.tier === from.tier + 1 && (branchOf(t) === branchOf(from) || (isMountedShooter(t) && shareBranch(t, from))) ? "promote" : null;
    if (!kind && ex.add.has(key(t))) kind = t.tier > from.tier ? "promote" : "side";
    if (!kind) continue;
    const diff = Math.max(0, t.cost - (from.cost ?? 0));
    out.push({ t, kind, cost: kind === "side" ? Math.round(t.cost * SIDE_SHARE) : diff, needLevel: kind === "side" ? SIDE_LEVEL : PROMOTE_LEVEL,
      needFeatures: requiredFeatures(from, t, kind) });
  }
  // the same unit can sit in several packs: keep one per name
  const seen = new Set();
  return out.filter(p => !seen.has(p.t.name) && seen.add(p.t.name))
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "side" ? -1 : 1) || a.t.tier - b.t.tier || a.cost - b.cost || a.t.name.localeCompare(b.t.name));
}

/** "a Weaponsmith", "an Armorsmith or Fletcher", "Horse Pastures" (pure). */
export const withArticle = (names) => /^Horse/.test(names) ? names : `${/^[AEIOU]/.test(names) ? "an" : "a"} ${names}`;
export const FEATURE_NAMES = { weaponsmith: "Weaponsmith", armorsmith: "Armorsmith", fletcher: "Fletcher", pastures: "Horse Pastures" };
const BRANCH_FEATURE = { spear: "armorsmith", blade: "weaponsmith", ranged: "fletcher", cavalry: "pastures" };
const PROSPERITY = ["Ruins", "Low", "Mid", "High"];
/** The city features any one of which lets a unit be promoted into t (pure). */
export function neededFeatures(t) {
  const own = BRANCH_FEATURE[branchOf(t)];
  return (t.range ?? 1) > 1 && own !== "fletcher" ? [own, "fletcher"] : [own];
}
/**
 * The city features (any one of them) a move needs (pure). Into mounted shooters (David, 2026-11-12): from foot ranged
 * units Horse Pastures, from melee cavalry a Fletcher, from mounted shooters either. Other promotions: the new unit's
 * feature; other side-grades: none.
 */
export function requiredFeatures(from, t, kind) {
  if (isMountedShooter(t)) {
    if (isMountedShooter(from)) return ["pastures", "fletcher"];
    if (from.category === "cavalry") return ["fletcher"];
    if (from.category === "ranged" || (from.range ?? 1) > 1) return ["pastures"];
  }
  return kind === "promote" ? neededFeatures(t) : [];
}
/** The Prosperity a city needs to promote into this tier (pure): Tier 2 Low, 3 Mid, 4 High. */
export const minProsperity = (tier) => Math.max(1, tier - 1);

/** May this path be taken now? { ok, reason } (pure). city = { prosperity, features: [keys] } or null (no city rules). */
export function promoteCheck({ level, coin, path, city = null, block = null, hasCharacter = true }) {
  if (block) return { ok: false, reason: block };
  if (!hasCharacter) return { ok: false, reason: "No character to pay." };
  if (level < path.needLevel) return { ok: false, reason: `Needs Level ${path.needLevel}` };
  if (city) {
    // the move's feature in the city, at any Prosperity (David, 2026-11-12: "promotion only needs the feature")
    if (path.kind === "promote" && path.t.tier >= 5) return { ok: false, reason: "Can't be trained by promotion" };
    const need = path.needFeatures ?? (path.kind === "promote" ? neededFeatures(path.t) : []);
    if (need.length && !need.some(k => (city.features ?? []).includes(k))) return { ok: false, reason: `Needs ${withArticle(need.map(k => FEATURE_NAMES[k] ?? k).join(" or "))} here` };
  }
  if (coin < path.cost) return { ok: false, reason: `Not enough coin (${coin} of ${path.cost})` };
  return { ok: true, reason: "" };
}

/** Equipment that stays with the new unit (pure): drop a Saddle on non-cavalry and Fine Arrows on units that don't shoot. */
export function keptEquipment(traitList, t) {
  return (traitList ?? []).filter(e => e.equip && !(/^saddle/i.test(e.name) && t.category !== "cavalry") && !(/^fine arrows/i.test(e.name) && (t.range ?? 1) <= 1));
}

// ---------------------------------------------------------------- Foundry side
const provider = () => game.modules?.get?.("rtk13-map")?.active ? game.modules.get("rtk13-map").api?.recruitOptions ?? null : null;
const ownerOfUnit = (a) => game.users.find(u => !u.isGM && a.ownership?.[u.id] === CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER) ?? null;

/** The unit's current template record: its own template flag, else the compendium unit of the same name. */
function currentOf(actor, list) {
  const uuid = actor.getFlag(SYSTEM_ID, "template"), s = actor.system;
  const byFlag = uuid && list.find(t => t.id === uuid);
  const byName = list.find(t => t.name === actor.name) ?? list.find(t => t.name === s.unitType);
  const base = byFlag ?? byName;
  return { name: base?.name ?? actor.name, faction: base?.faction ?? "Other", tier: s.tier, category: s.category, weaponSkill: s.weaponSkill, cost: s.cost, range: s.range };
}

async function context(actor) {
  const list = await templates(), from = currentOf(actor, list);
  let ex; try { ex = parseExceptions(game.settings.get(SYSTEM_ID, "promotionExceptions")); } catch { ex = undefined; }
  const user = ownerOfUnit(actor), prov = provider(), opt = prov && user ? await prov(user.id) : null;
  return { list, from, paths: promotionPaths(from, list, ex), user, opt };
}
// what the city has for promotions
const cityFor = (opt) => opt && !opt.block ? { prosperity: opt.prosperity ?? 0, features: opt.featureKeys ?? [] } : null;

/** GM side: check again and turn the unit into the new one. */
async function promoteOnGM(requesterId, { actorId, uuid }) {
  const requester = game.users.get(requesterId), actor = game.actors.get(actorId);
  if (!actor || actor.type !== "unit") return { ok: false, error: "No such unit." };
  if (!requester?.isGM && !actor.testUserPermission(requester, "OWNER")) return { ok: false, error: "That isn't your unit." };
  const { from, paths, user, opt } = await context(actor);
  const path = paths.find(p => p.t.id === uuid);
  if (!path) return { ok: false, error: "This unit can't become that one." };
  const pc = user?.character;
  const chk = promoteCheck({ level: actor.system.level ?? 1, coin: pc?.system?.coin ?? 0, path, city: cityFor(opt), block: opt?.block ?? null, hasCharacter: !!pc });
  if (!chk.ok) return { ok: false, error: chk.reason };
  const src = await fromUuid(path.t.id); if (!src) return { ok: false, error: "That unit couldn't be found." };
  const n = src.toObject(), old = actor.system, oldName = actor.name;
  const share = old.men?.max ? (old.men.value ?? 0) / old.men.max : 1, max = n.system.men?.max ?? 75;
  const promote = path.kind === "promote";
  const system = { ...n.system, side: old.side, officer: old.officer, status: old.status, hidden: false,
    men: { max, value: Math.max(1, Math.round(max * share)) }, morale: old.morale,
    level: promote ? 1 : old.level, xp: promote ? { value: 0, max: old.xp?.max ?? 100 } : old.xp,
    traitList: [...(n.system.traitList ?? []), ...keptEquipment(old.traitList, path.t)] };
  const renamed = oldName !== from.name && oldName !== old.unitType;   // a name the player gave it stays
  const name = renamed ? oldName : n.name, img = n.img, tex = n.prototypeToken?.texture?.src || img;
  await actor.update({ system }, { recursive: false });
  await actor.update({ name, img, "prototypeToken.name": name, "prototypeToken.texture.src": tex, [`flags.${SYSTEM_ID}.template`]: path.t.id });
  for (const sc of game.scenes) for (const tk of sc.tokens.filter(t => t.actorId === actor.id && t.actorLink)) await tk.update({ name, "texture.src": tex });
  if (path.cost) await pc.update({ "system.coin": Math.max(0, (pc.system.coin ?? 0) - path.cost) });
  const where = opt && !opt.block ? ` at ${esc(opt.title)}` : "";
  await ChatMessage.create({ content: `<p><b>${esc(oldName)}</b> ${promote ? "is promoted to" : "retrains as"} <b>${esc(path.t.name)}</b>${where}${path.cost ? ` for ${path.cost} coin` : ""}.</p>`, speaker: { alias: pc?.name ?? game.user.name } });
  return { ok: true, name: path.t.name };
}

export function registerPromoteQuery() {
  CONFIG.queries[QUERY] = async ({ requesterId, data }) => promoteOnGM(requesterId, data);
  game.settings.register(SYSTEM_ID, "promotionExceptions", { name: "Promotion exceptions",
    hint: "Extra or blocked unit promotions, one per line or separated by ;. \"Axe Band > Ji Militia\" adds a path, \"!Axe Band > Sabre Militia\" blocks one.",
    scope: "world", config: true, type: String, default: "" });
}

async function requestPromote(data) {
  let res;
  if (game.user.isGM) res = await promoteOnGM(game.user.id, data);
  else {
    const gm = game.users.activeGM;
    if (!gm) return ui.notifications.warn("The GM needs to be connected to promote units.");
    try { res = await gm.query(QUERY, { requesterId: game.user.id, data }, { timeout: 30000 }); } catch (e) { res = { ok: false, error: e.message }; }
  }
  if (!res?.ok) ui.notifications.warn(res?.error ?? "Promotion failed.");
  else ui.notifications.info(`Now ${res.name}.`);
  return res;
}

/** The Promote window for one unit. */
export class PromoteApp extends foundry.applications.api.ApplicationV2 {
  static #open = new Map();
  static DEFAULT_OPTIONS = {
    classes: ["qin", "qin-recruit", "qin-promote"],
    window: { title: "Promote", icon: "fa-solid fa-angles-up", resizable: true },
    position: { width: 430, height: 560 },
    actions: { go: PromoteApp.#go, info: PromoteApp.#info },
  };
  static open(actorId) {
    let app = this.#open.get(actorId);
    if (!app) { app = new PromoteApp({ id: `qin-promote-${actorId}` }); app.actorId = actorId; this.#open.set(actorId, app); }
    app.render({ force: true });
    return app;
  }
  static refreshAll() { for (const app of this.#open.values()) if (app.rendered) app.render(); }
  get title() { return `Promote: ${game.actors.get(this.actorId)?.name ?? ""}`; }
  static async #info(event, target) { (await import("./unit-info.mjs")).openUnitInfoForActor(target.dataset.uuid); }
  static async #go(event, target) {
    const p = this.paths?.find(x => x.t.id === target.dataset.uuid); if (!p) return;
    const a = game.actors.get(this.actorId), promote = p.kind === "promote";
    const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: promote ? "Promote" : "Side-grade" }, rejectClose: false,
      content: `<p>${esc(a.name)} becomes <b>${esc(p.t.name)}</b> (Tier ${p.t.tier})${p.cost ? ` for <b>${p.cost}</b> coin` : ""}.</p><p>${promote ? "It goes back to Level 1." : "It keeps its level and XP."} Trait choices start over; equipment stays.</p>` });
    if (!ok) return;
    target.disabled = true;
    await requestPromote({ actorId: this.actorId, uuid: p.t.id });
    this.render();
  }
  async _renderHTML() {
    const a = game.actors.get(this.actorId); if (!a) return `<p class="qin-muted">That unit is gone.</p>`;
    const { from, paths, user, opt } = await context(a);
    this.paths = paths;
    const s = a.system, pc = user?.character, coin = pc?.system?.coin ?? 0, level = s.level ?? 1;
    const head = `<div class="qin-recruit-city"><span class="qin-party-tag tier t${Math.min(5, s.tier)}">T${s.tier}</span> <b>${esc(a.name)}</b> · ${esc(from.faction)} · ${branchesOf(from).map(b => esc(BRANCH_NAMES[b])).join(" and ")} <span style="float:right">Level ${level}</span>
      <div class="qin-muted">${opt ? (opt.block ? esc(opt.block) : `At ${esc(opt.sub)}`) : ""}${pc ? ` · <i class="fa-solid fa-coins"></i> ${coin} coin` : user ? "" : " · no player owns this unit"}</div></div>`;
    const row = (p) => {
      const chk = promoteCheck({ level, coin, path: p, city: cityFor(opt), block: opt?.block ?? null, hasCharacter: !!pc });
      return `<li class="${chk.ok ? "" : "off"}"><img src="${esc(p.t.img)}" alt="" data-action="info" data-uuid="${esc(p.t.id)}"><span class="qin-party-tag tier t${Math.min(5, p.t.tier)}">T${p.t.tier}</span>
        <a class="nm" data-action="info" data-uuid="${esc(p.t.id)}" data-tooltip="Show this unit's details">${esc(p.t.name)}</a><span class="cost"><i class="fa-solid fa-coins"></i> ${p.cost}</span>
        ${chk.ok ? `<button type="button" data-action="go" data-uuid="${esc(p.t.id)}">${p.kind === "promote" ? "Promote" : "Side-grade"}</button>` : `<span class="qin-recruit-why">${esc(chk.reason)}</span>`}</li>`;
    };
    const side = paths.filter(p => p.kind === "side"), up = paths.filter(p => p.kind === "promote");
    const sec = (h, ps) => ps.length ? `<h4>${h}</h4><ul>${ps.map(row).join("")}</ul>` : "";
    const body = sec(`Side-grade (Tier ${s.tier}, needs Level ${SIDE_LEVEL}) · keeps level`, side) + sec(`Promote to Tier ${s.tier + 1} (needs Level ${PROMOTE_LEVEL}) · back to Level 1`, up);
    return `${head}<div class="qin-recruit-list">${body || `<p class="qin-muted">No side-grades or promotions for this unit.</p>`}</div>
      <p class="qin-muted" style="font-size:11px">Keeps its name, officer, equipment and its health as a share. Trait choices start over.</p>`;
  }
  _replaceHTML(result, content) { content.innerHTML = result; }
}
