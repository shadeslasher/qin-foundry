// A player's military budget, kept apart from their personal coins (David, 2026-11-13). The budget pays only for the
// army: recruiting and promoting units, equipment and siege equipment, and units' monthly upkeep. Personal coins are the
// character's own money (system.coin) and are never spent on the army. Each month a player's character draws their
// salary as personal coins, and their budget grows by ten times that salary (the rtk13-map module runs the month).
// The GM also hands out budget for victories and events. Stored on the character as flag qin.budget.
import { SYSTEM_ID } from "./config.mjs";

export const BUDGET_FLAG = "budget";
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

export const budgetOf = (pc) => Math.max(0, Math.round(Number(pc?.getFlag?.(SYSTEM_ID, BUDGET_FLAG)) || 0));
export async function setBudget(pc, n) { if (pc) await pc.setFlag(SYSTEM_ID, BUDGET_FLAG, Math.max(0, Math.round(Number(n) || 0))); }
export async function addBudget(pc, n) { if (pc) await setBudget(pc, budgetOf(pc) + Number(n || 0)); }
/** Take `n` from the budget if it's there; false (and nothing taken) if not. */
export async function spendBudget(pc, n) {
  n = Math.round(Number(n) || 0);
  if (!pc || budgetOf(pc) < n) return false;
  await setBudget(pc, budgetOf(pc) - n);
  return true;
}
/** "1,234 budget" with the icon, for windows. */
export const budgetHtml = (n) => `<span class="qin-budget"><i class="fa-solid fa-sack-dollar"></i> ${Math.round(n).toLocaleString()} budget</span>`;

/** One-time move (GM, on ready): the coins players spent on their armies so far become their budget (David, 2026-11-13). */
async function migrateCoinToBudget() {
  if (!game.user.isGM || game.users.activeGM?.id !== game.user.id || game.settings.get(SYSTEM_ID, "budgetMigrated")) return;
  const lines = [];
  for (const u of game.users.filter(u => !u.isGM && u.character)) {
    const pc = u.character, coin = Math.max(0, pc.system.coin ?? 0);
    if (!coin) continue;
    await pc.update({ "system.coin": 0, [`flags.${SYSTEM_ID}.${BUDGET_FLAG}`]: budgetOf(pc) + coin });
    lines.push(`${esc(pc.name)}: ${coin.toLocaleString()}`);
  }
  await game.settings.set(SYSTEM_ID, "budgetMigrated", true);
  if (lines.length) ChatMessage.create({ content: `<p><b>Military budget</b>: players' coins became their army budget (personal coins start at 0).</p><p>${lines.join("<br>")}</p>`, speaker: { alias: "Party" }, whisper: game.users.filter(u => u.isGM).map(u => u.id) });
}

export function registerBudget() {
  game.settings.register(SYSTEM_ID, "budgetMigrated", { scope: "world", config: false, type: Boolean, default: false });
  game.qinBudget = { budgetOf, setBudget, addBudget, spendBudget };
  Hooks.once("ready", () => migrateCoinToBudget().catch(e => console.warn("Qin | moving coin into budget", e)));
}
