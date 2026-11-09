// Officer compendium (David, 2026-11-08): a book button on the token controls opens every officer in the characters
// compendium, by faction, with search and type/tier filters. The GM shows officers to the players (one at a time or a
// whole faction): a shown officer gets a world copy in the "Officer Codex" folder that players can read (Observer),
// so clicking him opens his full sheet read-only. Click a card to open the sheet; drag it onto a unit (its sheet's
// officer slot, or the unit's token on the map) to make him its officer. Officers assigned from here always use a
// world copy, never the compendium entry itself.
import { SYSTEM_ID } from "./config.mjs";
import { officerEligibility } from "./officer-rules.mjs";

const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");
export const PACK_ID = "qin-3k-characters.characters";
export const CODEX_FOLDER = "Officer Codex";
export const TYPES = ["Commander", "Strategist", "Vanguard", "Champion", "Sentinel"];
const TYPE_RGB = { Commander: "232,192,74", Strategist: "111,168,238", Vanguard: "238,106,94", Champion: "95,207,140", Sentinel: "180,138,232" };

/** Faction and group of an officer from his compendium folder path (pure; exported for tests).
 *  "Characters / Liu Biao / Cai" → { faction: "Liu Biao", group: "Cai", minor: false }; "Minor Characters / X" → minor. */
export function factionOf(path) {
  const p = (path ?? []).filter(Boolean);
  const minor = /^minor/i.test(p[0] ?? "");
  if (p.length < 2) return { faction: minor ? "Minor characters" : "Unsorted", group: "", minor };
  return { faction: p[1], group: p[2] ?? "", minor };
}
/** The number at the start of a tier text ("2 High" → 2), or null. */
export const tierNum = (t) => { const m = /^\s*(\d)/.exec(String(t ?? "")); return m ? Number(m[1]) : null; };

/** Does an officer match the filters? (pure; exported for tests) */
export function matches(o, { q = "", types = [], tier = "", faction = "", group = "" } = {}) {
  if (faction && o.faction !== faction) return false;
  if (group && o.group !== group) return false;
  if (types.length && !types.includes(o.type)) return false;
  if (tier !== "" && tier != null && String(o.tier) !== String(tier)) return false;
  if (q) { const hay = `${o.name} ${o.title} ${o.faction} ${o.group}`.toLowerCase(); if (!q.toLowerCase().split(/\s+/).every(w => hay.includes(w))) return false; }
  return true;
}

/* ------------------------------------------------------------------ world copies */

/** The world copy of a compendium officer (made by this window or by Add to Party Officers), or null. */
export function worldCopyOf(packUuid) {
  return game.actors.find(a => a.getFlag(SYSTEM_ID, "codexOf") === packUuid) ?? game.actors.find(a => a.getFlag(SYSTEM_ID, "officerOf") === packUuid) ?? null;
}
async function codexFolder() {
  return game.folders.find(f => f.type === "Actor" && f.name === CODEX_FOLDER && !f.folder)
    ?? Folder.create({ name: CODEX_FOLDER, type: "Actor", color: "#6b5a33", sorting: "a" });
}
/** The world copy of a compendium officer, made if needed (GM). A uuid that isn't a compendium one is returned as is. */
export async function ensureWorldOfficer(uuid, { shown = null, faction = "" } = {}) {
  if (!String(uuid ?? "").startsWith("Compendium.")) return fromUuid(uuid);
  let copy = worldCopyOf(uuid);
  if (!copy) {
    if (!game.user.isGM) return null;
    const src = await fromUuid(uuid); if (!src) return null;
    const folder = await codexFolder();
    const data = src.toObject();
    const keep = !game.actors.get(data._id); // keep the compendium id when it's free, so lookups by id still work
    if (!keep) delete data._id;
    data.folder = folder.id;
    data.ownership = { default: shown ? CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER : CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE };
    data.prototypeToken = { ...(data.prototypeToken ?? {}), actorLink: true };
    data.flags = { ...(data.flags ?? {}), [SYSTEM_ID]: { ...(data.flags?.[SYSTEM_ID] ?? {}), codexOf: uuid, codexFaction: faction, codexShown: !!shown } };
    data._stats = { ...(data._stats ?? {}), compendiumSource: uuid };
    copy = await Actor.create(data, { keepId: keep });
  } else if (shown !== null && game.user.isGM) await setShown(copy, shown, faction);
  return copy;
}
/** Show an officer's world copy to the players, or hide it (an officer in the Party Officers folder stays readable). */
async function setShown(copy, shown, faction) {
  const L = CONST.DOCUMENT_OWNERSHIP_LEVELS, inParty = isPartyOfficer(copy);
  const upd = { [`flags.${SYSTEM_ID}.codexShown`]: shown };
  if (faction) upd[`flags.${SYSTEM_ID}.codexFaction`] = faction;
  const def = copy.ownership?.default ?? 0;
  if (shown && def < L.OBSERVER) upd["ownership.default"] = L.OBSERVER;
  if (!shown && !inParty && def === L.OBSERVER) upd["ownership.default"] = L.NONE;
  await copy.update(upd);
}
export const isShown = (copy) => !!copy?.getFlag(SYSTEM_ID, "codexShown");

/** Make an officer a unit's officer (unit = actor or token document); refuses one a player's officer already leads. */
export async function assignOfficer(unit, uuid) {
  const actor = unit?.actor ?? unit;
  if (!actor || actor.type !== "unit") return false;
  if (!actor.isOwner) { ui.notifications.warn(`Only ${actor.name}'s owner or the GM can change its officer.`); return false; }
  const off = await ensureWorldOfficer(uuid);
  if (!off) { ui.notifications.warn("Only the GM can bring that officer in from the compendium."); return false; }
  if (off.type !== "character") { ui.notifications.warn("Officers must be Qin characters."); return false; }
  const e = officerEligibility(off, actor.system, actor.id);
  if (!e.ok) { ui.notifications.warn(`${off.name} can't lead ${actor.name}: ${e.reason}.`); return false; }
  await actor.update({ "system.officer": off.uuid });
  ui.notifications.info(`${off.name} now leads ${actor.name}.`);
  return true;
}


/* ------------------------------------------------------------------ party officers */

export const PARTY_FOLDER = "Party Officers";
export const isPartyOfficer = (a) => a?.type === "character" && a.folder?.name === PARTY_FOLDER && !a.folder?.folder;
/** The party's officers (characters in the Party Officers folder), by name. */
export const partyOfficers = () => (game.actors?.contents ?? []).filter(isPartyOfficer).sort((a, b) => a.name.localeCompare(b.name));
async function partyFolder() {
  return game.folders.find(f => f.type === "Actor" && f.name === PARTY_FOLDER && !f.folder)
    ?? Folder.create({ name: PARTY_FOLDER, type: "Actor", color: "#7a5a2a", sorting: "a" });
}
/** Add an officer to the party (GM): a compendium officer through his world copy, a codex copy as he is, any other
 *  world character as a new copy. Players get read-only access (an existing Owner copy keeps its ownership). */
export async function addToParty(uuid) {
  if (!game.user.isGM) return null;
  let a = String(uuid).startsWith("Compendium.") ? await ensureWorldOfficer(uuid) : await fromUuid(uuid);
  if (!a || a.type !== "character") { ui.notifications.warn("Only characters can join the party as officers."); return null; }
  if (isPartyOfficer(a)) { ui.notifications.info(`${a.name} is already in the party.`); return a; }
  const folder = await partyFolder(), L = CONST.DOCUMENT_OWNERSHIP_LEVELS;
  if (!a.getFlag(SYSTEM_ID, "codexOf")) { // a world character of the GM's own (not one made by the Officers window): copy him
    const data = a.toObject(); delete data._id;
    data.flags = { ...(data.flags ?? {}), [SYSTEM_ID]: { ...(data.flags?.[SYSTEM_ID] ?? {}), officerOf: a.uuid, codexOf: null } };
    data.ownership = { default: L.OBSERVER };
    data.folder = folder.id;
    data.prototypeToken = { ...(data.prototypeToken ?? {}), actorLink: true };
    a = await Actor.create(data);
  } else {
    await a.update({ folder: folder.id, "ownership.default": Math.max(a.ownership?.default ?? 0, L.OBSERVER) });
  }
  ui.notifications.info(`${a.name} joins the party; the players can read his sheet.`);
  return a;
}
/** Take an officer out of the party (GM): off his unit, back to the Officer Codex folder, hidden again unless shown there. */
export async function removeFromParty(actor) {
  if (!game.user.isGM || !actor) return;
  const led = (game.actors?.contents ?? []).filter(u => u.type === "unit" && u.system?.officer === actor.uuid);
  if (led.length) await Actor.updateDocuments(led.map(u => ({ _id: u.id, "system.officer": "" })));
  const L = CONST.DOCUMENT_OWNERSHIP_LEVELS, folder = await codexFolder();
  await actor.update({ folder: folder.id, "ownership.default": isShown(actor) ? L.OBSERVER : L.NONE });
  ui.notifications.info(`${actor.name} leaves the party${led.length ? ` and ${led.map(u => u.name).join(", ")}` : ""}.`);
}

/* ------------------------------------------------------------------ the window */

const PREFS = "qin.codexPrefs";
const loadPrefs = () => { try { return JSON.parse(localStorage.getItem(PREFS) ?? "{}"); } catch { return {}; } };
const savePrefs = (p) => { try { localStorage.setItem(PREFS, JSON.stringify(p)); } catch { /* fine */ } };

export class OfficerCodex extends (globalThis.foundry?.applications?.api?.ApplicationV2 ?? class {}) {
  static instance = null;
  static DEFAULT_OPTIONS = {
    id: "qin-codex", classes: ["qin", "qin-codex"],
    window: { title: "Officers", icon: "fa-solid fa-book-open", resizable: true },
    position: { width: 900, height: 660 },
    actions: {
      faction: OfficerCodex.#faction, open: OfficerCodex.#open, eye: OfficerCodex.#eye, facEye: OfficerCodex.#facEye,
      type: OfficerCodex.#type, viewAs: OfficerCodex.#viewAs,
    },
  };
  static open() { (this.instance ??= new OfficerCodex()).render({ force: true }); return this.instance; }
  static toggle() { if (this.instance?.rendered) this.instance.close(); else this.open(); }
  static refresh() { if (this.instance?.rendered) this.instance.render(); }

  state = { q: "", types: [], tier: "", faction: "", group: "", asPlayer: false, ...loadPrefs() };
  #entries = null;
  #save() { const { q, types, tier, faction, group } = this.state; savePrefs({ types, tier, faction, group, q }); }

  /** Every officer in the compendium (GM) with his world copy, or the shown world copies (players). */
  async #load() {
    if (game.user.isGM) {
      const pack = game.packs.get(PACK_ID);
      if (!pack) return [];
      const idx = await pack.getIndex({ fields: ["system.details.title", "system.details.tier", "system.details.characterType", "folder", "type"] });
      const path = (fid) => { const out = []; let f = pack.folders.get(fid); while (f) { out.unshift(f.name); f = f.folder; } return out; };
      return idx.filter(e => e.type === "character").map(e => {
        const { faction, group, minor } = factionOf(path(e.folder));
        const copy = worldCopyOf(e.uuid);
        return { uuid: e.uuid, name: e.name, img: e.img, title: e.system?.details?.title ?? "", tier: tierNum(e.system?.details?.tier), type: e.system?.details?.characterType ?? "",
          faction, group, minor, copy, shown: isShown(copy) };
      });
    }
    return game.actors.filter(a => a.type === "character" && isShown(a) && a.testUserPermission(game.user, "OBSERVER")).map(a => ({
      uuid: a.uuid, name: a.name, img: a.img, title: a.system.details?.title ?? "", tier: tierNum(a.system.details?.tier), type: a.system.details?.characterType ?? "",
      faction: a.getFlag(SYSTEM_ID, "codexFaction") || "Others", group: "", minor: false, copy: a, shown: true }));
  }

  async _prepareContext() { this.#entries = await this.#load(); return {}; }

  async _renderHTML() {
    const gm = game.user.isGM, st = this.state, asPlayer = gm && st.asPlayer;
    let all = this.#entries ?? [];
    if (asPlayer) all = all.filter(o => o.shown);
    if (st.faction && !all.some(o => o.faction === st.faction)) { st.faction = ""; st.group = ""; }
    // factions: major ones first (by size), then minor ones; groups only where a faction has them (Liu Biao, Nanman)
    const facs = new Map();
    for (const o of all) {
      const f = facs.get(o.faction) ?? { name: o.faction, minor: o.minor, n: 0, shown: 0, groups: new Map() };
      f.n++; if (o.shown) f.shown++; if (o.group) f.groups.set(o.group, (f.groups.get(o.group) ?? 0) + 1);
      facs.set(o.faction, f);
    }
    const sortF = (a, b) => b.n - a.n || a.name.localeCompare(b.name);
    const major = [...facs.values()].filter(f => !f.minor).sort(sortF), minor = [...facs.values()].filter(f => f.minor).sort(sortF);
    const facRow = (f) => `<div class="qin-cx-fac ${st.faction === f.name && !st.group ? "on" : ""}" data-action="faction" data-faction="${esc(f.name)}">
        <span>${esc(f.name)}</span><span class="n">${f.n}</span>
        ${gm && !asPlayer ? `<a class="qin-cx-eye ${f.shown === f.n ? "vis" : f.shown ? "some" : ""}" data-action="facEye" data-faction="${esc(f.name)}" data-tooltip="${f.shown === f.n ? "Every officer here is shown to the players. Click to hide them all" : `${f.shown} of ${f.n} shown. Click to show them all to the players`}"><i class="fa-solid ${f.shown ? "fa-eye" : "fa-eye-slash"}"></i></a>` : ""}</div>
      ${st.faction === f.name ? [...f.groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([g, n]) => `<div class="qin-cx-fac sub ${st.group === g ? "on" : ""}" data-action="faction" data-faction="${esc(f.name)}" data-group="${esc(g)}"><span>${esc(g)}</span><span class="n">${n}</span></div>`).join("") : ""}`;
    const list = all.filter(o => matches(o, st)).sort((a, b) => a.name.localeCompare(b.name));
    const card = (o) => {
      const rgb = TYPE_RGB[o.type];
      const drag = gm || isPartyOfficer(o.copy);
      return `<div class="qin-cx-card ${gm && !asPlayer && !o.shown ? "hidden" : ""}" data-uuid="${esc(o.uuid)}" data-action="open" ${drag ? `draggable="true"` : ""}>
        ${gm && !asPlayer ? `<a class="qin-cx-eye ${o.shown ? "vis" : ""}" data-action="eye" data-uuid="${esc(o.uuid)}" data-tooltip="${o.shown ? "Players can see him. Click to hide" : "Hidden from the players. Click to show"}"><i class="fa-solid ${o.shown ? "fa-eye" : "fa-eye-slash"}"></i></a>` : ""}
        <img src="${esc(o.img)}" alt="">
        <div class="nm">${esc(o.name)}</div><div class="ep">${esc(o.title)}</div>
        <div class="meta">${o.tier != null ? `<span class="pill">Tier ${o.tier}</span>` : ""}${o.type ? `<span style="color:rgb(${rgb ?? "200,200,200"})">${esc(o.type)}</span>` : ""}</div></div>`;
    };
    const chips = TYPES.map(t => `<a class="qin-cx-chip ${st.types.includes(t) ? "on" : ""}" data-action="type" data-type="${t}" style="--c:${TYPE_RGB[t]}">${t}</a>`).join("");
    return `<div class="qin-cx">
      <div class="qin-cx-bar">
        <label class="qin-cx-search"><i class="fa-solid fa-magnifying-glass"></i><input type="search" name="q" value="${esc(st.q)}" placeholder="Search officers, epithets, factions"></label>
        ${chips}
        <select name="tier"><option value="">Any tier</option>${[0, 1, 2, 3].map(t => `<option value="${t}" ${String(st.tier) === String(t) ? "selected" : ""}>Tier ${t}</option>`).join("")}</select>
        ${gm ? `<span class="qin-cx-view"><a data-action="viewAs" data-as="gm" class="${asPlayer ? "" : "on"}">GM</a><a data-action="viewAs" data-as="player" class="${asPlayer ? "on" : ""}" data-tooltip="See the window as the players do: only the officers you've shown">Player</a></span>` : ""}
      </div>
      <div class="qin-cx-body">
        <nav class="qin-cx-facs"><div class="qin-cx-fac ${!st.faction ? "on" : ""}" data-action="faction" data-faction=""><span><i class="fa-solid fa-users"></i> All factions</span><span class="n">${all.length}</span></div>
          ${major.length ? `<div class="qin-cx-grp">Factions</div>${major.map(facRow).join("")}` : ""}
          ${minor.length ? `<div class="qin-cx-grp">Minor characters</div>${minor.map(facRow).join("")}` : ""}</nav>
        <div class="qin-cx-cards">${list.map(card).join("") || `<p class="qin-muted">${gm || all.length ? "No officers match." : "The GM hasn't shown you any officers yet."}</p>`}</div>
      </div>
      <div class="qin-cx-foot">${list.length} shown${gm && !asPlayer ? ` · <i class="fa-solid fa-eye"></i> = the players can see him` : ""} · click to open the sheet · drag onto a unit to make him its officer</div>
    </div>`;
  }
  _replaceHTML(result, content) {
    const keepScroll = content.querySelector(".qin-cx-cards")?.scrollTop ?? 0, hadFocus = document.activeElement?.name === "q";
    content.innerHTML = result;
    const cards = content.querySelector(".qin-cx-cards"); if (cards) cards.scrollTop = keepScroll;
    const q = content.querySelector("input[name=q]");
    let t = null;
    q?.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { this.state.q = q.value; this.#save(); this.render(); }, 180); });
    if (hadFocus && q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
    content.querySelector("select[name=tier]")?.addEventListener("change", (ev) => { this.state.tier = ev.target.value; this.#save(); this.render(); });
    for (const c of content.querySelectorAll(".qin-cx-card[draggable]")) c.addEventListener("dragstart", (ev) => {
      ev.dataTransfer.setData("text/plain", JSON.stringify({ type: "Actor", uuid: c.dataset.uuid, qinOfficer: true }));
    });
  }

  static #faction(ev, el) { this.state.faction = el.dataset.faction ?? ""; this.state.group = el.dataset.group ?? ""; this.#save(); this.render(); }
  static #type(ev, el) { const t = el.dataset.type, s = this.state.types; this.state.types = s.includes(t) ? s.filter(x => x !== t) : [...s, t]; this.#save(); this.render(); }
  static #viewAs(ev, el) { this.state.asPlayer = el.dataset.as === "player"; this.render(); }
  static async #open(ev, el) {
    if (ev.target.closest("[data-action=eye]")) return;
    const o = this.#entries?.find(x => x.uuid === el.dataset.uuid); if (!o) return;
    const doc = game.user.isGM ? await fromUuid(o.uuid) : o.copy;
    doc?.sheet?.render(true);
  }
  static async #eye(ev, el) {
    ev.stopPropagation();
    const o = this.#entries?.find(x => x.uuid === el.dataset.uuid); if (!o || !game.user.isGM) return;
    await ensureWorldOfficer(o.uuid, { shown: !o.shown, faction: o.faction });
    ui.notifications.info(`${o.name}: ${o.shown ? "hidden from" : "shown to"} the players.`);
    this.render();
  }
  static async #facEye(ev, el) {
    ev.stopPropagation();
    const name = el.dataset.faction, list = (this.#entries ?? []).filter(o => o.faction === name);
    if (!list.length || !game.user.isGM) return;
    const show = list.some(o => !o.shown);
    if (show && list.filter(o => !o.copy).length > 10) {
      const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: `Show ${name}` }, rejectClose: false,
        content: `<p>Show all ${list.length} officers of <b>${esc(name)}</b> to the players? Each gets a read-only copy in the ${CODEX_FOLDER} folder.</p>` });
      if (!ok) return;
    }
    for (const o of list) if (o.shown !== show) await ensureWorldOfficer(o.uuid, { shown: show, faction: o.faction });
    ui.notifications.info(`${name}: ${list.length} officers ${show ? "shown to" : "hidden from"} the players.`);
    this.render();
  }
}

/** Live updates, and dropping an officer card on a unit's token on the map. */
export function registerOfficerCodex() {
  const refresh = (doc) => { if (doc?.type === "character") OfficerCodex.refresh(); };
  for (const h of ["createActor", "updateActor", "deleteActor"]) Hooks.on(h, refresh);
  Hooks.on("dropCanvasData", (cnv, data) => {
    if (data?.type !== "Actor" || !data.qinOfficer) return;
    const tok = canvas.tokens?.placeables?.find(t => t.actor?.type === "unit" && t.bounds?.contains(data.x, data.y));
    if (!tok) { ui.notifications.warn("Drop the officer on one of your units' tokens (or on a unit sheet's officer slot)."); return false; }
    assignOfficer(tok.document.actorLink ? tok.actor : tok.document, data.uuid);
    return false;
  });
}
