// Battle-start reveals (David, 2026-11-09): a battlefield skill such as Liu Dan's Inside Knowledge reveals a hidden
// enemy unit at the start of the battle. The GM picks which one; for a side the battle AI runs, the AI picks (ai.mjs).
// This shows the GM a small window listing the hidden enemy units when a pick is waiting.
import { SYSTEM_ID } from "../config.mjs";
import { getBattle, buildState, runAction } from "./adapter.mjs";
import { aiSettings } from "./ai-driver.mjs";
import * as E from "./engine.mjs";
import * as SK from "./skills.mjs";

let openFor = null;
const isRunner = () => game.user?.isGM && (!game.users.activeGM || game.users.activeGM === game.user);
const esc = (t) => foundry.utils.escapeHTML ? foundry.utils.escapeHTML(String(t ?? "")) : String(t ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** Is this pick left to the battle AI (its side is AI-run and not a player's unit)? */
function aiPicks(s, src) {
  const cfg = aiSettings();
  return !src.owner && ((src.side === "enemy" && cfg.enemy) || (src.side === "ally" && cfg.ally));
}

async function check() {
  if (!isRunner()) return;
  const battle = getBattle();
  if (!battle?.active || battle.outcome) return;
  const { s } = buildState(battle);
  const p = SK.pendingReveal(s);
  if (!p) { openFor = null; return; }
  const src = E.unitById(s, p.src);
  if (!src || aiPicks(s, src) || openFor === p.id) return;
  const cands = SK.revealCandidates(s, src);
  if (!cands.length) { await runAction(game.user.id, { type: "skillReveal", pickId: p.id, skip: true }); return; }
  openFor = p.id;
  const tierOf = (u) => Number(E.typeOf(s, u)?.tier) || 1;
  const rows = cands.map(u => `<label style="display:flex;gap:8px;align-items:center;margin:3px 0"><input type="radio" name="t" value="${u.id}">
    <span><b>${esc(u.name)}</b> · Tier ${tierOf(u)} · ${u.men} troops · square ${u.x},${u.y}</span></label>`).join("");
  const res = await foundry.applications.api.DialogV2.wait({
    window: { title: p.label }, rejectClose: false,
    content: `<p>Pick the hidden enemy unit to reveal.</p>${rows}`,
    buttons: [
      { action: "reveal", label: "Reveal", default: true, callback: (ev, btn) => btn.form.elements.t?.value || cands[0].id },
      { action: "skip", label: "Skip", callback: () => "skip" },
    ],
  }).catch(() => null);
  openFor = null;
  if (!res) return; // closed: ask again on the next battle update
  await runAction(game.user.id, res === "skip" ? { type: "skillReveal", pickId: p.id, skip: true } : { type: "skillReveal", pickId: p.id, targetId: res });
}

export function registerRevealPick() {
  Hooks.on("updateSetting", (st) => { if (st.key === `${SYSTEM_ID}.battle`) check().catch(e => console.warn("Qin | reveal pick", e)); });
  Hooks.once("ready", () => check().catch(() => {}));
}
