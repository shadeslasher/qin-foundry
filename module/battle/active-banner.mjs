// Battlefield active banner (David, 2026-11-08, style B "edge band"): when an officer uses their battlefield active the
// screen dims, a band in the side's colour sweeps in from that side's edge with the skill's name, then the officer's
// full art slides in over it. It plays on every client as the first step of the action's animation, so the skill's
// effects (floats, moves) follow it. Player and ally bands come from the left, enemy bands from the right.
import { fullArtFor } from "../full-art.mjs";

const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");
export const SIDE_RGB = { player: "58,120,200", ally: "63,166,106", enemy: "200,68,58", neutral: "184,150,40" };
export const BANNER_MS = 2300;

/** What the banner shows (pure; exported for tests). */
export function bannerInfo(step, { officer = null, artFor = fullArtFor } = {}) {
  const side = SIDE_RGB[step.side] ? step.side : "neutral";
  const full = officer ? artFor(officer) : null;
  return {
    side, rgb: SIDE_RGB[side], fromRight: side === "enemy",
    officer: officer?.name ?? step.officerName ?? "", skill: step.skill ?? "Battlefield active",
    img: full ?? officer?.img ?? null, full: !!full,
  };
}

/** Play the banner; resolves when it has gone. */
export function playActiveBanner(step) {
  let officer = null;
  try { officer = step.officerId ? fromUuidSync(step.officerId) : null; } catch { /* no officer: name only */ }
  const info = bannerInfo(step, { officer });
  const reduce = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const ms = reduce ? 1400 : BANNER_MS;
  const root = document.createElement("div");
  root.className = `qin-ab ${info.fromRight ? "qin-ab-right" : ""} ${info.full ? "qin-ab-full" : "qin-ab-token"} ${reduce ? "qin-ab-reduce" : ""}`;
  root.style.setProperty("--c", info.rgb);
  root.style.setProperty("--ab-ms", ms + "ms");
  root.innerHTML = `<div class="qin-ab-dim"></div>
    <div class="qin-ab-band"><div class="qin-ab-text">
      ${info.officer ? `<div class="qin-ab-who">${esc(info.officer)} uses</div>` : ""}
      <div class="qin-ab-skill">${esc(info.skill)}</div></div></div>
    ${info.img ? `<div class="qin-ab-art"><img src="${esc(info.img)}" alt=""></div>` : ""}`;
  document.body.appendChild(root);
  return new Promise(res => setTimeout(() => { root.remove(); res(); }, ms));
}
