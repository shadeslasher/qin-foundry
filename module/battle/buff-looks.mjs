// Which buff/debuff animation (buff-fx.mjs) a landed effect plays, by the stats it changes (David, 2026-11-21). Pure.
/* ---------------------------------------------------------------- which looks a landed effect plays */
const STAT_LOOK = {
  attack: "atk", damage: "atk", pen: "atk", commandAtk: "atk", contestAtk: "atk", enemyLoss: "atk", enemyLossAtk: "atk",
  meleeDef: "def", rangedDef: "def", armor: "def", resist: "def", commandDef: "def", reflectMelee: "def",
  command: "cmd", contestNext: "cmd",
  moraleLossLess: "mor", checkpointLess: "mor", skillLossLess: "mor", anyLossLess: "mor", startMorale: "mor", regenCap: "mor",
  moraleFloor: "mor", surroundLossLess: "mor", fireLossLess: "mor",
  move: "mov", moveAway: "mov",
};
const LOWER_IS_BETTER = new Set(["damageTaken", "forcedMarchCost", "skillCost"]);
const FLAG_LOOK = { ignoreLowMorale: "morUp", noRout: "morUp", noSurrender: "morUp", noRoutLoss: "morUp", ignoreTerrainCost: "movUp" };
const STATUS_LOOK = { cantMove: "stun", cantAttack: "stun", cantMoveOrAttack: "stun", skipTurn: "stun" };
/** The looks a skill's buff record plays when it lands: one per stat group it raises or lowers. */
export function looksOfBuff(b) {
  const out = new Set();
  for (const m of b?.mods ?? []) {
    const v = Number(m.value) || 0; if (!v) continue;
    if (m.stat === "damageTaken") { out.add(v < 0 ? "defUp" : "defDn"); continue; }
    if (m.stat === "forcedMarchCost") { out.add(v < 0 ? "movUp" : "movDn"); continue; }
    const g = STAT_LOOK[m.stat]; if (!g) continue;
    const up = LOWER_IS_BETTER.has(m.stat) ? v < 0 : v > 0;
    out.add(g + (up ? "Up" : "Dn"));
  }
  for (const f of b?.flags ?? []) { const k = FLAG_LOOK[f.flag ?? f]; if (k) out.add(k); }
  if (b?.status && STATUS_LOOK[b.status]) out.add(STATUS_LOOK[b.status]);
  return [...out];
}
/** The looks for the other lasting effects (traits and the like), by their effect key. */
export function looksOfKey(key) {
  if (key.startsWith("t:sunder") || key.startsWith("t:poison")) return ["defDn"];
  if (key.startsWith("t:suppressed")) return ["atkDn", "movDn"];
  if (key.startsWith("t:deterred")) return ["atkDn"];
  if (key.startsWith("t:slow")) return ["movDn"];
  return [];
}
