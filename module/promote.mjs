// Unit promotion tree (David, 2026-11-12). Built from the units themselves, no hand-made tree:
// - Branch: cavalry, ranged (mounted shooters side-grade with both, promote as cavalry), spear infantry (spear / ji / halberd units: weapon skill qiangshu) or blade infantry
//   (swords, sabres, axes, maces: every other infantry). Axe Band ↔ Sabre Militia, Spear Guards ↔ Ji Infantry.
// - Side-grade: same army, same branch, same tier; needs Level 2; keeps level and XP. Costs the price difference
//   half the new unit's recruitment cost (David, 2026-11-12).
// - Han units may also move into their faction's lord armies (not Mercenary, Imperial, Northern or frontier troops);
//   lord units may side-grade (not promote) into Han.
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


import { attachUnitHover, hideUnitHover } from "./unit-hover.mjs";
import { inService, armiesFor, RECRUIT_ARMIES } from "./recruit.mjs";
import { officerGrants, grantFor, VIA_FLAG } from "./officer-armies.mjs";
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
// Han units may also side-grade or promote into the lord armies of the player's faction (David, 2026-11-13), not into
// the place- or feature-bound groups below.
export const BRIDGE_FROM = "Han";
export const NO_BRIDGE = ["Han", "Mercenary", "Imperial", "Northern", "Qiang", "Xiliang", "Xiongnu", "Xianbei"];
/** The armies a Han unit may move into, from a list of the player's armies (pure). */
export const bridgeArmies = (groups) => (groups ?? []).filter(g => !NO_BRIDGE.includes(g));
// frontier local troops (David, 2026-11-13) promote into the next tier their group has in that branch, skipping a missing one
// (Xiongnu Cavalry T2 → the T4s)
export const LOCAL_GROUPS = ["Qiang", "Xiongnu", "Xianbei", "Xiliang"];
const upBranch = (from, t) => branchOf(t) === branchOf(from) || (isMountedShooter(t) && shareBranch(t, from));
function nextTier(from, t, list) {
  if (!LOCAL_GROUPS.includes(from.faction) || t.faction !== from.faction) return from.tier + 1;
  const tiers = list.filter(u => u.faction === from.faction && u.tier > from.tier && upBranch(from, u)).map(u => u.tier);
  return tiers.length ? Math.min(...tiers) : from.tier + 1;
}
// set promotion links across branches (David, 2026-11-13): [from, to, features]
export const LINKS = [["Qiang Warriors", "Qiang Raiders", ["pastures"]], ["Qiang Polearms", "Qiang Marauders", ["pastures"]]];
/** Can some other unit of its own group promote into t? (pure) Local troops that can are promotion only. */
export const promotedInto = (t, list) => list.some(u => u.faction === t.faction && u.tier < t.tier && u.name !== t.name
  && promotionPaths(u, list).some(p => p.kind === "promote" && p.t.name === t.name));
/** Armies whose units never side-grade or promote (David, 2026-11-13). */
export const FIXED_ARMIES = ["Mercenary", "Northern"];
/** Single units that stay what they are (one-of-a-kind, opened by a feature): War Elephants (found in testing 2026-11-13:
 *  they could side-grade into Han Tier 4 cavalry and so free the one-elephant slot). */
export const FIXED_UNITS = ["War Elephants"];
export function promotionPaths(from, list, ex = { add: new Set(), block: new Set() }, bridge = []) {
  if (FIXED_ARMIES.includes(from.faction) || FIXED_UNITS.includes(from.name)) return [];
  const key = (t) => `${from.name.toLowerCase()}>${t.name.toLowerCase()}`, out = [];
  for (const t of list) {
    if (t.name === from.name || !(t.cost > 0)) continue;
    if (ex.block.has(key(t))) continue;
    let kind = null;
    // side-grades: any shared branch (mounted shooters ↔ cavalry or ranged); promotions: the unit's own branch, or into
    // mounted shooters from ranged infantry too (David, 2026-11-12)
    // Tier 5 (Imperial) units don't side-grade (David, 2026-11-13)
    const side = t.tier === from.tier && from.tier < 5 && shareBranch(t, from);
    if (t.faction === from.faction || (from.faction === BRIDGE_FROM && bridge.includes(t.faction))) kind = side ? "side"
      : t.tier === nextTier(from, t, list) && upBranch(from, t) ? "promote" : null;
    // lord units may side-grade back into Han, never promote into it (David, 2026-11-13)
    else if (t.faction === BRIDGE_FROM && !NO_BRIDGE.includes(from.faction) && side) kind = "side";
    const link = LINKS.find(([a, b]) => a === from.name && b === t.name);
    if (!kind && link) kind = "promote";
    if (!kind && ex.add.has(key(t))) kind = t.tier > from.tier ? "promote" : "side";
    if (!kind) continue;
    const diff = Math.max(0, t.cost - (from.cost ?? 0));
    out.push({ t, kind, cost: kind === "side" ? Math.round(t.cost * SIDE_SHARE) : diff, needLevel: kind === "side" ? SIDE_LEVEL : PROMOTE_LEVEL,
      needFeatures: LINKS.find(([a, b]) => a === from.name && b === t.name)?.[2] ?? requiredFeatures(from, t, kind) });
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
export function promoteCheck({ level, coin, path, city = null, block = null, hasCharacter = true, taken = null }) {
  if (block) return { ok: false, reason: block };
  if (taken) return { ok: false, reason: `Already serving ${taken}` };
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
// promotions only in the party's own faction's city: a city where only mercenaries can be hired blocks them
const ownCity = (o) => o?.foreign ? { block: o.foreign.replace(/^.*?: only mercenaries can be hired here; /, "").replace(/^promotions need/, "Promotions need") } : o;
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

const bridgeFor = (user, opt) => bridgeArmies(opt && !opt.block ? opt.groups : armiesFor(user));
/** The Han bridge plus the armies the party's officers open (David, 2026-11-13: one unit per officer). */
async function bridgeWithOfficers(user, opt) {
  const base = bridgeFor(user, opt), grants = await officerGrants(RECRUIT_ARMIES);
  const have = opt && !opt.block ? opt.groups ?? [] : armiesFor(user);
  const extra = [...new Set(grants.flatMap(g => g.armies))].filter(a => !have.includes(a));
  return { bridge: [...new Set([...base, ...extra])], grants, extra };
}
const exceptions = () => { try { return parseExceptions(game.settings.get(SYSTEM_ID, "promotionExceptions")); } catch { return undefined; } };
async function context(actor) {
  const list = await templates(), from = currentOf(actor, list);
  const user = ownerOfUnit(actor), prov = provider(), opt = prov && user ? ownCity(await prov(user.id)) : null;
  const { bridge, grants, extra } = await bridgeWithOfficers(user, opt);
  return { list, from, paths: promotionPaths(from, list, exceptions(), bridge), user, opt, grants, extra };
}
/** A player's units for the Promote window: their own player-side units. */
export const unitsOf = (userId) => (game.actors?.contents ?? []).filter(a => a.type === "unit" && a.system?.side === "player" && ownerOfUnit(a)?.id === userId)
  .sort((a, b) => (b.system.tier ?? 0) - (a.system.tier ?? 0) || String(a.name).localeCompare(String(b.name)));
// what the city has for promotions
const cityFor = (opt) => opt && !opt.block ? { prosperity: opt.prosperity ?? 0, features: opt.featureKeys ?? [] } : null;

/** GM side: check again and turn the unit into the new one. */
async function promoteOnGM(requesterId, { actorId, uuid }) {
  const requester = game.users.get(requesterId), actor = game.actors.get(actorId);
  if (!actor || actor.type !== "unit") return { ok: false, error: "No such unit." };
  if (!requester?.isGM && !actor.testUserPermission(requester, "OWNER")) return { ok: false, error: "That isn't your unit." };
  const { from, paths, user, opt, grants, extra } = await context(actor);
  const path = paths.find(p => p.t.id === uuid);
  if (!path) return { ok: false, error: "This unit can't become that one." };
  const pc = user?.character;
  const chk = promoteCheck({ level: actor.system.level ?? 1, coin: pc?.system?.coin ?? 0, path, city: cityFor(opt), block: opt?.block ?? null, hasCharacter: !!pc, taken: inService(path.t, opt) });
  if (!chk.ok) return { ok: false, error: chk.reason };
  const src = await fromUuid(path.t.id); if (!src) return { ok: false, error: "That unit couldn't be found." };
  const n = src.toObject(), old = actor.system, oldName = actor.name;
  const share = old.men?.max ? (old.men.value ?? 0) / old.men.max : 1, max = n.system.men?.max ?? 75;
  const promote = path.kind === "promote";
  // the officer's mark (officer-armies.mjs): kept within the same army, set when moving into an army an officer opens
  // (then only he may lead it), dropped when leaving it
  const oldVia = actor.getFlag(SYSTEM_ID, VIA_FLAG) ?? null;
  const via = oldVia && path.t.faction === from.faction ? oldVia : extra.includes(path.t.faction) ? grantFor(path.t.faction, grants)?.uuid ?? null : null;
  if (via !== oldVia) await actor.update({ [`flags.${SYSTEM_ID}.${VIA_FLAG}`]: via });
  const system = { ...n.system, side: old.side, officer: via && old.officer !== via ? "" : old.officer, status: old.status, hidden: false,
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

const BRANCH_LABEL = (from) => branchesOf(from).map(b => BRANCH_NAMES[b]).join(" and ");

/** The Promote window for one player (David, 2026-11-12): every unit they own as a card, with Side-grade and Promote
 *  buttons at the bottom that open that unit's choices under the card. */
export class PromoteApp extends foundry.applications.api.ApplicationV2 {
  static #open = new Map();
  static DEFAULT_OPTIONS = {
    classes: ["qin", "qin-recruit", "qin-promote"],
    window: { title: "Promote", icon: "fa-solid fa-angles-up", resizable: true },
    position: { width: 440, height: 560 },
    actions: { go: PromoteApp.#go, info: PromoteApp.#info, show: PromoteApp.#show },
  };
  /** Open the window for a player; or, given a unit, for its owner with that unit's promotions open. */
  static open(id) {
    const actor = game.actors.get(id), userId = actor ? ownerOfUnit(actor)?.id : id;
    if (!userId) return ui.notifications.warn("No player owns this unit.");
    let app = this.#open.get(userId);
    if (!app) { app = new PromoteApp({ id: `qin-promote-${userId}` }); app.userId = userId; this.#open.set(userId, app); }
    if (actor) app.shown = { actorId: actor.id, kind: "promote" };
    app.render({ force: true });
    return app;
  }
  static refreshAll() { for (const app of this.#open.values()) if (app.rendered) app.render(); }
  get title() { return `Promote: ${game.users.get(this.userId)?.name ?? ""}`; }
  static async #info(event, target) { (await import("./unit-info.mjs")).openUnitInfoForActor(target.dataset.uuid); }
  static #show(event, target) {
    const { actorId, kind } = target.dataset;
    this.shown = this.shown?.actorId === actorId && this.shown?.kind === kind ? null : { actorId, kind };
    this.render();
  }
  static async #go(event, target) {
    const a = game.actors.get(target.dataset.actor), p = this.paths?.get(a?.id)?.find(x => x.t.id === target.dataset.uuid); if (!a || !p) return;
    const promote = p.kind === "promote";
    const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: promote ? "Promote" : "Side-grade" }, rejectClose: false,
      content: `<p>${esc(a.name)} becomes <b>${esc(p.t.name)}</b> (Tier ${p.t.tier})${p.cost ? ` for <b>${p.cost}</b> coin` : ""}.</p><p>${promote ? "It goes back to Level 1." : "It keeps its level and XP."} Trait choices start over; equipment stays.</p>` });
    if (!ok) return;
    target.disabled = true;
    const res = await requestPromote({ actorId: a.id, uuid: p.t.id });
    if (res?.ok) this.shown = null;
    this.render();
  }
  async _renderHTML() {
    const user = game.users.get(this.userId), pc = user?.character, coin = pc?.system?.coin ?? 0;
    const prov = provider(), opt = prov ? ownCity(await prov(this.userId)) : null, list = await templates(), ex = exceptions(), city = cityFor(opt);
    const units = unitsOf(this.userId), { bridge } = await bridgeWithOfficers(user, opt);
    this.paths = new Map();
    // layout A (David, 2026-11-12): a slim header, units as rows with a level bar and one status line; buttons only when usable
    const head = `<div class="qin-pr-head"><b>${esc(pc?.name ?? user?.name ?? "")}</b><span><i class="fa-solid fa-coins"></i> ${pc ? coin.toLocaleString() : "no character"}</span></div>
      ${opt ? `<div class="qin-pr-city">${opt.block ? esc(opt.block) : `${esc(opt.title)} · ${esc(opt.sub.replace(/^.*?city · /, ""))}`}</div>` : ""}`;
    if (!units.length) return `${head}<p class="qin-muted qin-pr-empty">${esc(user?.name ?? "This player")} has no units yet.</p>`;
    const short = (r) => r.replace(/^Already serving /, "Taken: ").replace(/^Needs (an? )?/, "").replace(/ here$/, "").replace(/ \(.*\)$/, "");
    const row = (a) => {
      const s = a.system, from = currentOf(a, list), level = s.level ?? 1, paths = promotionPaths(from, list, ex, bridge);
      this.paths.set(a.id, paths);
      const side = paths.filter(p => p.kind === "side"), up = paths.filter(p => p.kind === "promote");
      const hp = s.men?.max ? Math.round(100 * (s.men.value ?? 0) / s.men.max) : 100;
      const xpPct = level >= 5 ? 100 : Math.round(100 * ((level - 1) + (s.xp?.value ?? 0) / (s.xp?.max || 100)) / 4);
      const canSide = side.length && level >= SIDE_LEVEL, canUp = up.length && level >= PROMOTE_LEVEL;
      const goals = [!canSide && side.length && level < SIDE_LEVEL ? `side-grade at ${SIDE_LEVEL}` : "", !canUp && up.length && level < PROMOTE_LEVEL ? `promote at ${PROMOTE_LEVEL}` : ""].filter(Boolean);
      const status = `Level ${level} · ${goals.length ? goals.join(" · ") : `${hp}% health`}`;
      const shownKind = this.shown?.actorId === a.id ? this.shown.kind : null;
      const btn = (kind, label) => `<button type="button" class="${shownKind === kind ? "on" : ""}" data-action="show" data-actor-id="${a.id}" data-kind="${kind}">${label}${shownKind === kind ? ' <i class="fa-solid fa-chevron-up"></i>' : ""}</button>`;
      const choices = (shownKind === "side" ? side : shownKind === "promote" ? up : []).map(p => {
        const chk = promoteCheck({ level, coin, path: p, city, block: opt?.block ?? null, hasCharacter: !!pc, taken: inService(p.t, opt) });
        return `<div class="qin-pr-choice ${chk.ok ? "" : "off"}"><img src="${esc(p.t.img)}" alt="" data-unit-uuid="${esc(p.t.id)}">
          <span data-unit-uuid="${esc(p.t.id)}">${esc(p.t.name)} <small>T${p.t.tier}</small></span><span class="qin-pr-cost">${p.cost.toLocaleString()}</span>
          ${chk.ok ? `<button type="button" data-action="go" data-actor="${a.id}" data-uuid="${esc(p.t.id)}">${p.kind === "promote" ? "Promote" : "Side-grade"}</button>` : `<span class="qin-pr-why" data-tooltip="${esc(chk.reason)}">${esc(short(chk.reason))}</span>`}</div>`;
      }).join("");
      return `<div class="qin-pr-unit ${shownKind ? "open" : ""}">
        <div class="qin-pr-row"><img src="${esc(a.img)}" alt="" data-unit-uuid="${esc(a.uuid)}">
          <div class="qin-pr-mid"><div><span class="qin-pr-tier t${Math.min(5, s.tier)}">T${s.tier}</span><b data-unit-uuid="${esc(a.uuid)}">${esc(a.name)}</b> <span class="qin-muted">· ${esc(BRANCH_LABEL(from))}</span></div>
            <div class="qin-pr-bar"><i style="width:${xpPct}%"></i></div><div class="qin-muted qin-pr-status">${esc(status)}</div></div>
          <div class="qin-pr-acts">${canSide ? btn("side", "Side-grade") : ""}${canUp ? btn("promote", "Promote") : ""}</div></div>
        ${choices ? `<div class="qin-pr-choices">${choices}</div>` : ""}</div>`;
    };
    return `${head}<div class="qin-pr-list">${units.map(row).join("")}</div>`;
  }
  _replaceHTML(result, content) { hideUnitHover(); content.innerHTML = result; attachUnitHover(content); }
  _onClose(options) { hideUnitHover(); super._onClose?.(options); }
}

// refresh open Promote windows when units or coin change
if (globalThis.Hooks) for (const h of ["updateActor", "createActor", "deleteActor"]) Hooks.on(h, () => PromoteApp.refreshAll());
