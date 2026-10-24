// The Party panel (P): every unit owned by a player, grouped by its owner, with health, morale and XP.
// The GM also gets buttons to heal units to full and to set morale back to the default, for one unit,
// one player's units, or the whole party.

const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");
/** A unit's starting morale (the data model's default). */
export const DEFAULT_MORALE = 50;

/** The player who owns a unit actor (the first non-GM user with Owner permission), or null. */
function ownerOf(actor) {
  return game.users.find(u => !u.isGM && actor.testUserPermission(u, "OWNER")) ?? null;
}

/** Party units grouped by owner: [{ user, units: [actor] }], players in name order, units by name. */
export function partyGroups() {
  const by = new Map();
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

/** What "heal" and "reset morale" change on one unit (nothing when it's already there). */
export function restoreUpdate(actor, what) {
  const s = actor.system;
  if (what === "heal") return s.men.value < s.men.max ? { "system.men.value": s.men.max } : null;
  if (what === "morale") return s.morale !== DEFAULT_MORALE ? { "system.morale": DEFAULT_MORALE } : null;
  return null;
}

async function restore(actors, what) {
  if (!game.user.isGM) return;
  const updates = actors.map(a => { const u = restoreUpdate(a, what); return u ? { _id: a.id, ...u } : null; }).filter(Boolean);
  if (!updates.length) return ui.notifications.info(what === "heal" ? "Already at full health." : `Morale is already ${DEFAULT_MORALE}.`);
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

  async _renderHTML() {
    const gm = game.user.isGM, groups = partyGroups();
    const pct = (v, m) => Math.max(0, Math.min(100, m ? (100 * v) / m : 0));
    const btns = (scope, id = "") => gm ? `<span class="qin-party-btns">
        <button type="button" data-action="heal" data-scope="${scope}" data-id="${id}" data-tooltip="Heal to full"><i class="fa-solid fa-heart-pulse"></i></button>
        <button type="button" data-action="morale" data-scope="${scope}" data-id="${id}" data-tooltip="Set morale to ${DEFAULT_MORALE}"><i class="fa-solid fa-flag"></i></button></span>` : "";
    const unit = (a) => {
      const s = a.system, off = s.officerActor;
      const status = s.status && s.status !== "active" ? `<span class="qin-party-status ${esc(s.status)}">${esc(s.status[0].toUpperCase() + s.status.slice(1))}</span>` : "";
      return `<li class="qin-party-unit">
        <img src="${esc(a.img)}" alt="" data-action="open" data-id="${a.id}">
        <div class="qin-party-main">
          <div class="qin-party-name"><a data-action="open" data-id="${a.id}">${esc(a.name)}</a> ${status}${btns("unit", a.id)}</div>
          <div class="qin-party-sub"><span class="qin-party-tag tier t${Math.min(4, s.tier)}">T${s.tier}</span><span class="qin-party-tag">Lv ${s.level ?? 1}</span>${s.unitType ? `<span class="qin-party-tag">${esc(s.unitType)}</span>` : ""}${off ? `<span class="qin-party-tag off"><i class="fa-solid fa-user-shield"></i> ${esc(off.name)}</span>` : ""}${s.cost ? `<span class="qin-party-tag coin" data-tooltip="Recruitment cost ${s.cost} · upkeep ${s.upkeep} a month"><i class="fa-solid fa-coins"></i> ${s.upkeep}/mo</span>` : ""}</div>
          <div class="qin-party-bars">
            <span>Health</span><div class="qin-bar"><i style="width:${pct(s.men.value, s.men.max)}%"></i></div><b>${s.men.value}/${s.men.max}</b>
            <span>Morale</span><div class="qin-bar morale"><i style="width:${pct(s.morale, 100)}%"></i></div><b>${s.morale} <small>${esc(s.moraleState ?? "")}</small></b>
            <span>XP</span><div class="qin-bar xp"><i style="width:${pct(s.xp?.value ?? 0, s.xp?.max ?? 100)}%"></i></div><b>${s.xp?.value ?? 0}/${s.xp?.max ?? 100}</b>
          </div>
        </div></li>`;
    };
    const upkeep = (units) => units.reduce((n, a) => n + (a.system.upkeep ?? 0), 0);
    const money = (g) => {
      const coin = g.user.character?.system?.coin;
      return `<span class="qin-party-money" data-tooltip="Upkeep for these units each month${coin !== undefined ? `; ${esc(g.user.character.name)}'s coin` : ""}"><i class="fa-solid fa-coins"></i> ${upkeep(g.units)}/mo${coin !== undefined ? ` · ${coin} coin` : ""}</span>`;
    };
    const body = groups.length ? groups.map(g => `<section class="qin-party-player">
        <h3><span class="qin-party-dot" style="background:${esc(g.user.color?.css ?? g.user.color ?? "#888")}"></span>${esc(g.user.name)}
          <small>${g.units.length} unit${g.units.length === 1 ? "" : "s"}</small>${money(g)}${btns("player", g.user.id)}</h3>
        <ul>${g.units.map(unit).join("")}</ul></section>`).join("")
      : `<p class="qin-muted">No units are owned by a player yet. Make one with New unit (N) and pick an owner.</p>`;
    const top = gm && groups.length ? `<div class="qin-party-all"><b>Whole party <span class="qin-party-money"><i class="fa-solid fa-coins"></i> ${upkeep(groups.flatMap(g => g.units))}/mo</span></b>
        <button type="button" data-action="heal" data-scope="all"><i class="fa-solid fa-heart-pulse"></i> Heal all</button>
        <button type="button" data-action="morale" data-scope="all"><i class="fa-solid fa-flag"></i> Morale to ${DEFAULT_MORALE}</button></div>` : "";
    return `<div class="qin-party-wrap">${top}${body}</div>`;
  }
  _replaceHTML(result, content) { content.innerHTML = result; }
}

/** Keep the panel live as units change. */
export function registerParty() {
  const refresh = (doc) => { if (doc?.type === undefined || doc.type === "unit" || doc.documentName === "User") PartyPanel.refresh(); };
  for (const h of ["createActor", "updateActor", "deleteActor", "updateUser"]) Hooks.on(h, refresh);
}
