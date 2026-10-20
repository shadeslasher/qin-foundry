import { SKILLS } from "../config.mjs";

const fields = foundry.data.fields;
const int = (initial = 0, opts = {}) => new fields.NumberField({ required: true, nullable: false, integer: true, initial, ...opts });
const desc = () => new fields.HTMLField({ initial: "" });

export class WeaponData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      skill: new fields.StringField({ initial: "jianshu" }),
      damage: int(3),
      resilience: int(9),
      range: new fields.SchemaField({ c: int(0), m: int(0), l: int(0), e: int(0) }), // yards; all 0 = close combat
      price: int(0),
      equipped: new fields.BooleanField({ initial: true }),
      animation: new fields.StringField({ initial: "" }), // optional Sequencer/JB2A path
      description: desc(),
    };
  }
  get isRanged() { return this.range.c + this.range.m + this.range.l + this.range.e > 0; }
}

export class ArmorData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      protection: int(0, { min: 0 }),
      resilience: int(0),
      defenseBonus: int(0), // e.g. small shield +1 to Active Defense with Dunshu
      price: int(0),
      equipped: new fields.BooleanField({ initial: true }),
      description: desc(),
    };
  }
}

export class TaoData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      key: new fields.StringField({ initial: "" }),
      level: int(1, { min: 0, max: 6 }),
      effects: new fields.SchemaField({
        l1: new fields.StringField({ initial: "" }), l2: new fields.StringField({ initial: "" }),
        l3: new fields.StringField({ initial: "" }), l4: new fields.StringField({ initial: "" }),
      }),
      description: desc(),
    };
  }
}

export class TechniqueData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      skill: new fields.StringField({ initial: "jianshu" }),
      skillLevel: int(1, { min: 1, max: 6 }),
      stIncrease: int(1),
      kind: new fields.StringField({ initial: "close", choices: ["close", "distance"] }),
      roll: new fields.StringField({ initial: "attack", choices: ["attack", "defense", "other"] }),
      description: desc(),
    };
  }
}

export class MagicData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      way: new fields.StringField({ initial: "exorcism" }),
      skillLevel: int(1, { min: 1, max: 6 }),
      chiCost: int(1, { min: 0 }),
      prepST: int(0),
      prepTime: new fields.StringField({ initial: "" }),
      duration: new fields.StringField({ initial: "" }),
      area: new fields.StringField({ initial: "" }),
      improvements: new fields.StringField({ initial: "" }),
      description: desc(),
    };
  }
}

export class TraitData extends foundry.abstract.TypeDataModel {
  static defineSchema() { return { description: desc() }; }
}

export class GearData extends foundry.abstract.TypeDataModel {
  static defineSchema() { return { quantity: int(1, { min: 0 }), price: int(0), description: desc() }; }
}

/** Extra skill instance (e.g. a second Craft or Language). */
export class SkillData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      domain: new fields.StringField({ initial: "water" }),
      value: int(1, { min: 0, max: 6 }),
      complex: new fields.BooleanField({ initial: false }),
      martial: new fields.BooleanField({ initial: false }),
      description: desc(),
    };
  }
}

/** Battlefield officer ability: passive, battle skill, heroic action or battle art. */
export class OfficerAbilityData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      kind: new fields.StringField({ initial: "passive", choices: ["passive", "skill", "heroic", "battleArt"] }),
      moraleCost: int(0, { min: 0 }),
      effects: new fields.SchemaField({
        ignoreMoralePenalty: new fields.BooleanField({ initial: false }),
        noRearAgainst: new fields.BooleanField({ initial: false }),
        ignoreEncirclement: new fields.BooleanField({ initial: false }),
        moveBonus: int(0),
        chargeAttackBonus: int(0),
        extraMoraleLossOnWin: int(0),
      }),
      description: desc(),
    };
  }
}

/** A signature skill occupying one slot: Passive, Active, Battle Passive or Battle Active. */
export class SignatureData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      slot: new fields.StringField({ initial: "passive", choices: ["passive", "active", "battlePassive", "battleActive"] }),
      chiCost: int(0, { min: 0 }),
      moraleCost: int(0, { min: 0 }),
      effects: new fields.SchemaField({
        ignoreMoralePenalty: new fields.BooleanField({ initial: false }),
        noRearAgainst: new fields.BooleanField({ initial: false }),
        ignoreEncirclement: new fields.BooleanField({ initial: false }),
        moveBonus: int(0),
        chargeAttackBonus: int(0),
        extraMoraleLossOnWin: int(0),
      }),
      description: desc(),
    };
  }
}

export const SKILL_CHOICES = () => Object.fromEntries(Object.entries(SKILLS).map(([k, v]) => [k, v.label]));
