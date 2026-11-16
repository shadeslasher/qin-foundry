// Duel zoom (David, 2026-11-15; approved from mockup v4): the Fire Emblem Awakening battle transition, 2 s each way.
// In: every screen rushes in on the challenged officer (1.3 s) with two fading echoes trailing, whites out; the duel
//     scene switches in underneath and comes in from farther away to its normal view (0.7 s) as the white clears.
// Out: the duel shrinks away (1.1 s) with two echoes trailing, whites out; the battle map pulls back out from the
//     challenged officer's square to its normal view (0.9 s) as the white clears.
import { SYSTEM_ID } from "../config.mjs";

const SOCKET = `system.${SYSTEM_ID}`;
const T = { in: [1300, 700], out: [1100, 900] };
export const ZOOM_IN_MS = T.in[0];
const ECHOES = 2, LAG = 0.16, ECHO_OP = 0.28;
let veil = null, waiting = null, veilTimer = null;

const ease = (k) => k * k * (3 - 2 * k);
/** Run fn(k) from 0 to 1 over ms; timers, not animation frames, so a background tab still finishes. */
function tween(ms, fn) {
  return new Promise((done) => {
    const t0 = performance.now();
    const step = () => { const k = Math.min(1, (performance.now() - t0) / ms); fn(k); if (k < 1) setTimeout(step, 16); else done(); };
    step();
  });
}
/** The canvas as an image (rendered now, so the drawing buffer is still there). */
function snapshot() {
  try {
    const view = canvas.app.view ?? canvas.app.canvas;
    canvas.app.renderer.render(canvas.app.stage);
    return { src: view.toDataURL("image/jpeg", 0.85), rect: view.getBoundingClientRect() };
  } catch { return null; }
}
/** A scene point (px) on screen; the screen middle without one. */
function screenPoint(pt, rect) {
  if (!pt) return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  const p = canvas.stage.worldTransform.apply({ x: pt.x, y: pt.y });
  return { x: rect.left + p.x, y: rect.top + p.y };
}
function layers(shot, at, echoes) {
  const box = Object.assign(document.createElement("div"), { className: "qin-dz" });
  Object.assign(box.style, { position: "fixed", inset: "0", zIndex: 10000, pointerEvents: "none", overflow: "hidden", background: "#000" });
  const r = shot?.rect ?? { left: 0, top: 0, width: innerWidth, height: innerHeight };
  const make = () => {
    const im = document.createElement("img");
    if (shot?.src) im.src = shot.src;
    Object.assign(im.style, { position: "absolute", left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`,
      transformOrigin: `${at.x - r.left}px ${at.y - r.top}px`, willChange: "transform, opacity" });
    box.appendChild(im); return im;
  };
  const base = make(), echo = Array.from({ length: echoes }, make);
  const white = document.createElement("div");
  Object.assign(white.style, { position: "absolute", inset: "0", background: "#fff", opacity: "0" });
  box.appendChild(white);
  document.body.appendChild(box);
  return { box, base, echo, white };
}

/** Part 1: scale the current screen from → to around a point with two trailing echoes, ending on white (held until the
 *  next scene shows, 6 s at most). */
async function rush(pt, from, to, ms) {
  clearVeil();
  const shot = snapshot(), r = shot?.rect ?? { left: 0, top: 0, width: innerWidth, height: innerHeight };
  const L = layers(shot, screenPoint(pt, r), ECHOES);
  veil = L.box; veilTimer = setTimeout(clearVeil, ms + 6000);
  await tween(ms, (k) => {
    const e = ease(k);
    L.base.style.transform = `scale(${from + (to - from) * e})`;
    L.echo.forEach((el, i) => {
      const ek = Math.max(0, e - (i + 1) * LAG);
      el.style.transform = `scale(${from + (to - from) * ek})`;
      el.style.opacity = k > 0.05 && k < 0.95 ? String(ECHO_OP - i * 0.08) : "0";
    });
    L.white.style.opacity = String(k > 0.75 ? (k - 0.75) / 0.25 : 0);
  });
}
/** Part 2: the new scene goes from → to around a point (no echoes) while the white clears. */
async function settle(pt, from, to, ms) {
  const shot = snapshot(), r = shot?.rect ?? { left: 0, top: 0, width: innerWidth, height: innerHeight };
  const L = layers(shot, screenPoint(pt, r), 0);
  L.white.style.opacity = "1"; L.base.style.transform = `scale(${from})`;
  clearVeil();                                   // the new layers (white on top) replace the held white
  await tween(ms, (k) => {
    const e = ease(k);
    L.base.style.transform = `scale(${from + (to - from) * e})`;
    L.white.style.opacity = String(k < 0.25 ? 1 - k / 0.25 : 0);
  });
  L.box.remove();
}
function clearVeil() { clearTimeout(veilTimer); veil?.remove(); veil = null; }

/** Every client: part 1 on the scene they're looking at, part 2 once `toScene` is on screen. dir: "in" | "out". */
async function play({ from, to, toScene, dir = "in" }) {
  waiting = { toScene, to, dir };
  const [a] = T[dir] ?? T.in;
  await (dir === "out" ? rush(from, 1, 0.15, a) : rush(from, 1, 6, a));
  if (canvas.scene?.id === toScene && canvas.ready && waiting) { const w = waiting; waiting = null; setTimeout(() => part2(w), 150); }
}
const part2 = (w) => { const [, b] = T[w.dir] ?? T.in; return w.dir === "out" ? settle(w.to, 6, 1, b) : settle(w.to, 0.6, 1, b); };
Hooks.on("canvasReady", () => {
  if (!waiting || canvas.scene?.id !== waiting.toScene) return;
  const w = waiting; waiting = null;
  setTimeout(() => part2(w), 300);              // let the scene draw first
});
Hooks.once("ready", () => game.socket.on(SOCKET, (m) => { if (m?.action === "duelZoom") play(m).catch(e => console.warn("Qin | duel zoom", e)); }));

/** GM: start the transition on every screen and wait until they're all white, then switch scenes. */
export async function duelZoom({ from = null, to = null, toScene, dir = "in" }) {
  const m = { action: "duelZoom", from, to, toScene, dir };
  game.socket.emit(SOCKET, m);
  play(m).catch(e => console.warn("Qin | duel zoom", e));
  await new Promise(r => setTimeout(r, ZOOM_IN_MS + 50));
}
/** The middle of a token (scene px). */
export const tokenCentre = (scene, id) => {
  const t = scene?.tokens.get(id); if (!t) return null;
  const g = scene.grid.size; return { x: t.x + (t.width ?? 1) * g / 2, y: t.y + (t.height ?? 1) * g / 2 };
};
/** This screen only: the whole transition on the current scene (to try it out). */
export async function previewDuelZoom(pt = null, dir = "in") { const [a, b] = T[dir]; await (dir === "out" ? rush(pt, 1, 0.15, a) : rush(pt, 1, 6, a)); await new Promise(r => setTimeout(r, 150)); await part2({ to: pt, dir }); }
