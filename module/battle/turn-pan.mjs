// Follow the active unit (David, 2026-11-01; units without an officer too since 2026-11-03): when a unit starts its
// turn, every client's view pans to it. Watches the battle setting; each new activation pans once. A hidden unit
// (hidden token, or concealed in the battle) never pans a player's view unless that player owns it.
let lastKey = null;

export function panToActiveOfficer(battle) {
  if (!canvas?.ready || !battle?.active || battle.sceneId !== canvas.scene?.id) { lastKey = null; return; }
  const ac = battle.turn?.activation;
  if (!ac?.unitId) return;
  const key = `${battle.turn?.round ?? 0}:${ac.unitId}`;
  if (key === lastKey) return;
  lastKey = key;
  const tok = canvas.tokens?.get(ac.unitId);
  if (!tok) return;
  if (!game.user.isGM && !tok.isOwner) {
    if (tok.document?.hidden) return; // don't give away a hidden unit
    const bu = (battle.units ?? []).find(u => u.id === ac.unitId);
    if (bu?.hidden) return; // concealed (forest, tall grass, ambush)
  }
  const c = tok.center;
  canvas.animatePan?.({ x: c.x, y: c.y, duration: 600 });
}
