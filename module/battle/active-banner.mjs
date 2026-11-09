// Battlefield active banner (David, 2026-11-08): when an officer uses their battlefield active the screen dims, a band
// in the side's colour sweeps in from that side's edge (enemy from the right) with the officer's name over the skill's
// name, centred; then the officer's full art slides in from the same edge, head to waist, standing on the band. Every
// figure is scaled by its whole height so their proportions match, and its box is as wide as its visible upper half,
// so nothing is cut at the sides. The art is never mirrored. Since 2026-11-09 the band and art fly in fast, drift slowly
// across, then speed up and fly off the far side; during an activation the dim is the spotlight's (activation-fx.mjs). It plays on every client as the first step of the
// action's animation, so the skill's effects follow it. Officers without full art show their round token.
import { fullArtInfo } from "../full-art.mjs";
import { atSpeed } from "./battle-speed.mjs";

const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");
export const SIDE_RGB = { player: "58,120,200", ally: "63,166,106", enemy: "200,68,58", neutral: "184,150,40" };
export const BANNER_MS = 2600; // fly in, drift slowly, speed up and fly off the far side (David, 2026-11-09)
export const ART_BOX = 380;      // px of figure shown above the band's bottom edge (head to waist)
export const ART_EDGE = 24;      // px from the screen edge

/** What the banner shows (pure; exported for tests). */
export function bannerInfo(step, { officer = null, artFor = fullArtInfo } = {}) {
  const side = SIDE_RGB[step.side] ? step.side : "neutral";
  const art = officer ? artFor(officer) : null;
  return {
    side, rgb: SIDE_RGB[side], fromRight: side === "enemy",
    officer: officer?.name ?? step.officerName ?? "", skill: step.skill ?? "Battlefield active",
    art, img: art?.src ?? officer?.img ?? null, full: !!art,
  };
}

/** Where the figure sits in its box (pure; exported for tests): the image is drawn twice the box height so the box
 *  shows its upper half; the box is the visible width of that half. */
export function artLayout(art, natW, natH) {
  const w = art?.w ?? natW, h = art?.h ?? natH;
  if (!w || !h) return null;
  const k = (ART_BOX * 2) / h, [x0, x1] = art?.up ?? [0, w];
  return { imgH: ART_BOX * 2, boxW: Math.round((x1 - x0) * k), offX: Math.round(-x0 * k) };
}

const sizeOf = (src) => new Promise(res => { const i = new Image(); i.onload = () => res([i.naturalWidth, i.naturalHeight]); i.onerror = () => res([0, 0]); i.src = src; });

/** Play the banner; resolves when it has gone. */
export async function playActiveBanner(step, { dim = true } = {}) {
  let officer = null;
  try { officer = step.officerId ? fromUuidSync(step.officerId) : null; } catch { /* no officer: name only */ }
  const info = bannerInfo(step, { officer });
  const lay = info.full ? artLayout(info.art, ...(info.art.w ? [] : await sizeOf(info.img))) : null;
  const reduce = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const ms = reduce ? 1400 : atSpeed(BANNER_MS);
  const root = document.createElement("div");
  root.className = `qin-ab ${info.fromRight ? "qin-ab-right" : ""} ${lay ? "qin-ab-full" : "qin-ab-token"} ${dim ? "" : "qin-ab-nodim"}`;
  root.style.setProperty("--c", info.rgb);
  root.style.setProperty("--ab-ms", ms + "ms");
  root.style.setProperty("--ab-edge", ART_EDGE + "px");
  const artHTML = !info.img ? "" : lay
    ? `<div class="qin-ab-art" style="width:${lay.boxW}px"><img src="${esc(info.img)}" alt="" style="height:${lay.imgH}px;left:${lay.offX}px"></div>`
    : `<div class="qin-ab-art"><img src="${esc(info.img)}" alt=""></div>`;
  // the band's trailing end is cut at an angle with a gold edge and a thinner gold stripe (David, 2026-11-09); it stays off
  // screen until the band flies away
  const cut = `<svg class="qin-ab-cut" viewBox="0 0 120 156" preserveAspectRatio="none" aria-hidden="true"><line x1="90" y1="1.5" x2="0" y2="154.5" stroke="#e8c46a" stroke-width="6"/><line x1="106" y1="1.5" x2="16" y2="154.5" stroke="rgba(232,196,106,.6)" stroke-width="2.5"/></svg>`;
  root.innerHTML = `<div class="qin-ab-dim"></div><div class="qin-ab-bandwrap"><div class="qin-ab-band">${cut}</div></div>${artHTML}
    <div class="qin-ab-label"><div class="qin-ab-text">${info.officer ? `<div class="qin-ab-who">${esc(info.officer)}</div>` : ""}<div class="qin-ab-skill">${esc(info.skill)}</div></div></div>`;
  document.body.appendChild(root);
  return new Promise(res => setTimeout(() => { root.remove(); res(); }, ms));
}
