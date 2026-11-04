// Follow the active unit (David, 2026-11-01; units without an officer too since 2026-11-03): when a unit starts its
// turn, every client's view pans to it. Watches the battle setting; each new activation pans once. A hidden unit
// (hidden token, or concealed in the battle) never pans a player's view unless that player owns it.
// Each person can turn it off for themselves (client setting "Follow the active unit", David 2026-11-04).
import { SYSTEM_ID } from "../config.mjs";
import { atSpeed } from "./battle-speed.mjs";
let lastKey = null;

export function registerTurnPan() {
  game.settings.register(SYSTEM_ID, "followActiveUnit", {
    name: "Follow the active unit",
    hint: "In battles, move your view to each unit as it starts its turn. Turn off to keep the camera where you put it.",
    scope: "client", config: true, type: Boolean, default: true,
  });
}

export function panToActiveOfficer(battle) {
  if (!canvas?.ready || !battle?.active || battle.sceneId !== canvas.scene?.id) { lastKey = null; return; }
  const ac = battle.turn?.activation;
  if (!ac?.unitId) return;
  const key = `${battle.turn?.round ?? 0}:${ac.unitId}`;
  if (key === lastKey) return;
  lastKey = key;
  if (game.settings.get(SYSTEM_ID, "followActiveUnit") === false) return;
  const tok = canvas.tokens?.get(ac.unitId);
  if (!tok) return;
  if (!game.user.isGM && !tok.isOwner) {
    if (tok.document?.hidden) return; // don't give away a hidden unit
    const bu = (battle.units ?? []).find(u => u.id === ac.unitId);
    if (bu?.hidden) return; // concealed (forest, tall grass, ambush)
  }
  const c = tok.center;
  canvas.animatePan?.({ x: c.x, y: c.y, duration: atSpeed(600) });
}
