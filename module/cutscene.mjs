// Cutscene Maker (David, 2026-11-10). The GM builds a scene in a panel in the top left (officers dragged in from the
// compendium or found by search, a background, saved setups) and presses Play. Black bars slide over the top and bottom
// quarters of everyone's screen; the officers stand in the band between, cut off at the waist by the lower bar, dimmed
// until the GM "displays" them (Display lights one up or dims him, several at once; Switch lights only him). Officers can leave or join (from the right) and the
// rest space out again. Works on any scene, battle or world map. While a scene plays the players can't move the map;
// the GM can, and the camera tools still move the players' views.
// The running scene lives in a world setting, so every client (and anyone joining late) draws the same thing.
import { SYSTEM_ID } from "./config.mjs";
import { fullArtInfo, halfArtInfo } from "./full-art.mjs";

const STATE = "cutscene", SAVED = "cutsceneSaved";
export const MAX_CAST = 5;
/** Pre-set backgrounds: { key, name, src }. None yet: "Empty" (the map shows between the bars) is the only choice. */
export const BACKGROUNDS = [];
const CHAR_PACK = "qin-3k-characters.characters";
const esc = (t) => foundry.utils.escapeHTML?.(String(t ?? "")) ?? String(t ?? "");
const route = (p) => (p && !/^(https?:|data:|\/)/.test(p) ? foundry.utils.getRoute(p) : p);

const state = () => { try { return game.settings.get(SYSTEM_ID, STATE) ?? {}; } catch { return {}; } };
const setState = (s) => game.settings.set(SYSTEM_ID, STATE, s);
const saved = () => { try { return game.settings.get(SYSTEM_ID, SAVED) ?? []; } catch { return []; } };
export const cutsceneActive = () => !!state().active;

/** A cast entry for an actor: the full-body painting when there is one, else the portrait. */
function castEntry(actor) {
  const art = fullArtInfo(actor), half = art ? null : halfArtInfo(actor);       // half-body art: children, drawn smaller than the adults
  return { key: foundry.utils.randomID(8), uuid: actor.uuid, name: actor.name, img: actor.img ?? null, src: art?.src ?? half?.src ?? null, half: !!half, frac: art?.frac ?? null, ...artMetrics(art) };
}
/** Where the face sits in a painting (full-art data: eye line and face height in image px, found by face detection). */
const artMetrics = (art) => art?.eye && art?.h ? { eye: art.eye / art.h, fh: (art.fh ?? 0) / art.h } : {};
/** Height and top (vh) of a whole-figure painting, so every officer's eyes sit on one line (David, 2026-11-10).
 *  Whole-body paintings keep one size; close-up paintings (big face: cut off above the feet) are scaled to the usual face size.
 *  The figure always reaches past the lower bar. */
const EYE_VH = 26.5 + 95.5 * 0.115, FACE = 0.092;
export function figureBox({ eye, fh, frac } = {}) {
  if (!eye) return frac ? { top: 26.5, height: 95.5 * Math.max(frac, 0.53) } : { top: 26.5, height: 95.5 };
  let height = fh > 0.12 || frac ? 95.5 * FACE / fh : 95.5;
  height = Math.max(height, (76 - EYE_VH) / (1 - eye));
  return { top: EYE_VH - eye * height, height };
}
async function actorFromDrop(ev) {
  let d; try { d = JSON.parse(ev.dataTransfer.getData("text/plain")); } catch { return null; }
  if (d?.type !== "Actor" || !d.uuid) return null;
  const a = await fromUuid(d.uuid);
  if (!a || a.type === "unit") { ui.notifications.warn("Drag an officer (a character), not a battle unit."); return null; }
  return a;
}

/* ------------------------------------------------------------------ officer search (compendium + world) */
let index = null;
async function officerIndex() {
  if (index) return index;
  const out = [];
  for (const a of game.actors) if (a.type !== "unit") out.push({ uuid: a.uuid, name: a.name, img: a.img, world: true });
  const pack = game.packs.get(CHAR_PACK);
  if (pack) for (const e of await pack.getIndex({ fields: ["type", "img"] })) if (e.type === "character") out.push({ uuid: e.uuid ?? `Compendium.${CHAR_PACK}.Actor.${e._id}`, name: e.name, img: e.img });
  return (index = out.sort((a, b) => a.name.localeCompare(b.name)));
}
Hooks.on("createActor", () => { index = null; }); Hooks.on("deleteActor", () => { index = null; });
function wireSearch(input, list, onPick) {
  const show = async () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { list.innerHTML = ""; list.style.display = "none"; return; }
    const hits = (await officerIndex()).filter(o => o.name.toLowerCase().includes(q))
      .sort((a, b) => (a.name.toLowerCase().startsWith(q) ? 0 : 1) - (b.name.toLowerCase().startsWith(q) ? 0 : 1)).slice(0, 8);
    list.innerHTML = hits.length ? hits.map(o => `<div class="hit" data-u="${esc(o.uuid)}"><i style="background-image:url('${esc(route(o.img))}')"></i>${esc(o.name)}${o.world ? " <small>world</small>" : ""}</div>`).join("")
      : `<div class="none">No officer by that name.</div>`;
    list.style.display = "block";
    for (const el of list.querySelectorAll(".hit")) el.onclick = async () => {
      const a = await fromUuid(el.dataset.u); input.value = ""; list.style.display = "none"; if (a) onPick(a);
    };
  };
  input.oninput = show;
  input.onkeydown = (e) => { e.stopPropagation(); if (e.key === "Enter") list.querySelector(".hit")?.click(); if (e.key === "Escape") { input.value = ""; show(); } };
}

/* ------------------------------------------------------------------ the scene on screen (every client) */
let root = null, shown = new Map(), names = new Map(), ending = null;
/** The displayed officers' keys (several can be lit at once; older scenes stored one key). */
const litOf = (st) => Array.isArray(st.lit) ? st.lit : st.lit ? [st.lit] : [];
function css() {
  if (document.getElementById("qin-cutscene-css")) return;
  const s = document.createElement("style"); s.id = "qin-cutscene-css";
  s.textContent = `
  #qin-cutscene { position: fixed; inset: 0; z-index: 95; overflow: hidden; pointer-events: auto; font-family: var(--qin-font, Signika, sans-serif); color: #ece6d6; }
  #qin-cutscene.gm { z-index: 5; pointer-events: none; }                  /* the GM keeps the map and the interface */
  #qin-cutscene .bar { position: absolute; left: 0; right: 0; height: 25vh; background: #000; z-index: 5; transition: transform .7s cubic-bezier(.3,.7,.3,1); }
  #qin-cutscene .bar.t { top: 0; transform: translateY(-101%); } #qin-cutscene .bar.b { bottom: 0; transform: translateY(101%); }
  #qin-cutscene.in .bar { transform: none; }
  #qin-cutscene .bg { position: absolute; left: 0; right: 0; top: 25vh; height: 50vh; background-size: cover; background-position: center; opacity: 0; transition: opacity .7s; z-index: 1; }
  #qin-cutscene.in .bg.on { opacity: 1; }
  #qin-cutscene .of { position: absolute; top: 26.5vh; height: 95.5vh; z-index: 3; transform: translateX(-50%); opacity: 0;
    transition: left .7s cubic-bezier(.3,.7,.3,1), opacity .6s, filter .35s; filter: brightness(.38) saturate(.6); pointer-events: none; }
  #qin-cutscene .of { width: max-content; max-width: none; }                /* never squeezed near the edge (5 officers) */
  #qin-cutscene .of img { height: 100%; width: auto; max-width: none; display: block; }
  #qin-cutscene .of.round { top: 31vh; height: 38vh; } #qin-cutscene .of.round img { border-radius: 50%; border: 3px solid #c9a85c; box-shadow: 0 6px 24px rgba(0,0,0,.7); }
  #qin-cutscene .of.half { top: auto; bottom: 25vh; height: 33vh; }      /* head-to-waist art standing on the lower bar, about two thirds of an adult */
  #qin-cutscene .of.here { opacity: 1; }
  #qin-cutscene .of.lit { filter: drop-shadow(0 0 18px rgba(255,236,170,.55)); z-index: 4; }
  #qin-cutscene .of.gone { opacity: 0; }
  #qin-cutscene .nm { position: absolute; z-index: 6; top: calc(75vh - 46px); transform: translateX(-50%); padding: 5px 26px; white-space: nowrap; opacity: 0;
    font-family: "Cinzel", var(--qin-font-display, serif); font-weight: 900; font-size: 22px; letter-spacing: 2px; text-transform: uppercase; color: #fff4d6;
    background: linear-gradient(90deg, transparent, rgba(0,0,0,.85) 20%, rgba(0,0,0,.85) 80%, transparent); border-top: 1px solid #c9a85c; border-bottom: 1px solid #c9a85c;
    transition: opacity .3s, left .7s cubic-bezier(.3,.7,.3,1); }
  #qin-cutscene .nm.on { opacity: 1; }
  .qin-cs-panel { background: linear-gradient(180deg, rgba(30,28,26,.96), rgba(16,15,14,.96)); border: 1px solid rgba(201,168,92,.6); border-radius: 5px;
    box-shadow: 0 4px 16px rgba(0,0,0,.6); color: #ece6d6; font-family: var(--qin-font, Signika, sans-serif); font-size: 13px; user-select: none; }
  #qin-cs-ctl { position: fixed; z-index: 96; left: 50%; bottom: 12px; transform: translateX(-50%); display: flex; gap: 8px; align-items: stretch; padding: 8px 10px; max-width: 96vw; }
  #qin-cs-ctl .card { width: 138px; padding: 6px; border: 1px solid rgba(201,168,92,.35); border-radius: 4px; text-align: center; }
  #qin-cs-ctl .card.on { border-color: #e8c45a; background: rgba(201,168,92,.16); }
  #qin-cs-ctl .card .two { display: flex; gap: 4px; } #qin-cs-ctl .card .two .btn { flex: 1; }
  #qin-cs-ctl .h { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; text-align: left; font-weight: 600; line-height: 1.1; min-height: 32px; }
  .qin-cs-panel i.pt { width: 30px; height: 30px; border-radius: 50%; background-size: cover; background-position: 50% 10%; border: 1px solid #c9a85c; flex: none; }
  .qin-cs-panel .btn { display: block; padding: 4px 6px; margin-top: 4px; border: 1px solid rgba(201,168,92,.6); border-radius: 3px; cursor: pointer; text-align: center; }
  .qin-cs-panel .btn:hover { background: rgba(201,168,92,.22); }
  .qin-cs-panel .btn.on { background: #c9a85c; color: #1a1612; font-weight: 700; }
  .qin-cs-panel .btn.red { border-color: #a8402f; color: #f0b0a0; } .qin-cs-panel .btn.red:hover { background: rgba(168,64,47,.3); }
  .qin-cs-panel .btn.off { opacity: .4; pointer-events: none; }
  #qin-cs-ctl .add { position: relative; width: 150px; padding: 6px; border: 2px dashed rgba(201,168,92,.55); border-radius: 4px; display: flex; flex-direction: column; justify-content: center; gap: 4px; font-size: 12px; color: #c9c2b0; text-align: center; }
  #qin-cs-ctl .add.over, #qin-cs-build .drop.over { border-color: #e8c45a; background: rgba(201,168,92,.18); }
  #qin-cs-ctl .end { width: 96px; display: flex; align-items: center; justify-content: center; border: 1px solid #a8402f; border-radius: 4px; background: rgba(168,64,47,.25); font-weight: 700; color: #ffd9cf; cursor: pointer; }
  #qin-cs-ctl .end:hover { background: rgba(168,64,47,.5); }
  .qin-cs-panel input, .qin-cs-panel select { width: 100%; height: 26px; box-sizing: border-box; background: rgba(0,0,0,.45); color: #ece6d6; border: 1px solid rgba(201,168,92,.4); border-radius: 3px; font-size: 13px; }
  .qin-cs-panel .hits { display: none; position: absolute; left: 0; right: 0; z-index: 3; background: #171513; border: 1px solid rgba(201,168,92,.6); border-radius: 3px; max-height: 260px; overflow: auto; text-align: left; }
  #qin-cs-ctl .hits { bottom: 100%; margin-bottom: 4px; left: -40px; right: -40px; }
  .qin-cs-panel .hit { display: flex; align-items: center; gap: 7px; padding: 4px 7px; cursor: pointer; color: #ece6d6; font-size: 13px; }
  .qin-cs-panel .hit:hover { background: rgba(201,168,92,.22); } .qin-cs-panel .hit small { color: #8f897b; margin-left: auto; }
  .qin-cs-panel .hit i { width: 24px; height: 24px; border-radius: 50%; background-size: cover; background-position: 50% 10%; flex: none; }
  .qin-cs-panel .none { padding: 5px 7px; color: #8f897b; font-style: italic; font-size: 12px; }
  #qin-cs-build { position: fixed; z-index: 97; left: 70px; top: 70px; width: 300px; padding: 9px 12px 12px; display: none; }
  #qin-cs-build .hd { display: flex; align-items: center; font-family: "Cinzel", var(--qin-font-display, serif); font-weight: 900; font-size: 16px; letter-spacing: 1px; text-transform: uppercase; color: #fff4d6; cursor: move; }
  #qin-cs-build .hd .x { margin-left: auto; cursor: pointer; color: #c9c2b0; } #qin-cs-build .hd .x:hover { color: #fff; }
  #qin-cs-build .sec { margin-top: 9px; padding-top: 7px; border-top: 1px solid rgba(236,230,214,.18); position: relative; }
  #qin-cs-build .lb { font-size: 11px; letter-spacing: 1px; text-transform: uppercase; color: #b9b2a0; margin-bottom: 5px; }
  #qin-cs-build .row { display: flex; align-items: center; gap: 8px; padding: 3px 0; }
  #qin-cs-build .row b { flex: 1; font-weight: 500; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #qin-cs-build .row .a { cursor: pointer; color: #c9c2b0; padding: 0 3px; } #qin-cs-build .row .a:hover { color: #fff; }
  #qin-cs-build .row small { color: #c98a6a; }
  #qin-cs-build .drop { margin-top: 6px; padding: 9px; border: 2px dashed rgba(201,168,92,.45); border-radius: 4px; text-align: center; color: #b9b2a0; font-size: 12px; }
  #qin-cs-build .three { display: flex; gap: 6px; } #qin-cs-build .three .btn { flex: 1; }
  #qin-cs-build .play { margin-top: 10px; padding: 7px; font-size: 14px; }`;
  document.head.appendChild(s);
}
const slot = (i, n) => `${((i + 1) / (n + 1)) * 100}%`;

function render() {
  const st = state();
  if (!st.active) return teardown();
  css();
  if (ending) { clearTimeout(ending.t); ending.r.remove(); ending = null; }
  const fresh = !root || root.dataset.id !== st.id;
  if (fresh) {
    root?.remove(); shown = new Map(); names = new Map();
    root = document.createElement("div"); root.id = "qin-cutscene"; root.dataset.id = st.id;
    root.classList.toggle("gm", game.user.isGM);
    root.innerHTML = `<div class="bg"></div><div class="bar t"></div><div class="bar b"></div>`;
    for (const t of ["wheel", "pointerdown", "contextmenu", "dblclick"]) root.addEventListener(t, (e) => { if (!game.user.isGM) { e.preventDefault(); e.stopPropagation(); } }, { passive: false });
    document.body.appendChild(root);
    void root.offsetWidth; setTimeout(() => root?.classList.add("in"), 30);    // not rAF: a hidden or background tab may never fire it
  }
  const bg = BACKGROUNDS.find(b => b.key === st.bg), bgEl = root.querySelector(".bg");
  bgEl.classList.toggle("on", !!bg); bgEl.style.backgroundImage = bg ? `url('${route(bg.src)}')` : "";
  const cast = st.cast ?? [], n = cast.length;
  const lit = litOf(st);
  for (const [key, el] of shown) if (!cast.some(c => c.key === key)) {          // left the scene
    shown.delete(key); el.classList.remove("here", "lit"); el.classList.add("gone"); setTimeout(() => el.remove(), 700);
    const nm = names.get(key); names.delete(key); if (nm) { nm.classList.remove("on"); setTimeout(() => nm.remove(), 400); }
  }
  cast.forEach((c, i) => {
    let el = shown.get(c.key);
    if (!el) {
      el = document.createElement("div"); el.className = "of" + (c.half ? " half" : c.src ? "" : " round");
      const img = document.createElement("img"); img.src = route(c.src ?? c.img ?? "icons/svg/mystery-man.svg"); img.alt = ""; img.draggable = false; el.appendChild(img);
      // the opening cast fades in where it stands; anyone added later walks in from the right
      if (c.src && !c.half) {                     // eyes on one line (older saved scenes look the numbers up again)
        const m = c.eye ? c : { ...artMetrics(fullArtInfo(fromUuidSync(c.uuid))), frac: c.frac };
        const b = figureBox(m); el.style.top = `${b.top}vh`; el.style.height = `${b.height}vh`;
      }
      el.style.left = fresh ? slot(i, n) : "112%";
      root.appendChild(el); shown.set(c.key, el);
      void el.offsetWidth;
      setTimeout(() => el.classList.add("here"), fresh ? 650 : 30);
    }
    setTimeout(() => { el.style.left = slot(i, n); }, 30);
    el.classList.toggle("lit", lit.includes(c.key));
    // every displayed officer gets his name under him
    let nm = names.get(c.key);
    if (!nm) { nm = document.createElement("div"); nm.className = "nm"; root.appendChild(nm); names.set(c.key, nm); }
    nm.textContent = c.name; nm.style.left = slot(i, n); nm.classList.toggle("on", lit.includes(c.key));
  });
  renderControls(st);
}
function teardown() {
  ctl?.remove(); ctl = null;
  if (!root || ending) return;
  const r = root; root = null; shown = new Map(); names = new Map();
  for (const el of r.querySelectorAll(".of")) el.classList.remove("here", "lit");
  for (const nm of r.querySelectorAll(".nm")) nm.classList.remove("on");
  r.classList.remove("in");
  ending = { r, t: setTimeout(() => { r.remove(); ending = null; }, 800) };
  Builder.refresh();
}
// players can't move the map with the keyboard either while a scene plays
window.addEventListener("keydown", (e) => {
  if (!root || game.user?.isGM) return;
  const t = e.target; if (t?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t?.tagName)) return;
  if (/^(Key[WASDQE]|Arrow(Up|Down|Left|Right)|Page(Up|Down)|Numpad[0-9]|NumpadAdd|NumpadSubtract|Equal|Minus)$/.test(e.code)) { e.stopImmediatePropagation(); e.preventDefault(); }
}, true);

/* ------------------------------------------------------------------ GM: running the scene */
export async function playCutscene(cast, bg = null) {
  if (!game.user.isGM) return;
  const list = (cast ?? []).slice(0, MAX_CAST).map(c => ({ ...c, key: foundry.utils.randomID(8) }));
  if (!list.length) return ui.notifications.warn("Add at least one officer to the scene first.");
  await setState({ active: true, id: foundry.utils.randomID(8), bg: bg || null, cast: list, lit: [] });
}
export async function endCutscene() { if (game.user.isGM) await setState({ active: false }); }
async function patch(fn) { const st = foundry.utils.deepClone(state()); if (!st.active) return; fn(st); await setState(st); }
// Display toggles one officer on or off (several can be lit); Switch makes him the only one lit (David, 2026-11-11)
const display = (key) => patch(st => { const l = litOf(st); st.lit = l.includes(key) ? l.filter(k => k !== key) : [...l, key]; });
const switchTo = (key) => patch(st => { st.lit = [key]; });
const leave = (key) => patch(st => { st.cast = st.cast.filter(c => c.key !== key); st.lit = litOf(st).filter(k => k !== key); });
async function join(actor) {
  if ((state().cast?.length ?? 0) >= MAX_CAST) return ui.notifications.warn(`A scene holds up to ${MAX_CAST} officers. Have one leave first.`);
  await patch(st => { st.cast.push(castEntry(actor)); });
}

let ctl = null;
function renderControls(st) {
  if (!game.user.isGM) return;
  ctl ??= Object.assign(document.createElement("div"), { id: "qin-cs-ctl", className: "qin-cs-panel" });
  if (!ctl.isConnected) document.body.appendChild(ctl);
  const typing = ctl.querySelector("input") === document.activeElement ? ctl.querySelector("input").value : null;
  const full = st.cast.length >= MAX_CAST;
  const lit = litOf(st);
  ctl.innerHTML = st.cast.map(c => { const on = lit.includes(c.key); return `<div class="card ${on ? "on" : ""}" data-k="${c.key}">
      <div class="h"><i class="pt" style="background-image:url('${esc(route(c.img ?? c.src))}')"></i><span>${esc(c.name)}</span></div>
      <div class="two"><span class="btn ${on ? "on" : ""}" data-a="display" title="Light this officer up or dim him again; several can be lit at once">${on ? "Displayed" : "Display"}</span>
      <span class="btn ${on && lit.length === 1 ? "on" : ""}" data-a="switch" title="Light only this officer; everyone else dims">Switch</span></div>
      <span class="btn red" data-a="leave" title="This officer leaves the scene; the others space out again">Leave</span></div>`; }).join("")
    + `<div class="add" title="Drag an officer here from the compendium or the Actors tab; they walk in from the right">${full ? `Scene is full (${MAX_CAST})` : `<span><i class="fa-solid fa-user-plus"></i> Drag an officer here</span><input placeholder="or search…"><div class="hits"></div>`}</div>
    <div class="end" data-a="end"><span><i class="fa-solid fa-stop"></i> End scene</span></div>`;
  for (const card of ctl.querySelectorAll(".card")) {
    card.querySelector('[data-a="display"]').onclick = () => display(card.dataset.k);
    card.querySelector('[data-a="switch"]').onclick = () => switchTo(card.dataset.k);
    card.querySelector('[data-a="leave"]').onclick = () => leave(card.dataset.k);
  }
  ctl.querySelector(".end").onclick = () => endCutscene();
  const add = ctl.querySelector(".add"), inp = add.querySelector("input");
  if (inp) { wireSearch(inp, add.querySelector(".hits"), join); if (typing != null) { inp.value = typing; inp.focus(); } }
  add.ondragover = (e) => { e.preventDefault(); add.classList.add("over"); };
  add.ondragleave = () => add.classList.remove("over");
  add.ondrop = async (e) => { e.preventDefault(); e.stopPropagation(); add.classList.remove("over"); const a = await actorFromDrop(e); if (a) join(a); };
}

/* ------------------------------------------------------------------ GM: the Cutscene Maker panel (top left) */
const draft = { cast: [], bg: "", sel: "" };
const Builder = {
  el: null,
  toggle(show) {
    if (!game.user.isGM) return;
    css();
    this.el ??= Object.assign(document.createElement("div"), { id: "qin-cs-build", className: "qin-cs-panel" });
    if (!this.el.isConnected) document.body.appendChild(this.el);
    show ??= this.el.style.display !== "block";
    this.el.style.display = show ? "block" : "none";
    if (show) { const c = document.getElementById("scene-controls")?.getBoundingClientRect(); if (c?.width && !this.moved) this.el.style.left = `${Math.round(c.right + 12)}px`; }
    this.refresh();
  },
  refresh() {
    const el = this.el; if (!el || el.style.display !== "block") return;
    const list = saved(), playing = cutsceneActive(), full = draft.cast.length >= MAX_CAST;
    el.innerHTML = `<div class="hd">Cutscene Maker<span class="x"><i class="fa-solid fa-xmark"></i></span></div>
      <div class="sec"><div class="lb">Officers, left to right (${draft.cast.length}/${MAX_CAST})</div>
        ${draft.cast.map((c, i) => `<div class="row" data-i="${i}"><i class="pt" style="background-image:url('${esc(route(c.img ?? c.src))}')"></i><b title="${esc(c.name)}">${esc(c.name)}${c.src ? "" : ` <small title="No full-body painting: the round portrait is shown instead">portrait</small>`}</b>
          <span class="a" data-a="up" title="Move left"><i class="fa-solid fa-arrow-up"></i></span><span class="a" data-a="down" title="Move right"><i class="fa-solid fa-arrow-down"></i></span><span class="a" data-a="del" title="Remove"><i class="fa-solid fa-xmark"></i></span></div>`).join("")}
        ${full ? "" : `<input class="q" placeholder="Search officers…"><div class="hits"></div>`}
        <div class="drop">${full ? `The scene is full (${MAX_CAST}).` : "or drag officers here from the compendium"}</div></div>
      <div class="sec"><div class="lb">Background</div>
        <select class="bg"><option value="">Empty (the map shows through)</option>${BACKGROUNDS.map(b => `<option value="${b.key}" ${draft.bg === b.key ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select></div>
      <div class="sec"><div class="lb">Saved scenes</div>
        <select class="sv"><option value="">${list.length ? "Choose a saved scene…" : "None saved yet"}</option>${list.map(s => `<option value="${s.id}" ${draft.sel === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select>
        <div class="three"><span class="btn ${draft.sel ? "" : "off"}" data-a="save" title="Save over the chosen scene">Save</span><span class="btn" data-a="saveas">Save as…</span><span class="btn red ${draft.sel ? "" : "off"}" data-a="delete">Delete</span></div></div>
      <span class="btn on play ${playing ? "off" : ""}" data-a="play"><i class="fa-solid fa-play"></i> ${playing ? "A scene is playing" : "Play"}</span>`;
    el.querySelector(".x").onclick = () => this.toggle(false);
    for (const row of el.querySelectorAll(".row")) {
      const i = Number(row.dataset.i), mv = (d) => { const j = i + d; if (j < 0 || j >= draft.cast.length) return; [draft.cast[i], draft.cast[j]] = [draft.cast[j], draft.cast[i]]; this.refresh(); };
      row.querySelector('[data-a="up"]').onclick = () => mv(-1); row.querySelector('[data-a="down"]').onclick = () => mv(1);
      row.querySelector('[data-a="del"]').onclick = () => { draft.cast.splice(i, 1); this.refresh(); };
    }
    const add = (a) => { if (draft.cast.length >= MAX_CAST) return ui.notifications.warn(`A scene holds up to ${MAX_CAST} officers.`); draft.cast.push(castEntry(a)); this.refresh(); el.querySelector(".q")?.focus(); };
    const q = el.querySelector(".q"); if (q) wireSearch(q, el.querySelector(".hits"), add);
    el.ondragover = (e) => { e.preventDefault(); el.querySelector(".drop").classList.add("over"); };
    el.ondragleave = () => el.querySelector(".drop")?.classList.remove("over");
    el.ondrop = async (e) => { e.preventDefault(); e.stopPropagation(); const a = await actorFromDrop(e); if (a) add(a); else el.querySelector(".drop")?.classList.remove("over"); };
    el.querySelector(".bg").onchange = (e) => { draft.bg = e.target.value; };
    el.querySelector(".sv").onchange = async (e) => { draft.sel = e.target.value; const s = saved().find(x => x.id === draft.sel); if (s) await loadSaved(s); this.refresh(); };
    const store = async (id, name) => {
      const entry = { id, name, bg: draft.bg || null, cast: draft.cast.map(c => ({ uuid: c.uuid, name: c.name })) };
      const l = saved().filter(s => s.id !== id); l.push(entry); l.sort((a, b) => a.name.localeCompare(b.name));
      await game.settings.set(SYSTEM_ID, SAVED, l); draft.sel = id; this.refresh(); ui.notifications.info(`Saved the scene "${name}".`);
    };
    el.querySelector('[data-a="save"]').onclick = () => { const s = saved().find(x => x.id === draft.sel); if (s) store(s.id, s.name); };
    el.querySelector('[data-a="saveas"]').onclick = async () => {
      if (!draft.cast.length) return ui.notifications.warn("Add at least one officer first.");
      let name = null;
      try { name = await foundry.applications.api.DialogV2.prompt({ window: { title: "Save scene" }, content: `<input name="n" type="text" placeholder="Scene name" autofocus style="width:100%">`, ok: { label: "Save", callback: (ev, btn) => btn.form.elements.n.value.trim() }, rejectClose: false }); } catch { name = null; }
      if (name) store(foundry.utils.randomID(8), name);
    };
    el.querySelector('[data-a="delete"]').onclick = async () => { await game.settings.set(SYSTEM_ID, SAVED, saved().filter(s => s.id !== draft.sel)); draft.sel = ""; this.refresh(); };
    el.querySelector('[data-a="play"]').onclick = () => playCutscene(draft.cast, draft.bg);
    // drag the panel by its title
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
async function loadSaved(s) {
  const cast = [];
  for (const c of s.cast ?? []) { const a = await fromUuid(c.uuid).catch(() => null); if (a) cast.push(castEntry(a)); else ui.notifications.warn(`${c.name} is no longer in the world or the compendium; left out.`); }
  draft.cast = cast; draft.bg = s.bg ?? "";
}
export const toggleCutsceneMaker = (show) => Builder.toggle(show);

/* ------------------------------------------------------------------ setup */
Hooks.once("init", () => {
  game.settings.register(SYSTEM_ID, STATE, { scope: "world", config: false, type: Object, default: { active: false }, onChange: () => { render(); Builder.refresh(); } });
  game.settings.register(SYSTEM_ID, SAVED, { scope: "world", config: false, type: Array, default: [], onChange: () => Builder.refresh() });
  game.keybindings.register(SYSTEM_ID, "cutsceneMaker", {
    name: "Cutscene Maker", hint: "GM: open or close the Cutscene Maker panel.",
    editable: [{ key: "KeyU", modifiers: ["Shift"] }], restricted: true, onDown: () => { toggleCutsceneMaker(); return true; },
  });
});
Hooks.once("ready", () => { render(); });
Hooks.on("getSceneControlButtons", (controls) => {
  if (!game.user?.isGM) return;
  const tool = { name: "qinCutscene", title: "Cutscene Maker", icon: "fa-solid fa-clapperboard", order: 103, button: true, visible: true, onChange: () => toggleCutsceneMaker() };
  if (Array.isArray(controls)) controls.find(c => c.name === "token")?.tools.push({ ...tool, onClick: tool.onChange });
  else if (controls.tokens?.tools) controls.tokens.tools.qinCutscene = tool;
});
