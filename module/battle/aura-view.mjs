// Officers' aura areas on the battle map (David, 2026-11-11, style 3 of the examples): the squares a battlefield
// passive reaches are lightly tinted, strongest at the officer's unit and fading outward. You see the auras of your own
// and allied units all the time; an enemy officer's aura shows while you hover over his unit.
import * as E from "./engine.mjs";
import * as SK from "./skills.mjs";
import { getBattle, buildState } from "./adapter.mjs";

const TINT = 0xfff4d6;
let layerC = null, hovered = null;

function groundLayer() {
  if (layerC && !layerC.destroyed && layerC.parent) return layerC;
  layerC = new PIXI.Container();
  // on the map under the tokens and their stands
  Object.assign(layerC, { elevation: 0, sortLayer: 650, sort: -1e6 + 1, zIndex: -1e6 + 1, eventMode: "none" });
  (canvas.primary ?? canvas.stage).addChild(layerC);
  if (canvas.primary) canvas.primary.sortDirty = true;
  return layerC;
}
function clear() { if (layerC && !layerC.destroyed) layerC.removeChildren().forEach(c => c.destroy()); }

/** The alliances whose auras this user always sees: those of the units he owns (players), else the players' side. */
function mySides(s) {
  const mine = new Set(E.liveUnits(s).filter(u => u.owner && u.owner === game.user.id).map(u => E.alliance(u.side)));
  return mine.size ? mine : new Set(["player"]);
}

/** Tint the squares within r of unit u: alpha falls off with the distance from his square. */
export function auraAlpha(d, r) { return 0.04 + 0.22 * Math.max(0, 1 - d / (r + 1)); }
function drawAura(g, s, u, r, size) {
  const { cols, rows } = s.map;
  for (let x = Math.max(0, u.x - r); x <= Math.min(cols - 1, u.x + r); x++) for (let y = Math.max(0, u.y - r); y <= Math.min(rows - 1, u.y + r); y++) {
    const d = Math.abs(x - u.x) + Math.abs(y - u.y); if (d > r) continue;
    g.beginFill(TINT, auraAlpha(d, r)).drawRect(x * size + 1, y * size + 1, size - 2, size - 2).endFill();
  }
}

/** Redraw (whenever the battle changes, or the hovered unit does). */
export function refreshAuras() {
  if (!canvas?.ready) return;
  const battle = getBattle();
  if (!battle?.active || canvas.scene?.id !== battle.sceneId) { clear(); return; }
  let s; try { s = buildState(battle, {}).s; } catch { clear(); return; }
  const size = canvas.scene?.grid?.size ?? canvas.grid?.size ?? 100, sides = mySides(s);
  clear(); const g = new PIXI.Graphics(); groundLayer().addChild(g);
  for (const u of E.liveUnits(s)) {
    if (!u.officerId) continue;
    const mine = sides.has(E.alliance(u.side));
    if (!mine && u.id !== hovered) continue;
    if (!mine && (u.hidden || canvas.tokens?.get(u.id)?.document?.hidden) && !game.user.isGM) continue;
    let a; try { a = SK.passiveAura(s, u); } catch { a = null; }
    if (a?.range) drawAura(g, s, u, a.range, size);
  }
}

export function registerAuraView() {
  Hooks.on("hoverToken", (token, on) => {
    const id = on ? token?.id : null;
    if (id === hovered || (!on && token?.id !== hovered)) return;
    hovered = id; refreshAuras();
  });
  Hooks.on("canvasTearDown", () => { layerC = null; hovered = null; });
}
