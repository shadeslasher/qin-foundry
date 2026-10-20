// Pure Qin rules math. No Foundry dependencies, so it can be unit-tested in Node.

/** Body (Metal+Water) vs Mind (Fire+Wood). */
export function balance(a) {
  return Math.abs((a.metal + a.water) - (a.fire + a.wood));
}

export function basicChi(bal) {
  if (bal <= 0) return 4;
  if (bal <= 2) return 3;
  if (bal <= 5) return 2;
  return 1;
}

/** Chi = Basic Chi x Earth x best Skill Level (canonical; no Metal substitution). */
export function chiMax(a, bestSkill) {
  return basicChi(balance(a)) * a.earth * bestSkill;
}

export const passiveDefense = (a) => a.water + a.wood + 2;
export const resistance = (a) => a.metal + a.earth;

// Breath of Life total by Resistance row and Balance column (p.50).
const BOL_TOTAL = [
  // [maxResistance, bal0, bal1-2, bal3-5, bal6-8]
  [2, 17, 15, 13, 11],
  [4, 19, 17, 15, 13],
  [7, 21, 19, 17, 15],
  [9, 23, 21, 19, 17],
  [Infinity, 25, 23, 21, 19],
];
export function bolTotal(a) {
  const res = resistance(a), bal = balance(a);
  const row = BOL_TOTAL.find(r => res <= r[0]);
  const col = bal <= 0 ? 1 : bal <= 2 ? 2 : bal <= 5 ? 3 : 4;
  return row[col];
}

// Distribution of boxes per level by total (p.50).
const BOL_DIST = {
  11: [3, 3, 2, 2, 1], 13: [4, 3, 3, 2, 1], 15: [5, 4, 3, 2, 1], 17: [6, 5, 3, 2, 1],
  19: [7, 5, 4, 2, 1], 21: [7, 5, 4, 3, 2], 23: [8, 6, 4, 3, 2], 25: [8, 6, 5, 4, 2],
};
export const BOL_KEYS = ["normal", "bruised", "slightly", "seriously", "fatally"];
export const BOL_PENALTY = { normal: 0, bruised: 0, slightly: 1, seriously: 3, fatally: 5 };

/**
 * Boxes per level. strengthenedBody = Tao level (book p.80): L1 +2 Normal, L2 +2 Normal,
 * L3 +2 Bruised, L4 +2 Slightly Injured. override = 5 numbers (0 = automatic).
 */
export function bolDistribution(a, { strengthenedBody = 0, override = null } = {}) {
  const total = bolTotal(a);
  const dist = (BOL_DIST[total] || BOL_DIST[17]).slice();
  if (strengthenedBody >= 1) dist[0] += 2;
  if (strengthenedBody >= 2) dist[0] += 2;
  if (strengthenedBody >= 3) dist[1] += 2;
  if (strengthenedBody >= 4) dist[2] += 2;
  if (override && override.some(n => n > 0)) return override.map((n, i) => (n > 0 ? n : dist[i]));
  return dist;
}

/** Where `damage` boxes crossed off leaves the character. */
export function bolState(dist, damage) {
  let left = Math.max(0, damage);
  const levels = BOL_KEYS.map((key, i) => {
    const max = dist[i], filled = Math.min(max, left);
    left -= filled;
    return { key, max, filled, penalty: BOL_PENALTY[key] };
  });
  const total = dist.reduce((a, b) => a + b, 0);
  const remaining = Math.max(0, total - damage);
  // Current level = first level with an empty box; all full = coma (fatally).
  const current = levels.find(l => l.filled < l.max) || levels[levels.length - 1];
  const coma = damage >= total;
  const dead = damage > total;
  // Penalty applies once a level has started being crossed off past the first box of it?
  // Book: penalty of the level the character is currently at (first level with boxes left).
  return { levels, total, remaining, current: current.key, penalty: coma ? 5 : current.penalty, coma, dead };
}

export function actionsPerRound(skillLevel) {
  return Math.max(0, skillLevel) + 1;
}

/** Armor movement penalty = protection - Metal, minimum 0. */
export const armorPenalty = (protection, metal) => Math.max(0, protection - metal);

/**
 * Resolve a Yin/Yang roll with the campaign's homebrew.
 * yin, yang: 0-9 faces.
 * - normal: result = |yin - yang|
 * - double (non-zero): result = the face value (no automatic success); regain that much Chi
 * - double zero: critical failure, lose 5 Chi
 * - Beginner (skill 0, if usesSkill): cannot get Yin/Yang effects; a double counts as 0
 */
export function yinYangResult(yin, yang, { beginner = false } = {}) {
  const double = yin === yang;
  const critFail = double && yin === 0;
  let value = Math.abs(yin - yang);
  let chiGain = 0;
  if (double && !critFail) {
    if (beginner) value = 0;
    else { value = yin; chiGain = yin; }
  }
  const yangDiff = yang > yin ? yang - yin : 0;
  return { yin, yang, value, double, critFail, chiGain: beginner ? 0 : chiGain, chiLoss: critFail ? 5 : 0, yangDiff };
}

/**
 * Attack damage = Metal + weapon damage + (Yang - Yin if Yang higher) + (face value on a
 * double, only if the attack hits).
 */
export function attackDamage({ metal, weapon, dice, hit, bonus = 0 }) {
  let dmg = metal + weapon + dice.yangDiff + bonus;
  if (dice.double && !dice.critFail && hit) dmg += dice.value;
  return Math.max(0, dmg);
}

/** Spending Chi: below zero, each negative point becomes a damage point. */
export function spendChi(current, cost) {
  const after = current - cost;
  const wasNegative = Math.min(0, current);
  const damage = Math.max(0, wasNegative - Math.min(0, after));
  return { chi: after, damage };
}

/** Tao / Skill / Technique purchase costs. */
export const CREATION_COST = { 1: 1, 2: 3, 3: 6 };
export const XP_COST = { skill: { 1: 4, 2: 8, 3: 12, 4: 16 }, tao: { 1: 4, 2: 8, 3: 12, 4: 16 }, aspect: (v) => 5 * v };
