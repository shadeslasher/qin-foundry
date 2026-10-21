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
  const w = token.w, h = Math.max(12, Math.round(token.h * 0.16));
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
    fontFamily: "Signika, sans-serif", fontSize: Math.round(h * 0.82), fontWeight: "bold",
    fill: "#ffffff", stroke: "#000000", strokeThickness: Math.max(2, Math.round(h * 0.22)),
  };
  const style = new PIXI.TextStyle(styleOpts);
  const rows = [
    { pct: Math.max(0, Math.min(1, men / max)), color: healthColor(men / max), label: `${men} / ${max}` },
    { pct: Math.max(0, Math.min(1, morale / 100)), color: moraleColor(morale), label: `Morale ${morale}` },
  ];
  const g = new PIXI.Graphics();
  c.addChild(g);
  // side colour tab to the left of the bars
  const tabH = rows.length * (h + 2) - 2;
  g.lineStyle(1, 0x000000, 0.9).beginFill(SIDE_COLORS[s.side] ?? 0x888888, 1).drawRoundedRect(-Math.round(h * 0.6) - 2, -tabH - 2, Math.round(h * 0.6), tabH, 2).endFill();
  if (acted) {
    const t = new Txt("Done", new PIXI.TextStyle({ ...styleOpts, fontSize: Math.round(h * 0.9), fill: "#dddddd" }));
    t.anchor?.set?.(0.5, 0.5);
    t.position.set(w / 2, token.h / 2);
    c.addChild(t);
  }
  rows.forEach((r, i) => {
    const y = -(rows.length - i) * (h + 2) - 2;
    g.lineStyle(1, 0x000000, 0.9).beginFill(0x111111, 0.75).drawRoundedRect(0, y, w, h, 3).endFill();
    if (r.pct > 0) g.lineStyle(0).beginFill(r.color, 0.95).drawRoundedRect(1, y + 1, Math.max(2, (w - 2) * r.pct), h - 2, 2).endFill();
    const t = new Txt(r.label, style);
    t.anchor?.set?.(0.5, 0.5);
    t.position.set(w / 2, y + h / 2);
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
