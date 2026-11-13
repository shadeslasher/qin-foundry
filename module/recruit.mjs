// Recruiting units with coin (from the Party panel). A player spends their character's coin on a battle unit
// from the compendium. The GM's client does the work (players can't create actors), through a query.
// Where and what: when a world-map module offers recruitOptions (rtk13-map: the city the party is in, its owner's army,
// Prosperity tier caps and feature bonuses; David, 2026-11-12) that decides; otherwise the armies the GM picks per player.
import { budgetOf, setBudget, budgetHtml } from "./budget.mjs";
import { SYSTEM_ID } from "./config.mjs";
import { templates, createUnit } from "./new-unit.mjs";
import { promotedInto, neededFeatures, FEATURE_NAMES, withArticle, branchOf } from "./promote.mjs";

import { attachUnitHover, hideUnitHover } from "./unit-hover.mjs";
import { officerGrants, grantFor, VIA_FLAG } from "./officer-armies.mjs";
/** Add the party officers' open armies to city options or an army list (David, 2026-11-13). */
async function withOfficers(opt, armies = []) {
  const grants = await officerGrants(RECRUIT_ARMIES), have = opt && !opt.block ? opt.groups ?? [] : armies;
  const extra = opt?.foreign || opt?.alliedCity ? [] : [...new Set(grants.flatMap(g => g.armies))].filter(a => !have.includes(a));
  if (opt && !opt.block) opt.officerArmies = extra;
  return { grants, extra };
}
const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");
export const RECRUIT_ARMIES = ["Han", "Bandits", "Yellow Turbans", "Qiang", "Northern", "Cao Cao", "Wei", "Xiongnu", "Xianbei", "Song", "Xiliang", "Mercenary", "Wu", "Yuan Shu", "Gongsun Zan", "Lu Bu", "Liu Bei", "Liu Biao", "Liu Yan", "Kong Rong", "Tao Qian", "Lu Zhi", "Yan Baihu", "Liu Chong", "Nanman", "Imperial"];
export const ARMIES_FLAG = "recruitArmies";
const QUERY = `${SYSTEM_ID}.recruit`;
const TYPES = [["infantry", "Infantry"], ["ranged", "Ranged Infantry"], ["cavalry", "Cavalry"]];

/** The armies a player may recruit from (none until the GM picks some). */
export const armiesFor = (user) => (user?.getFlag?.(SYSTEM_ID, ARMIES_FLAG) ?? []).filter(a => RECRUIT_ARMIES.includes(a));

/** The world map's recruitment rules, if a module provides them: async (userId) → options (see rtk13-map recruit.js). */
const provider = () => game.modules?.get?.("rtk13-map")?.active ? game.modules.get("rtk13-map").api?.recruitOptions ?? null : null;
export const cityRecruiting = () => !!provider();

/** Is this unit offered by these city options, and its tier cap there (pure). Hybrids (range 2+) use their best type. */
export function cityOffer(t, opt, list = null) {
  // units opened by a city feature (Elephant Grounds → War Elephants, David 2026-11-13): any owner, no cap, no other feature
  if ((opt.specialUnits ?? []).includes(t.name)) return { offered: true, cap: 99 };
  // mercenaries (David, 2026-11-13): any city, no feature, no tier cap; limited per city by its Prosperity (see hireLimit)
  if ((opt.mercenary ?? []).includes(t.faction)) return { offered: true, cap: 99, missing: null };
  const local = (opt.local ?? []).includes(t.name);
  const offered = (opt.groups ?? []).includes(t.faction) || (opt.officerArmies ?? []).includes(t.faction) || local;
  if (!offered) return { offered: false, cap: 0 };
  // local troops (David, 2026-11-13): any Prosperity, but only the lowest tier of each chain; the rest come by promotion
  if (local) return { offered: true, cap: 99, missing: null, promoteOnly: !!list && promotedInto(t, list) };
  if ((opt.uncapped ?? []).includes(t.faction)) return { offered: true, cap: 99 };
  const types = [t.category in (opt.caps ?? {}) ? t.category : "infantry", ...((t.range ?? 1) > 1 ? ["ranged"] : [])];
  const cap = Math.max(...types.map(k => opt.caps?.[k] ?? 0));
  // above Tier 1 the city also needs the unit's feature, as for promotions (David, 2026-11-12); local troops come trained
  let missing = null;
  if (Array.isArray(opt.featureKeys) && (t.tier ?? 1) > 1 && !local) {
    const need = neededFeatures(t);
    if (!need.some(k => opt.featureKeys.includes(k))) missing = need.map(k => FEATURE_NAMES[k] ?? k).join(" or ");
  }
  return { offered: true, cap, missing };
}
/** One of each (David, 2026-11-13: the Imperial troops at the Seat of the Emperor): the player already holding this unit, or null. */
export const UNIQUE_ARMIES = ["Imperial"];
/** Single units held by one player at most (David, 2026-11-13: War Elephants, from the Elephant Grounds). */
export const UNIQUE_UNITS = ["War Elephants"];
export function inService(t, opt) {
  if (![...UNIQUE_ARMIES, ...(opt?.unique ?? [])].includes(t.faction) && !UNIQUE_UNITS.includes(t.name)) return null;
  const owner = (a) => game.users.find(u => !u.isGM && a.testUserPermission(u, "OWNER"));
  const a = game.actors.find(a => a.type === "unit" && (a.getFlag(SYSTEM_ID, "template") === t.id || a.name === t.name) && owner(a));
  return a ? owner(a).name : null;
}

/** Local troop limit (David, 2026-11-13): per city and per local group (Xiongnu, Qiang…), 2 units for the whole party;
 *  a unit counts while it serves (flag recruitedAt = { city, group }, kept through promotions). War Elephants: one in all. */
export const LOCAL_LIMIT = 2;
export const isLocalPick = (t, opt) => !!opt && (opt.local ?? []).includes(t.name) && !(opt.specialUnits ?? []).includes(t.name) && !UNIQUE_UNITS.includes(t.name);
export function localUsed(group, city) {
  return (game.actors?.contents ?? []).filter(a => a.type === "unit" && a.system?.side === "player"
    && a.getFlag?.(SYSTEM_ID, "recruitedAt")?.city === city && a.getFlag(SYSTEM_ID, "recruitedAt")?.group === group).length;
}
export const isMerc = (t, opt) => !!opt && (opt.mercenary ?? []).includes(t.faction);
/** How many of this kind the party may have from this city: mercenaries by Prosperity (Low 1, Mid 2, High 3), local troops 2 per group. */
// Northern veterans (David, 2026-11-13): recruited outright under the normal rules, one per Prosperity level above Low
// (Mid 1, High 2) from each city for the party; they never side-grade or promote
export const NORTHERN = "Northern";
export const hireLimit = (t, opt) => isMerc(t, opt) ? (opt.mercLimit ?? 0) : t.faction === NORTHERN && opt ? Math.max(0, (opt.prosperity ?? 0) - 1)
  : isLocalPick(t, opt) ? LOCAL_LIMIT : null;
const localFull = (t, opt) => { const lim = hireLimit(t, opt);
  return lim != null && localUsed(t.faction, opt.title) >= lim ? `${lim} ${isMerc(t, opt) ? "mercenary" : t.faction === NORTHERN ? "Northern" : t.faction} unit${lim === 1 ? "" : "s"} from ${opt.title} already serve` : null; };

/** The cap chips (pure): per kind of unit, the highest tier this city recruits once its features count (David, 2026-11-12). */
export function capChips(opt) {
  const has = (keys) => !Array.isArray(opt.featureKeys) || keys.some(k => opt.featureKeys.includes(k));
  const kinds = [["Spear", "infantry", ["armorsmith"]], ["Blade", "infantry", ["weaponsmith"]], ["Ranged", "ranged", ["fletcher"]],
    ["Cavalry", "cavalry", ["pastures"]], ["Mounted archers", "cavalry", ["pastures", "fletcher"]]];
  return kinds.map(([label, type, keys]) => {
    const cap = opt.caps?.[type] ?? 0, ok = has(keys), top = ok ? cap : Math.min(cap, 1);
    const names = keys.map(k => FEATURE_NAMES[k] ?? k).join(" or ");
    return { label, cap, top, why: ok ? `${opt.prosperityName ?? ""} Prosperity: up to Tier ${cap}`.trim() : `Above Tier 1 needs ${withArticle(names)}` };
  });
}

/** Why a tier is above the cap, in Prosperity words (pure). levelCaps[i] = the tier cap of Prosperity i (Ruins, Low, Mid, High). */
export function capReason(tier, cap, base, levelCaps = [0, 2, 3, 4]) {
  const need = tier - (cap - base), i = levelCaps.findIndex(c => c >= need);
  return i >= 1 ? `Needs ${["", "Low", "Mid", "High"][i]} Prosperity` : "Not recruitable here";
}

/** May this be bought? { ok, reason } (pure). With city options, armies is ignored and offered / tier / cap decide. */
export function recruitCheck({ coin, cost, armies, army, hasCharacter = true, city = null }) {
  // city: { offered, cap, base, tier, levelCaps? }
  if (!hasCharacter) return { ok: false, reason: "No character is assigned to this player, so there's no budget to spend." };
  if (city) {
    if (!city.offered) return { ok: false, reason: "Not recruited in this city." };
    if (city.tier > city.cap) return { ok: false, reason: capReason(city.tier, city.cap, city.base ?? city.cap, city.levelCaps) };
    if (city.promoteOnly) return { ok: false, reason: "Promotion only" };
    if (city.missing) return { ok: false, reason: `Needs ${withArticle(city.missing)} here` };
    if (city.taken) return { ok: false, reason: `Already serving ${city.taken}` };
    if (city.full) return { ok: false, reason: city.full };
    // each player's unit limit (rank; David, 2026-11-13: recruit caps stop recruitment)
    if (city.command && city.command.used >= city.command.limit) return { ok: false, reason: `Your command is full (${city.command.used} of ${city.command.limit} units, ${city.command.why})` };
  } else if (!armies.includes(army)) return { ok: false, reason: `This player can't recruit ${army} units.` };
  if (!(cost > 0)) return { ok: false, reason: "This unit has no recruitment cost set." };
  if (coin < cost) return { ok: false, reason: `Not enough budget (${coin} of ${cost}).` };
  return { ok: true, reason: "" };
}

/** GM side: check again with the real data, create the unit for the player and take the coin. */
async function recruitOnGM(requesterId, { userId, uuid }) {
  const requester = game.users.get(requesterId), user = game.users.get(userId);
  if (!user || user.isGM) return { ok: false, error: "No such player." };
  if (!requester?.isGM && requesterId !== userId) return { ok: false, error: "You can only recruit for yourself." };
  const t = (await templates()).find(x => x.id === uuid);
  if (!t) return { ok: false, error: "That unit couldn't be found." };
  const pc = user.character;
  const prov = provider();
  let city = null, opt = null, off = null;
  if (prov) {
    opt = await prov(userId);
    if (opt.block) return { ok: false, error: opt.block };
    off = await withOfficers(opt);
    city = { ...cityOffer(t, opt, await templates()), tier: t.tier, base: opt.baseCap, levelCaps: opt.levelCaps, taken: inService(t, opt), full: localFull(t, opt), command: opt.command ?? null };
  }
  if (!off) off = await withOfficers(null, armiesFor(user));
  const chk = recruitCheck({ coin: budgetOf(pc), cost: t.cost, armies: [...armiesFor(user), ...off.extra], army: t.faction, hasCharacter: !!pc, city });
  if (!chk.ok) return { ok: false, error: chk.reason };
  const actor = await createUnit({ template: uuid, name: "", owner: user.id, side: "player", officer: "" });
  if (!actor) return { ok: false, error: "The unit couldn't be created." };
  if (opt && hireLimit(t, opt) != null) await actor.setFlag(SYSTEM_ID, "recruitedAt", { city: opt.title, group: t.faction });
  const via = off.extra.includes(t.faction) ? grantFor(t.faction, off.grants) : null;
  if (via) await actor.setFlag(SYSTEM_ID, VIA_FLAG, via.uuid);
  await setBudget(pc, budgetOf(pc) - t.cost); // the army budget pays, not personal coins (David, 2026-11-13)
  ChatMessage.create({ content: `<p><b>${esc(user.name)}</b> recruits <b>${esc(actor.name)}</b> for ${t.cost} budget${opt ? ` at ${esc(opt.title)}` : ""}${via ? ` through ${esc(via.name)} (only he can lead it)` : ""}.</p>`, speaker: { alias: pc.name } });
  return { ok: true, name: actor.name };
}

export function registerRecruitQuery() {
  CONFIG.queries[QUERY] = async ({ requesterId, data }) => recruitOnGM(requesterId, data);
  CONFIG.queries[DISBAND] = async ({ requesterId, data }) => disbandOnGM(requesterId, data);
}

// ---------------------------------------------------------------- disband (David, 2026-11-13: players can disband a unit)
const DISBAND = `${SYSTEM_ID}.disband`;
async function disbandOnGM(requesterId, { actorId }) {
  const requester = game.users.get(requesterId), actor = game.actors.get(actorId);
  if (!actor || actor.type !== "unit") return { ok: false, error: "No such unit." };
  if (!requester?.isGM && !actor.testUserPermission(requester, "OWNER")) return { ok: false, error: "That isn't your unit." };
  const name = actor.name;
  for (const sc of game.scenes) { const ids = sc.tokens.filter(t => t.actorId === actor.id).map(t => t.id); if (ids.length) await sc.deleteEmbeddedDocuments("Token", ids); }
  await actor.delete();
  ChatMessage.create({ content: `<p><b>${esc(requester?.name ?? "")}</b> disbands <b>${esc(name)}</b>.</p>` });
  return { ok: true, name };
}
/** A player (or the GM) disbands one of their units: asks first, then the GM's client deletes it. No coin back. */
export async function disbandUnit(actor) {
  if (!actor) return;
  const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: "Disband unit" }, rejectClose: false,
    content: `<p>Disband <b>${esc(actor.name)}</b>?</p><p class="qin-muted">The unit is gone for good (no budget back). Its officer is free to lead another unit.</p>` });
  if (!ok) return;
  let res;
  if (game.user.isGM) res = await disbandOnGM(game.user.id, { actorId: actor.id });
  else {
    const gm = game.users.activeGM;
    if (!gm) return ui.notifications.warn("The GM needs to be connected to disband a unit.");
    try { res = await gm.query(DISBAND, { requesterId: game.user.id, data: { actorId: actor.id } }, { timeout: 30000 }); } catch (e) { res = { ok: false, error: e.message }; }
  }
  if (!res?.ok) ui.notifications.warn(res?.error ?? "Disbanding failed."); else ui.notifications.info(`${res.name} is disbanded.`);
}

async function requestRecruit(data) {
  let res;
  if (game.user.isGM) res = await recruitOnGM(game.user.id, data);
  else {
    const gm = game.users.activeGM;
    if (!gm) return ui.notifications.warn("The GM needs to be connected to recruit units.");
    try { res = await gm.query(QUERY, { requesterId: game.user.id, data }, { timeout: 30000 }); }
    catch (e) { res = { ok: false, error: e.message }; }
  }
  if (!res?.ok) ui.notifications.warn(res?.error ?? "Recruiting failed.");
  else ui.notifications.info(`Recruited ${res.name}.`);
  return res;
}

/** GM: choose which armies a player may recruit from. */
export async function pickArmies(userId) {
  const user = game.users.get(userId); if (!user || !game.user.isGM) return;
  const now = new Set(armiesFor(user));
  const content = `<p>Which armies can <b>${esc(user.name)}</b> recruit units from?</p>` + RECRUIT_ARMIES.map(a =>
    `<label class="checkbox" style="display:flex;gap:6px;align-items:center"><input type="checkbox" name="army" value="${a}" ${now.has(a) ? "checked" : ""}> ${a}</label>`).join("");
  const picked = await foundry.applications.api.DialogV2.prompt({
    window: { title: `Recruitment: ${user.name}` }, content, rejectClose: false,
    ok: { label: "Save", icon: "fa-solid fa-check", callback: (ev, button) => [...button.form.querySelectorAll("input[name=army]:checked")].map(i => i.value) },
  });
  if (picked) await user.setFlag(SYSTEM_ID, ARMIES_FLAG, picked);
}

/** The Recruit window for one player: the units they may buy, grouped by army and type, cheapest tier first. */
export class RecruitApp extends foundry.applications.api.ApplicationV2 {
  static #open = new Map();
  static DEFAULT_OPTIONS = {
    classes: ["qin", "qin-recruit", "qin-promote"],
    window: { title: "Recruit", icon: "fa-solid fa-coins", resizable: true },
    position: { width: 420, height: 600 },
    actions: { buy: RecruitApp.#buy, info: RecruitApp.#info, rcTab: RecruitApp.#tab },   // not "tab": Foundry 14 keeps that name
  };
  static #tab(event, target) { this.tab = target.dataset.tab; this.render(); }
  static open(userId) {
    let app = this.#open.get(userId);
    if (!app) { app = new RecruitApp({ id: `qin-recruit-${userId}` }); app.userId = userId; this.#open.set(userId, app); }
    app.render({ force: true });
    return app;
  }
  static refreshAll() { for (const app of this.#open.values()) if (app.rendered) app.render(); }
  get title() { return `Recruit: ${game.users.get(this.userId)?.name ?? ""}`; }

  static async #info(event, target) { (await import("./unit-info.mjs")).openUnitInfoForActor(target.dataset.uuid); }
  static async #buy(event, target) {
    const t = this.list?.find(x => x.id === target.dataset.uuid); if (!t) return;
    const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: "Recruit" },
      content: `<p>Recruit <b>${esc(t.name)}</b> for <b>${t.cost}</b> budget? Upkeep ${Math.round(t.cost / 4)} a month.</p>`, rejectClose: false });
    if (!ok) return;
    target.disabled = true;
    await requestRecruit({ userId: this.userId, uuid: t.id });
    this.render();
  }

  async _renderHTML() {
    const user = game.users.get(this.userId), pc = user?.character, coin = budgetOf(pc), prov = provider();
    const opt = prov ? await prov(this.userId) : null;
    const offs = await withOfficers(opt, armiesFor(user));
    const head = `<div class="qin-recruit-head">${pc ? `<img src="${esc(pc.img)}" alt=""><div><b>${esc(pc.name)}</b><div>${budgetHtml(coin)}</div></div>`
      : `<div class="qin-muted">No character is assigned to ${esc(user?.name ?? "this player")} (User Configuration), so there's no budget to spend.</div>`}</div>`;
    const row = (t, chk) => `<li class="${chk.ok ? "" : "off"}"><img src="${esc(t.img)}" alt="" data-unit-uuid="${esc(t.id)}"><span class="qin-party-tag tier t${Math.min(5, t.tier)}">T${t.tier}</span>
          <a class="nm" data-unit-uuid="${esc(t.id)}">${esc(t.name)}</a><span class="cost" data-tooltip="Upkeep ${Math.round(t.cost / 4)} a month"><i class="fa-solid fa-coins"></i> ${t.cost}</span>
          ${chk.ok ? `<button type="button" data-action="buy" data-uuid="${esc(t.id)}">Recruit</button>` : `<span class="qin-recruit-why">${esc(chk.reason)}</span>`}</li>`;
    const sort = (a, b) => a.tier - b.tier || a.cost - b.cost || a.name.localeCompare(b.name);
    const typeOf = (t) => TYPES.some(([c]) => c === t.category) ? t.category : "infantry";
    if (opt) {
      // clean layout (David, 2026-11-12): slim header, short cap chips, tabs by kind of unit, slim rows grouped by army
      const cmd = opt.command ? ` <span class="qin-muted" data-tooltip="Units you lead now, and your limit (${esc(opt.command.why)}). Disband a unit from the Party panel to make room.">· ${opt.command.used}/${opt.command.limit} units</span>` : "";
      const top = `<div class="qin-pr-head"><b>${esc(pc?.name ?? user?.name ?? "")}${cmd}</b><span>${pc ? budgetHtml(coin) : "no character"}</span></div>`;
      if (opt.block) { this.list = []; return `${top}<div class="qin-pr-city">${esc(opt.block)}</div>`; }
      const all = await templates();
      this.list = all.filter(t => t.cost > 0 && cityOffer(t, opt).offered);
      const chkOf = (t) => recruitCheck({ coin, cost: t.cost, hasCharacter: !!pc, city: { ...cityOffer(t, opt, all), tier: t.tier, base: opt.baseCap, levelCaps: opt.levelCaps, taken: inService(t, opt), full: localFull(t, opt), command: opt.command ?? null } });
      const city = `<div class="qin-pr-city">${esc(opt.title)} · ${esc(opt.sub.replace(/^.*?city · /, ""))}</div>${opt.foreign || opt.alliedCity ? `<div class="qin-pr-city">${esc(opt.foreign || opt.alliedCity)}</div>` : ""}`;
      const chips = opt.foreign ? "" : `<div class="qin-rc-chips">${capChips(opt).map(c => `<span class="qin-recruit-cap ${c.top < c.cap ? "low" : ""}" data-tooltip="${esc(c.why)}">${esc(c.label)} T${c.top}</span>`).join("")}</div>`;
      const tabOf = (t) => (opt.unique ?? []).includes(t.faction) ? "imperial" : opt.local.includes(t.name) || (opt.specialUnits ?? []).includes(t.name) ? "local" : branchOf(t);
      const TABS = [["spear", "Spear"], ["blade", "Blade"], ["ranged", "Ranged"], ["cavalry", "Cavalry"], ["local", "Local"], ["imperial", "Imperial"]].filter(([k]) => this.list.some(t => tabOf(t) === k));
      const okIn = (k) => this.list.some(t => tabOf(t) === k && chkOf(t).ok);
      if (!TABS.some(([k]) => k === this.tab)) this.tab = (TABS.find(([k]) => okIn(k)) ?? TABS[0])?.[0];
      const tabs = `<nav class="qin-rc-tabs">${TABS.map(([k, label]) => `<a class="${k === this.tab ? "on" : ""}" data-action="rcTab" data-tab="${k}">${label}</a>`).join("")}</nav>`;
      const short = (t, r) => / already serve$/.test(r) ? "Limit reached" : /^Already serving /.test(r) ? r.replace("Already serving", "Taken:") : /^Not recruitable here$/.test(r) && t.tier >= 4 ? "Promotion only" : r.replace(/^Needs (an? )?(.*) here$/, "$2").replace(/ \(.*\)$/, "");
      const line = (t) => { const chk = chkOf(t);
        return `<div class="qin-pr-choice qin-rc-row ${chk.ok ? "" : "off"}"><img src="${esc(t.img)}" alt="" data-unit-uuid="${esc(t.id)}">
          <span data-unit-uuid="${esc(t.id)}"><span class="qin-pr-tier t${Math.min(5, t.tier)}">T${t.tier}</span>${esc(t.name)}</span><span class="qin-pr-cost" data-tooltip="Upkeep ${Math.round(t.cost / 4)} a month">${t.cost.toLocaleString()}</span>
          ${chk.ok ? `<button type="button" data-action="buy" data-uuid="${esc(t.id)}">Recruit</button>` : `<span class="qin-pr-why" data-tooltip="${esc(chk.reason)}">${esc(short(t, chk.reason))}</span>`}</div>`; };
      const inTab = this.list.filter(t => tabOf(t) === this.tab).sort(sort);
      const armiesHere = [...new Set(inTab.map(t => t.faction))].sort((a, b) => (opt.groups.indexOf(a) + 1 || 99) - (opt.groups.indexOf(b) + 1 || 99));
      const body = this.tab === "local" ? [...new Set(inTab.map(t => t.faction))].map(g => { const lim = inTab.some(t => t.faction === g && isLocalPick(t, opt));
          return `<div class="qin-rc-grp">${esc(g)} · local troops of ${esc(opt.title)}${lim ? ` <span class="qin-muted">(${Math.max(0, LOCAL_LIMIT - localUsed(g, opt.title))} of ${LOCAL_LIMIT} left for the party)</span>` : ""}</div>${inTab.filter(t => t.faction === g).map(line).join("")}`; }).join("") + (inTab.some(t => UNIQUE_UNITS.includes(t.name)) ? '<p class="qin-muted">War Elephants: one unit across all players.</p>' : "")
        : this.tab === "imperial" ? `<div class="qin-rc-grp">Seat of the Emperor · one of each across all players</div>${inTab.map(line).join("")}`
        : armiesHere.map(g => { const lim = (opt.mercenary ?? []).includes(g) ? opt.mercLimit ?? 0 : g === NORTHERN ? Math.max(0, (opt.prosperity ?? 0) - 1) : null;
          return `<div class="qin-rc-grp">${esc(g)}${lim != null ? ` <span class="qin-muted">(${Math.max(0, lim - localUsed(g, opt.title))} of ${lim} left here for the party; never promoted)</span>` : ""}${(opt.officerArmies ?? []).includes(g) ? ` <span class="qin-muted">· through ${esc(grantFor(g, offs.grants)?.name ?? "")} (one unit, only he leads it)</span>` : ""}</div>${inTab.filter(t => t.faction === g).map(line).join("")}`; }).join("");
      return `${top}${city}${chips}${tabs}<div class="qin-rc-list">${body || `<p class="qin-muted">No units to recruit here.</p>`}</div>`;
    }
    const armies = [...armiesFor(user), ...offs.extra];
    this.list = (await templates()).filter(t => armies.includes(t.faction));
    if (!armies.length) return `${head}<p class="qin-muted">The GM hasn't chosen which armies ${esc(user?.name ?? "this player")} can recruit from yet.</p>`;
    const rows = RECRUIT_ARMIES.filter(a => armies.includes(a)).flatMap(army => TYPES.map(([k, label]) => {
      const ts = this.list.filter(t => t.faction === army && typeOf(t) === k).sort(sort);
      if (!ts.length) return "";
      return `<h4>${army} · ${label}</h4><ul>${ts.map(t => row(t, recruitCheck({ coin, cost: t.cost, armies, army: t.faction, hasCharacter: !!pc }))).join("")}</ul>`;
    })).join("");
    return `${head}<div class="qin-recruit-list">${rows || `<p class="qin-muted">No units with a cost in these armies.</p>`}</div>`;
  }
  _replaceHTML(result, content) { hideUnitHover(); content.innerHTML = result; attachUnitHover(content); }
  _onClose(options) { hideUnitHover(); super._onClose?.(options); }
}
