// The Party panel (P): every unit owned by a player, grouped by its owner, with health, morale and XP.
// The GM also gets buttons to heal units to full and to set morale back to the default, for one unit,
// one player's units, or the whole party.

import { officerEligibility } from "./officer-rules.mjs";
import { RecruitApp, pickArmies, armiesFor } from "./recruit.mjs";
import { EquipmentPicker, equipmentOf } from "./equipment.mjs";

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
      equip: (ev, el) => EquipmentPicker.open(game.actors.get(el.dataset.id)),
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
    const btns = (scope, id = "") => gm ? `<span class="qin-party-btns">
        ${scope === "unit" ? `<button type="button" data-action="equip" data-id="${id}" data-tooltip="Equip this unit"><i class="fa-solid fa-shield-halved"></i></button>` : ""}
        <button type="button" data-action="heal" data-scope="${scope}" data-id="${id}" data-tooltip="Heal to full"><i class="fa-solid fa-heart-pulse"></i></button>
        <button type="button" data-action="morale" data-scope="${scope}" data-id="${id}" data-tooltip="Set morale to its default (${DEFAULT_MORALE}, more for Disciplined units)"><i class="fa-solid fa-flag"></i></button></span>` : "";
    // officer: the owning player's characters (eligible ones only), editable by whoever owns the unit
    const officerPicker = (a, g) => {
      const s = a.system, chars = (game.actors?.contents ?? []).filter(c => c.type === "character" && c.testUserPermission(g.user, "OWNER"));
      const cur = s.officerActor;
      if (cur && !chars.includes(cur)) chars.unshift(cur);
      const opts = chars.sort((x, y) => x.name.localeCompare(y.name)).map(c => { const e = officerEligibility(c, s), sel = c.uuid === s.officer;
        return `<option value="${esc(c.uuid)}" ${sel ? "selected" : ""} ${!e.ok && !sel ? "disabled" : ""}>${esc(c.name)}${e.ok ? "" : ` (${esc(e.reason)})`}</option>`; }).join("");
      return `<label class="qin-party-off"><i class="fa-solid fa-user-shield" data-tooltip="Officer"></i><select data-officer-for="${a.id}" ${a.isOwner ? "" : "disabled"}><option value="">No officer</option>${opts}</select></label>`;
    };
    const unit = (a, g) => {
      const s = a.system, off = s.officerActor;
      const status = s.status && s.status !== "active" ? `<span class="qin-party-status ${esc(s.status)}">${esc(s.status[0].toUpperCase() + s.status.slice(1))}</span>` : "";
      return `<li class="qin-party-unit">
        <img src="${esc(a.img)}" alt="" data-action="open" data-id="${a.id}">
        <div class="qin-party-main">
          <div class="qin-party-name"><a data-action="open" data-id="${a.id}">${esc(a.name)}</a> ${status}${btns("unit", a.id)}</div>
          <div class="qin-party-sub"><span class="qin-party-tag tier t${Math.min(4, s.tier)}">T${s.tier}</span><span class="qin-party-tag">Lv ${s.level ?? 1}</span>${s.unitType ? `<span class="qin-party-tag">${esc(s.unitType)}</span>` : ""}${s.cost ? `<span class="qin-party-tag coin" data-tooltip="Recruitment cost ${s.cost} · upkeep ${s.upkeep} a month"><i class="fa-solid fa-coins"></i> ${s.upkeep}/mo</span>` : ""}${equipmentOf(a).map(e => `<span class="qin-party-tag equip" data-tooltip="${esc(e.desc)}"><i class="fa-solid fa-shield-halved"></i> ${esc(e.name)}</span>`).join("")}</div>
          ${officerPicker(a, g)}
          <div class="qin-party-bars">
            <span>Health</span><div class="qin-bar"><i style="width:${pct(s.men.value, s.men.max)}%"></i></div><b>${s.men.value}/${s.men.max}</b>
            <span>Morale</span><div class="qin-bar morale"><i style="width:${pct(s.morale, 100)}%"></i></div><b>${s.morale} <small>${esc(s.moraleState ?? "")}</small></b>
            <span>XP</span><div class="qin-bar xp"><i style="width:${pct(s.xp?.value ?? 0, s.xp?.max ?? 100)}%"></i></div><b>${s.xp?.value ?? 0}/${s.xp?.max ?? 100}</b>
          </div>
        </div></li>`;
    };
    const upkeep = (units) => units.reduce((n, a) => n + (a.system.upkeep ?? 0), 0);
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
    const body = groups.length ? groups.map(g => `<section class="qin-party-player">
        <h3><span class="qin-party-dot" style="background:${esc(g.user.color?.css ?? g.user.color ?? "#888")}"></span>${esc(g.user.name)}
          <small>${g.units.length} unit${g.units.length === 1 ? "" : "s"}</small>${money(g)}${btns("player", g.user.id)}</h3>
        <ul>${g.units.map(a => unit(a, g)).join("") || `<li class="qin-muted qin-party-none">No units yet.</li>`}</ul>
        ${recruitRow(g)}</section>`).join("")
      : `<p class="qin-muted">There are no player accounts yet.</p>`;
    const top = gm && groups.length ? `<div class="qin-party-all"><b>Whole party <span class="qin-party-money"><i class="fa-solid fa-coins"></i> ${upkeep(groups.flatMap(g => g.units))}/mo</span></b>
        <button type="button" data-action="heal" data-scope="all"><i class="fa-solid fa-heart-pulse"></i> Heal all</button>
        <button type="button" data-action="morale" data-scope="all"><i class="fa-solid fa-flag"></i> Reset morale</button>
        <button type="button" data-action="coin" data-scope="all" data-tooltip="Add the same amount of coin to every player's character"><i class="fa-solid fa-coins"></i> Add coin</button></div>` : "";
    return `<div class="qin-party-wrap">${top}${body}</div>`;
  }
  _replaceHTML(result, content) {
    content.innerHTML = result;
    for (const sel of content.querySelectorAll("select[data-officer-for]"))
      sel.addEventListener("change", () => game.actors.get(sel.dataset.officerFor)?.update({ "system.officer": sel.value }));
  }
}

/** Keep the panel live as units change. */
export function registerParty() {
  const refresh = (doc) => { if (doc?.type === undefined || doc.type === "unit" || doc.documentName === "User") PartyPanel.refresh(); };
  for (const h of ["createActor", "updateActor", "deleteActor", "updateUser"]) Hooks.on(h, refresh);
  for (const h of ["createActor", "updateActor", "deleteActor", "updateUser"]) Hooks.on(h, () => RecruitApp.refreshAll());
}
