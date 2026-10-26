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
      attackModifier: int(0), // added to (or, if negative, taken from) every Attack Test with this weapon
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
      pdModifier: int(0), // raises (or lowers) Passive Defense while equipped
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
      slot: new fields.StringField({ initial: "passive", choices: ["passive", "active", "active2", "active3", "active4", "battlePassive", "battleActive"] }),
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

/**
 * Battlefield formation (embedded in a unit). Numbers are roll modifiers; see the item sheet for meanings.
 * Only the GM may create, edit or delete these.
 */
const FORMATION_ZERO = { moveMod: 0, immobile: false, noRear: false, defAll: 0, defMelee: 0, defRanged: 0, defFront: 0, frontMelee: 0,
  atkMod: 0, rearAtk: 0, chargeBonus: 0, dmgMod: 0, casReduce: 0, noAttackerBonus: false, noChargeBonus: false, winReposition: false };
const P = (t) => `<p>${t}</p>`;
const FORMATION_REV2 = {
  loose: { fx: { defRanged: 3, defMelee: -2, atkMod: -1 }, desc: P("Commanded Unit spreads out: <b>ranged defense +3</b>, <b>melee defense -2</b>, <b>attack -1</b>. <i>Most infantry units.</i>") },
  diamond: { fx: { moveMod: -3, atkMod: -2, defAll: 2 }, desc: P("Commanded Unit forms a diamond: <b>movement -3</b>, <b>attack -2</b>, <b>melee and ranged defense +2</b>. <i>Cavalry only.</i>") },
  wedge: { fx: { defAll: -2, winReposition: true }, desc: P("Commanded Unit forms a wedge: <b>melee and ranged defense -2</b>. If it <b>wins the Command roll when attacking</b>, it may <b>move to any empty tile next to the enemy unit</b>. <i>Cavalry.</i>") },
  circle: { fx: { immobile: true, defMelee: 2, defRanged: -1, atkMod: -1, noRear: true }, desc: P("Commanded Unit forms a circle and <b>cannot move</b>: <b>melee defense +2</b>, <b>ranged defense -1</b>, <b>attack -1</b>. It <b>cannot be attacked in the rear</b>. <i>Melee infantry.</i>") },
  hollow_square: { fx: { immobile: true, defMelee: 2, noChargeBonus: true, defRanged: -2, atkMod: -2, noRear: true }, desc: P("Commanded Unit forms a hollow square and <b>cannot move</b>: <b>melee defense +2</b>, <b>enemies charging it get no charge bonus</b>, <b>ranged defense -2</b>, <b>attack -2</b>. It <b>cannot be attacked in the rear</b>. <i>Melee infantry.</i>") },
  shield_wall: { fx: { moveMod: -1, defAll: 2, rearAtk: 2 }, desc: P("Commanded Unit raises its shields: <b>movement -1</b>, <b>melee and ranged defense +2</b>. <b>Rear attacks against it get attack +2</b> more. <i>Infantry with shields.</i>") },
  spear_wall: { fx: { moveMod: -1, defMelee: 4, atkMod: 1, noChargeBonus: true, defRanged: -2, rearAtk: 2 }, desc: P("Commanded Unit points its spears forward: <b>movement -1</b>, <b>melee defense +4</b>, <b>attack +1</b>, <b>enemies charging it get no charge bonus</b>, <b>ranged defense -2</b>. <b>Rear attacks against it get attack +2</b> more. <i>Infantry with spears.</i>") },
  turtle: { fx: { moveMod: -2, defAll: 3, atkMod: -2, noRear: true }, desc: P("Commanded Unit overlaps its shields: <b>movement -2</b>, <b>melee and ranged defense +3</b>, <b>attack -2</b>. It <b>cannot be attacked in the rear</b>. <i>Infantry with shields.</i>") },
};
export { FORMATION_REV2 };

export class FormationData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const n = () => new fields.NumberField({ required: true, integer: true, initial: 0 });
    return {
      key: new fields.StringField({ initial: "" }),
      moveMod: n(), immobile: new fields.BooleanField({ initial: false }),
      defMelee: n(), defRanged: n(), atkMod: n(), rearAtk: n(),
      noChargeBonus: new fields.BooleanField({ initial: false }),
      winReposition: new fields.BooleanField({ initial: false }),
      rulesVersion: n(), // which revision of David's formation rules this item was last brought up to
      defAll: n(), defFront: n(), frontMelee: n(), chargeBonus: n(), dmgMod: n(), casReduce: n(),
      noAttackerBonus: new fields.BooleanField({ initial: false }),
      noRear: new fields.BooleanField({ initial: false }),
      description: desc(),
    };
  }

  /** Formation items copied before the melee/ranged split: update untouched defaults. */
  static migrateData(src) {
    const v = (k) => Number(src[k] ?? 0) || 0;
    // older handout defaults (before melee/ranged were split)
    if (src.key === "circle" && v("vsAttack") === -3 && !v("vsMelee")) { src.vsAttack = 0; src.vsMelee = -3; }
    if (src.key === "hollow_square" && v("vsAttack") === -2 && src.vsCharge === -2 && !v("vsMelee")) { src.vsAttack = 0; src.vsMelee = -2; src.vsCharge = -4; }
    if (src.key === "turtle" && v("defAll") === 2 && !v("vsAttack")) { src.defAll = 0; src.vsAttack = -2; }
    // "enemy attacks +/-N" (added to the attacker) became defense bonuses (added to this unit's roll)
    if (["vsAttack", "vsMelee", "vsRanged", "vsCharge"].some(k => k in src)) {
      src.defAll = v("defAll") - v("vsAttack");
      src.defMelee = v("defMelee") - v("vsMelee");
      src.defRanged = v("defRanged") - v("vsRanged");
      if (src.vsCharge !== null && src.vsCharge !== undefined) src.defCharge = -Number(src.vsCharge);
      for (const k of ["vsAttack", "vsMelee", "vsRanged", "vsCharge"]) delete src[k];
    }
    // October 2026 formation revision: the standard formations take their new rules (by key)
    if ((Number(src.rulesVersion) || 0) < 3 && FORMATION_REV2[src.key]) {
      Object.assign(src, FORMATION_ZERO, FORMATION_REV2[src.key].fx, { rulesVersion: 3 });
      if (FORMATION_REV2[src.key].desc) src.description = FORMATION_REV2[src.key].desc;
    }
    delete src.defCharge;
    return super.migrateData(src);
  }
}
