// Cutscene Maker (David, 2026-11-10). The GM builds a scene in a panel in the top left (officers dragged in from the
// compendium or found by search, a background, saved setups) and presses Play. Black bars slide over the top and bottom
// quarters of everyone's screen; the officers stand in the band between, cut off at the waist by the lower bar, dimmed
// until the GM "displays" them (Display lights one up or dims him, several at once; Switch lights only him). Officers can leave or join (from the right) and the
// rest space out again. Works on any scene, battle or world map. While a scene plays the players can't move the map;
// the GM can, and the camera tools still move the players' views.
// The running scene lives in a world setting, so every client (and anyone joining late) draws the same thing.
// Cutscenes (David, 2026-11-15): a saved scene also keeps a list of steps (enter, leave, display, switch, injure, battle,
// clash, end battle). Record plays the scene and turns each live action into the next step; Play then runs them one at a
// time with Next (Space / →) and Back (←), from a bar only the GM sees.
import { SYSTEM_ID } from "./config.mjs";
import { fullArtInfo, halfArtInfo } from "./full-art.mjs";
import { playMoment } from "./sound.mjs";
import { userKnows, revealOfficer } from "./officer-codex.mjs";

const STATE = "cutscene", SAVED = "cutsceneSaved";
export const MAX_CAST = 5;
/** Pre-set backgrounds: { key, name, src, thumb?, group? }. The system ships none ("Empty": the map shows between the bars);
 *  a module adds its own with game.qin.registerCutsceneBackgrounds([...]). */
export const BACKGROUNDS = [];
/** Add backgrounds (a later entry with the same key replaces the earlier one). Called by modules, e.g. at "setup". */
export function registerCutsceneBackgrounds(list) {
  for (const b of list ?? []) {
    if (!b?.key || !b.src) { console.warn("Qin | a cutscene background needs { key, name, src }", b); continue; }
    const i = BACKGROUNDS.findIndex(x => x.key === b.key), entry = { key: b.key, name: b.name ?? b.key, src: b.src, thumb: b.thumb ?? null, group: b.group ?? null };
    if (i >= 0) BACKGROUNDS[i] = entry; else BACKGROUNDS.push(entry);
  }
  Builder.refresh?.();
}
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
const artMetrics = (art) => art?.eye && art?.h ? { eye: art.eye / art.h, fh: (art.fh ?? 0) / art.h, ...(art.fx && art.w ? { fx: art.fx / art.w } : {}) } : {};
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
  // one entry per officer (David, 2026-11-17: Gongsun Zan showed three times): the compendium's, plus a world copy only
  // when it looks different (its own art); the animation bench's imported copies are left out
  const comp = new Map();
  const pack = game.packs.get(CHAR_PACK);
  if (pack) for (const e of await pack.getIndex({ fields: ["type", "img"] })) if (e.type === "character") {
    const uuid = e.uuid ?? `Compendium.${CHAR_PACK}.Actor.${e._id}`; comp.set(uuid, e.img); out.push({ uuid, name: e.name, img: e.img }); }
  const seen = new Set();
  for (const a of game.actors) {
    if (a.type === "unit" || a.getFlag?.(SYSTEM_ID, "benchSource")) continue;
    const src = a._stats?.compendiumSource ?? a.flags?.core?.sourceId ?? null;
    if (src && comp.has(src) && comp.get(src) === a.img) continue;            // a plain copy of a compendium officer
    const k = (src ?? a.name) + "|" + a.img; if (seen.has(k)) continue; seen.add(k);
    out.push({ uuid: a.uuid, name: a.name, img: a.img, world: true });
  }
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
let root = null, shown = new Map(), names = new Map(), ending = null, seenHurt = null, seenClash = null;
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
  #qin-cutscene.in.full .bar.t { transform: translateY(-101%); } #qin-cutscene.in.full .bar.b { transform: translateY(101%); }   /* full screen: no black bars (David, 2026-11-17) */
  #qin-cutscene.full .bg { top: 0; height: 100vh; }
  #qin-cutscene .bg { position: absolute; left: 0; right: 0; top: 25vh; height: 50vh; background-size: cover; background-position: center; opacity: 0; transition: opacity .7s, top .7s cubic-bezier(.3,.7,.3,1), height .7s cubic-bezier(.3,.7,.3,1); z-index: 1; }
  #qin-cutscene.in .bg.on { opacity: 1; }
  #qin-cutscene .of { position: absolute; top: 26.5vh; height: 95.5vh; z-index: 3; transform: translateX(-50%); opacity: 0;
    transition: left .7s cubic-bezier(.3,.7,.3,1), transform .7s cubic-bezier(.3,.7,.3,1), opacity .6s, filter .35s; filter: brightness(.38) saturate(.6); pointer-events: none; }
  #qin-cutscene .of { width: max-content; max-width: none; }                /* never squeezed near the edge (5 officers) */
  #qin-cutscene .of img { height: 100%; width: auto; max-width: none; display: block; }
  #qin-cutscene .of.round { top: 31vh; height: 38vh; } #qin-cutscene .of.round img { border-radius: 50%; border: 3px solid #c9a85c; box-shadow: 0 6px 24px rgba(0,0,0,.7); }
  #qin-cutscene .of.half { top: auto; bottom: 25vh; height: 33vh; }      /* head-to-waist art standing on the lower bar, about two thirds of an adult */
  #qin-cutscene .of.here { opacity: 1; }
  #qin-cutscene .of.lit { filter: drop-shadow(0 0 18px rgba(255,236,170,.55)); z-index: 4; }
  /* leaving (David, 2026-11-17): a slower fade while sliding toward the nearer edge of the screen, darkening */
  #qin-cutscene .of.gone { opacity: 0; transform: translateX(calc(-50% + var(--qin-exit, 0px))); filter: brightness(.2) saturate(.6);
    transition: opacity 1.6s cubic-bezier(.4,0,.6,1), transform 1.6s cubic-bezier(.4,0,.6,1), filter 1.6s; }
  /* roll cards made during a cutscene show on screen too (David, 2026-11-17) */
  #qin-cutscene .rolls { position: absolute; right: 18px; top: calc(25vh + 10px); width: 320px; max-height: calc(50vh - 20px); z-index: 8; display: flex; flex-direction: column; gap: 8px; overflow: hidden; }
  #qin-cutscene.gm .rolls { pointer-events: none; }
  #qin-cutscene .rolls .qin-cs-roll { background: rgba(20,18,16,.94); border: 1px solid #c9a85c; border-radius: 6px; padding: 4px; color: #ece6d6; box-shadow: 0 6px 20px rgba(0,0,0,.6);
    animation: qinCsRollIn .35s ease-out; transition: opacity .6s; list-style: none; }
  #qin-cutscene .rolls .qin-cs-roll.out { opacity: 0; }
  #qin-cutscene .rolls .qin-cs-roll .chat-message { margin: 0; }
  @keyframes qinCsRollIn { from { opacity: 0; transform: translateX(30px); } to { opacity: 1; transform: none; } }
  /* Injure (David, 2026-11-11): a blade streak, a gash on the chest, a red flash and a shake */
  #qin-cutscene .hurt { position: absolute; width: 0; height: 0; overflow: visible; pointer-events: none; z-index: 4; }
  #qin-cutscene .hurt svg { position: absolute; overflow: visible; transform: translate(-50%, -50%); }
  #qin-cutscene .nm { position: absolute; z-index: 6; top: calc(75vh - 46px); transform: translateX(-50%); padding: 5px 26px; white-space: nowrap; opacity: 0;
    font-family: "Cinzel", var(--qin-font-display, serif); font-weight: 900; font-size: 22px; letter-spacing: 2px; text-transform: uppercase; color: #fff4d6;
    background: linear-gradient(90deg, transparent, rgba(0,0,0,.85) 20%, rgba(0,0,0,.85) 80%, transparent); border-top: 1px solid #c9a85c; border-bottom: 1px solid #c9a85c;
    transition: opacity .3s, left .7s cubic-bezier(.3,.7,.3,1); }
  #qin-cutscene .nm.on { opacity: 1; }
  /* Battle (David, 2026-11-11): the fighters face off in the middle, the others stand aside smaller; Clash plays three quick blows */
  #qin-cutscene .clash { position: absolute; z-index: 7; width: 0; height: 0; pointer-events: none; }
  #qin-cutscene .clash svg { position: absolute; transform: translate(-50%, -50%); overflow: visible; }
  #qin-cs-ctl.battle { left: 0; right: 0; transform: none; max-width: none; background: none; border: 0; box-shadow: none; padding: 0; height: 0; bottom: 12px; overflow: visible; }
  #qin-cs-ctl.battle .card { position: absolute; bottom: 0; transition: left .7s cubic-bezier(.3,.7,.3,1); background: linear-gradient(180deg, rgba(30,28,26,.96), rgba(16,15,14,.96)); border-color: rgba(201,168,92,.6); }
  #qin-cs-ctl.battle .card.on { background: linear-gradient(180deg, rgba(64,54,30,.97), rgba(36,30,18,.97)); border-color: #e8c45a; }
  #qin-cs-ctl.battle .mid { position: absolute; bottom: 0; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; gap: 6px; width: 132px; }
  #qin-cs-ctl .clashbtn { height: 70px; display: flex; align-items: center; justify-content: center; border: 2px solid #ffb39d; border-radius: 5px; cursor: pointer;
    background: linear-gradient(#c94a3a, #8a2418); color: #fff; font-weight: 800; font-size: 18px; letter-spacing: 1px; box-shadow: 0 4px 16px rgba(0,0,0,.6); }
  #qin-cs-ctl .clashbtn:hover { filter: brightness(1.15); }
  #qin-cs-ctl .mid .end { width: auto; height: 30px; background: rgba(60,20,14,.95); }
  #qin-cs-ctl .battlebtn { width: 96px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; border: 1px solid #c9a85c; border-radius: 4px; background: rgba(201,168,92,.18); font-weight: 700; color: #fff4d6; cursor: pointer; text-align: center; }
  #qin-cs-ctl .battlebtn:hover { background: rgba(201,168,92,.35); }
  #qin-cs-ctl .battlebtn.go { background: #e8c45a; color: #1b140b; border-color: #e8c45a; } #qin-cs-ctl .battlebtn.go small { font-weight: 400; }
  #qin-cs-ctl .battlebtn.off { opacity: .45; pointer-events: none; }
  #qin-cs-ctl .side { display: flex; margin-top: 4px; border: 1px solid rgba(201,168,92,.6); border-radius: 3px; overflow: hidden; }
  #qin-cs-ctl .side span { flex: 1; padding: 3px 0; cursor: pointer; text-align: center; } #qin-cs-ctl .side span + span { border-left: 1px solid rgba(201,168,92,.4); }
  #qin-cs-ctl .side span:hover { background: rgba(201,168,92,.22); }
  #qin-cs-ctl .side .L { background: #2f5f8a; color: #fff; font-weight: 700; } #qin-cs-ctl .side .R { background: #a8402f; color: #fff; font-weight: 700; }
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
  #qin-cs-ctl .sidesbtn { width: 78px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; border: 1px solid rgba(201,168,92,.6); border-radius: 4px; cursor: pointer; font-weight: 700; color: #fff4d6; }
  #qin-cs-ctl .sidesbtn small { font-weight: 400; font-size: 11px; color: #b9b2a0; } #qin-cs-ctl .sidesbtn:hover { background: rgba(201,168,92,.2); }
  #qin-cs-ctl .sidesbtn.on { background: #c9a85c; color: #1a1612; } #qin-cs-ctl .sidesbtn.on small { color: #3a2f1c; }
  #qin-cs-ctl .bgctl { width: 84px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; border: 1px solid rgba(201,168,92,.6); border-radius: 4px; cursor: pointer; }
  #qin-cs-ctl .bgctl:hover { background: rgba(201,168,92,.2); }
  #qin-cs-ctl .bgctl i { width: 64px; height: 36px; border-radius: 3px; background: center/cover #222; border: 1px solid rgba(201,168,92,.4); }
  #qin-cs-ctl .bgctl i.none { background: repeating-linear-gradient(45deg, #2b2a27 0 6px, #232220 6px 12px); }
  #qin-cs-ctl .bgctl small { font-size: 11px; color: #e8d9b0; max-width: 78px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .qin-cs-panel input, .qin-cs-panel select { width: 100%; height: 26px; box-sizing: border-box; background: rgba(0,0,0,.45); color: #ece6d6; border: 1px solid rgba(201,168,92,.4); border-radius: 3px; font-size: 13px; }
  .qin-cs-panel .hits { display: none; position: absolute; left: 0; right: 0; z-index: 3; background: #171513; border: 1px solid rgba(201,168,92,.6); border-radius: 3px; max-height: 260px; overflow: auto; text-align: left; }
  #qin-cs-ctl .hits { bottom: 100%; margin-bottom: 4px; left: -40px; right: -40px; }
  .qin-cs-panel .hit { display: flex; align-items: center; gap: 7px; padding: 4px 7px; cursor: pointer; color: #ece6d6; font-size: 13px; }
  .qin-cs-panel .hit:hover { background: rgba(201,168,92,.22); } .qin-cs-panel .hit small { color: #8f897b; margin-left: auto; }
  .qin-cs-panel .hit i { width: 24px; height: 24px; border-radius: 50%; background-size: cover; background-position: 50% 10%; flex: none; }
  .qin-cs-panel .none { padding: 5px 7px; color: #8f897b; font-style: italic; font-size: 12px; }
  #qin-cs-build .bgbtn { display: flex; gap: 9px; align-items: center; padding: 5px; border: 1px solid rgba(201,168,92,.6); border-radius: 4px; background: rgba(0,0,0,.35); cursor: pointer; }
  #qin-cs-build .bgbtn:hover { background: rgba(201,168,92,.16); }
  #qin-cs-build .bgbtn i { width: 96px; height: 54px; flex: none; border-radius: 3px; background: center/cover #222; border: 1px solid rgba(201,168,92,.4); }
  #qin-cs-build .bgbtn i.none, #qin-cs-bgpick .card.empty .pic { background: repeating-linear-gradient(45deg, #2b2a27 0 10px, #232220 10px 20px); }
  #qin-cs-build .bgbtn b { display: block; color: #fff4d6; font-weight: 600; } #qin-cs-build .bgbtn small { color: #b9b2a0; }
  #qin-cs-build .bgbtn .chg { margin-left: auto; padding: 3px 8px; border: 1px solid rgba(201,168,92,.6); border-radius: 3px; font-size: 12px; flex: none; }
  #qin-cs-bgpick { position: fixed; z-index: 99; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(1090px, 94vw); height: min(820px, 90vh); padding: 12px 14px; display: none; flex-direction: column; box-sizing: border-box; }
  #qin-cs-bgpick .hd { display: flex; align-items: center; font-family: "Cinzel", var(--qin-font-display, serif); font-weight: 900; font-size: 16px; letter-spacing: 1px; text-transform: uppercase; color: #fff4d6; }
  #qin-cs-bgpick .hd .x { margin-left: auto; cursor: pointer; color: #c9c2b0; } #qin-cs-bgpick .hd .x:hover { color: #fff; }
  #qin-cs-bgpick .tools { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 10px; }
  #qin-cs-bgpick .tools input { width: 260px; height: 28px; }
  #qin-cs-bgpick .chip { padding: 3px 10px; border: 1px solid rgba(201,168,92,.45); border-radius: 12px; font-size: 12px; color: #d9d2bf; cursor: pointer; }
  #qin-cs-bgpick .chip:hover { background: rgba(201,168,92,.18); } #qin-cs-bgpick .chip.on { background: #c9a85c; color: #1a1612; border-color: #c9a85c; font-weight: 700; }
  #qin-cs-bgpick .grid { margin-top: 10px; overflow: auto; flex: 1; display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px; align-content: start; padding-right: 4px; }
  #qin-cs-bgpick .grp { grid-column: 1 / -1; font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; color: #c9a85c; border-bottom: 1px solid rgba(201,168,92,.3); padding: 6px 0 3px; }
  #qin-cs-bgpick .card { border: 1px solid rgba(236,230,214,.15); border-radius: 4px; padding: 5px; background: rgba(0,0,0,.25); cursor: pointer; }
  #qin-cs-bgpick .card:hover { border-color: rgba(232,196,90,.6); background: rgba(201,168,92,.08); }
  #qin-cs-bgpick .card.sel { border-color: #e8c45a; box-shadow: 0 0 0 1px #e8c45a inset; background: rgba(201,168,92,.14); }
  #qin-cs-bgpick .card .pic { aspect-ratio: 16 / 9; border-radius: 3px; background: center/cover #222; display: flex; align-items: center; justify-content: center; }
  #qin-cs-bgpick .card .pic span { color: #b9b2a0; font-size: 12px; font-style: italic; }
  #qin-cs-bgpick .card b { display: block; margin-top: 5px; font-weight: 600; color: #ece6d6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #qin-cs-bgpick .card small { color: #8f897b; font-size: 11px; }
  #qin-cs-bgpick .none { grid-column: 1 / -1; color: #8f897b; font-style: italic; padding: 8px 2px; }
  #qin-cs-bgpick .foot { display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(236,230,214,.18); }
  #qin-cs-bgpick .foot .btn { width: 120px; margin: 0; }
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
  #qin-cs-build .play { margin-top: 10px; padding: 7px; font-size: 14px; }
  #qin-cs-build .steps { max-height: 230px; overflow: auto; }
  #qin-cs-build .row .n { width: 16px; color: #8f897b; font-size: 11px; text-align: right; flex: none; }
  #qin-cs-build .dirty { color: #e8c45a; font-size: 11px; margin-left: 4px; text-transform: none; letter-spacing: 0; }
  #qin-cs-build .btn.rec { border-color: #a8402f; color: #ffb39d; } #qin-cs-build .btn.rec i, #qin-cs-step .recdot { color: #ff5a3c; }
  #qin-cs-step { position: fixed; z-index: 96; left: 50%; transform: translateX(-50%); width: 440px; padding: 8px 10px; display: none; }
  #qin-cs-step .line { display: flex; align-items: center; gap: 8px; }
  #qin-cs-step .line .btn { margin: 0; width: 74px; } #qin-cs-step .line .btn.next { background: #c9a85c; color: #1a1612; font-weight: 700; }
  #qin-cs-step .mid { flex: 1; text-align: center; min-width: 0; } #qin-cs-step .mid small { display: block; color: #b9b2a0; font-size: 11px; }
  #qin-cs-step .mid b { display: block; color: #fff4d6; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #qin-cs-step .prog { height: 3px; margin-top: 7px; background: rgba(236,230,214,.15); border-radius: 2px; } #qin-cs-step .prog i { display: block; height: 3px; background: #e8c45a; border-radius: 2px; }
  #qin-cs-step .foot { display: flex; align-items: center; gap: 8px; margin-top: 6px; font-size: 11px; color: #8f897b; }
  #qin-cs-step .foot .btn { margin: 0 0 0 auto; padding: 2px 8px; font-size: 11px; }`;
  document.head.appendChild(s);
}
const slot = (i, n) => `${((i + 1) / (n + 1)) * 100}%`;

/**
 * Where an officer stands: { x (0-1 across the screen), anchor (0-1 across his painting: the point put at x), scale, origin }.
 * Normally spaced out evenly. In a battle the fighters face off in the middle on their sides (lined up by the face), and the
 * others step out to the edges, half each side, at about 60% size, still standing on the lower bar (David, 2026-11-11).
 */
function layout(st, cast, i, c) {
  const n = cast.length, b = st.battle;
  if (!b?.on && st.sides) {   // Sides (David, 2026-11-16): half to each edge, the middle clear; they slide there (CSS left transition)
    const half = Math.ceil(n / 2), left = i < half, k = left ? i : n - 1 - i;
    const step = Math.min(0.1, 0.34 / Math.max(1, half - 1 || 1));
    return { x: left ? 0.08 + step * k : 0.92 - step * k, anchor: 0.5, scale: 1, origin: "50% 50%", lunge: 0 };
  }
  if (!b?.on) return { x: (i + 1) / (n + 1), anchor: 0.5, scale: 1, origin: "50% 50%", lunge: 0 };
  const side = b.sides?.[c.key];
  const fx = c.fx ?? 0.5, eye = c.eye ?? 0.15;
  if (side === "L" || side === "R") {
    const team = cast.filter(o => b.sides[o.key] === side), j = team.indexOf(c);
    const x = side === "L" ? 0.36 - 0.1 * j : 0.64 + 0.1 * j;
    return { x, anchor: fx, scale: 1.08, origin: `${fx * 100}% ${eye * 100}%`, side };
  }
  const spect = cast.filter(o => !b.sides?.[o.key]), j = spect.indexOf(c), half = Math.ceil(spect.length / 2);
  const left = j < half, k = left ? j : j - half;
  // shrink towards the lower bar's line so they keep standing on it
  const bx = c.half ? { top: 42, height: 33 } : !c.src ? { top: 31, height: 38 } : figureBox(c);
  const top = bx.top, h = bx.height, barAt = Math.max(0.3, Math.min(0.95, (75 - top) / h));
  const gap = Math.max(0.09, 150 / (window.innerWidth || 1920)), edge = Math.max(0.07, 75 / (window.innerWidth || 1920)); // room for each one's control card
  return { x: left ? edge + gap * k : 1 - edge - gap * k, anchor: fx, scale: 0.58, origin: `${fx * 100}% ${barAt * 100}%`, spect: true };
}
function placeOfficer(el, L) {
  el.style.left = `${L.x * 100}%`;
  el.style.transformOrigin = L.origin;
  el.style.transform = `translateX(-${L.anchor * 100}%) scale(${L.scale})`;
  el.dataset.side = L.side ?? "";
}

/** Clash: three quick blows (the Duel clash sound has them at 0, 0.26 and 0.52 s); the fighters lunge in once and hold, sparks fly in the middle on each blow. */
function clashFx(st, cast) {
  playMoment("Duel clash", { minGap: 0 });
  const b = st.battle, fighters = cast.filter(c => b.sides?.[c.key]).map(c => ({ c, el: shown.get(c.key), side: b.sides[c.key] })).filter(f => f.el);
  if (!root || !fighters.length) return;
  const W = window.innerWidth, H = window.innerHeight;
  // the meeting point: between the two front fighters, at chest height
  const front = (s) => fighters.filter(f => f.side === s).map(f => f.el.getBoundingClientRect()).map(r => s === "L" ? r.right : r.left);
  const lx = Math.max(...front("L"), W * 0.36), rx = Math.min(...front("R"), W * 0.64);
  const cx = fighters.some(f => f.side === "L") && fighters.some(f => f.side === "R") ? (lx + rx) / 2 : W / 2, cy = H * 0.44;
  // one lunge for the whole clash (David, 2026-11-15): in on the first blow, held through all three, back after the last
  for (const f of fighters) {
    const d = (f.side === "L" ? 1 : -1) * W * 0.04;
    f.el.style.transition = "translate .09s ease-out"; f.el.style.translate = `${d}px 0`;
  }
  setTimeout(() => { for (const f of fighters) { f.el.style.transition = "translate .2s ease-in-out"; f.el.style.translate = ""; setTimeout(() => { f.el.style.transition = ""; }, 220); } }, 640);
  [0, 260, 520].forEach((at, n) => setTimeout(() => hit(n === 2), at));
  function hit(big) {
    const s = big ? 1.35 : 1, id = "c" + foundry.utils.randomID(6), tilt = (Math.random() - 0.5) * 30;
    const sparks = [...Array(big ? 22 : 14)].map((_, i, a) => { const t = i / a.length * Math.PI * 2 + Math.random() * 0.3, r = 70 + Math.random() * 70;
      return `<line x1="${Math.cos(t) * 18}" y1="${Math.sin(t) * 18}" x2="${Math.cos(t) * r}" y2="${Math.sin(t) * r}" stroke="${i % 3 ? "#ffd27a" : "#fff"}" stroke-width="${i % 2 ? 3 : 2}" stroke-linecap="round"/>`; }).join("");
    const w = document.createElement("div"); w.className = "clash"; w.style.left = `${cx}px`; w.style.top = `${cy}px`;
    w.innerHTML = `<svg width="${420 * s}" height="${420 * s}" viewBox="-210 -210 420 420"><defs><radialGradient id="${id}"><stop offset="0" stop-color="#fff"/><stop offset=".35" stop-color="#fff2c0" stop-opacity=".9"/><stop offset="1" stop-color="#ff9a3c" stop-opacity="0"/></radialGradient></defs>
      <g transform="rotate(${tilt})"><circle class="fl" r="150" fill="url(#${id})"/><circle class="ring" r="60" fill="none" stroke="#fff4d6" stroke-width="4"/>
      <path d="M-170 -120 L170 120" stroke="#fff" stroke-width="7" stroke-linecap="round" style="filter:drop-shadow(0 0 10px #6cc8ff)"/>
      <path d="M170 -120 L-170 120" stroke="#fff" stroke-width="7" stroke-linecap="round" style="filter:drop-shadow(0 0 10px #ff6a3c)"/><g class="sp">${sparks}</g></g></svg>`;
    root.appendChild(w);
    const svg = w.querySelector("svg"), ring = w.querySelector(".ring"), sp = w.querySelector(".sp"), t0 = performance.now(), dur = big ? 520 : 380;
    const step = () => {
      const t = (performance.now() - t0) / dur;
      if (t >= 1 || !w.isConnected) return w.remove();
      svg.style.opacity = String(t < 0.15 ? 1 : 1 - (t - 0.15) / 0.85);
      svg.style.transform = `translate(-50%, -50%) scale(${0.7 + 0.4 * Math.min(1, t * 3)})`;
      ring.setAttribute("r", String(60 + 110 * t)); ring.style.opacity = String(1 - t);
      sp.setAttribute("transform", `scale(${0.6 + 0.9 * t})`);
      setTimeout(step, 16);                                                   // not rAF: a background tab may never fire it
    };
    step();
  }
}

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
  root.classList.toggle("full", !!st.full);
  const bg = BACKGROUNDS.find(b => b.key === st.bg), bgEl = root.querySelector(".bg"), url = bg ? `url('${route(bg.src)}')` : "";
  if (url !== (bgEl.dataset.url ?? "")) {                                       // background changed (or first draw)
    const was = bgEl.dataset.url ?? ""; bgEl.dataset.url = url;
    root.querySelectorAll(".bg.over").forEach(o => o.remove());
    if (url && was && !fresh) {                                                // one picture to another: the new one fades in on top
      const over = Object.assign(document.createElement("div"), { className: "bg over" }); over.style.backgroundImage = url;
      bgEl.after(over); void over.offsetWidth; setTimeout(() => over.classList.add("on"), 30);
      setTimeout(() => { if (bgEl.dataset.url === url) bgEl.style.backgroundImage = url; over.remove(); }, 800);
    } else if (url) { bgEl.style.backgroundImage = url; bgEl.classList.add("on"); }
    else bgEl.classList.remove("on");                                         // to Empty: fade out (the picture stays until it's invisible)
  }
  const cast = st.cast ?? [], n = cast.length;
  const lit = litOf(st);
  for (const [key, el] of shown) if (!cast.some(c => c.key === key)) {          // left the scene
    shown.delete(key); el.classList.remove("here", "lit");
    { const r = el.getBoundingClientRect(), mid = r.left + r.width / 2; el.style.setProperty("--qin-exit", `${(mid < window.innerWidth / 2 ? -1 : 1) * Math.round(window.innerWidth * 0.12)}px`); } // toward the nearer edge
    el.classList.add("gone"); setTimeout(() => el.remove(), 1700);
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
      el.dataset.eye = c.eye ?? ""; el.style.left = fresh ? slot(i, n) : "112%";
      root.appendChild(el); shown.set(c.key, el);
      void el.offsetWidth;
      setTimeout(() => el.classList.add("here"), fresh ? 650 : 30);
    }
    const L = layout(st, cast, i, c);
    setTimeout(() => placeOfficer(el, L), 30);
    el.classList.toggle("lit", lit.includes(c.key));
    if (st.hurt?.key === c.key && st.hurt.id !== seenHurt) { seenHurt = st.hurt.id; if (!fresh) injureFx(el, c); }
    // every displayed officer gets his name under him
    let nm = names.get(c.key);
    if (!nm) { nm = document.createElement("div"); nm.className = "nm"; root.appendChild(nm); names.set(c.key, nm); }
    nm.textContent = knows(st, c) ? c.name : "????"; nm.style.left = `${L.x * 100}%`; nm.classList.toggle("on", lit.includes(c.key));
  });
  if (st.battle?.on && st.battle.clash && st.battle.clash !== seenClash) { const first = seenClash === null && fresh; seenClash = st.battle.clash; if (!first) clashFx(st, cast); }
  renderControls(st);
  StepBar.render();
}
/** A player sees an officer's name only if he knows him (his Officers window) or the GM revealed him in this scene. */
const knows = (st, c) => game.user.isGM || (st.revealed ?? []).includes(c.key) || userKnows(c.uuid);
function teardown() {
  ctl?.remove(); ctl = null;
  if (run) { run = null; Builder.refresh(); } StepBar.render();
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
  await setState({ active: true, id: foundry.utils.randomID(8), bg: bg || null, cast: list, lit: [] });
}
export async function endCutscene() { if (game.user.isGM) await setState({ active: false }); }
async function patch(fn) { const st = foundry.utils.deepClone(state()); if (!st.active) return; fn(st); await setState(st); }
// Display toggles one officer on or off (several can be lit); Switch makes him the only one lit (David, 2026-11-11)
const display = (key) => patch(st => { const l = litOf(st); st.lit = l.includes(key) ? l.filter(k => k !== key) : [...l, key]; });
const switchTo = (key) => patch(st => { st.lit = [key]; });
const injure = (key) => patch(st => { st.hurt = { key, id: foundry.utils.randomID(8) }; });
// Battle: pick sides, start (the fighters lit), clash, end (everyone back, the lit officers as before)
const battleSetup = () => patch(st => { st.battle = { setup: true, sides: {} }; });
const battleCancel = () => patch(st => { st.battle = null; });
const pickSide = (key, side) => patch(st => { if (!st.battle) return; st.battle.sides ??= {}; if (side) st.battle.sides[key] = side; else delete st.battle.sides[key]; });
const battleStart = () => patch(st => { const b = st.battle; if (!b) return; b.setup = false; b.on = true; b.preLit = litOf(st); st.lit = st.cast.filter(c => b.sides?.[c.key]).map(c => c.key); });
const battleClash = () => patch(st => { if (st.battle?.on) st.battle.clash = foundry.utils.randomID(8); });
/** Reveal (David, 2026-11-15): his name shows on everyone's screen, and the players online now get him in their Officers
 *  window (offline players don't). */
async function reveal(key) {
  const c = state().cast?.find(x => x.key === key); if (!c) return;
  const online = game.users.filter(u => u.active && !u.isGM).map(u => u.id);
  if (online.length) await revealOfficer(c.uuid, online).catch(e => console.warn("Qin | reveal", e));
  await patch(st => { st.revealed = [...new Set([...(st.revealed ?? []), key])]; });
  ui.notifications.info(online.length ? `${c.name} revealed; added to the Officers window of ${game.users.filter(u => online.includes(u.id)).map(u => u.name).join(", ")}.` : `${c.name} revealed on screen; no players are online, so no one's Officers window changed.`);
}
const battleEnd = () => patch(st => { const pre = st.battle?.preLit ?? []; st.battle = null; st.lit = pre.filter(k => st.cast.some(c => c.key === k)); });

/* ------------------------------------------------------------------ cutscene steps (David, 2026-11-15) */
// A step names its officer by actor uuid (scene keys are new every time a scene plays).
export function stepLabel(s) {
  switch (s?.t) {
    case "enter": return `${s.name} enters`;
    case "leave": return `${s.name} leaves`;
    case "display": return `Display ${s.name}`;
    case "switch": return `Switch to ${s.name}`;
    case "injure": return `Injure ${s.name}`;
    case "battle": { const side = (v) => (s.sides ?? []).filter(f => f.side === v).map(f => f.name).join(", ") || "?"; return `Battle: ${side("L")} vs ${side("R")}`; }
    case "clash": return "Clash";
    case "battleEnd": return "End battle";
    case "reveal": return `Reveal ${s.name}`;
    case "sides": return s.on ? "Officers to the sides" : "Officers back to their places";
    case "bg": return `Background: ${s.name || "Empty"}`;
    case "full": return s.on ? "Full screen (no black bars)" : "Black bars back";
    default: return "?";
  }
}
const keyOf = (st, uuid) => st.cast?.find(c => c.uuid === uuid)?.key;
/** Do one step on the running scene. */
async function applyStep(s) {
  const st = state(); if (!st.active || !s) return;
  const k = s.uuid ? keyOf(st, s.uuid) : null;
  const missing = () => ui.notifications.warn(`${s.name} isn't in the scene, so "${stepLabel(s)}" was skipped.`);
  switch (s.t) {
    case "enter": { const a = await fromUuid(s.uuid).catch(() => null); if (!a) return ui.notifications.warn(`${s.name} is no longer in the world or the compendium; skipped.`); return join(a); }
    case "leave": return k ? leave(k) : missing();
    case "display": return k ? display(k) : missing();
    case "switch": return k ? switchTo(k) : missing();
    case "injure": return k ? injure(k) : missing();
    case "battle": return patch(st => {
      const sides = {}; for (const f of s.sides ?? []) { const kk = keyOf(st, f.uuid); if (kk) sides[kk] = f.side; }
      st.battle = { setup: false, on: true, sides, preLit: litOf(st) }; st.lit = st.cast.filter(c => sides[c.key]).map(c => c.key);
    });
    case "clash": return battleClash();
    case "battleEnd": return battleEnd();
    case "reveal": return k ? reveal(k) : missing();
    case "sides": return patch(st => { st.sides = !!s.on; });
    case "bg": return patch(st => { st.bg = s.key || null; });
    case "full": return patch(st => { st.full = !!s.on; });
  }
}
/** The GM's run through a cutscene: its steps, where he is, the scene as it was before each step (for Back). */
let run = null, busy = false;
/** True while the GM steps through a cutscene (other modules leave Space and the arrow keys alone then). */
export const cutsceneStepping = () => !!run && cutsceneActive();
const snap = () => foundry.utils.deepClone(state());
/** A live action from the control bar: recorded as the next step while recording, then done. */
async function live(step) {
  if (run?.rec) { run.steps.splice(run.pos); run.steps.push(step); run.hist.splice(run.pos); run.hist.push(snap()); run.pos = run.steps.length; draft.dirty = true; Builder.refresh(); }
  await applyStep(step);
  StepBar.render();
}
async function stepNext() {
  if (!run || busy || !cutsceneActive()) return;
  if (run.pos >= run.steps.length) return endCutscene();
  busy = true;
  try { run.hist[run.pos] = snap(); await applyStep(run.steps[run.pos]); run.pos++; } finally { busy = false; }
  StepBar.render();
}
async function stepBack() {
  if (!run || busy || !cutsceneActive() || run.pos <= 0) return;
  busy = true;
  try {
    run.pos--;
    const st = foundry.utils.deepClone(run.hist[run.pos]);
    delete st.hurt; if (st.battle) delete st.battle.clash;          // going back doesn't replay a blow or a clash
    if (run.rec) { run.steps.splice(run.pos); run.hist.splice(run.pos); draft.dirty = true; Builder.refresh(); }   // recording: Back also takes the step out
    st.id = state().id; await setState(st);
  } finally { busy = false; }
  StepBar.render();
}
/** The GM's bar while a cutscene runs: Back · step N of M, what Next does · Next; record from here / stop recording. */
const StepBar = {
  el: null,
  render() {
    const on = game.user.isGM && run && cutsceneActive();
    if (!on) { if (this.el) this.el.style.display = "none"; return; }
    css();
    this.el ??= Object.assign(document.createElement("div"), { id: "qin-cs-step", className: "qin-cs-panel" });
    if (!this.el.isConnected) document.body.appendChild(this.el);
    const n = run.steps.length, p = run.pos, nextLbl = p < n ? stepLabel(run.steps[p]) : "End the scene";
    this.el.innerHTML = `<div class="line"><span class="btn ${p ? "" : "off"}" data-a="back" title="Undo the last step (←)"><i class="fa-solid fa-backward-step"></i> Back</span>
        <div class="mid"><small>${run.rec ? `<i class="fa-solid fa-circle recdot"></i> Recording · ` : ""}Step ${p} of ${n}</small><b title="${esc(nextLbl)}">Next: ${esc(nextLbl)}</b></div>
        <span class="btn next" data-a="next" title="Do the next step (Space or →)">${p < n ? "Next" : "End"} <i class="fa-solid fa-forward-step"></i></span></div>
      <div class="prog"><i style="width:${n ? Math.round(p / n * 100) : 0}%"></i></div>
      <div class="foot"><span>Space or → next · ← back</span>${run.rec
        ? `<span class="btn" data-a="stop" title="Stop recording; the steps so far stay in the Cutscene Maker">Stop recording</span>`
        : `<span class="btn" data-a="rec" title="Your next actions replace the steps after this one">Record from here</span>`}</div>`;
    this.el.querySelector('[data-a="back"]').onclick = stepBack;
    this.el.querySelector('[data-a="next"]').onclick = stepNext;
    const rec = this.el.querySelector('[data-a="rec"]'); if (rec) rec.onclick = () => { run.rec = true; this.render(); };
    const stop = this.el.querySelector('[data-a="stop"]'); if (stop) stop.onclick = () => { run.rec = false; this.render(); Builder.refresh(); };
    this.el.style.display = "block";
    // just above the officer cards
    setTimeout(() => {
      if (!this.el || !ctl) return;
      const tops = [ctl, ...ctl.children].map(e => e.getBoundingClientRect()).filter(b => b.height).map(b => b.top);
      this.el.style.bottom = `${Math.round(window.innerHeight - Math.min(...tops, window.innerHeight - 12) + 8)}px`;
    }, 40);
  },
};

/** The injury on screen: the Melee hit sound, a blade streak across the chest, a gash that fades, blood, a red flash and a shake. */
function injureFx(el, c) {
  playMoment("Melee hit", { minGap: 0 });
  const img = el.querySelector("img"); if (!img) return;
  const box = el.getBoundingClientRect(), H = box.height || 1, W = box.width || 1;
  // the chest: under the face when the painting's face was found, else a third of the way down the middle
  const fx = c.fx ?? 0.5, eye = c.eye ?? 0.15, fh = c.fh || 0.085;
  const cx = fx * W, cy = Math.min(0.7, eye + 2.4 * fh) * H, size = Math.max(140, Math.min(W * 0.9, fh * H * 3.2));
  // drawn over the scene, not inside the officer, so a dimmed officer's gash is still bright
  const wrap = document.createElement("div"); wrap.className = "hurt"; wrap.style.left = `${box.left + cx}px`; wrap.style.top = `${box.top + cy}px`;
  const id = "g" + foundry.utils.randomID(6);
  wrap.innerHTML = `<svg width="${size}" height="${size}" viewBox="-130 -130 260 260">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5a0505"/><stop offset=".5" stop-color="#c0160f"/><stop offset="1" stop-color="#5a0505"/></linearGradient>
    <clipPath id="${id}c"><rect x="-130" y="-130" width="260" height="0"/></clipPath></defs>
    <g class="gash" clip-path="url(#${id}c)">
      <path d="M95 -105 C40 -40 -20 20 -95 100 C-15 30 45 -30 95 -105Z" fill="url(#${id})" stroke="#2a0000" stroke-width="2"/>
      <path d="M60 -110 C15 -55 -30 0 -105 70 C-25 10 25 -45 60 -110Z" fill="url(#${id})" stroke="#2a0000" stroke-width="1.5" opacity=".85"/></g>
    <path class="streak" d="M120 -125 L-120 120" stroke="#fff6e8" stroke-width="5" stroke-linecap="round" fill="none" stroke-dasharray="340" stroke-dashoffset="340" style="filter:drop-shadow(0 0 8px #ff5030)"/>
    <g class="drops" fill="#a80f0c"></g></svg>`;
  (root ?? el).appendChild(wrap);
  const rect = wrap.querySelector("clipPath rect"), streak = wrap.querySelector(".streak"), gash = wrap.querySelector(".gash"), drops = wrap.querySelector(".drops");
  const DS = [[50, -60, 6], [-40, -30, 4], [70, 10, 5], [-70, 20, 3], [25, -80, 4], [0, -40, 3]];
  const lit = el.classList.contains("lit");
  const t0 = performance.now();
  const frame = (now) => {
    const t = (now - t0) / 1000;
    // shake (0.45 s) and red flash (0.55 s); the dim of an unlit officer comes back after
    const sh = t < 0.45 ? Math.sin(t * 55) * 16 * (1 - t / 0.45) : 0;
    el.style.translate = `${sh}px 0`; wrap.style.translate = `${sh}px 0`;
    const f = t < 0.06 ? t / 0.06 : Math.max(0, 1 - (t - 0.06) / 0.5);
    img.style.filter = f > 0 ? `brightness(${1 + (lit ? 0.5 : 3) * f}) sepia(${f}) saturate(${1 + 5 * f}) hue-rotate(${-30 * f}deg)` : "";
    // the streak draws in 0.12 s and fades; the gash opens behind it, stays a second and fades by 2 s
    const p = Math.min(1, t / 0.12);
    streak.setAttribute("stroke-dashoffset", 340 * (1 - p)); streak.style.opacity = t < 0.12 ? 1 : Math.max(0, 1 - (t - 0.12) / 0.15);
    rect.setAttribute("x", -130 + 260 * (1 - p)); rect.setAttribute("height", 260 * p + 1);
    gash.style.opacity = t < 1.2 ? 1 : Math.max(0, 1 - (t - 1.2) / 0.8);
    const q = (t - 0.1) / 0.6;
    drops.innerHTML = q > 0 && q < 1 ? DS.map(([dx, dy, r]) => `<circle cx="${dx * q}" cy="${dy * q + 90 * q * q}" r="${r * (1 - q * 0.5)}" opacity="${1 - q}"/>`).join("") : "";
    if (t < 2.05 && el.isConnected) setTimeout(() => frame(performance.now()), 16); // not rAF: a background tab may never fire it
    else { wrap.remove(); el.style.translate = ""; img.style.filter = ""; }
  };
  frame(performance.now());
}
const leave = (key) => patch(st => { st.cast = st.cast.filter(c => c.key !== key); st.lit = litOf(st).filter(k => k !== key); if (st.battle?.sides) delete st.battle.sides[key]; });
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
  const lit = litOf(st), bt = st.battle, sides = bt?.sides ?? {};
  ctl.classList.toggle("battle", !!bt?.on);
  const sidePick = (c) => `<div class="side" title="Which side he fights on (none: he stands aside)">${[["L", "◀ Left"], ["", "—"], ["R", "Right ▶"]].map(([v, t]) => `<span data-a="side" data-s="${v}" class="${(sides[c.key] ?? "") === v && v ? v : ""}">${t}</span>`).join("")}</div>`;
  ctl.innerHTML = st.cast.map((c, i) => { const on = lit.includes(c.key);
    const pos = bt?.on ? layout(st, st.cast, i, c) : null;
    return `<div class="card ${on ? "on" : ""}" data-k="${c.key}"${pos ? ` style="left: calc(${pos.x * 100}% - 69px)"` : ""}>
      <div class="h"><i class="pt" style="background-image:url('${esc(route(c.img ?? c.src))}')"></i><span>${esc(c.name)}</span></div>
      ${bt?.setup ? sidePick(c) : ""}
      <div class="two"><span class="btn ${on ? "on" : ""}" data-a="display" title="Light this officer up or dim him again; several can be lit at once">${on ? "Displayed" : "Display"}</span>
      <span class="btn ${on && lit.length === 1 ? "on" : ""}" data-a="switch" title="Light only this officer; everyone else dims">Switch</span></div>
      <div class="two"><span class="btn" data-a="injure" title="He's struck: a sword-hit sound, he shakes and a gash opens across him (everyone sees it)">Injure</span>
      <span class="btn red" data-a="leave" title="This officer leaves the scene; the others space out again">Leave</span></div>
      ${(() => { const done = (st.revealed ?? []).includes(c.key), need = !done && game.users.some(u => u.active && !u.isGM && !userKnows(c.uuid, u));
        return `<span class="btn ${done ? "on" : ""} ${on ? "" : "off"}" data-a="reveal" title="${on ? (done ? "Revealed in this scene" : need ? "Players online see ???? — reveal his name and add him to their Officers window" : "Every player online already knows him; reveal anyway to show his name to late joiners") : "Display him first"}">${done ? "Revealed" : `<i class="fa-solid fa-eye"></i> Reveal${need ? " ????" : ""}`}</span>`; })()}</div>`; }).join("")
    + (bt?.on
      ? `<div class="mid"><div class="clashbtn" data-a="clash" title="The fighters lunge together once: three quick blows, sparks in the middle"><span>⚔ CLASH</span></div>
         <div class="end" data-a="battleEnd" title="Everyone goes back to where they stood"><span>End battle</span></div></div>`
      : bt?.setup
      ? (() => { const nL = Object.values(sides).filter(v => v === "L").length, nR = Object.values(sides).filter(v => v === "R").length;
          return `<div class="battlebtn go ${nL && nR ? "" : "off"}" data-a="battleStart" title="The chosen officers face off in the middle; the others stand aside"><span>⚔ Start battle</span><small>${nL || "?"} vs ${nR || "?"}</small></div>
           <div class="end" data-a="battleCancel" style="width:70px"><span>Cancel</span></div>`; })()
      : `<div class="add" title="Drag an officer here from the compendium or the Actors tab; they walk in from the right">${full ? `Scene is full (${MAX_CAST})` : `<span><i class="fa-solid fa-user-plus"></i> Drag an officer here</span><input placeholder="or search…"><div class="hits"></div>`}</div>
         <div class="battlebtn" data-a="battle" title="Set up a battle: pick who fights on each side"><span>⚔ Battle</span></div>
         <div class="sidesbtn ${st.sides ? "on" : ""}" data-a="sides" title="Move everyone to the edges, to show what's in the middle of the screen (again: back to their places)"><span><i class="fa-solid fa-arrows-left-right-to-line"></i> Sides</span><small>${st.sides ? "on" : "off"}</small></div>
         <div class="sidesbtn ${st.full ? "on" : ""}" data-a="full" title="Full screen: the black bars slide away and the background fills the screen (again: the bars come back)"><span><i class="fa-solid fa-expand"></i> Full</span><small>${st.full ? "on" : "off"}</small></div>
         ${(() => { const b = BACKGROUNDS.find(x => x.key === st.bg); return `<div class="bgctl" data-a="bg" title="Change the background; it fades over for everyone (${esc(b?.name ?? "Empty")} now)"><i class="${b ? "" : "none"}" style="${b ? `background-image:url('${esc(route(b.thumb ?? b.src))}')` : ""}"></i><small>${esc(b?.name ?? "Background")}</small></div>`; })()}
         <div class="end" data-a="end"><span><i class="fa-solid fa-stop"></i> End scene</span></div>`);
  for (const card of ctl.querySelectorAll(".card")) {
    const c = st.cast.find(x => x.key === card.dataset.k), who = { uuid: c?.uuid, name: c?.name };
    card.querySelector('[data-a="display"]').onclick = () => live({ t: "display", ...who });
    card.querySelector('[data-a="switch"]').onclick = () => live({ t: "switch", ...who });
    card.querySelector('[data-a="injure"]').onclick = () => live({ t: "injure", ...who });
    card.querySelector('[data-a="leave"]').onclick = () => live({ t: "leave", ...who });
    card.querySelector('[data-a="reveal"]').onclick = () => live({ t: "reveal", ...who });
    for (const sp of card.querySelectorAll('[data-a="side"]')) sp.onclick = () => pickSide(card.dataset.k, sp.dataset.s);
  }
  const on = (a, fn) => { const el = ctl.querySelector(`[data-a="${a}"]`); if (el) el.onclick = fn; };
  on("battle", battleSetup); on("battleCancel", battleCancel); on("clash", () => live({ t: "clash" })); on("battleEnd", () => live({ t: "battleEnd" }));
  on("battleStart", () => { const sd = st.battle?.sides ?? {}; live({ t: "battle", sides: st.cast.filter(c => sd[c.key]).map(c => ({ uuid: c.uuid, name: c.name, side: sd[c.key] })) }); });
  const joinLive = (a) => { if ((state().cast?.length ?? 0) >= MAX_CAST) return ui.notifications.warn(`A scene holds up to ${MAX_CAST} officers. Have one leave first.`); live({ t: "enter", uuid: a.uuid, name: a.name }); };
  on("end", () => endCutscene());
  on("sides", () => live({ t: "sides", on: !st.sides }));
  on("full", () => live({ t: "full", on: !st.full }));
  on("bg", () => BgPicker.open(st.bg ?? "", (key) => { if ((key || null) === (state().bg || null)) return; live({ t: "bg", key: key || null, name: BACKGROUNDS.find(b => b.key === key)?.name ?? "Empty" }); }));
  const add = ctl.querySelector(".add"), inp = add?.querySelector("input");
  if (!add) return;
  if (inp) { wireSearch(inp, add.querySelector(".hits"), joinLive); if (typing != null) { inp.value = typing; inp.focus(); } }
  add.ondragover = (e) => { e.preventDefault(); add.classList.add("over"); };
  add.ondragleave = () => add.classList.remove("over");
  add.ondrop = async (e) => { e.preventDefault(); e.stopPropagation(); add.classList.remove("over"); const a = await actorFromDrop(e); if (a) joinLive(a); };
}

/* ------------------------------------------------------------------ GM: the Cutscene Maker panel (top left) */
const draft = { cast: [], bg: "", sel: "", steps: [], dirty: false };
const Builder = {
  el: null,
  toggle(show) {
    if (!game.user.isGM) return;
    css();
    this.el ??= Object.assign(document.createElement("div"), { id: "qin-cs-build", className: "qin-cs-panel" });
    if (!this.el.isConnected) document.body.appendChild(this.el);
    show ??= this.el.style.display !== "block";
    this.el.style.display = show ? "block" : "none";
    if (show) { const c = (document.getElementById("qin-dock") ?? document.getElementById("scene-controls"))?.getBoundingClientRect(); if (c?.width && !this.moved) this.el.style.left = `${Math.round(c.right + 12)}px`; }
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
        ${(() => { const b = BACKGROUNDS.find(x => x.key === draft.bg); return `<div class="bgbtn" title="Choose the background">${b ? `<i style="background-image:url('${esc(route(b.thumb ?? b.src))}')"></i><div><b>${esc(b.name)}</b>${b.group ? `<small>${esc(b.group)}</small>` : ""}</div>` : `<i class="none"></i><div><b>Empty</b><small>the map shows through</small></div>`}<span class="chg">Change…</span></div>`; })()}</div>
      <div class="sec"><div class="lb">Cutscene steps (${draft.steps.length})${draft.dirty ? `<span class="dirty">· not saved</span>` : ""}</div>
        <div class="three"><span class="btn rec ${playing ? "off" : ""}" data-a="record" title="Play the scene from the start; every action you take becomes the next step (replaces the steps)"><i class="fa-solid fa-circle"></i> Record</span><span class="btn" data-a="addstep" title="Add a step at the end">+ Add step</span></div>
        <div class="steps">${draft.steps.map((s, i) => `<div class="row st" data-i="${i}"><span class="n">${i + 1}</span><b title="${esc(stepLabel(s))}">${esc(stepLabel(s))}</b>
          <span class="a" data-a="up" title="Earlier"><i class="fa-solid fa-arrow-up"></i></span><span class="a" data-a="down" title="Later"><i class="fa-solid fa-arrow-down"></i></span><span class="a" data-a="del" title="Remove"><i class="fa-solid fa-xmark"></i></span></div>`).join("")
          || `<div class="none">No steps: Play just sets the scene. Press Record to make a cutscene.</div>`}</div>
        <div class="drop sdrop">drag an officer here to add an "enters" step</div></div>
      <div class="sec"><div class="lb">Saved scenes</div>
        <select class="sv"><option value="">${list.length ? "Choose a saved scene…" : "None saved yet"}</option>${list.map(s => `<option value="${s.id}" ${draft.sel === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select>
        <div class="three"><span class="btn ${draft.sel ? "" : "off"}" data-a="save" title="Save over the chosen scene">Save</span><span class="btn" data-a="saveas">Save as…</span><span class="btn red ${draft.sel ? "" : "off"}" data-a="delete">Delete</span></div></div>
      <span class="btn on play ${playing ? "off" : ""}" data-a="play"><i class="fa-solid fa-play"></i> ${playing ? "A scene is playing" : draft.steps.length ? `Play cutscene (${draft.steps.length} steps)` : "Play"}</span>`;
    el.querySelector(".x").onclick = () => this.toggle(false);
    for (const row of el.querySelectorAll(".row:not(.st)")) {
      const i = Number(row.dataset.i), mv = (d) => { const j = i + d; if (j < 0 || j >= draft.cast.length) return; [draft.cast[i], draft.cast[j]] = [draft.cast[j], draft.cast[i]]; this.refresh(); };
      row.querySelector('[data-a="up"]').onclick = () => mv(-1); row.querySelector('[data-a="down"]').onclick = () => mv(1);
      row.querySelector('[data-a="del"]').onclick = () => { draft.cast.splice(i, 1); this.refresh(); };
    }
    for (const row of el.querySelectorAll(".row.st")) {
      const i = Number(row.dataset.i), mv = (d) => { const j = i + d; if (j < 0 || j >= draft.steps.length) return; [draft.steps[i], draft.steps[j]] = [draft.steps[j], draft.steps[i]]; draft.dirty = true; this.refresh(); };
      row.querySelector('[data-a="up"]').onclick = () => mv(-1); row.querySelector('[data-a="down"]').onclick = () => mv(1);
      row.querySelector('[data-a="del"]').onclick = () => { draft.steps.splice(i, 1); draft.dirty = true; this.refresh(); };
    }
    el.querySelector('[data-a="record"]').onclick = async () => {
      if (draft.steps.length) {
        const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: "Record" }, content: `<p>Recording replaces the ${draft.steps.length} steps. To keep the start, play the cutscene, go to a step and press "Record from here" instead.</p>`, rejectClose: false }).catch(() => false);
        if (!ok) return;
      }
      draft.steps = []; draft.dirty = true;
      run = { steps: draft.steps, pos: 0, hist: [], rec: true };
      await playCutscene(draft.cast, draft.bg); this.refresh();
    };
    el.querySelector('[data-a="addstep"]').onclick = () => addStepDialog();
    const sd = el.querySelector(".sdrop");
    sd.ondragover = (e) => { e.preventDefault(); e.stopPropagation(); sd.classList.add("over"); };
    sd.ondragleave = () => sd.classList.remove("over");
    sd.ondrop = async (e) => { e.preventDefault(); e.stopPropagation(); sd.classList.remove("over"); const a = await actorFromDrop(e); if (a) { draft.steps.push({ t: "enter", uuid: a.uuid, name: a.name }); draft.dirty = true; this.refresh(); } };
    const add = (a) => { if (draft.cast.length >= MAX_CAST) return ui.notifications.warn(`A scene holds up to ${MAX_CAST} officers.`); draft.cast.push(castEntry(a)); this.refresh(); el.querySelector(".q")?.focus(); };
    const q = el.querySelector(".q"); if (q) wireSearch(q, el.querySelector(".hits"), add);
    el.ondragover = (e) => { e.preventDefault(); el.querySelector(".drop").classList.add("over"); };
    el.ondragleave = () => el.querySelector(".drop")?.classList.remove("over");
    el.ondrop = async (e) => { e.preventDefault(); e.stopPropagation(); const a = await actorFromDrop(e); if (a) add(a); else el.querySelector(".drop")?.classList.remove("over"); };
    el.querySelector(".bgbtn").onclick = () => BgPicker.open(draft.bg, (key) => { draft.bg = key; this.refresh(); });
    el.querySelector(".sv").onchange = async (e) => { draft.sel = e.target.value; const s = saved().find(x => x.id === draft.sel); if (s) await loadSaved(s); this.refresh(); };
    const store = async (id, name) => {
      const entry = { id, name, bg: draft.bg || null, cast: draft.cast.map(c => ({ uuid: c.uuid, name: c.name })), steps: foundry.utils.deepClone(draft.steps) };
      const l = saved().filter(s => s.id !== id); l.push(entry); l.sort((a, b) => a.name.localeCompare(b.name));
      await game.settings.set(SYSTEM_ID, SAVED, l); draft.sel = id; draft.dirty = false; this.refresh(); ui.notifications.info(`Saved the scene "${name}".`);
    };
    el.querySelector('[data-a="save"]').onclick = () => { const s = saved().find(x => x.id === draft.sel); if (s) store(s.id, s.name); };
    el.querySelector('[data-a="saveas"]').onclick = async () => {
      let name = null;
      try { name = await foundry.applications.api.DialogV2.prompt({ window: { title: "Save scene" }, content: `<input name="n" type="text" placeholder="Scene name" autofocus style="width:100%">`, ok: { label: "Save", callback: (ev, btn) => btn.form.elements.n.value.trim() }, rejectClose: false }); } catch { name = null; }
      if (name) store(foundry.utils.randomID(8), name);
    };
    el.querySelector('[data-a="delete"]').onclick = async () => { await game.settings.set(SYSTEM_ID, SAVED, saved().filter(s => s.id !== draft.sel)); draft.sel = ""; this.refresh(); };
    el.querySelector('[data-a="play"]').onclick = async () => {
      run = draft.steps.length ? { steps: draft.steps, pos: 0, hist: [], rec: false } : null;
      await playCutscene(draft.cast, draft.bg); StepBar.render();
    };
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
/* ------------------------------------------------------------------ GM: the background selector (David, 2026-11-15) */
// A window of picture cards: Empty first, then the registered backgrounds grouped by their group, with a search box and
// group chips. Click a card and press "Use background", or double-click a card. Esc or × cancels.
const BgPicker = {
  el: null, cur: "", done: null, q: "", grp: "",
  open(cur, done) {
    css();
    this.el ??= Object.assign(document.createElement("div"), { id: "qin-cs-bgpick", className: "qin-cs-panel" });
    if (!this.el.isConnected) document.body.appendChild(this.el);
    this.cur = cur ?? ""; this.done = done; this.el.style.display = "flex"; this.render();
    this.el.querySelector(".tools input")?.focus();
  },
  close() { if (this.el) this.el.style.display = "none"; },
  pick(key) { this.close(); this.done?.(key); },
  render() {
    const groups = [...new Set(BACKGROUNDS.map(b => b.group).filter(Boolean))];
    const q = this.q.trim().toLowerCase(), want = (b) => (!this.grp || b.group === this.grp) && (!q || b.name.toLowerCase().includes(q) || (b.group ?? "").toLowerCase().includes(q));
    const card = (b) => `<div class="card ${this.cur === b.key ? "sel" : ""}" data-k="${esc(b.key)}" title="${esc(b.name)}"><div class="pic" style="background-image:url('${esc(route(b.thumb ?? b.src))}')"></div><b>${esc(b.name)}</b>${this.cur === b.key ? `<small>✓ current</small>` : ""}</div>`;
    let body = (!this.grp && !q) || "empty".includes(q) ? `<div class="card empty ${this.cur ? "" : "sel"}" data-k=""><div class="pic"><span>No background</span></div><b>Empty</b><small>the map shows through</small></div>` : "";
    const shown = BACKGROUNDS.filter(want);
    if (groups.length) for (const g of [...groups, null]) { const l = shown.filter(b => (b.group ?? null) === g); if (l.length) body += (g ? `<div class="grp">${esc(g)}</div>` : `<div class="grp">Other</div>`) + l.map(card).join(""); }
    else body += shown.map(card).join("");
    if (!BACKGROUNDS.length) body += `<div class="none">No backgrounds are installed. A module can add some (game.qin.registerCutsceneBackgrounds).</div>`;
    else if (!shown.length) body += `<div class="none">No background matches.</div>`;
    const el = this.el, focused = document.activeElement === el.querySelector(".tools input"), caret = el.querySelector(".tools input")?.selectionStart;
    el.innerHTML = `<div class="hd">Choose a background<span class="x"><i class="fa-solid fa-xmark"></i></span></div>
      <div class="tools"><input placeholder="Search backgrounds…" value="${esc(this.q)}">${groups.length ? `<span class="chip ${this.grp ? "" : "on"}" data-g="">All</span>${groups.map(g => `<span class="chip ${this.grp === g ? "on" : ""}" data-g="${esc(g)}">${esc(g)}</span>`).join("")}` : ""}</div>
      <div class="grid">${body}</div>
      <div class="foot"><span class="btn" data-a="cancel">Cancel</span><span class="btn on" data-a="use">Use background</span></div>`;
    el.querySelector(".x").onclick = () => this.close();
    el.querySelector('[data-a="cancel"]').onclick = () => this.close();
    el.querySelector('[data-a="use"]').onclick = () => this.pick(this.cur);
    const inp = el.querySelector(".tools input");
    inp.oninput = () => { this.q = inp.value; this.render(); };
    inp.onkeydown = (e) => { if (e.key === "Escape") { e.stopPropagation(); this.close(); } };
    if (focused) { inp.focus(); inp.setSelectionRange(caret, caret); }
    for (const c of el.querySelectorAll(".chip")) c.onclick = () => { this.grp = c.dataset.g; this.render(); };
    for (const c of el.querySelectorAll(".card")) {
      c.onclick = () => { this.cur = c.dataset.k; for (const o of el.querySelectorAll(".card")) o.classList.toggle("sel", o === c); };
      c.ondblclick = () => this.pick(c.dataset.k);
    }
  },
};
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && BgPicker.el?.style.display === "flex") BgPicker.close(); });

async function loadSaved(s) {
  const cast = [];
  for (const c of s.cast ?? []) { const a = await fromUuid(c.uuid).catch(() => null); if (a) cast.push(castEntry(a)); else ui.notifications.warn(`${c.name} is no longer in the world or the compendium; left out.`); }
  draft.cast = cast; draft.bg = s.bg ?? ""; draft.steps = foundry.utils.deepClone(s.steps ?? []); draft.dirty = false;
}
/** Add step by hand: an action and one of the officers the cutscene knows (the opening cast and anyone who enters).
 *  New officers come in by dragging them onto the steps, a battle by recording it. */
async function addStepDialog() {
  const known = new Map(); for (const c of draft.cast) known.set(c.uuid, c.name); for (const s of draft.steps) if (s.t === "enter") known.set(s.uuid, s.name);
  const acts = [["display", "Display"], ["switch", "Switch to"], ["injure", "Injure"], ["leave", "Leaves"], ["reveal", "Reveal name"], ["clash", "Clash (in a battle)"], ["battleEnd", "End battle"], ["sidesOn", "Officers to the sides"], ["sidesOff", "Officers back to their places"], ["bg", "Change background"], ["fullOn", "Full screen (no black bars)"], ["fullOff", "Black bars back"]];
  let got = null;
  try {
    got = await foundry.applications.api.DialogV2.prompt({ window: { title: "Add step" },
      content: `<div class="form-group"><label>Action</label><select name="t">${acts.map(([v, t]) => `<option value="${v}">${t}</option>`).join("")}</select></div>
        <div class="form-group"><label>Officer</label><select name="u">${[...known].map(([u, n]) => `<option value="${esc(u)}">${esc(n)}</option>`).join("")}</select></div>
        <div class="form-group"><label>Background</label><select name="b"><option value="">Empty</option>${BACKGROUNDS.map(b => `<option value="${esc(b.key)}">${esc(b.group ? `${b.group}: ${b.name}` : b.name)}</option>`).join("")}</select></div>
        <p class="hint">Background is only for Change background. Clash, End battle, Sides and Full screen need no officer. To add an officer entering, drag him onto the steps; record a battle.</p>`,
      ok: { label: "Add", callback: (ev, btn) => ({ t: btn.form.elements.t.value, u: btn.form.elements.u.value, b: btn.form.elements.b.value }) }, rejectClose: false });
  } catch { got = null; }
  if (!got) return;
  const step = got.t === "fullOn" || got.t === "fullOff" ? { t: "full", on: got.t === "fullOn" } : got.t === "bg" ? { t: "bg", key: got.b || null, name: BACKGROUNDS.find(b => b.key === got.b)?.name ?? "Empty" } : got.t === "sidesOn" || got.t === "sidesOff" ? { t: "sides", on: got.t === "sidesOn" } : ["clash", "battleEnd"].includes(got.t) ? { t: got.t } : got.u ? { t: got.t, uuid: got.u, name: known.get(got.u) } : null;
  if (!step) return ui.notifications.warn("Add an officer to the scene first.");
  draft.steps.push(step); draft.dirty = true; Builder.refresh();
}
export const toggleCutsceneMaker = (show) => Builder.toggle(show);
export const cutsceneMakerOpen = () => Builder.el?.style.display === "block";

/* ------------------------------------------------------------------ setup */
Hooks.once("init", () => {
  game.settings.register(SYSTEM_ID, STATE, { scope: "world", config: false, type: Object, default: { active: false }, onChange: () => { render(); Builder.refresh(); } });
  game.settings.register(SYSTEM_ID, SAVED, { scope: "world", config: false, type: Array, default: [], onChange: () => Builder.refresh() });
  game.keybindings.register(SYSTEM_ID, "cutsceneMaker", {
    name: "Cutscene Maker", hint: "GM: open or close the Cutscene Maker panel.",
    editable: [{ key: "KeyU", modifiers: ["Shift"] }], restricted: true, onDown: () => { toggleCutsceneMaker(); return true; },
  });
  // only while the GM runs a cutscene; otherwise the keys do what they always do (Space pauses, arrows move the map)
  const PRI = CONST.KEYBINDING_PRECEDENCE?.PRIORITY ?? 0;
  game.keybindings.register(SYSTEM_ID, "cutsceneNext", {
    name: "Cutscene: next step", hint: "GM: while a cutscene plays, do its next step.", precedence: PRI,
    editable: [{ key: "Space" }, { key: "ArrowRight" }], restricted: true, onDown: () => { if (!run || !cutsceneActive()) return false; stepNext(); return true; },
  });
  game.keybindings.register(SYSTEM_ID, "cutsceneBack", {
    name: "Cutscene: back a step", hint: "GM: while a cutscene plays, undo its last step.", precedence: PRI,
    editable: [{ key: "ArrowLeft" }], restricted: true, onDown: () => { if (!run || !cutsceneActive()) return false; stepBack(); return true; },
  });
});
Hooks.once("ready", () => { render(); });

/* ------------------------------------------------------------------ roll cards on screen during a cutscene (David, 2026-11-17) */
// A chat message with dice made while a cutscene plays is shown on the cutscene too (to whoever may see it), for 10 s;
// at most three at once. The chat log has it as always.
Hooks.on("createChatMessage", async (m) => {
  if (!root || !state()?.active || !m?.rolls?.length || m.visible === false) return;
  let el = null;
  try { el = await m.renderHTML?.(); } catch (e) { el = null; }
  if (!el) { el = document.createElement("div"); el.innerHTML = m.content ?? ""; }
  if (!root) return;
  let box = root.querySelector(".rolls");
  if (!box) { box = Object.assign(document.createElement("div"), { className: "rolls" }); root.appendChild(box); }
  const card = Object.assign(document.createElement("div"), { className: "qin-cs-roll" });
  card.appendChild(el); box.appendChild(card);
  while (box.children.length > 3) box.firstElementChild.remove();
  const bye = () => { card.classList.add("out"); setTimeout(() => card.remove(), 650); };
  card.addEventListener("click", (e) => { if (!e.target.closest("a, button, details, summary, .dice-roll")) bye(); });
  setTimeout(bye, 10000);
});
