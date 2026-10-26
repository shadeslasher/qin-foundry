// Static configuration for the Qin: The Warring States system.

export const SYSTEM_ID = "qin";
export const systemPath = (p) => `systems/${SYSTEM_ID}/${p}`;

export const ASPECTS = {
  metal: { label: "Metal", short: "Met", yin: "Yin", trait: "Martial: strength, resilience, warlike spirit" },
  water: { label: "Water", short: "Wat", yin: "Yin", trait: "Physical: agility, speed, suppleness" },
  fire: { label: "Fire", short: "Fir", yin: "Yang", trait: "Social: charisma, intuition, inspiration" },
  wood: { label: "Wood", short: "Woo", yin: "Yang", trait: "Mental: intelligence, memory, perception" },
  earth: { label: "Earth", short: "Ear", yin: "Balance", trait: "Mystical: will, inner strength, the Tao" },
};

export const SKILL_LEVELS = {
  0: "Beginner", 1: "Apprentice", 2: "Competent", 3: "Expert", 4: "Master", 5: "Legendary", 6: "Godlike",
};

// Skills by domain. `complex` = marked with an asterisk in the rulebook: a Beginner
// cannot attempt the Test at all. `spec` = needs a specialization. `martial` = a
// fighting Skill (sets actions per round). `homebrew` = campaign addition.
const S = (label, opts = {}) => ({ label, complex: false, spec: false, martial: false, ...opts });
export const SKILLS = {
  // Martial domain (Metal)
  artOfWar: S("Art of War", { domain: "metal" }),
  bangshu: S("Bangshu (stick)", { domain: "metal", martial: true }),
  chuishu: S("Chuishu (mace)", { domain: "metal", martial: true }),
  daoshu: S("Daoshu (dagger)", { domain: "metal", martial: true }),
  dunshu: S("Dunshu (shield)", { domain: "metal", martial: true }),
  gongshu: S("Gongshu (archery)", { domain: "metal", martial: true }),
  handToHand: S("Hand-to-Hand", { domain: "metal", martial: true }),
  improvisation: S("Improvisation", { domain: "metal", martial: true }),
  jianshu: S("Jianshu (fencing)", { domain: "metal", martial: true }),
  nushu: S("Nushu (crossbow)", { domain: "metal", martial: true }),
  qiangshu: S("Qiangshu (spear)", { domain: "metal", martial: true }),
  throwing: S("Throwing", { domain: "metal", martial: true }),
  // Physical domain (Water)
  acrobatics: S("Acrobatics", { domain: "water" }),
  craft: S("Craft", { domain: "water", spec: true }),
  stealth: S("Stealth", { domain: "water" }),
  horsemanship: S("Horsemanship", { domain: "water" }),
  climbing: S("Climbing", { domain: "water" }),
  dodging: S("Dodging", { domain: "water" }),
  forge: S("Forge", { domain: "water", complex: true }),
  theft: S("Theft", { domain: "water" }),
  swimming: S("Swimming", { domain: "water" }),
  survival: S("Survival", { domain: "water", spec: true }),
  // Social domain (Fire)
  acting: S("Acting", { domain: "fire" }),
  arts: S("Arts", { domain: "fire", spec: true }),
  command: S("Command", { domain: "fire", homebrew: true }),
  dance: S("Dance", { domain: "fire" }),
  diplomacy: S("Diplomacy", { domain: "fire" }),
  eloquence: S("Eloquence", { domain: "fire" }),
  etiquette: S("Etiquette", { domain: "fire" }),
  games: S("Games", { domain: "fire" }),
  heraldry: S("Heraldry", { domain: "fire" }),
  intimidation: S("Intimidation", { domain: "fire" }),
  languages: S("Languages", { domain: "fire", complex: true, spec: true }),
  music: S("Music", { domain: "fire", spec: true }),
  seduction: S("Seduction", { domain: "fire" }),
  trade: S("Trade", { domain: "fire" }),
  // Mental domain (Wood)
  architecture: S("Architecture", { domain: "wood", complex: true }),
  bureaucracy: S("Bureaucracy", { domain: "wood", complex: true }),
  calligraphy: S("Calligraphy", { domain: "wood", complex: true }),
  herbalism: S("Herbalism", { domain: "wood" }),
  history: S("History", { domain: "wood" }),
  investigation: S("Investigation", { domain: "wood" }),
  law: S("Law", { domain: "wood", complex: true }),
  learning: S("Learning", { domain: "wood", spec: true }),
  literature: S("Literature", { domain: "wood", complex: true }),
  medicine: S("Medicine", { domain: "wood", complex: true }),
  navigation: S("Navigation", { domain: "wood", complex: true }),
  perception: S("Perception", { domain: "wood" }),
  science: S("Science", { domain: "wood", complex: true }),
  // Mystical domain (Earth)
  divination: S("Divination", { domain: "earth", complex: true }),
  empathy: S("Empathy", { domain: "earth" }),
  exorcism: S("Exorcism", { domain: "earth", complex: true }),
  externalAlchemy: S("External Alchemy", { domain: "earth", complex: true }),
  internalAlchemy: S("Internal Alchemy", { domain: "earth", complex: true }),
  legends: S("Legends", { domain: "earth" }),
  meditation: S("Meditation", { domain: "earth" }),
  taoism: S("Taoism", { domain: "earth", complex: true }),
  theology: S("Theology", { domain: "earth" }),
};

export const DOMAINS = {
  metal: "Martial (Metal)", water: "Physical (Water)", fire: "Social (Fire)", wood: "Mental (Wood)", earth: "Mystical (Earth)",
};

export const BOL_LEVELS = {
  normal: { label: "Normal", penalty: 0 },
  bruised: { label: "Bruised", penalty: 0 },
  slightly: { label: "Slightly Injured", penalty: 1 },
  seriously: { label: "Seriously Injured", penalty: 3 },
  fatally: { label: "Fatally Injured", penalty: 5 },
};

export const MAGIC_WAYS = {
  externalAlchemy: "External Alchemy", internalAlchemy: "Internal Alchemy", divination: "Divination", exorcism: "Exorcism",
};

export const OFFICER_ABILITY_KINDS = {
  passive: "Passive (always on)", skill: "Battle skill (once per turn)", heroic: "Heroic action (uses = Fire)", battleArt: "Battle art (Encouraged only)",
};

export const OFFICER_EFFECTS = {
  ignoreMoralePenalty: { label: "Ignores roll penalties from morale", type: "boolean" },
  noRearAgainst: { label: "Enemies get no rear-attack bonus", type: "boolean" },
  ignoreEncirclement: { label: "Ignores encirclement morale loss", type: "boolean" },
  moveBonus: { label: "Movement bonus", type: "number" },
  chargeAttackBonus: { label: "Bonus to roll when charging", type: "number" },
  extraMoraleLossOnWin: { label: "Extra morale loss for enemies it beats", type: "number" },
};

// One signature skill per slot, shown under the derived stats. The two battle slots
// feed the battlefield system when the character leads a unit.
export const SIGNATURE_SLOTS = {
  passive: { label: "Passive", battle: false },
  active: { label: "Active", battle: false },
  active2: { label: "Active II", battle: false, extra: 1 },
  active3: { label: "Active III", battle: false, extra: 2 },
  active4: { label: "Active IV", battle: false, extra: 3 },
  battlePassive: { label: "Battle Passive", battle: true },
  battleActive: { label: "Battle Active", battle: true },
};

/** Extra in-person actives a character's tier allows (David, 2026-10-26): Tier 2 one, Tier 1 two, Tier 0 three. */
export function extraActivesForTier(tier) {
  const t = String(tier ?? "").trim();
  if (/^0/.test(t)) return 3;
  if (/^1/.test(t)) return 2;
  if (/^2/.test(t)) return 1;
  return 0;
}

export const UNIT_CATEGORIES = { infantry: "Infantry", cavalry: "Cavalry", ranged: "Ranged" };
export const SIDES = { player: "Player", enemy: "Enemy", ally: "Ally", neutral: "Neutral" };
