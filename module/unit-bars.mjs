// Always-on Health and Morale bars (with numbers) drawn above every battle unit token, a side
// colour tab, and a greyed-out look for units that have already taken their turn this round.
const BAR_KEY = "qinUnitBars";
const SIDE_COLORS = { player: 0x3a78c8, enemy: 0xc8443a, ally: 0x3fa66a, neutral: 0xd4a017 };

/** Has this unit token already acted in the current battle round? */
function hasActed(token) {
  let battle;
  try { battle = game.settings.get("qin", "battle"); } catch { return false; }
  if (!battle?.active || battle.sceneId !== token.document?.parent?.id) return false;
  if (battle.turn?.activation?.unitId === token.id) return false;
  return !!battle.meta?.[token.id]?.round?.activated;
}

function applyActedLook(token, acted) {
  const mesh = token.mesh;
  if (!mesh || mesh.destroyed) return;
  if (acted) { mesh.tint = 0x707070; mesh.qinActed = true; }
  else if (mesh.qinActed) {
    const t = token.document?.texture?.tint;
    mesh.tint = t === undefined || t === null ? 0xffffff : Number(t);
    mesh.qinActed = false;
  }
}

function textClass() {
  return foundry.canvas?.containers?.PreciseText ?? globalThis.PreciseText ?? PIXI.Text;
}

function healthColor(pct) {
  if (pct > 0.5) return 0x3f9b4a;
  if (pct > 0.25) return 0xd4a017;
  return 0xc0392b;
}

function moraleColor(m) {
  if (m >= 75) return 0x4aa3df;
  if (m <= 25) return 0x7d5a9e;
  return 0x2f6fb2;
}

function clear(token) {
  const c = token[BAR_KEY];
  if (c && !c.destroyed) c.destroy({ children: true });
  token[BAR_KEY] = null;
}

export function drawUnitBars(token) {
  const actor = token?.actor;
  if (!actor || actor.type !== "unit" || token.destroyed) return clear(token);
  const s = actor.system;
  const men = s.men?.value ?? 0, max = s.men?.max || 100, morale = s.morale ?? 0;
  // Bars sit inside the bottom of the token's own square so nothing spills into the next tile
  const w = token.w, h = Math.max(9, Math.round(token.h * 0.15));
  const acted = hasActed(token);
  applyActedLook(token, acted);
  const key = `${men}/${max}/${morale}/${w}/${h}/${s.side}/${acted}`;
  let c = token[BAR_KEY];
  if (c && !c.destroyed && c.parent === token && c.qinKey === key) return;
  if (!c || c.destroyed || c.parent !== token) {
    clear(token);
    c = token[BAR_KEY] = new PIXI.Container();
    c.eventMode = "none";
    token.addChild(c);
  }
  c.qinKey = key;
  for (const ch of c.removeChildren()) ch.destroy();

  const Txt = textClass();
  const styleOpts = {
    fontFamily: "Signika, sans-serif", fontSize: Math.round(h * 0.85), fontWeight: "bold",
    fill: "#ffffff", stroke: "#000000", strokeThickness: Math.max(2, Math.round(h * 0.25)),
  };
  const style = new PIXI.TextStyle(styleOpts);
  const rows = [
    { pct: Math.max(0, Math.min(1, men / max)), color: healthColor(men / max), label: `${men} / ${max}` },
    { pct: Math.max(0, Math.min(1, morale / 100)), color: moraleColor(morale), label: `Morale ${morale}` },
  ];
  const g = new PIXI.Graphics();
  c.addChild(g);
  const pad = Math.max(1, Math.round(token.w * 0.02));
  const tabW = Math.max(4, Math.round(h * 0.45));
  const barX = pad + tabW + 1, barW = w - barX - pad;
  const top = token.h - pad - rows.length * (h + 1) + 1;
  // side colour tab at the left of the bars
  g.lineStyle(1, 0x000000, 0.9).beginFill(SIDE_COLORS[s.side] ?? 0x888888, 1).drawRoundedRect(pad, top, tabW, rows.length * (h + 1) - 1, 2).endFill();
  if (acted) {
    const t = new Txt("Done", new PIXI.TextStyle({ ...styleOpts, fontSize: Math.round(h * 1.1), fill: "#dddddd" }));
    t.anchor?.set?.(0.5, 0.5);
    t.position.set(w / 2, top / 2);
    c.addChild(t);
  }
  rows.forEach((r, i) => {
    const y = top + i * (h + 1);
    g.lineStyle(1, 0x000000, 0.9).beginFill(0x111111, 0.8).drawRoundedRect(barX, y, barW, h, 2).endFill();
    if (r.pct > 0) g.lineStyle(0).beginFill(r.color, 0.95).drawRoundedRect(barX + 1, y + 1, Math.max(2, (barW - 2) * r.pct), h - 2, 2).endFill();
    const t = new Txt(r.label, style);
    t.anchor?.set?.(0.5, 0.5);
    t.position.set(barX + barW / 2, y + h / 2);
    if (t.width > barW - 2) t.scale.set((barW - 2) / t.width);
    c.addChild(t);
  });
}

/** Redraw every unit token (e.g. when the battle round or turn changes). */
export function redrawAllUnitBars() {
  for (const t of canvas?.tokens?.placeables ?? []) if (t.actor?.type === "unit") drawUnitBars(t);
}

export function registerUnitBars() {
  Hooks.on("drawToken", drawUnitBars);
  Hooks.on("refreshToken", drawUnitBars);
  Hooks.on("destroyToken", clear);
  // Health/morale changes on the actor refresh its tokens' bars
  Hooks.on("updateActor", (actor) => {
    if (actor.type !== "unit") return;
    for (const t of actor.getActiveTokens?.(true) ?? []) drawUnitBars(t);
  });
}
