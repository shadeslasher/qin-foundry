// The Party panel (P): every unit owned by a player, grouped by its owner, with health, morale and XP.
// The GM also gets buttons to heal units to full and to set morale back to the default, for one unit,
// one player's units, or the whole party.

import { officerEligibility } from "./officer-rules.mjs";
import { RecruitApp, pickArmies, armiesFor } from "./recruit.mjs";
import { EquipmentPicker, equipmentOf } from "./equipment.mjs";
import { ownerFolder } from "./new-unit.mjs";
import { partyOfficers, addToParty, removeFromParty, assignOfficer, isPartyOfficer } from "./officer-codex.mjs";
import { factionList, factionOf } from "./factions.mjs";

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
    position: { width: 360, height: 620, top: 70, left: 70 },
    actions: {
      heal: PartyPanel.#act, morale: PartyPanel.#act, open: PartyPanel.#open,
      recruit: PartyPanel.#recruit, armies: PartyPanel.#armies, coin: PartyPanel.#coin,
      removeUnit: (ev, el) => removeUnit(game.actors.get(el.dataset.id)),
      equip: (ev, el) => EquipmentPicker.open(game.actors.get(el.dataset.id)),
      tab: (ev, el) => { setTab(el.dataset.tab); PartyPanel.refresh(); },
      offSheet: (ev, el) => fromUuidSync(el.dataset.uuid)?.sheet?.render(true),
      offRemove: async (ev, el) => { const a = fromUuidSync(el.dataset.uuid); if (a) await removeFromParty(a); PartyPanel.refresh(); },
      offClear: async (ev, el) => { const u = game.actors.get(el.dataset.id); if (u?.isOwner) await u.update({ "system.officer": "" }); },
      upkeep: async (ev, el) => { const a = game.actors.get(el.dataset.id); if (game.user.isGM && a) await a.update({ "flags.qin.noUpkeep": !noUpkeep(a) }); },
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
  /** Add (or take, with a negative number) coin: one player's character, or every player's at once (GM). */
  static async #coin(event, target) {
    const all = target.dataset.scope === "all";
    const users = all ? partyGroups().map(g => g.user) : [game.users.get(target.dataset.id)].filter(Boolean);
    if (!game.user.isGM && (all || users[0]?.id !== game.user.id)) return;
    const pcs = users.map(u => u.character).filter(Boolean);
    if (!pcs.length) return ui.notifications.warn(all ? "No player has a character assigned yet." : "This player has no character assigned (User Configuration).");
    const who = all ? `everyone in the party (${pcs.map(p => p.name).join(", ")})` : pcs[0].name;
    const n = await foundry.applications.api.DialogV2.prompt({
      window: { title: all ? "Coin for the party" : `Coin: ${pcs[0].name}` }, rejectClose: false,
      content: `<p>How much coin ${all ? "does each character get" : `does ${esc(pcs[0].name)} get`}? A negative number takes coin away.</p>
        <input type="number" name="coin" value="100" step="25" autofocus style="width:100%">`,
      ok: { label: "Add", icon: "fa-solid fa-coins", callback: (ev, button) => Number(button.form.elements.coin.value) },
    });
    if (!n) return;
    await Actor.updateDocuments(pcs.map(pc => ({ _id: pc.id, "system.coin": Math.max(0, (pc.system.coin ?? 0) + n) })));
    ChatMessage.create({ content: `<p><b>${n > 0 ? `+${n}` : n} coin</b> for ${esc(who)}.</p>`, speaker: { alias: game.user.name } });
  }
  static #armies(event, target) { pickArmies(target.dataset.id); }

  async _renderHTML() {
    const gm = game.user.isGM, groups = partyGroups();
    const pct = (v, m) => Math.max(0, Math.min(100, m ? (100 * v) / m : 0));
    const equipBtn = (a) => `<button type="button" data-action="equip" data-id="${a.id}" data-tooltip="Equip this unit"><i class="fa-solid fa-shield-halved"></i></button>`;
    const btns = (scope, id = "", a = null) => gm ? `<span class="qin-party-btns">
        ${scope === "unit" ? equipBtn(a) : ""}
        <button type="button" data-action="heal" data-scope="${scope}" data-id="${id}" data-tooltip="Heal to full"><i class="fa-solid fa-heart-pulse"></i></button>
        <button type="button" data-action="morale" data-scope="${scope}" data-id="${id}" data-tooltip="Set morale to its default (${DEFAULT_MORALE}, more for Disciplined units)"><i class="fa-solid fa-flag"></i></button>
        ${scope === "unit" ? `<button type="button" class="qin-party-remove" data-action="removeUnit" data-id="${id}" data-tooltip="Remove from the party"><i class="fa-solid fa-user-minus"></i></button>` : ""}</span>`
      : scope === "unit" && a?.isOwner ? `<span class="qin-party-btns">${equipBtn(a)}</span>` : ""; // a player equips their own units
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
    const unit = (a, g) => {
      const s = a.system, off = s.officerActor;
      const status = s.status && s.status !== "active" ? `<span class="qin-party-status ${esc(s.status)}">${esc(s.status[0].toUpperCase() + s.status.slice(1))}</span>` : "";
      return `<li class="qin-party-unit">
        <img src="${esc(a.img)}" alt="" data-action="open" data-id="${a.id}">
        <div class="qin-party-main">
          <div class="qin-party-name"><a data-action="open" data-id="${a.id}">${esc(a.name)}</a> ${status}${btns("unit", a.id, a)}</div>
          <div class="qin-party-sub"><span class="qin-party-tag tier t${Math.min(5, s.tier)}">T${s.tier}</span><span class="qin-party-tag">Lv ${s.level ?? 1}</span>${s.unitType ? `<span class="qin-party-tag">${esc(s.unitType)}</span>` : ""}${s.cost ? (noUpkeep(a)
            ? `<span class="qin-party-tag coin off ${gm ? "click" : ""}" ${gm ? `data-action="upkeep" data-id="${a.id}"` : ""} data-tooltip="Recruitment cost ${s.cost} · no upkeep${gm ? " (click to charge upkeep again)" : ""}"><i class="fa-solid fa-coins"></i> No upkeep</span>`
            : `<span class="qin-party-tag coin ${gm ? "click" : ""}" ${gm ? `data-action="upkeep" data-id="${a.id}"` : ""} data-tooltip="Recruitment cost ${s.cost} · upkeep ${s.upkeep} a month${gm ? " (click: no upkeep for this unit)" : ""}"><i class="fa-solid fa-coins"></i> ${s.upkeep}/mo</span>`) : ""}${equipmentOf(a).map(e => `<span class="qin-party-tag equip" data-tooltip="${esc(e.desc)}"><i class="fa-solid fa-shield-halved"></i> ${esc(e.name)}</span>`).join("")}</div>
          ${officerPicker(a, g)}
          <div class="qin-party-bars">
            <span>Health</span><div class="qin-bar"><i style="width:${pct(s.men.value, s.men.max)}%"></i></div><b>${s.men.value}/${s.men.max}</b>
            <span>Morale</span><div class="qin-bar morale"><i style="width:${pct(s.morale, 100)}%"></i></div><b>${s.morale} <small>${esc(s.moraleState ?? "")}</small></b>
            <span>XP</span><div class="qin-bar xp"><i style="width:${pct(s.xp?.value ?? 0, s.xp?.max ?? 100)}%"></i></div><b>${s.xp?.value ?? 0}/${s.xp?.max ?? 100}</b>
          </div>
        </div></li>`;
    };
    const upkeep = (units) => units.reduce((n, a) => n + upkeepOf(a), 0);
    const money = (g) => {
      const coin = g.user.character?.system?.coin, mine = g.user.id === game.user.id;
      const btn = (gm || mine) && g.user.character ? `<button type="button" class="qin-party-coin" data-action="coin" data-id="${g.user.id}" data-tooltip="Add coin to ${esc(g.user.character.name)}"><i class="fa-solid fa-plus"></i></button>` : "";
      return `<span class="qin-party-money" data-tooltip="Upkeep for these units each month${coin !== undefined ? `; ${esc(g.user.character.name)}'s coin` : ""}"><i class="fa-solid fa-coins"></i> ${upkeep(g.units)}/mo${coin !== undefined ? ` · ${coin} coin` : ""}</span>${btn}`;
    };
    const recruitRow = (g) => {
      if (!gm && g.user.id !== game.user.id) return "";
      const armies = armiesFor(g.user);
      return `<div class="qin-party-recruit"><button type="button" data-action="recruit" data-id="${g.user.id}"><i class="fa-solid fa-plus"></i> Recruit</button>
        <span class="qin-muted">${armies.length ? esc(armies.join(", ")) : "No armies allowed yet"}</span>
        ${gm ? `<button type="button" class="qin-party-armies" data-action="armies" data-id="${g.user.id}" data-tooltip="Choose which armies ${esc(g.user.name)} can recruit from"><i class="fa-solid fa-chess-rook"></i></button>` : ""}</div>`;
    };
    const fold = folded();
    const body = groups.length ? groups.map(g => `<section class="qin-party-player${fold.has(g.user.id) ? " folded" : ""}">
        <h3><a class="qin-party-fold" data-action="fold" data-id="${g.user.id}" data-tooltip="${fold.has(g.user.id) ? "Show" : "Hide"} ${esc(g.user.name)}'s units"><i class="fa-solid fa-chevron-${fold.has(g.user.id) ? "right" : "down"}"></i></a><span class="qin-party-dot" style="background:${esc(g.user.color?.css ?? g.user.color ?? "#888")}"></span>${esc(g.user.name)}
          <small>${g.units.length} unit${g.units.length === 1 ? "" : "s"}</small>${money(g)}${btns("player", g.user.id)}</h3>
        ${fold.has(g.user.id) ? "" : `<ul>${g.units.map(a => unit(a, g)).join("") || `<li class="qin-muted qin-party-none">No units yet.</li>`}</ul>
        ${recruitRow(g)}`}</section>`).join("")
      : `<p class="qin-muted">There are no player accounts yet.</p>`;
    const top = gm && groups.length ? `<div class="qin-party-all"><b>Whole party <span class="qin-party-money"><i class="fa-solid fa-coins"></i> ${upkeep(groups.flatMap(g => g.units))}/mo</span></b>
        <button type="button" data-action="heal" data-scope="all"><i class="fa-solid fa-heart-pulse"></i> Heal all</button>
        <button type="button" data-action="morale" data-scope="all"><i class="fa-solid fa-flag"></i> Reset morale</button>
        <button type="button" data-action="coin" data-scope="all" data-tooltip="Add the same amount of coin to every player's character"><i class="fa-solid fa-coins"></i> Add coin</button></div>` : "";
    const pf = partyFaction(), pfo = pf && pf !== "*mixed" ? factionOf(pf) : null;
    const facRow = gm ? `<div class="qin-party-faction"><span>Party faction</span><select data-party-faction>
        <option value="" ${pf === "" ? "selected" : ""}>— none —</option>${pf === "*mixed" ? `<option value="*mixed" selected disabled>(players differ)</option>` : ""}
        ${factionList().map(f => `<option value="${esc(f.key)}" ${f.key === pf ? "selected" : ""}>${esc(f.name)}</option>`).join("")}</select></div>`
      : `<div class="qin-party-faction"><span>Party faction</span>${pfo?.img ? `<img src="${esc(pfo.img)}" alt="">` : ""}<b>${esc(pfo?.name ?? (pf === "*mixed" ? "Mixed" : "None"))}</b></div>`;
    const offs = partyOfficers(), tab = getTab();
    const tabs = `<nav class="qin-party-tabs"><a data-action="tab" data-tab="units" class="${tab === "units" ? "on" : ""}">Units</a><a data-action="tab" data-tab="officers" class="${tab === "officers" ? "on" : ""}">Officers <small>(${offs.length})</small></a></nav>`;
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
    return `<div class="qin-party-wrap">${tabs}${facRow}${top}${body}</div>`;
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
    for (const el of content.querySelectorAll("[data-drop-unit]")) zone(el.closest(".qin-party-unit") ?? el, (uuid) => assignOfficer(game.actors.get(el.dataset.dropUnit), uuid));
    for (const el of content.querySelectorAll("[data-drop-party]")) zone(el, async (uuid) => { await addToParty(uuid); PartyPanel.refresh(); });
    content.querySelector("select[data-party-faction]")?.addEventListener("change", (ev) => setPartyFaction(ev.target.value));
    for (const sel of content.querySelectorAll("select[data-officer-for]"))
      sel.addEventListener("change", () => game.actors.get(sel.dataset.officerFor)?.update({ "system.officer": sel.value }));
  }
}

/** Which tab of the Party window is open, in this browser. */
const TAB_KEY = "qin.partyTab";
function getTab() { try { return localStorage.getItem(TAB_KEY) === "officers" ? "officers" : "units"; } catch { return "units"; } }
function setTab(t) { try { localStorage.setItem(TAB_KEY, t); } catch { /* fine */ } }

/** Players whose units are folded away in this browser (David, 2026-11-01). */
const FOLD_KEY = "qin.partyFolded";
function folded() { try { return new Set(JSON.parse(localStorage.getItem(FOLD_KEY) ?? "[]")); } catch { return new Set(); } }
function saveFolded(set) { try { localStorage.setItem(FOLD_KEY, JSON.stringify([...set])); } catch { /* fine */ } }

/** Keep the panel live as units change. */
export function registerParty() {
  const refresh = (doc) => { if (doc?.type === undefined || doc.type === "unit" || doc.type === "character" || doc.documentName === "User") PartyPanel.refresh(); };
  for (const h of ["createActor", "updateActor", "deleteActor", "updateUser"]) Hooks.on(h, refresh);
  for (const h of ["createActor", "updateActor", "deleteActor", "updateUser"]) Hooks.on(h, () => RecruitApp.refreshAll());
}
