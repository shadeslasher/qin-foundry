// Follow the officers (David, 2026-11-01): when a unit led by an officer starts its turn, every client's view
// pans to it. Watches the battle setting; each new activation pans once.
let lastKey = null;

export function panToActiveOfficer(battle) {
  if (!canvas?.ready || !battle?.active || battle.sceneId !== canvas.scene?.id) { lastKey = null; return; }
  const ac = battle.turn?.activation;
  if (!ac?.unitId) return;
  const key = `${battle.turn?.round ?? 0}:${ac.unitId}`;
  if (key === lastKey) return;
  lastKey = key;
  const tok = canvas.tokens?.get(ac.unitId);
  if (!tok || !tok.actor?.system?.officer) return; // officer-led units only
  if (tok.document?.hidden && !game.user.isGM) return; // don't give away a hidden unit
  const c = tok.center;
  canvas.animatePan?.({ x: c.x, y: c.y, duration: 600 });
}
