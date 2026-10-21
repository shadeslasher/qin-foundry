// Always-on Health and Morale bars (with numbers) drawn above every battle unit token.
const BAR_KEY = "qinUnitBars";

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
  const key = `${men}/${max}/${morale}/${w}/${h}`;
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
  const style = new PIXI.TextStyle({
    fontFamily: "Signika, sans-serif", fontSize: Math.round(h * 0.82), fontWeight: "bold",
    fill: "#ffffff", stroke: "#000000", strokeThickness: Math.max(2, Math.round(h * 0.22)),
  });
  const rows = [
    { pct: Math.max(0, Math.min(1, men / max)), color: healthColor(men / max), label: `${men} / ${max}` },
    { pct: Math.max(0, Math.min(1, morale / 100)), color: moraleColor(morale), label: `Morale ${morale}` },
  ];
  const g = new PIXI.Graphics();
  c.addChild(g);
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
