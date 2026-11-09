// Battlefield active activation (David, 2026-11-09). Everything pauses: the screen darkens except around the officer's
// unit, which lights up white and flashes; the light stays on while the banner and portrait fly in, drift slowly and
// fly off; the screen stays dark a moment while the light fades; then, just before the dark lifts, the unit's stand
// is released (its morale cost, ready mark and buff show, the buff sweeping up from the bottom) and any special
// animation for the skill plays (tier 1 and up: see unique-fx.mjs).
import { playActiveBanner } from "./active-banner.mjs";
import { atSpeed } from "./battle-speed.mjs";
import { releaseUnits, hideSkillReady } from "../unit-bars.mjs";
import { playUniqueActivation } from "./unique-fx.mjs";

const wait = (ms) => new Promise(r => setTimeout(r, ms));
const smooth = (a) => (a <= 0 ? 0 : a >= 1 ? 1 : a * a * (3 - 2 * a));

/** Timings in ms (before battle speed). */
export const ACT = { build: 600, lightOff: 750, undimFrom: 400, undimTo: 800, release: 550 };

/** The spotlight dim: dark everywhere but a soft circle round the unit (a DOM layer over the canvas). */
function spotlight(token) {
  const el = document.createElement("div");
  el.className = "qin-act-dim";
  const place = () => {
    if (!token || token.destroyed) return;
    try {
      const p = canvas.clientCoordinatesFromCanvas(token.center), k = canvas.stage.scale.x;
      el.style.setProperty("--x", p.x + "px"); el.style.setProperty("--y", p.y + "px");
      el.style.setProperty("--r", Math.max(token.w, token.h) * k * 0.6 + "px");
    } catch { /* stays centred */ }
  };
  place();
  document.body.appendChild(el);
  return { el, place };
}

/** The white light on the unit: a blurred glow round its stand and a white wash over it. */
function unitLight(token) {
  const T = Math.min(token.w, token.h), pad = T * 0.03, r = T * 0.1;
  const Blur = PIXI.BlurFilter ?? PIXI.filters?.BlurFilter;
  const glow = new PIXI.Graphics().lineStyle(T * 0.09, 0xffffff, 1).drawRoundedRect(pad, pad, token.w - 2 * pad, token.h - 2 * pad, r);
  if (Blur) glow.filters = [new Blur(T * 0.08)];
  const fill = new PIXI.Graphics().beginFill(0xffffff, 1).drawRoundedRect(pad, pad, token.w - 2 * pad, token.h - 2 * pad, r).endFill();
  glow.alpha = fill.alpha = 0; glow.eventMode = fill.eventMode = "none";
  token.addChildAt(glow, 0); token.addChild(fill);
  return { glow, fill, done: () => { glow.destroy(); fill.destroy(); } };
}

/** Play an officer's activation; resolves when it has finished. */
export async function playActivation(st) {
  const token = canvas.tokens?.get(st.unit);
  const reduce = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  if (!token || reduce) { await playActiveBanner(st); releaseUnits([st.unit]); return; }
  hideSkillReady(token);
  const dim = spotlight(token), light = unitLight(token);
  const ms = (k) => atSpeed(ACT[k]);
  const BUILD = ms("build"), OFF = ms("lightOff"), UNDIM0 = ms("undimFrom"), UNDIM1 = ms("undimTo");
  let t = 0, phase = "build", released = false;
  const tick = () => {
    t += canvas.app.ticker.deltaMS;
    dim.place();
    let L, F, D = 1;
    if (phase === "build") { // the light builds, then flashes
      const k = t / BUILD;
      L = smooth(k / 0.8); F = k < 0.8 ? 0.25 * smooth(k / 0.8) : 0.25 + 0.6 * smooth((k - 0.8) / 0.2);
      D = Math.min(1, t / atSpeed(200));
    } else if (phase === "banner") { L = 1; F = 0.55 + 0.3 * (1 - smooth(t / atSpeed(400))); } // eases down to a steady glow
    else { // after the banner: the light fades, the dark lifts a little later
      const k = t / OFF; L = 1 - smooth(k); F = 0.55 * (1 - smooth(k));
      D = t < UNDIM0 ? 1 : 1 - smooth((t - UNDIM0) / (UNDIM1 - UNDIM0));
    }
    if (!light.glow.destroyed) { light.glow.alpha = L; light.fill.alpha = F; }
    dim.el.style.opacity = D;
  };
  canvas.app.ticker.add(tick);
  try {
    await wait(BUILD);
    phase = "banner"; t = 0;
    await playActiveBanner(st, { dim: false });
    phase = "after"; t = 0;
    await wait(ms("release"));
    released = true;
    releaseUnits([st.unit]);             // morale cost, ready mark, buff (it sweeps up from the bottom)
    playUniqueActivation(st, token);     // tier 1+ special animation, if the skill has one
    await wait(Math.max(OFF, UNDIM1) - ms("release"));
  } finally {
    canvas.app.ticker.remove(tick);
    light.done(); dim.el.remove();
    if (!released) releaseUnits([st.unit]);
  }
}
