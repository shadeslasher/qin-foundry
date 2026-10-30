import { SKILLS, ASPECTS } from "../config.mjs";
import * as Q from "../rules/qin-rules.mjs";
import { parseTraitText, traitTextOf, traitTiersOf } from "../battle/traits.mjs";

const fields = foundry.data.fields;
const int = (initial = 0, opts = {}) => new fields.NumberField({ required: true, nullable: false, integer: true, initial, ...opts });

function aspectsSchema(initial = 2) {
  const s = {};
  for (const k of Object.keys(ASPECTS)) s[k] = int(initial, { min: 0, max: 10 });
  return new fields.SchemaField(s);
}
function skillsSchema() {
  const s = {};
  for (const k of Object.keys(SKILLS)) {
    s[k] = new fields.SchemaField({
      value: int(0, { min: 0, max: 6 }), spec: new fields.StringField({ initial: "" }),
      known: new fields.BooleanField({ initial: false }), // learned at Beginner (level 0) — shown like a trained skill
    });
  }
  return new fields.SchemaField(s);
}

/** Collects skill levels from built-in skills plus extra "skill" items. */
function allSkillLevels(system, items) {
  const levels = Object.values(system.skills).map(s => s.value);
  for (const i of items ?? []) if (i.type === "skill") levels.push(i.system.value);
  return levels;
}

/** Shared by characters (PCs and VIP NPCs) and henchmen. */
class QinBaseActor extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      aspects: aspectsSchema(2),
      skills: skillsSchema(),
      biography: new fields.HTMLField({ initial: "" }),
      notes: new fields.HTMLField({ initial: "" }),
      pdBonus: int(0),
    };
  }

  prepareDerivedData() {
    const a = this.aspects;
    const items = this.parent?.items ?? [];
    this.balance = Q.balance(a);
    this.resistance = Q.resistance(a);
    this.passiveDefense = Q.passiveDefense(a) + (this.pdBonus || 0);
    // Armor: best equipped protection (shields add their defense bonus separately)
    let protection = 0, defenseBonus = 0, armorPD = 0;
    for (const i of items) {
      if (i.type !== "armor" || !i.system.equipped) continue;
      protection = Math.max(protection, i.system.protection);
      defenseBonus += i.system.defenseBonus || 0;
      armorPD += i.system.pdModifier || 0;
    }
    this.passiveDefense += armorPD;
    this.armor = { protection, defenseBonus, movementPenalty: Q.armorPenalty(protection, a.metal) };
    this.bestSkill = Math.max(0, ...allSkillLevels(this, items));
  }
}

export class CharacterData extends QinBaseActor {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      details: new fields.SchemaField({
        state: new fields.StringField({ initial: "" }),
        characterType: new fields.StringField({ initial: "" }),
        tier: new fields.StringField({ initial: "" }),
        title: new fields.StringField({ initial: "" }),
      }),
      chi: new fields.SchemaField({ value: int(0), bonus: int(0) }),
      bol: new fields.SchemaField({
        damage: int(0, { min: 0 }),
        override: new fields.ArrayField(int(0, { min: 0 }), { initial: [0, 0, 0, 0, 0] }),
      }),
      renown: int(0, { min: 0 }),
      coin: int(0, { min: 0 }),
      experience: new fields.SchemaField({ value: int(0), total: int(0) }),
      deeds: new fields.HTMLField({ initial: "" }),
      // offices and ranks the character has held, one card each in Bio and notes (David, 2026-10-26)
      offices: new fields.ArrayField(new fields.SchemaField({
        title: new fields.StringField({ initial: "" }), when: new fields.StringField({ initial: "" }), grantedBy: new fields.StringField({ initial: "" }),
      }), { initial: [] }),
    };
  }

  prepareDerivedData() {
    super.prepareDerivedData();
    const items = this.parent?.items ?? [];
    this.chi.max = Q.chiMax(this.aspects, this.bestSkill) + (this.chi.bonus || 0);
    const sb = items.find(i => i.type === "tao" && i.system.key === "strengthenedBody");
    const dist = Q.bolDistribution(this.aspects, { strengthenedBody: sb?.system.level ?? 0, override: this.bol.override });
    const st = Q.bolState(dist, this.bol.damage);
    this.bol.levels = st.levels;
    this.bol.total = st.total;
    this.bol.remaining = st.remaining;
    this.bol.current = st.current;
    this.bol.penalty = st.penalty;
    this.bol.coma = st.coma;
    this.bol.dead = st.dead;
    this.penalty = st.penalty;
  }
}

/** Henchmen: no Chi, no Breath of Life. Out of action when one blow exceeds Resistance. */
export class HenchmanData extends QinBaseActor {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      outOfAction: new fields.BooleanField({ initial: false }),
      count: int(1, { min: 1 }),
      tier: int(1, { min: 1, max: 6 }),   // campaign homebrew: health = tier
      wounds: int(0, { min: 0 }),          // health lost
    };
  }
  prepareDerivedData() {
    super.prepareDerivedData();
    this.penalty = 0;
    this.hp = { max: this.tier, value: Math.max(0, this.tier - this.wounds) };
  }
}

/** A battlefield unit: one formation of soldiers, optionally led by an officer (Fire Emblem-style battles). */
/** A unit's resting morale: 50, +5/+10/+15 for Disciplined/+/++ (David, 2026-10-25). */
export function defaultMoraleFor(traits) {
  const d = traitTiersOf(traits).disciplined || 0;
  return 50 + [0, 5, 10, 15][Math.min(3, d)];
}

export class UnitData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      side: new fields.StringField({ initial: "player", choices: ["player", "enemy", "ally", "neutral"] }),
      faction: new fields.StringField({ initial: "" }),
      unitType: new fields.StringField({ initial: "" }),          // e.g. "Spear and Shield", "Mounted Spear"
      tier: int(1, { min: 1, max: 6 }),
      category: new fields.StringField({ initial: "infantry", choices: ["infantry", "cavalry", "ranged"] }),
      weaponSkill: new fields.StringField({ initial: "qiangshu" }), // officer skill used in the combat roll
      weaponSkill2: new fields.StringField({ initial: "" }),       // a second weapon (e.g. Azure Dragons: spear and bow); the officer uses whichever is higher
      men: new fields.SchemaField({ value: int(100, { min: 0 }), max: int(100, { min: 1 }) }), // shown as Health
      armor: int(0, { min: 0 }),
      armorNote: new fields.StringField({ initial: "" }),          // e.g. "2 + 2 (Shield)"
      damage: int(5, { min: 0 }),
      armorPen: int(0, { min: 0 }),
      move: int(3, { min: 0 }),
      range: int(1, { min: 1 }),                                    // 1 = melee; 2+ = ranged
      rangeMin: int(1, { min: 1 }),
      unitValue: int(1, { min: 0 }),
      cost: int(0, { min: 0 }),                                     // recruitment cost in coins; upkeep is a quarter of it a month
      level: int(1, { min: 1 }),                                    // every 100 XP; for the promotion tree (not tier)
      xp: new fields.SchemaField({ value: int(0, { min: 0 }), max: int(100, { min: 1 }) }),
      morale: int(50, { min: 0, max: 100 }),
      hidden: new fields.BooleanField({ initial: false }),
      status: new fields.StringField({ initial: "active", choices: ["active", "defeated", "surrendered", "escaped"] }),
      officer: new fields.StringField({ initial: "" }),            // UUID of a character actor
      traits: new fields.HTMLField({ initial: "" }),                // older free-text traits; the list below replaces it
      traitList: new fields.ArrayField(new fields.SchemaField({
        name: new fields.StringField({ initial: "" }),
        desc: new fields.StringField({ initial: "" }),
        level: int(1, { min: 1 }),                                   // the trait is locked until this level
        equip: new fields.BooleanField({ initial: false }),           // a piece of equipment (Equipment tab), not a trait
        upgrades: new fields.ArrayField(new fields.SchemaField({     // e.g. at level 5 it becomes "Anti-Infantry+"
          level: int(5, { min: 1 }), name: new fields.StringField({ initial: "" }), desc: new fields.StringField({ initial: "" }),
        })),
        // a choice: at `level` the unit picks one of these (then it works like a normal trait)
        options: new fields.ArrayField(new fields.SchemaField({ name: new fields.StringField({ initial: "" }), desc: new fields.StringField({ initial: "" }) })),
        chosen: int(-1, { min: -1 }),
      })),
    };
  }

  /** Older unit actors (Defense / weapon / rangeMax fields). */
  static migrateData(source) {
    if (source.defense !== undefined && source.armor === undefined) source.armor = source.defense;
    if (source.rangeMax !== undefined && source.range === undefined) source.range = source.weapon === "ranged" ? Math.max(2, source.rangeMax) : 1;
    // free-text traits become trait cards (the text is kept until the list is first edited)
    if (typeof source.traits === "string" && source.traits.trim() && !source.traitList?.length) source.traitList = parseTraitText(source.traits);
    return super.migrateData(source);
  }

  get officerActor() {
    if (!this.officer) return null;
    try { return fromUuidSync(this.officer) ?? null; } catch { return null; }
  }

  get isRanged() { return this.range > 1; }

  prepareDerivedData() {
    const m = this.morale;
    this.moraleState = m <= 0 ? "Surrendered" : m <= 25 ? "Demoralized" : m >= 75 ? "Encouraged" : "Neutral";
    this.weapon = this.range > 1 ? "ranged" : "melee";
    this.upkeep = Math.round((this.cost || 0) / 4);
    // everything reads `traits`: make it the traits unlocked at the unit's current level
    if (this.traitList?.length) this.traits = traitTextOf(this.traitList, this.level);
    this.defaultMorale = defaultMoraleFor(this.traits);
  }
}
