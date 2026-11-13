// Recruiting units with coin (from the Party panel). A player spends their character's coin on a battle unit
// from the compendium. The GM's client does the work (players can't create actors), through a query.
// Where and what: when a world-map module offers recruitOptions (rtk13-map: the city the party is in, its owner's army,
// Prosperity tier caps and feature bonuses; David, 2026-11-12) that decides; otherwise the armies the GM picks per player.
import { SYSTEM_ID } from "./config.mjs";
import { templates, createUnit } from "./new-unit.mjs";
import { neededFeatures, FEATURE_NAMES, withArticle, branchOf } from "./promote.mjs";

import { attachUnitHover, hideUnitHover } from "./unit-hover.mjs";
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
export function cityOffer(t, opt) {
  const local = (opt.local ?? []).includes(t.name);
  const offered = (opt.groups ?? []).includes(t.faction) || local;
  if (!offered) return { offered: false, cap: 0 };
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
  if (!hasCharacter) return { ok: false, reason: "No character is assigned to this player, so there's no coin to spend." };
  if (city) {
    if (!city.offered) return { ok: false, reason: "Not recruited in this city." };
    if (city.tier > city.cap) return { ok: false, reason: capReason(city.tier, city.cap, city.base ?? city.cap, city.levelCaps) };
    if (city.missing) return { ok: false, reason: `Needs ${withArticle(city.missing)} here` };
  } else if (!armies.includes(army)) return { ok: false, reason: `This player can't recruit ${army} units.` };
  if (!(cost > 0)) return { ok: false, reason: "This unit has no recruitment cost set." };
  if (coin < cost) return { ok: false, reason: `Not enough coin (${coin} of ${cost}).` };
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
  let city = null, opt = null;
  if (prov) {
    opt = await prov(userId);
    if (opt.block) return { ok: false, error: opt.block };
    city = { ...cityOffer(t, opt), tier: t.tier, base: opt.baseCap, levelCaps: opt.levelCaps };
  }
  const chk = recruitCheck({ coin: pc?.system?.coin ?? 0, cost: t.cost, armies: armiesFor(user), army: t.faction, hasCharacter: !!pc, city });
  if (!chk.ok) return { ok: false, error: chk.reason };
  const actor = await createUnit({ template: uuid, name: "", owner: user.id, side: "player", officer: "" });
  if (!actor) return { ok: false, error: "The unit couldn't be created." };
  await pc.update({ "system.coin": Math.max(0, (pc.system.coin ?? 0) - t.cost) });
  ChatMessage.create({ content: `<p><b>${esc(user.name)}</b> recruits <b>${esc(actor.name)}</b> for ${t.cost} coin${opt ? ` at ${esc(opt.title)}` : ""}.</p>`, speaker: { alias: pc.name } });
  return { ok: true, name: actor.name };
}

export function registerRecruitQuery() {
  CONFIG.queries[QUERY] = async ({ requesterId, data }) => recruitOnGM(requesterId, data);
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
    actions: { buy: RecruitApp.#buy, info: RecruitApp.#info, tab: RecruitApp.#tab },
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
      content: `<p>Recruit <b>${esc(t.name)}</b> for <b>${t.cost}</b> coin? Upkeep ${Math.round(t.cost / 4)} a month.</p>`, rejectClose: false });
    if (!ok) return;
    target.disabled = true;
    await requestRecruit({ userId: this.userId, uuid: t.id });
    this.render();
  }

  async _renderHTML() {
    const user = game.users.get(this.userId), pc = user?.character, coin = pc?.system?.coin ?? 0, prov = provider();
    const opt = prov ? await prov(this.userId) : null;
    const head = `<div class="qin-recruit-head">${pc ? `<img src="${esc(pc.img)}" alt=""><div><b>${esc(pc.name)}</b><div><i class="fa-solid fa-coins"></i> ${coin} coin</div></div>`
      : `<div class="qin-muted">No character is assigned to ${esc(user?.name ?? "this player")} (User Configuration), so there's no coin to spend.</div>`}</div>`;
    const row = (t, chk) => `<li class="${chk.ok ? "" : "off"}"><img src="${esc(t.img)}" alt="" data-unit-uuid="${esc(t.id)}"><span class="qin-party-tag tier t${Math.min(5, t.tier)}">T${t.tier}</span>
          <a class="nm" data-unit-uuid="${esc(t.id)}">${esc(t.name)}</a><span class="cost" data-tooltip="Upkeep ${Math.round(t.cost / 4)} a month"><i class="fa-solid fa-coins"></i> ${t.cost}</span>
          ${chk.ok ? `<button type="button" data-action="buy" data-uuid="${esc(t.id)}">Recruit</button>` : `<span class="qin-recruit-why">${esc(chk.reason)}</span>`}</li>`;
    const sort = (a, b) => a.tier - b.tier || a.cost - b.cost || a.name.localeCompare(b.name);
    const typeOf = (t) => TYPES.some(([c]) => c === t.category) ? t.category : "infantry";
    if (opt) {
      // clean layout (David, 2026-11-12): slim header, short cap chips, tabs by kind of unit, slim rows grouped by army
      const top = `<div class="qin-pr-head"><b>${esc(pc?.name ?? user?.name ?? "")}</b><span><i class="fa-solid fa-coins"></i> ${pc ? coin.toLocaleString() : "no character"}</span></div>`;
      if (opt.block) { this.list = []; return `${top}<div class="qin-pr-city">${esc(opt.block)}</div>`; }
      const all = await templates();
      this.list = all.filter(t => t.cost > 0 && cityOffer(t, opt).offered);
      const chkOf = (t) => recruitCheck({ coin, cost: t.cost, hasCharacter: !!pc, city: { ...cityOffer(t, opt), tier: t.tier, base: opt.baseCap, levelCaps: opt.levelCaps } });
      const city = `<div class="qin-pr-city">${esc(opt.title)} · ${esc(opt.sub.replace(/^.*?city · /, ""))}</div>`;
      const chips = `<div class="qin-rc-chips">${capChips(opt).map(c => `<span class="qin-recruit-cap ${c.top < c.cap ? "low" : ""}" data-tooltip="${esc(c.why)}">${esc(c.label)} T${c.top}</span>`).join("")}</div>`;
      const tabOf = (t) => opt.local.includes(t.name) ? "local" : branchOf(t);
      const TABS = [["spear", "Spear"], ["blade", "Blade"], ["ranged", "Ranged"], ["cavalry", "Cavalry"], ["local", "Local"]].filter(([k]) => this.list.some(t => tabOf(t) === k));
      const okIn = (k) => this.list.some(t => tabOf(t) === k && chkOf(t).ok);
      if (!TABS.some(([k]) => k === this.tab)) this.tab = (TABS.find(([k]) => okIn(k)) ?? TABS[0])?.[0];
      const tabs = `<nav class="qin-rc-tabs">${TABS.map(([k, label]) => `<a class="${k === this.tab ? "on" : ""}" data-action="tab" data-tab="${k}">${label}</a>`).join("")}</nav>`;
      const short = (t, r) => /^Not recruitable here$/.test(r) && t.tier >= 4 ? "Promotion only" : r.replace(/^Needs (an? )?(.*) here$/, "$2").replace(/ \(.*\)$/, "");
      const line = (t) => { const chk = chkOf(t);
        return `<div class="qin-pr-choice qin-rc-row ${chk.ok ? "" : "off"}"><img src="${esc(t.img)}" alt="" data-unit-uuid="${esc(t.id)}">
          <span data-unit-uuid="${esc(t.id)}"><span class="qin-pr-tier t${Math.min(5, t.tier)}">T${t.tier}</span>${esc(t.name)}</span><span class="qin-pr-cost" data-tooltip="Upkeep ${Math.round(t.cost / 4)} a month">${t.cost.toLocaleString()}</span>
          ${chk.ok ? `<button type="button" data-action="buy" data-uuid="${esc(t.id)}">Recruit</button>` : `<span class="qin-pr-why" data-tooltip="${esc(chk.reason)}">${esc(short(t, chk.reason))}</span>`}</div>`; };
      const inTab = this.list.filter(t => tabOf(t) === this.tab).sort(sort);
      const armiesHere = [...new Set(inTab.map(t => t.faction))].sort((a, b) => (opt.groups.indexOf(a) + 1 || 99) - (opt.groups.indexOf(b) + 1 || 99));
      const body = this.tab === "local" ? `<div class="qin-rc-grp">Local troops of ${esc(opt.title)}</div>${inTab.map(line).join("")}`
        : armiesHere.map(g => `<div class="qin-rc-grp">${esc(g)}</div>${inTab.filter(t => t.faction === g).map(line).join("")}`).join("");
      return `${top}${city}${chips}${tabs}<div class="qin-rc-list">${body || `<p class="qin-muted">No units to recruit here.</p>`}</div>`;
    }
    const armies = armiesFor(user);
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
