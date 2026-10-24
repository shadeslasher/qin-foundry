// Recruiting units with coin (from the Party panel). A player spends their character's coin on a battle unit
// from the compendium, limited to the armies the GM allows them (user flag). The GM's client does the work
// (players can't create actors), through a query.
import { SYSTEM_ID } from "./config.mjs";
import { templates, createUnit } from "./new-unit.mjs";

const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");
export const RECRUIT_ARMIES = ["Han", "Bandits", "Yellow Turbans"];
export const ARMIES_FLAG = "recruitArmies";
const QUERY = `${SYSTEM_ID}.recruit`;
const TYPES = [["infantry", "Infantry"], ["ranged", "Ranged Infantry"], ["cavalry", "Cavalry"]];

/** The armies a player may recruit from (none until the GM picks some). */
export const armiesFor = (user) => (user?.getFlag?.(SYSTEM_ID, ARMIES_FLAG) ?? []).filter(a => RECRUIT_ARMIES.includes(a));

/** May this be bought? { ok, reason } (pure). */
export function recruitCheck({ coin, cost, armies, army, hasCharacter = true }) {
  if (!hasCharacter) return { ok: false, reason: "No character is assigned to this player, so there's no coin to spend." };
  if (!armies.includes(army)) return { ok: false, reason: `This player can't recruit ${army} units.` };
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
  const chk = recruitCheck({ coin: pc?.system?.coin ?? 0, cost: t.cost, armies: armiesFor(user), army: t.faction, hasCharacter: !!pc });
  if (!chk.ok) return { ok: false, error: chk.reason };
  const actor = await createUnit({ template: uuid, name: "", owner: user.id, side: "player", officer: "" });
  if (!actor) return { ok: false, error: "The unit couldn't be created." };
  await pc.update({ "system.coin": Math.max(0, (pc.system.coin ?? 0) - t.cost) });
  ChatMessage.create({ content: `<p><b>${esc(user.name)}</b> recruits <b>${esc(actor.name)}</b> for ${t.cost} coin.</p>`, speaker: { alias: pc.name } });
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
    classes: ["qin", "qin-recruit"],
    window: { title: "Recruit", icon: "fa-solid fa-coins", resizable: true },
    position: { width: 420, height: 600 },
    actions: { buy: RecruitApp.#buy, info: RecruitApp.#info },
  };
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
    const user = game.users.get(this.userId), pc = user?.character, coin = pc?.system?.coin ?? 0, armies = armiesFor(user);
    this.list = (await templates()).filter(t => armies.includes(t.faction));
    const head = `<div class="qin-recruit-head">${pc ? `<img src="${esc(pc.img)}" alt=""><div><b>${esc(pc.name)}</b><div><i class="fa-solid fa-coins"></i> ${coin} coin</div></div>`
      : `<div class="qin-muted">No character is assigned to ${esc(user?.name ?? "this player")} (User Configuration), so there's no coin to spend.</div>`}</div>`;
    if (!armies.length) return `${head}<p class="qin-muted">The GM hasn't chosen which armies ${esc(user?.name ?? "this player")} can recruit from yet.</p>`;
    const rows = RECRUIT_ARMIES.filter(a => armies.includes(a)).flatMap(army => TYPES.map(([k, label]) => {
      const ts = this.list.filter(t => t.faction === army && (t.category === k || (k === "infantry" && !TYPES.some(([c]) => c === t.category))))
        .sort((a, b) => a.tier - b.tier || a.cost - b.cost || a.name.localeCompare(b.name));
      if (!ts.length) return "";
      return `<h4>${army} · ${label}</h4><ul>${ts.map(t => {
        const chk = recruitCheck({ coin, cost: t.cost, armies, army: t.faction, hasCharacter: !!pc });
        return `<li class="${chk.ok ? "" : "off"}"><img src="${esc(t.img)}" alt="" data-action="info" data-uuid="${esc(t.id)}"><span class="qin-party-tag tier t${Math.min(4, t.tier)}">T${t.tier}</span>
          <a class="nm" data-action="info" data-uuid="${esc(t.id)}" data-tooltip="Show this unit's details">${esc(t.name)}</a><span class="cost" data-tooltip="Upkeep ${Math.round(t.cost / 4)} a month"><i class="fa-solid fa-coins"></i> ${t.cost}</span>
          <button type="button" data-action="buy" data-uuid="${esc(t.id)}" ${chk.ok ? "" : `disabled data-tooltip="${esc(chk.reason)}"`}>Recruit</button></li>`;
      }).join("")}</ul>`;
    })).join("");
    return `${head}<div class="qin-recruit-list">${rows || `<p class="qin-muted">No units with a cost in these armies.</p>`}</div>`;
  }
  _replaceHTML(result, content) { content.innerHTML = result; }
}
