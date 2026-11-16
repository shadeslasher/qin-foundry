// Scene switcher (David, 2026-11-15; approved from a mockup). A GM window that lists every scene, grouped by the
// top-level folders of the Scenes tab (anything outside a folder goes under "Other"), with thumbnails, search and group
// chips. Coloured dots show which players are on each scene. Pick a scene, then:
//   Take everyone there (activates it; double-click a card does the same) · Look alone (only the GM views it) ·
//   Pick players… (only the ticked players are pulled there).
// Options (world settings): a fade to black during the switch, and back to the world map when a battle ends.
import { SYSTEM_ID } from "./config.mjs";

const SOCKET = `system.${SYSTEM_ID}`;
const esc = (t) => foundry.utils.escapeHTML?.(String(t ?? "")) ?? String(t ?? "");
const route = (p) => (p && !/^(https?:|data:|\/)/.test(p) ? foundry.utils.getRoute(p) : p);
const setting = (k) => { try { return game.settings.get(SYSTEM_ID, k); } catch { return null; } };

/** The scenes grouped by top-level Scenes-tab folder, in the sidebar's order; unfoldered scenes last as "Other". */
export function sceneGroups() {
  const top = (f) => { while (f?.folder) f = f.folder; return f; };
  const groups = new Map();
  const folders = (game.folders?.filter(f => f.type === "Scene" && !f.folder) ?? []).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name));
  for (const f of folders) groups.set(f.id, { id: f.id, name: f.name, scenes: [] });
  const other = { id: "_other", name: "Other", scenes: [] };
  for (const s of game.scenes ?? []) { const f = top(s.folder); (f && groups.get(f.id) || other).scenes.push(s); }
  const list = [...groups.values(), other].filter(g => g.scenes.length);
  for (const g of list) g.scenes.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name));
  return list;
}

function css() {
  if (document.getElementById("qin-ss-css")) return;
  const s = document.createElement("style"); s.id = "qin-ss-css";
  s.textContent = `
  #qin-ss { position: fixed; z-index: 98; left: 70px; top: 70px; width: 560px; max-height: calc(100vh - 100px); display: none; flex-direction: column;
    background: linear-gradient(180deg, rgba(30,28,26,.97), rgba(16,15,14,.97)); border: 1px solid rgba(201,168,92,.6); border-radius: 5px;
    box-shadow: 0 6px 22px rgba(0,0,0,.6); color: #ece6d6; font-family: var(--qin-font-body, Signika, sans-serif); font-size: 13px; padding: 9px 12px 12px; }
  #qin-ss .hd { display: flex; align-items: center; gap: 8px; font-family: "Cinzel", var(--qin-font-display, serif); font-weight: 900; font-size: 16px; letter-spacing: 1px; text-transform: uppercase; color: #fff4d6; cursor: move; }
  #qin-ss .hd .x { margin-left: auto; cursor: pointer; color: #c9c2b0; } #qin-ss .hd .x:hover { color: #fff; }
  #qin-ss .tools { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin: 8px 0 4px; }
  #qin-ss .tools input { flex: 1; min-width: 150px; height: 26px; background: rgba(0,0,0,.45); color: #ece6d6; border: 1px solid rgba(201,168,92,.4); border-radius: 3px; }
  #qin-ss .chip { padding: 2px 9px; border: 1px solid rgba(201,168,92,.5); border-radius: 3px; cursor: pointer; font-size: 12px; color: #c9c2b0; }
  #qin-ss .chip:hover { background: rgba(201,168,92,.2); } #qin-ss .chip.on { background: #c9a85c; color: #1a1612; font-weight: 700; }
  #qin-ss .body { overflow: auto; min-height: 0; padding-right: 2px; }
  #qin-ss .grp { font-size: 11px; letter-spacing: 1px; text-transform: uppercase; color: #b9b2a0; margin: 6px 0 5px; padding: 5px 6px; border-radius: 5px; cursor: pointer; user-select: none; display: flex; align-items: center; gap: 7px; }
  #qin-ss .grp:hover { background: rgba(255,255,255,.06); color: #e8e2d2; }
  #qin-ss .grp i { width: 10px; font-size: 10px; transition: transform .15s; }
  #qin-ss .grp.shut i { transform: rotate(-90deg); }
  #qin-ss .grp .n { margin-left: auto; letter-spacing: 0; text-transform: none; color: #8d877a; }
  #qin-ss .foldall { margin-left: auto; font-size: 11px; color: #b9b2a0; cursor: pointer; white-space: nowrap; }
  #qin-ss .foldall:hover { color: #e8e2d2; text-decoration: underline; }
  #qin-ss .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
  #qin-ss .card { border: 1px solid rgba(201,168,92,.3); border-radius: 4px; overflow: hidden; cursor: pointer; background: rgba(0,0,0,.25); }
  #qin-ss .card:hover { border-color: rgba(201,168,92,.8); } #qin-ss .card.sel { outline: 2px solid #e8c45a; outline-offset: -1px; }
  #qin-ss .card.act { border-color: #6fae5a; }
  #qin-ss .th { height: 74px; background: #2a2723; position: relative; overflow: hidden; }
  #qin-ss .th img { width: 100%; height: 100%; object-fit: cover; display: block; border: 0; }
  #qin-ss .th .tag { position: absolute; top: 4px; left: 4px; font-size: 10.5px; padding: 1px 6px; border-radius: 3px; background: rgba(0,0,0,.7); color: #ece6d6; }
  #qin-ss .th .tag.g { background: #3d6b30; color: #eaffdf; } #qin-ss .th .tag.r { background: #8a2f22; color: #ffe2da; }
  #qin-ss .th .who { position: absolute; bottom: 4px; right: 4px; display: flex; gap: 2px; }
  #qin-ss .th .who i { width: 13px; height: 13px; border-radius: 50%; border: 1.5px solid #111; display: block; }
  #qin-ss .nm { padding: 4px 7px 5px; } #qin-ss .nm b { display: block; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #fff4d6; }
  #qin-ss .nm small { color: #9d968a; font-size: 11px; }
  #qin-ss .none { padding: 10px 4px; color: #8f897b; font-style: italic; }
  #qin-ss .foot { margin-top: 10px; border-top: 1px solid rgba(236,230,214,.18); padding-top: 9px; }
  #qin-ss .foot .t b { color: #fff4d6; font-size: 14px; } #qin-ss .foot .t small { display: block; color: #9d968a; font-size: 11px; }
  #qin-ss .row { display: flex; gap: 6px; margin-top: 8px; }
  #qin-ss .btn { flex: 1; text-align: center; padding: 6px; border: 1px solid rgba(201,168,92,.6); border-radius: 3px; cursor: pointer; }
  #qin-ss .btn:hover { background: rgba(201,168,92,.22); } #qin-ss .btn.on { background: #c9a85c; color: #1a1612; font-weight: 700; }
  #qin-ss .btn.off { opacity: .4; pointer-events: none; }
  #qin-ss .pick { margin-top: 8px; padding: 6px 8px; border: 1px solid rgba(201,168,92,.35); border-radius: 3px; display: flex; flex-wrap: wrap; gap: 4px 14px; align-items: center; }
  #qin-ss .pick label, #qin-ss .opt { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #c9c2b0; }
  #qin-ss .pick .btn { flex: none; padding: 3px 12px; margin-left: auto; }
  #qin-ss .opt { margin-top: 6px; } #qin-ss input[type=checkbox] { margin: 0; }
  #qin-ss-fade { position: fixed; inset: 0; z-index: 10000; background: #000; opacity: 0; pointer-events: none; transition: opacity .4s ease; }`;
  document.head.appendChild(s);
}

/* ------------------------------------------------------------------ the fade (every client that switches) */
let fadeEl = null, fadeTimer = null;
function fadeOut() {
  css();
  fadeEl ??= Object.assign(document.createElement("div"), { id: "qin-ss-fade" });
  if (!fadeEl.isConnected) document.body.appendChild(fadeEl);
  void fadeEl.offsetWidth; fadeEl.style.opacity = "1";
  clearTimeout(fadeTimer); fadeTimer = setTimeout(fadeIn, 6000);   // never stay black
}
function fadeIn() { clearTimeout(fadeTimer); if (fadeEl) fadeEl.style.opacity = "0"; }
Hooks.on("canvasReady", () => { if (fadeEl?.style.opacity === "1") setTimeout(fadeIn, 250); });

/** Move these players (all when users is null) to a scene, with the fade if it's on. */
async function sendTo(scene, users = null) {
  const fade = !!setting("sceneFade");
  if (fade) { game.socket.emit(SOCKET, { action: "sceneFade", users, sceneId: scene.id }); if (!users && canvas?.scene?.id !== scene.id) fadeOut(); await new Promise(r => setTimeout(r, 450)); }
  if (users) { for (const id of users) game.socket.emit("pullToScene", scene.id, id); }
  else await scene.activate();
}
/** Back to the world map when a battle ends (rtk13-map's map if it's there, else the first scene in a "World map" folder). */
function worldMap() {
  const ow = game.scenes.find(s => s.notes?.some(n => n.flags?.["rtk13-map"]?.type === "city")); if (ow) return ow;
  const g = sceneGroups().find(g => /world/i.test(g.name)); return g?.scenes[0] ?? null;
}

/* ------------------------------------------------------------------ the window */
const Switcher = {
  el: null, sel: null, q: "", grp: "", picking: false, moved: false,
  toggle(show) {
    if (!game.user.isGM) return;
    css();
    this.el ??= Object.assign(document.createElement("div"), { id: "qin-ss" });
    if (!this.el.isConnected) document.body.appendChild(this.el);
    show ??= this.el.style.display !== "flex";
    this.el.style.display = show ? "flex" : "none";
    if (show) {
      const c = document.getElementById("qin-dock")?.getBoundingClientRect(); if (c?.width && !this.moved) this.el.style.left = `${Math.round(c.right + 12)}px`;
      this.sel ??= canvas?.scene?.id ?? null; this.render(); this.el.querySelector(".tools input")?.focus();
    }
    game.qinDock?.refresh?.();
  },
  open: () => Switcher.el?.style.display === "flex",
  refresh() { if (this.open()) this.render(); },
  render() {
    const el = this.el, groups = sceneGroups(), q = this.q.trim().toLowerCase(), battle = (() => { try { return game.settings.get(SYSTEM_ID, "battle"); } catch { return null; } })();
    const players = game.users.filter(u => u.active && !u.isGM);
    const card = (s) => {
      const who = players.filter(u => u.viewedScene === s.id);
      const units = s.tokens.filter(t => t.actor?.type === "unit").length;
      const fight = battle?.active && battle.sceneId === s.id;
      const sub = fight ? "Battle running" : units ? `${units} unit${units === 1 ? "" : "s"} placed` : who.length ? `${who.length} player${who.length === 1 ? "" : "s"} here` : s.active ? "Active scene" : "";
      return `<div class="card ${this.sel === s.id ? "sel" : ""} ${s.active ? "act" : ""}" data-id="${s.id}" title="${esc(s.name)} — double-click to take everyone there">
        <div class="th">${(s.thumb || s.background?.src) ? `<img loading="lazy" src="${esc(route(s.thumb || s.background.src))}" data-bg="${esc(s.thumb && s.background?.src ? route(s.background.src) : "")}" alt="">` : ""}${s.active ? `<span class="tag g">Active</span>` : fight ? `<span class="tag r">Battle</span>` : ""}
        <span class="who">${who.map(u => `<i style="background:${esc(u.color?.css ?? u.color ?? "#888")}" title="${esc(u.name)}"></i>`).join("")}</span></div>
        <div class="nm"><b>${esc(s.navName || s.name)}</b><small>${esc(sub) || "&nbsp;"}</small></div></div>`;
    };
    let body = "";
    const folded = new Set(setting("sceneFolded") ?? []);
    const shown = groups.filter(g => !this.grp || this.grp === g.name), allShut = shown.every(g => folded.has(g.id));
    for (const g of groups) {
      if (this.grp && this.grp !== g.name) continue;
      const list = g.scenes.filter(s => !q || s.name.toLowerCase().includes(q) || (s.navName ?? "").toLowerCase().includes(q));
      // folded groups stay folded unless a search is on (then every match shows)
      const shut = !q && folded.has(g.id);
      if (list.length) body += `<div class="grp ${shut ? "shut" : ""}" data-fold="${esc(g.id)}"><i class="fa-solid fa-chevron-down"></i>${esc(g.name)}<span class="n">${list.length}${list.some(x => x.active) ? " · active" : ""}</span></div>${shut ? "" : `<div class="grid">${list.map(card).join("")}</div>`}`;
    }
    if (!body) body = `<div class="none">${game.scenes.size ? "No scene matches." : "No scenes yet: make one in the Scenes tab."}</div>`;
    const s = game.scenes.get(this.sel);
    const foot = s ? (() => {
      const who = players.filter(u => u.viewedScene === s.id).map(u => u.name);
      return `<div class="foot"><div class="t"><b>${esc(s.navName || s.name)}</b><small>${s.active ? "The active scene" : "Not active"}${who.length ? ` · here: ${esc(who.join(", "))}` : ""}</small></div>
        <div class="row"><span class="btn on" data-a="all"><i class="fa-solid fa-users"></i> Take everyone there</span><span class="btn" data-a="view"><i class="fa-solid fa-eye"></i> Look alone</span><span class="btn ${players.length ? "" : "off"}" data-a="pick" title="${players.length ? "Send only some players" : "No players online"}"><i class="fa-solid fa-user-check"></i> Pick players…</span></div>
        ${this.picking && players.length ? `<div class="pick">${players.map(u => `<label><input type="checkbox" value="${u.id}" checked> ${esc(u.name)}</label>`).join("")}<span class="btn on" data-a="send">Send</span></div>` : ""}
        <label class="opt"><input type="checkbox" data-o="sceneFade" ${setting("sceneFade") ? "checked" : ""}> Fade to black during the switch</label>
        <label class="opt"><input type="checkbox" data-o="sceneBattleBack" ${setting("sceneBattleBack") ? "checked" : ""}> Back to the world map when a battle ends</label></div>`;
    })() : `<div class="foot"><div class="t"><small>Pick a scene.</small></div></div>`;
    const focused = document.activeElement === el.querySelector(".tools input"), caret = el.querySelector(".tools input")?.selectionStart, top = el.querySelector(".body")?.scrollTop ?? 0;
    el.innerHTML = `<div class="hd"><i class="fa-solid fa-map"></i> Scenes<span class="x"><i class="fa-solid fa-xmark"></i></span></div>
      <div class="tools"><input placeholder="Search scenes…" value="${esc(this.q)}"><span class="chip ${this.grp ? "" : "on"}" data-g="">All</span>${groups.map(g => `<span class="chip ${this.grp === g.name ? "on" : ""}" data-g="${esc(g.name)}">${esc(g.name)}</span>`).join("")}<span class="foldall" title="Fold or open every group">${allShut ? "Open all" : "Fold all"}</span></div>
      <div class="body">${body}</div>${foot}`;
    el.querySelector(".body").scrollTop = top;
    // a scene imported from another world can point at a thumbnail that isn't here: try its background, else leave it blank
    for (const im of el.querySelectorAll(".th img")) im.onerror = () => { const bg = im.dataset.bg; if (bg) { im.dataset.bg = ""; im.src = bg; } else im.remove(); };
    el.querySelector(".x").onclick = () => this.toggle(false);
    const inp = el.querySelector(".tools input");
    inp.oninput = () => { this.q = inp.value; this.render(); };
    inp.onkeydown = (e) => { if (e.key === "Escape") { e.stopPropagation(); this.toggle(false); } };
    if (focused) { inp.focus(); inp.setSelectionRange(caret, caret); }
    for (const c of el.querySelectorAll(".chip")) c.onclick = () => { this.grp = c.dataset.g; this.render(); };
    const saveFold = async (set) => { await game.settings.set(SYSTEM_ID, "sceneFolded", [...set]); this.render(); };
    for (const h of el.querySelectorAll(".grp[data-fold]")) h.onclick = () => { const id = h.dataset.fold; folded.has(id) ? folded.delete(id) : folded.add(id); saveFold(folded); };
    el.querySelector(".foldall").onclick = () => { for (const g of shown) allShut ? folded.delete(g.id) : folded.add(g.id); saveFold(folded); };
    for (const c of el.querySelectorAll(".card")) {
      c.onclick = () => { this.sel = c.dataset.id; this.picking = false; this.render(); };
      c.ondblclick = () => { const sc = game.scenes.get(c.dataset.id); if (sc) sendTo(sc); };
    }
    const on = (a, fn) => { const b = el.querySelector(`[data-a="${a}"]`); if (b) b.onclick = fn; };
    on("all", () => s && sendTo(s));
    on("view", () => s?.view());
    on("pick", () => { this.picking = !this.picking; this.render(); });
    on("send", () => { const ids = [...el.querySelectorAll(".pick input:checked")].map(i => i.value); if (s && ids.length) sendTo(s, ids); this.picking = false; this.render(); });
    for (const o of el.querySelectorAll("[data-o]")) o.onchange = () => game.settings.set(SYSTEM_ID, o.dataset.o, o.checked);
    const hd = el.querySelector(".hd");
    hd.onpointerdown = (e) => {
      if (e.target.closest(".x")) return;
      const r = el.getBoundingClientRect(), ox = e.clientX - r.left, oy = e.clientY - r.top;
      const mv = (m) => { this.moved = true; el.style.left = `${Math.max(0, m.clientX - ox)}px`; el.style.top = `${Math.max(0, m.clientY - oy)}px`; };
      const up = () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); };
      window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
    };
  },
};
export const toggleSceneSwitcher = (show) => Switcher.toggle(show);
export const sceneSwitcherOpen = () => Switcher.open();

let refreshT = null;
const soon = () => { clearTimeout(refreshT); refreshT = setTimeout(() => Switcher.refresh(), 100); };
for (const h of ["createScene", "updateScene", "deleteScene", "createFolder", "updateFolder", "deleteFolder", "createToken", "deleteToken", "updateUser", "userConnected", "canvasReady"]) Hooks.on(h, soon);

let wasFighting = null;
Hooks.on("updateSetting", (doc) => {
  if (doc.key === `${SYSTEM_ID}.battle`) {
    const b = game.settings.get(SYSTEM_ID, "battle");
    if (wasFighting && !b?.active && setting("sceneBattleBack") && game.user === game.users.activeGM) {
      const w = worldMap(); if (w && !w.active) sendTo(w);
    }
    wasFighting = !!b?.active; soon();
  }
});

Hooks.once("init", () => {
  game.settings.register(SYSTEM_ID, "sceneFade", { scope: "world", config: false, type: Boolean, default: true });
  game.settings.register(SYSTEM_ID, "sceneFolded", { scope: "client", config: false, type: Array, default: [] });
  game.settings.register(SYSTEM_ID, "sceneBattleBack", { scope: "world", config: false, type: Boolean, default: false });
  game.keybindings.register(SYSTEM_ID, "sceneSwitcher", {
    name: "Scene switcher", hint: "GM: open or close the Scenes window.",
    editable: [{ key: "KeyS", modifiers: ["Shift"] }], restricted: true, onDown: () => { toggleSceneSwitcher(); return true; },
  });
});
Hooks.once("ready", () => {
  try { wasFighting = !!game.settings.get(SYSTEM_ID, "battle")?.active; } catch { wasFighting = false; }
  game.socket.on(SOCKET, (m) => { if (m?.action === "sceneFade" && !game.user.isGM && (!m.users || m.users.includes(game.user.id)) && canvas?.scene?.id !== m.sceneId) fadeOut(); });
});
