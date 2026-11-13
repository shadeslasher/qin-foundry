// The Party panel (P): every unit owned by a player, grouped by its owner, with health, morale and XP.
// The GM also gets buttons to heal units to full and to set morale back to the default, for one unit,
// one player's units, or the whole party.

import { officerEligibility } from "./officer-rules.mjs";
import { RecruitApp, pickArmies, armiesFor, cityRecruiting } from "./recruit.mjs";
import { PromoteApp } from "./promote.mjs";
import { EquipmentPicker, equipmentOf } from "./equipment.mjs";
import { ownerFolder } from "./new-unit.mjs";
import { partyOfficers, addToParty, removeFromParty, assignOfficer, isPartyOfficer } from "./officer-codex.mjs";
import { factionList, factionOf } from "./factions.mjs";
import { siegeTabHTML, siegeActions, carryTag } from "./party-siege.mjs";
import { budgetOf, setBudget } from "./budget.mjs";

/** A unit the GM has exempted from upkeep (David, 2026-11-12): the Party panel and the world map's season bills skip it. */
export const noUpkeep = (actor) => !!actor?.flags?.qin?.noUpkeep;
const upkeepOf = (actor) => noUpkeep(actor) ? 0 : (actor.system.upkeep ?? 0);
/** The party's faction (David, 2026-11-12) is every player account's world-map faction (user flag rtk13-map.faction). */
const FACTION_FLAG = "flags.rtk13-map.faction";
function partyFaction() {
  const keys = [...new Set(game.users.filter(u => !u.isGM).map(u => u.flags?.["rtk13-map"]?.faction ?? ""))];
  return keys.length === 1 ? keys[0] : keys.length ? "*mixed" : "";
}
async function setPartyFaction(key) {
  if (!game.user.isGM) return;
  const upd = game.users.filter(u => !u.isGM).map(u => key ? { _id: u.id, [FACTION_FLAG]: key } : { _id: u.id, "flags.rtk13-map.-=faction": null });
  await User.updateDocuments(upd);
  ui.notifications.info(key ? `The party now belongs to ${factionOf(key)?.name ?? key}.` : "The party has no faction now.");
}

const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");
/** A unit's resting morale when nothing says otherwise (Disciplined units rest higher: system.defaultMorale). */
export const DEFAULT_MORALE = 50;
export const restMorale = (actor) => actor.system.defaultMorale ?? DEFAULT_MORALE;

/** The player who owns a unit actor (the first non-GM user with Owner permission), or null. */
function ownerOf(actor) {
  return game.users.find(u => !u.isGM && actor.testUserPermission(u, "OWNER")) ?? null;
}

/** Every player (with or without units) and their units: [{ user, units: [actor] }], players in name order, units by name. */
export function partyGroups() {
  const by = new Map();
  for (const u of game.users.filter(u => !u.isGM)) by.set(u.id, { user: u, units: [] });
  for (const a of game.actors?.contents ?? []) {
    if (a.type !== "unit") continue;
    const u = ownerOf(a); if (!u) continue;
    if (!by.has(u.id)) by.set(u.id, { user: u, units: [] });
    by.get(u.id).units.push(a);
  }
  const groups = [...by.values()].sort((a, b) => a.user.name.localeCompare(b.user.name));
  for (const g of groups) g.units.sort((a, b) => a.name.localeCompare(b.name));
  return groups;
}

/** What "heal" and "reset morale" change on one unit (nothing when it's already there).
 *  Healing also brings a Defeated unit back to Active; resetting morale brings a Surrendered one back (David, 2026-10-25). */
export function restoreUpdate(actor, what) {
  const s = actor.system, u = {};
  if (what === "heal") {
    if (s.men.value < s.men.max) u["system.men.value"] = s.men.max;
    if (s.status === "defeated") u["system.status"] = "active";
  } else if (what === "morale") {
    const m = restMorale(actor);
    if (s.morale !== m) u["system.morale"] = m;
    if (s.status === "surrendered") u["system.status"] = "active";
  }
  return Object.keys(u).length ? u : null;
}

/** GM: take a unit out of the party. The player loses ownership, its officer steps down and it moves to
 *  "Player Units / No owner"; the actor itself is kept (delete it from the Actors list to get rid of it). David, 2026-11-10. */
export async function removeUnit(actor) {
  if (!game.user.isGM || !actor) return;
  const owner = ownerOf(actor);
  const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: "Remove from party" }, rejectClose: false,
    content: `<p>Take <b>${esc(actor.name)}</b> out of ${owner ? `${esc(owner.name)}'s units` : "the party"}?</p><p class="qin-muted">The unit is kept in the Actors list, under Player Units / No owner, with nobody owning it. Its officer steps down. No coin is refunded.</p>` });
  if (!ok) return;
  const upd = { "ownership.default": 0, folder: null, "system.officer": "" };
  for (const id of Object.keys(actor.ownership ?? {})) if (id !== "default" && !game.users.get(id)?.isGM) upd[`ownership.${id}`] = 0;
  upd.folder = (await ownerFolder(null))?.id ?? null;
  await actor.update(upd);
  ui.notifications.info(`${actor.name} has left the party.`);
}

async function restore(actors, what) {
  if (!game.user.isGM) return;
  const updates = actors.map(a => { const u = restoreUpdate(a, what); return u ? { _id: a.id, ...u } : null; }).filter(Boolean);
  if (!updates.length) return ui.notifications.info(what === "heal" ? "Already at full health." : `Morale is already at its default.`);
  await Actor.updateDocuments(updates);
  ui.notifications.info(`${what === "heal" ? "Healed" : "Reset the morale of"} ${updates.length} unit${updates.length === 1 ? "" : "s"}.`);
}

export class PartyPanel extends foundry.applications.api.ApplicationV2 {
  static instance = null;
  static DEFAULT_OPTIONS = {
    id: "qin-party", classes: ["qin", "qin-party"],
    window: { title: "Party", icon: "fa-solid fa-users", resizable: true },
    position: { width: 980, height: 640, top: 70, left: 70 },
    actions: {
      heal: PartyPanel.#act, morale: PartyPanel.#act, open: PartyPanel.#open,
      recruit: PartyPanel.#recruit, promote: PartyPanel.#promote, armies: PartyPanel.#armies, coin: PartyPanel.#coin,
      removeUnit: (ev, el) => removeUnit(game.actors.get(el.dataset.id)),
      disband: async (ev, el) => { const { disbandUnit } = await import("./recruit.mjs"); await disbandUnit(game.actors.get(el.dataset.id)); },
      equip: (ev, el) => EquipmentPicker.open(game.actors.get(el.dataset.id)),
      partyTab: (ev, el) => { setTab(el.dataset.tab); PartyPanel.refresh(); },   // not "tab": Foundry 14 keeps that action name for its own tabs
      offSheet: (ev, el) => fromUuidSync(el.dataset.uuid)?.sheet?.render(true),
      offRemove: async (ev, el) => { const a = fromUuidSync(el.dataset.uuid); if (a) await removeFromParty(a); PartyPanel.refresh(); },
      offClear: async (ev, el) => { const u = game.actors.get(el.dataset.id); if (u?.isOwner) await u.update({ "system.officer": "" }); },
      upkeep: async (ev, el) => { const a = game.actors.get(el.dataset.id); if (game.user.isGM && a) await a.update({ "flags.qin.noUpkeep": !noUpkeep(a) }); },
      select: (ev, el) => { const i = PartyPanel.instance; if (i && i.selected !== el.dataset.id) { i.selected = el.dataset.id; i.render(); } },
      ...siegeActions,
      fold: (ev, el) => { const f = folded(); f.has(el.dataset.id) ? f.delete(el.dataset.id) : f.add(el.dataset.id); saveFolded(f); PartyPanel.refresh(); },
    },
  };
  static open() { (this.instance ??= new PartyPanel()).render({ force: true }); return this.instance; }
  static toggle() { if (this.instance?.rendered) this.instance.close(); else this.open(); }
  static refresh() { if (this.instance?.rendered) this.instance.render(); }

  static async #act(event, target) {
    const what = target.dataset.action, scope = target.dataset.scope, id = target.dataset.id;
    const groups = partyGroups();
    const actors = scope === "unit" ? [game.actors.get(id)].filter(Boolean)
      : scope === "player" ? (groups.find(g => g.user.id === id)?.units ?? [])
      : groups.flatMap(g => g.units);
    await restore(actors, what);
  }
  static #open(event, target) { game.actors.get(target.dataset.id)?.sheet?.render(true); }
  static #recruit(event, target) { RecruitApp.open(target.dataset.id); }
  static #promote(event, target) { PromoteApp.open(target.dataset.id); }
  /** Add (or take, with a negative number) coin: one player's character, or every player's at once (GM). */
  static async #coin(event, target) {
    const all = target.dataset.scope === "all", budget = target.dataset.kind === "budget"; // the army budget (GM only) or personal coins
    const users = all ? partyGroups().map(g => g.user) : [game.users.get(target.dataset.id)].filter(Boolean);
    if (!game.user.isGM && (budget || all || users[0]?.id !== game.user.id)) return;
    const word = budget ? "budget" : "coin";
    const pcs = users.map(u => u.character).filter(Boolean);
    if (!pcs.length) return ui.notifications.warn(all ? "No player has a character assigned yet." : "This player has no character assigned (User Configuration).");
    const who = all ? `everyone in the party (${pcs.map(p => p.name).join(", ")})` : pcs[0].name;
    const n = await foundry.applications.api.DialogV2.prompt({
      window: { title: all ? `${budget ? "Budget" : "Coin"} for the party` : `${budget ? "Budget" : "Coin"}: ${pcs[0].name}` }, rejectClose: false,
      content: `<p>How much ${budget ? "army budget" : "personal coin"} ${all ? "does each player get" : `does ${esc(pcs[0].name)} get`}? A negative number takes it away.</p>${budget ? `<p class="qin-muted">The budget pays only for units, equipment and upkeep (victories, events).</p>` : ""}
        <input type="number" name="coin" value="100" step="25" autofocus style="width:100%">`,
      ok: { label: "Add", icon: "fa-solid fa-coins", callback: (ev, button) => Number(button.form.elements.coin.value) },
    });
    if (!n) return;
    if (budget) for (const pc of pcs) await setBudget(pc, budgetOf(pc) + n);
    else await Actor.updateDocuments(pcs.map(pc => ({ _id: pc.id, "system.coin": Math.max(0, (pc.system.coin ?? 0) + n) })));
    ChatMessage.create({ content: `<p><b>${n > 0 ? `+${n}` : n} ${word}</b> for ${esc(who)}.</p>`, speaker: { alias: game.user.name } });
  }
  static #armies(event, target) { pickArmies(target.dataset.id); }

  async _renderHTML() {
    const gm = game.user.isGM, groups = partyGroups();
    const pct = (v, m) => Math.max(0, Math.min(100, m ? (100 * v) / m : 0));
    // officer: the owning player's characters (eligible ones only), editable by whoever owns the unit
    const officerPicker = (a, g) => {
      const s = a.system, cur = s.officerActor;
      // a unit with an officer shows him (× takes him off); without one, a list of the player's characters and the party's officers
      if (cur) return `<div class="qin-party-off has" data-drop-unit="${a.id}"><img src="${esc(cur.img)}" alt=""><a data-action="offSheet" data-uuid="${esc(cur.uuid)}">${esc(cur.name)}</a>${a.isOwner ? `<a class="qin-party-offx" data-action="offClear" data-id="${a.id}" data-tooltip="Take ${esc(cur.name)} off this unit"><i class="fa-solid fa-xmark"></i></a>` : ""}</div>`;
      const chars = (game.actors?.contents ?? []).filter(c => c.type === "character" && (c.testUserPermission(g.user, "OWNER") || isPartyOfficer(c)));
      const opts = chars.sort((x, y) => x.name.localeCompare(y.name)).map(c => { const e = officerEligibility(c, s, a.id), sel = c.uuid === s.officer;
        return `<option value="${esc(c.uuid)}" ${sel ? "selected" : ""} ${!e.ok && !sel ? "disabled" : ""}>${esc(c.name)}${e.ok ? "" : ` (${esc(e.reason)})`}</option>`; }).join("");
      return `<label class="qin-party-off" data-drop-unit="${a.id}"><i class="fa-solid fa-user-shield" data-tooltip="Officer: pick one, or drag a party officer here"></i><select data-officer-for="${a.id}" ${a.isOwner ? "" : "disabled"}><option value="">No officer</option>${opts}</select></label>`;
    };
    // ---- the Units tab (David, 2026-11-13: wider, a roster with one row per unit, and a detail pane for the chosen unit)
    const tierTag = (s) => `<span class="qin-party-tag tier t${Math.min(5, s.tier)}">T${s.tier}</span>`;
    const statusTag = (s) => s.status && s.status !== "active" ? `<span class="qin-party-status ${esc(s.status)}">${esc(s.status[0].toUpperCase() + s.status.slice(1))}</span>` : "";
    const upkeepTag = (a) => { const s = a.system; if (!s.cost) return "";
      return noUpkeep(a)
        ? `<span class="qin-party-tag coin off ${gm ? "click" : ""}" ${gm ? `data-action="upkeep" data-id="${a.id}"` : ""} data-tooltip="Recruitment cost ${s.cost} · no upkeep${gm ? " (click to charge upkeep again)" : ""}"><i class="fa-solid fa-coins"></i> No upkeep</span>`
        : `<span class="qin-party-tag coin ${gm ? "click" : ""}" ${gm ? `data-action="upkeep" data-id="${a.id}"` : ""} data-tooltip="Recruitment cost ${s.cost} · upkeep ${s.upkeep} a month${gm ? " (click: no upkeep for this unit)" : ""}"><i class="fa-solid fa-coins"></i> ${s.upkeep}/mo</span>`; };
    const bar = (cls, v, m, label) => `<div class="qin-prb"><div class="qin-bar ${cls}"><i style="width:${pct(v, m)}%"></i></div><small>${label}</small></div>`;
    const bars = (s) => [
      bar("", s.men.value, s.men.max, `${s.men.value} / ${s.men.max}`),
      bar("morale", s.morale, 100, `${s.morale}${s.moraleState ? ` · ${esc(s.moraleState)}` : ""}`),
      bar("xp", s.xp?.value ?? 0, s.xp?.max ?? 100, `${s.xp?.value ?? 0} / ${s.xp?.max ?? 100}`)];
    const sel = this.selected && groups.some(g => g.units.some(u => u.id === this.selected)) ? this.selected : (groups.flatMap(g => g.units)[0]?.id ?? null);
    this.selected = sel;
    const row = (a, g) => { const s = a.system, [hb, mb, xb] = bars(s);
      return `<div class="qin-pr-row${a.id === sel ? " sel" : ""}">
        <img src="${esc(a.img)}" alt="" data-action="select" data-id="${a.id}" data-tooltip="Show details">
        <div class="qin-pr-unit" data-action="select" data-id="${a.id}"><div class="qin-pr-nm">${esc(a.name)} ${statusTag(s)}${carryTag(a)}</div>
          <div class="qin-pr-sub">${tierTag(s)} Lv ${s.level ?? 1}${s.unitType ? ` · ${esc(s.unitType)}` : ""}${s.cost ? ` · ${noUpkeep(a) ? "no upkeep" : `${s.upkeep}/mo`}` : ""}</div></div>
        <div class="qin-pr-off">${officerPicker(a, g)}</div>
        <div data-action="select" data-id="${a.id}">${hb}</div><div data-action="select" data-id="${a.id}">${mb}</div><div data-action="select" data-id="${a.id}">${xb}</div>
        <div class="qin-pr-acts">${a.isOwner || gm ? `<button type="button" data-action="equip" data-id="${a.id}" data-tooltip="Equip"><i class="fa-solid fa-shield-halved"></i></button>
          <button type="button" data-action="promote" data-id="${a.id}" data-tooltip="Promote or side-grade"><i class="fa-solid fa-angles-up"></i></button>` : ""}
          <button type="button" data-action="select" data-id="${a.id}" data-tooltip="More"><i class="fa-solid fa-ellipsis"></i></button></div></div>`; };
    const detail = () => {
      const a = sel && game.actors.get(sel); if (!a) return `<aside class="qin-pr-detail empty"><p class="qin-muted">Pick a unit to see it here.</p></aside>`;
      const s = a.system, g = groups.find(x => x.units.includes(a)), [hb, mb, xb] = bars(s), owner = g?.user;
      const eq = equipmentOf(a);
      return `<aside class="qin-pr-detail">
        <div class="qin-pd-head"><img src="${esc(a.img)}" alt="" data-action="open" data-id="${a.id}"><div><div class="qin-pd-nm">${esc(a.name)} ${statusTag(s)}</div>
          <div class="qin-pd-sub">${tierTag(s)} Level ${s.level ?? 1}${s.unitType ? ` · ${esc(s.unitType)}` : ""}${owner ? ` · ${esc(owner.name)}` : ""}</div><div class="qin-pd-tags">${upkeepTag(a)}</div></div>
          <button type="button" class="qin-pd-sheet" data-action="open" data-id="${a.id}"><i class="fa-solid fa-id-card"></i> Sheet</button></div>
        <h4>Condition</h4><div class="qin-pd-bars"><span>Health</span>${hb}<span>Morale</span>${mb}<span>XP</span>${xb}</div>
        <h4>Officer</h4>${g ? officerPicker(a, g) : ""}
        ${eq.length ? `<h4>Equipment</h4><div class="qin-pd-tags">${eq.map(e => `<span class="qin-party-tag equip" data-tooltip="${esc(e.desc)}"><i class="fa-solid fa-shield-halved"></i> ${esc(e.name)}</span>`).join("")}</div>` : ""}
        <h4>Actions</h4><div class="qin-pd-acts">
          ${a.isOwner || gm ? `<button type="button" data-action="equip" data-id="${a.id}"><i class="fa-solid fa-shield-halved"></i> Equip</button>
          <button type="button" data-action="promote" data-id="${a.id}"><i class="fa-solid fa-angles-up"></i> Promote</button>` : ""}
          ${gm ? `<button type="button" data-action="heal" data-scope="unit" data-id="${a.id}"><i class="fa-solid fa-heart-pulse"></i> Heal</button>
          <button type="button" data-action="morale" data-scope="unit" data-id="${a.id}" data-tooltip="Set morale to its default (${DEFAULT_MORALE}, more for Disciplined units)"><i class="fa-solid fa-flag"></i> Reset morale</button>
          <button type="button" data-action="removeUnit" data-id="${a.id}" data-tooltip="Take it out of the party (kept in the Actors list)"><i class="fa-solid fa-user-minus"></i> Remove</button>` : ""}
          ${a.isOwner && !gm ? `<button type="button" class="qin-pd-danger" data-action="disband" data-id="${a.id}" data-tooltip="Gone for good, no budget back"><i class="fa-solid fa-trash"></i> Disband</button>` : ""}
          ${gm ? `<button type="button" class="qin-pd-danger" data-action="disband" data-id="${a.id}" data-tooltip="Gone for good, no budget back"><i class="fa-solid fa-trash"></i> Disband</button>` : ""}</div></aside>`;
    };
    const upkeep = (units) => units.reduce((n, a) => n + upkeepOf(a), 0);
    const cmd = (u) => { try { return game.modules.get("rtk13-map")?.api?.commandLimit?.(u) ?? null; } catch { return null; } };
    const playerHead = (g) => {
      const pc = g.user.character, coin = pc?.system?.coin, mine = g.user.id === game.user.id, c = cmd(g.user), f = fold.has(g.user.id);
      const addCoin = (gm || mine) && pc ? `<button type="button" class="qin-party-coin" data-action="coin" data-id="${g.user.id}" data-tooltip="Add personal coin to ${esc(pc.name)}"><i class="fa-solid fa-plus"></i></button>` : "";
      const addBudget = gm && pc ? `<button type="button" class="qin-party-coin" data-action="coin" data-kind="budget" data-id="${g.user.id}" data-tooltip="Add army budget for ${esc(g.user.name)} (victories, events)"><i class="fa-solid fa-plus"></i></button>` : "";
      const facts = [pc ? esc(pc.name) : "",
        pc ? `<span class="qin-party-money budget" data-tooltip="Army budget: pays for units, equipment and upkeep"><i class="fa-solid fa-sack-dollar"></i> ${budgetOf(pc).toLocaleString()}</span>${addBudget}` : "",
        coin !== undefined ? `<span class="qin-party-money" data-tooltip="Personal coins (not for the army)"><i class="fa-solid fa-coins"></i> ${coin.toLocaleString()} coin</span>${addCoin}` : "",
        `${upkeep(g.units)}/mo`, c ? `<span data-tooltip="${esc(c.why ?? "")}">command ${c.used}/${c.limit}</span>` : `${g.units.length} unit${g.units.length === 1 ? "" : "s"}`].filter(Boolean).join(" · ");
      const canAct = gm || mine;
      return `<div class="qin-pr-player">
        <a class="qin-party-fold" data-action="fold" data-id="${g.user.id}" data-tooltip="${f ? "Show" : "Hide"} ${esc(g.user.name)}'s units"><i class="fa-solid fa-chevron-${f ? "right" : "down"}"></i></a>
        <span class="qin-party-dot" style="background:${esc(g.user.color?.css ?? g.user.color ?? "#888")}"></span><b>${esc(g.user.name)}</b><span class="qin-pr-facts">${facts}</span>
        <span class="qin-pr-pbtns">${canAct && (gm || !cityRecruiting()) ? `<button type="button" data-action="recruit" data-id="${g.user.id}"><i class="fa-solid fa-plus"></i> Recruit</button>` : ""}
          ${canAct ? `<button type="button" data-action="promote" data-id="${g.user.id}" data-tooltip="Promote or side-grade ${esc(g.user.name)}'s units"><i class="fa-solid fa-angles-up"></i> Promote</button>` : ""}
          ${gm && !cityRecruiting() ? `<button type="button" class="ic" data-action="armies" data-id="${g.user.id}" data-tooltip="Choose which armies ${esc(g.user.name)} can recruit from"><i class="fa-solid fa-chess-rook"></i></button>` : ""}
          ${gm ? `<button type="button" class="ic" data-action="heal" data-scope="player" data-id="${g.user.id}" data-tooltip="Heal ${esc(g.user.name)}'s units"><i class="fa-solid fa-heart-pulse"></i></button>
          <button type="button" class="ic" data-action="morale" data-scope="player" data-id="${g.user.id}" data-tooltip="Reset the morale of ${esc(g.user.name)}'s units"><i class="fa-solid fa-flag"></i></button>` : ""}</span></div>
        ${!gm && cityRecruiting() && mine ? `<div class="qin-pr-hint qin-muted">Recruit troops: right-click your city on the world map.</div>` : ""}`;
    };
    const fold = folded();
    const roster = groups.length ? `<div class="qin-pr-cols"><span></span><span>Unit</span><span>Officer</span><span>Health</span><span>Morale</span><span>XP</span><span></span></div>`
        + groups.map(g => `<section class="qin-pr-group">${playerHead(g)}${fold.has(g.user.id) ? "" : (g.units.map(a => row(a, g)).join("") || `<div class="qin-muted qin-party-none">No units yet.</div>`)}</section>`).join("")
      : `<p class="qin-muted">There are no player accounts yet.</p>`;
    const pf = partyFaction(), pfo = pf && pf !== "*mixed" ? factionOf(pf) : null, all = groups.flatMap(g => g.units);
    const facCtl = gm ? `<select data-party-faction>
        <option value="" ${pf === "" ? "selected" : ""}>— none —</option>${pf === "*mixed" ? `<option value="*mixed" selected disabled>(players differ)</option>` : ""}
        ${factionList().filter(f => f.key !== "abandoned").map(f => `<option value="${esc(f.key)}" ${f.key === pf ? "selected" : ""}>${esc(f.name)}</option>`).join("")}</select>`
      : `<b>${esc(pfo?.name ?? (pf === "*mixed" ? "Mixed" : "None"))}</b>`;
    const topbar = `<div class="qin-pr-top"><span class="qin-pr-k">Faction</span>${pfo?.img ? `<img src="${esc(pfo.img)}" alt="">` : ""}${facCtl}
      <span class="qin-pr-tot">${all.length} unit${all.length === 1 ? "" : "s"} · <span class="qin-party-money"><i class="fa-solid fa-coins"></i> ${upkeep(all)}/mo</span></span>
      ${gm && groups.length ? `<span class="qin-pr-allbtns"><button type="button" data-action="heal" data-scope="all"><i class="fa-solid fa-heart-pulse"></i> Heal all</button>
        <button type="button" data-action="morale" data-scope="all"><i class="fa-solid fa-flag"></i> Reset morale</button>
        <button type="button" data-action="coin" data-scope="all" data-kind="budget" data-tooltip="Add the same army budget to every player (victories, events)"><i class="fa-solid fa-sack-dollar"></i> Add budget</button></span>` : ""}</div>`;
    const offs = partyOfficers(), tab = getTab();
    const tabs = `<nav class="qin-party-tabs"><a data-action="partyTab" data-tab="units" class="${tab === "units" ? "on" : ""}">Units</a><a data-action="partyTab" data-tab="officers" class="${tab === "officers" ? "on" : ""}">Officers <small>(${offs.length})</small></a><a data-action="partyTab" data-tab="siege" class="${tab === "siege" ? "on" : ""}">Siege</a></nav>`;
    if (tab === "siege") return `<div class="qin-party-wrap qin-pv2">${tabs}${siegeTabHTML(groups, gm)}</div>`;
    if (tab === "officers") {
      const leads = (o) => (game.actors?.contents ?? []).find(u => u.type === "unit" && u.system?.officer === o.uuid);
      const row = (o) => { const u = leads(o), d = o.system.details ?? {}, own = u ? ownerOf(u) : null;
        return `<li class="qin-party-officer" draggable="true" data-uuid="${esc(o.uuid)}">
          <img src="${esc(o.img)}" alt="">
          <div><b>${esc(o.name)}</b><div class="qin-muted">${[d.title, d.characterType, d.tier !== "" && d.tier != null ? `Tier ${esc(String(d.tier).replace(/\s.*/, ""))}` : ""].filter(Boolean).map(esc).join(" · ")}</div>
            <div class="qin-party-lead ${u ? "busy" : "free"}">${u ? `Leads ${esc(u.name)}${own ? ` (${esc(own.name)})` : ""}` : "Free to lead a unit"}</div></div>
          <span class="qin-party-obtns"><button type="button" data-action="offSheet" data-uuid="${esc(o.uuid)}" data-tooltip="Open the sheet${gm ? "" : " (read-only)"}"><i class="fa-solid fa-id-card"></i></button>
          ${gm ? `<button type="button" data-action="offRemove" data-uuid="${esc(o.uuid)}" data-tooltip="Take him out of the party"><i class="fa-solid fa-user-minus"></i></button>` : ""}</span></li>`; };
      const drop = gm ? `<div class="qin-party-odrop" data-drop-party>Drop officers here from the Officers window (or the Actors list)<br><small>the players can read their sheets</small></div>` : `<p class="qin-muted">Drag an officer over the Units tab, then onto one of your units.</p>`;
      return `<div class="qin-party-wrap">${tabs}${drop}<ul class="qin-party-officers">${offs.map(row).join("") || `<li class="qin-muted">No officers in the party yet.</li>`}</ul></div>`;
    }
    return `<div class="qin-party-wrap qin-pv2">${tabs}${topbar}<div class="qin-pr-body"><div class="qin-pr-roster">${roster}</div>${detail()}</div></div>`;
  }
  _replaceHTML(result, content) {
    content.innerHTML = result;
    const read = (ev) => { try { return JSON.parse(ev.dataTransfer.getData("text/plain")); } catch { return null; } };
    // party officers drag onto units; hovering a tab while dragging switches to it
    for (const li of content.querySelectorAll(".qin-party-officer[draggable]"))
      li.addEventListener("dragstart", (ev) => ev.dataTransfer.setData("text/plain", JSON.stringify({ type: "Actor", uuid: li.dataset.uuid, qinOfficer: true })));
    for (const t of content.querySelectorAll(".qin-party-tabs a"))
      t.addEventListener("dragenter", () => { if (getTab() !== t.dataset.tab) { setTab(t.dataset.tab); PartyPanel.refresh(); } });
    const zone = (el, onDrop) => {
      el.addEventListener("dragover", (ev) => { ev.preventDefault(); el.classList.add("over"); });
      el.addEventListener("dragleave", () => el.classList.remove("over"));
      el.addEventListener("drop", async (ev) => { ev.preventDefault(); ev.stopPropagation(); el.classList.remove("over"); const d = read(ev); if (d?.type === "Actor" && d.uuid) await onDrop(d.uuid); });
    };
    for (const el of content.querySelectorAll("[data-drop-unit]")) zone(el.closest(".qin-pr-row") ?? el, (uuid) => assignOfficer(game.actors.get(el.dataset.dropUnit), uuid));
    for (const el of content.querySelectorAll("[data-drop-party]")) zone(el, async (uuid) => { await addToParty(uuid); PartyPanel.refresh(); });
    content.querySelector("select[data-party-faction]")?.addEventListener("change", (ev) => setPartyFaction(ev.target.value));
    for (const sel of content.querySelectorAll("select[data-officer-for]"))
      sel.addEventListener("change", () => game.actors.get(sel.dataset.officerFor)?.update({ "system.officer": sel.value }));
  }
}

/** Which tab of the Party window is open, in this browser. */
const TAB_KEY = "qin.partyTab";
function getTab() { try { const t = localStorage.getItem(TAB_KEY); return t === "officers" || t === "siege" ? t : "units"; } catch { return "units"; } }
function setTab(t) { try { localStorage.setItem(TAB_KEY, t); } catch { /* fine */ } }

/** Players whose units are folded away in this browser (David, 2026-11-01). */
const FOLD_KEY = "qin.partyFolded";
function folded() { try { return new Set(JSON.parse(localStorage.getItem(FOLD_KEY) ?? "[]")); } catch { return new Set(); } }
function saveFolded(set) { try { localStorage.setItem(FOLD_KEY, JSON.stringify([...set])); } catch { /* fine */ } }

/** Keep the panel live as units change. */
export function registerParty() {
  const refresh = (doc) => { if (doc?.type === undefined || doc.type === "unit" || doc.type === "character" || doc.documentName === "User") PartyPanel.refresh(); };
  for (const h of ["createActor", "updateActor", "deleteActor", "updateUser"]) Hooks.on(h, refresh);
  Hooks.on("updateSetting", (st) => { if (st.key === "qin.battle" && getTab() === "siege") PartyPanel.refresh(); }); // the Siege tab follows the battle
  for (const h of ["createActor", "updateActor", "deleteActor", "updateUser"]) Hooks.on(h, () => RecruitApp.refreshAll());
}
