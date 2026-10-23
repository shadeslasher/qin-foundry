// Default rules data. Everything here is editable in-game by the host
// (Library panel), and saved with each session.

const TERRAIN = {
  flat: { name: 'Flat', passable: true, cover: 0 },
  grass: { name: 'Tall grass', passable: true, cover: 2 }, // hidden; seen within 2 tiles (20 ft)
  trees: { name: 'Trees', passable: true, cover: 4 },      // hidden; seen within 4 tiles (40 ft)
  impassable: { name: 'Impassable', passable: false, cover: 0 },
};

// Formation fields (all optional, default 0/false):
//   moveMod        added to the unit's movement
//   immobile       unit cannot move
//   defAll         melee & ranged defense: added to THIS unit's roll whenever it defends
//   defMelee       melee defense: added to this unit's roll against melee attacks
//   defRanged      ranged defense: added to this unit's roll against ranged attacks
//   atkMod         attack: added to THIS unit's roll only when it attacks
//   rearAtk        extra attack for enemies attacking this unit from the rear (on top of the usual +2)
//   noChargeBonus  enemies charging this unit get no charge bonus
//   winReposition  after winning as the attacker, may move to an empty tile next to the enemy unit
//   defFront       added to THIS unit's roll when defending against attacks from the front
//   chargeBonus    added to this unit's roll when it makes a cavalry charge
//   dmgMod         added to this unit's damage value
//   noRear         this unit cannot be attacked in the rear
//   defAll         added to THIS unit's roll whenever it defends
//   frontMelee     added to THIS unit's roll in melee (attacking or defending) when the enemy is in front of it
//   casReduce      this unit takes this many fewer casualties (attacking or defending)
//   noAttackerBonus  this unit loses the +2 attacker bonus
const FORMATIONS = [
  { id: 'none', name: 'No formation', desc: 'No modifiers.' },
  { id: 'loose', name: 'Loose', defRanged: 3, defMelee: -2, atkMod: -1,
    desc: 'Ranged defense +3. Melee defense -2. Attack -1. (Most infantry units.)' },
  { id: 'diamond', name: 'Diamond', moveMod: -3, atkMod: -2, defAll: 2,
    desc: 'Movement -3. Attack -2. Melee and ranged defense +2. (Cavalry only.)' },
  { id: 'wedge', name: 'Wedge', defAll: -2, winReposition: true,
    desc: 'Melee and ranged defense -2. If it wins the Command roll when attacking, it may move to any empty tile next to the enemy unit. (Cavalry.)' },
  { id: 'circle', name: 'Circle', immobile: true, defMelee: 2, defRanged: -1, atkMod: -1, noRear: true,
    desc: 'Cannot move. Melee defense +2. Ranged defense -1. Attack -1. Cannot be attacked in the rear. (Melee infantry.)' },
  { id: 'hollow_square', name: 'Hollowed Square', immobile: true, defMelee: 2, noChargeBonus: true, defRanged: -2, atkMod: -2, noRear: true,
    desc: 'Cannot move. Melee defense +2. Enemies charging it get no charge bonus. Ranged defense -2. Attack -2. Cannot be attacked in the rear. (Melee infantry.)' },
  { id: 'shield_wall', name: 'Shield Wall', moveMod: -1, defAll: 2, rearAtk: 2,
    desc: 'Movement -1. Melee and ranged defense +2. Rear attacks against it get Attack +2 more. (Infantry with shields.)' },
  { id: 'spear_wall', name: 'Spear Wall', moveMod: -1, defMelee: 4, atkMod: 1, noChargeBonus: true, defRanged: -2, rearAtk: 2,
    desc: 'Movement -1. Melee defense +4. Attack +1. Enemies charging it get no charge bonus. Ranged defense -2. Rear attacks against it get Attack +2 more. (Infantry with spears.)' },
  { id: 'turtle', name: 'Turtle', moveMod: -2, defAll: 3, atkMod: -2, noRear: true,
    desc: 'Movement -2. Melee and ranged defense +3. Attack -2. Cannot be attacked in the rear. (Infantry with shields.)' },
];

// Unit types. Damage and Defense come from the v1.9 compendium (Dmg, Armor).
// Unit Value and movement are PLACEHOLDERS until the stat sheets are done.
// category: infantry | cavalry | ranged.  weapon: melee | ranged.
// skill: the officer weapon skill used for Skill Value in the combat roll.
const ALL = FORMATIONS.map(f => f.id);
function ut(id, name, faction, tier, category, weapon, skill, damage, defense, extra) {
  const base = {
    id, name, faction, tier, category, weapon, skill, damage, defense,
    unitValue: tier,
    move: category === 'cavalry' ? 6 : 4,
    rangeMin: weapon === 'ranged' ? 2 : 1,
    rangeMax: weapon === 'ranged' ? 3 : 1,
    formations: ALL,
  };
  return Object.assign(base, extra || {});
}
const UNIT_TYPES = [
  // Han infantry
  ut('han_peasant_spear', 'Peasant Spearmen', 'Han', 1, 'infantry', 'melee', 'Qiangshu', 5, 0),
  ut('han_ji_militia', 'Ji Militia', 'Han', 1, 'infantry', 'melee', 'Qiangshu', 5, 3),
  ut('han_ji_inf', 'Ji Infantry', 'Han', 2, 'infantry', 'melee', 'Qiangshu', 6, 3),
  ut('han_sabre_inf', 'Sabre Infantry', 'Han', 2, 'infantry', 'melee', 'Jianshu', 6, 3),
  ut('han_spear_guard', 'Spear Guards', 'Han', 2, 'infantry', 'melee', 'Qiangshu', 6, 3),
  ut('han_heavy_ji', 'Heavy Ji Infantry', 'Han', 3, 'infantry', 'melee', 'Qiangshu', 7, 4),
  ut('han_heavy_spear', 'Heavy Spear Guards', 'Han', 3, 'infantry', 'melee', 'Qiangshu', 6, 4),
  ut('han_protectors', 'Protectors of Heaven', 'Han', 4, 'infantry', 'melee', 'Qiangshu', 8, 5),
  // Han cavalry
  ut('han_lancer_cav', 'Lancer Cavalry', 'Han', 2, 'cavalry', 'melee', 'Qiangshu', 6, 3),
  ut('han_sabre_cav', 'Sabre Cavalry', 'Han', 2, 'cavalry', 'melee', 'Jianshu', 6, 3),
  ut('han_cataphracts', 'Cataphracts', 'Han', 3, 'cavalry', 'melee', 'Qiangshu', 6, 4),
  ut('han_heavy_cataphracts', 'Heavy Cataphracts', 'Han', 4, 'cavalry', 'melee', 'Qiangshu', 7, 5),
  // Han ranged
  ut('han_archers', 'Archers', 'Han', 2, 'ranged', 'ranged', 'Gongshu', 3, 2),
  ut('han_crossbow', 'Crossbowmen', 'Han', 2, 'ranged', 'ranged', 'Nushu', 5, 3, { rangeMax: 4 }),
  ut('han_heavy_crossbow', 'Heavy Crossbowmen', 'Han', 3, 'ranged', 'ranged', 'Nushu', 5, 4, { rangeMax: 4 }),
  ut('han_mounted_archers', 'Mounted Archers', 'Han', 3, 'cavalry', 'ranged', 'Gongshu', 3, 2, { move: 6 }),
  // Yellow Turbans
  ut('yt_warriors', 'Yellow Turban Warriors', 'Yellow Turban', 2, 'infantry', 'melee', 'Jianshu', 6, 3),
  ut('yt_spearmen', 'Yellow Turban Spearmen', 'Yellow Turban', 2, 'infantry', 'melee', 'Qiangshu', 6, 3),
  ut('yt_cavalry', 'Yellow Turban Cavalry', 'Yellow Turban', 2, 'cavalry', 'melee', 'Qiangshu', 6, 3),
  ut('yt_archers', 'Yellow Turban Archers', 'Yellow Turban', 2, 'ranged', 'ranged', 'Gongshu', 3, 2),
  // Bandits
  ut('bandit_axe', 'Bandit Warriors (Axe)', 'Bandits', 1, 'infantry', 'melee', 'Qiangshu', 6, 2),
  ut('bandit_white_tiger', 'White Tiger Warriors', 'Bandits', 2, 'infantry', 'melee', 'Qiangshu', 7, 1),
  ut('bandit_hunters', 'Bandit Hunters (Bow)', 'Bandits', 2, 'ranged', 'ranged', 'Gongshu', 4, 1),
];

// Officers. Fire, Command and weapon skills come from the v2.0 character sheets.
// passive.effects supports: ignoreMoralePenalty, noRearAgainst, moveBonus (n),
// chargeAttackBonus (n), extraMoraleLossOnWin (n), ignoreEncirclement.
const OFFICERS = [
  { id: 'xu_chu', name: 'Xu Chu', fire: 3, command: 3,
    skills: { Bangshu: 5 },
    passive: { name: 'Tiger Guard', text: 'Bodyguard. Apply manually for now.', effects: {} },
    skill: { name: "Tiger's Gate", moraleCost: 20,
      text: 'Once per round: adjacent allies gain +2 on melee defense; once, take casualties for an adjacent ally.' },
    heroicActions: [], battleArt: null },
  { id: 'han_dang', name: 'Han Dang', fire: 3, command: 4,
    skills: { Gongshu: 5, Jianshu: 4 },
    passive: { name: 'Old Wu Veteran', text: 'This unit ignores all roll penalties from morale state.',
      effects: { ignoreMoralePenalty: true } },
    skill: { name: 'Steady the Line', moraleCost: 20,
      text: 'Until next activation, adjacent allied units gain +1 to defending rolls; once, prevent a -10 formation-break penalty.' },
    heroicActions: [], battleArt: null },
  { id: 'wen_ping', name: 'Wen Ping', fire: 3, command: 4,
    skills: { Qiangshu: 4 },
    passive: { name: 'Unyielding Defender', text: 'Enemy units gain no rear attack bonus against this unit.',
      effects: { noRearAgainst: true } },
    skill: { name: 'Hold the Ford!', moraleCost: 20,
      text: "Until next activation, this unit and adjacent allies gain +1 on defending; enemies gain no rear-attack bonus against this unit." },
    heroicActions: [], battleArt: null },
];


// Heroic actions (David's handout): free actions for officer units; uses per battle = officer Fire,
// one per turn, never the same one twice in a row. Resolved by the GM.
const HEROIC_ACTIONS = [
  { id: "you_and_me", name: "You and Me!", text: "The officer declares a duel with an opposing officer. While this duel is occurring, neither unit can activate. Each turn the duel is active, the participants will fight for 2 rounds. If an officer dies, the unit they controlled will suffer a -30 morale loss. At the end of a round of dueling, an officer can decide to retreat and return to their unit, resulting in a -20 morale loss. An officer may also refuse to duel entirely, in this case, the officer who refused the duel's unit suffers a -10 morale loss." },
  { id: "enter_the_dragon", name: "Enter the Dragon", text: "When the officer's unit perform an attack, the officer himself can enter the fray and roll a single attack roll, that roll is added the value of the unit's attack roll. If the combined attack roll happens to be less than the enemy unit's command roll, the officer will suffer damage equal to the difference, his attack roll will still be added to his unit's even if this is the case." },
  { id: "diversion_ranged", name: "Diversion (Ranged)", text: "If a heroic action is performed within 3 movements of an officer's unit, the officer may attempt a missile attack with a ST of 9 + (Target Officer's Metal). Upon success, that heroic action is prevented." },
  { id: "unmovable_wall", name: "Unmovable Wall", text: "The officer blocks the path of an enemy Unit. He faces six Henchmen. If the officer wins, the unit is unable to activate this turn and takes 6 casualties." },
  { id: "formation_breaker", name: "Formation Breaker", text: "The officer charges into the enemy Unit's formation. He faces 4 Henchman. The officer will suffer a -1 to rolls while the Henchman will receive +1 to rolls. If the officer wins, the unit immediately loses the benefits of their formation and takes 4 casualties." },
  { id: "flame_amidst_the_chaos", name: "Flame amidst the Chaos", text: "The officer rallies his troops or an adjacent unit, making a YinYang + Command + Fire roll. Multiply the result by 2 and add it to the officer's unit's morale." },
  { id: "deducing_heaven", name: "Deducing Heaven", text: "The officer makes a mental calculation and predicts future events. The officer makes a YinYang + Wood + Divination roll. The officer may add this result to any roll his unit makes next turn." },
  { id: "facing_a_thousand_arrows", name: "Facing a Thousand Arrows", text: "The officer attempts to block enemy missiles. The officer must make an Active Defense Roll with a +2 bonus. If the active defense is equal to or higher than the enemy unit's ranged attack, suffer less casualties equal to 1 plus the difference between the two rolls. If the result is less that the attack, take damage equal to the difference." },
];


// Battle tactics (David's "Battle Tactics" sheet, October 2026). A tactician places them before initiative;
// each covers a square of (2 x size + 1) tiles centred on its tile and fires once, the first time its trigger
// happens there for a unit of the side that placed it. It then lasts `turns` rounds (1 = the rest of this
// round), or is used up at once (turns: 0). Effects only ever touch units of the placing side.
//   trigger: attack | attacked | rangedAttack | meleeAttack | rearAttack | ambush | charge | flankedAttack |
//            raiseFlag | setFire | surrender | forcedMarch | backsTurned | hold | heroic | officerKill |
//            surrounded | destroy | heroAttack | heroMove
// reach: a tactic placed on one tile whose effect covers a wider square (Raise Flag: 1×1, rallies a 9×9 square)
// when / lasts: the Trigger and Duration columns of the Battle Tactics sheet (shown on the tactics screen)
const TACTICS = [
  { key: 'attack', name: 'Attack', aow: 1, size: 2, trigger: 'attack', turns: 1, when: 'An allied unit attacks.', lasts: '1 turn', text: 'Units in the area gain Attack +2.' },
  { key: 'defend', name: 'Defend', aow: 1, size: 2, trigger: 'attacked', turns: 1, when: 'An allied unit is attacked.', lasts: '1 turn', text: 'Units in the area gain Melee and ranged defense +2.' },
  { key: 'raiseFlag', name: 'Raise Flag', aow: 1, size: 0, reach: 4, trigger: 'raiseFlag', turns: 0, highGround: true, when: 'An allied unit on the flag tile takes the Raise Flag action instead of attacking.', lasts: '1 action', text: 'A unit on the flag tile takes the Raise Flag action instead of attacking: allied units within the 9×9 square around it below 50 morale rise to 50.' },
  { key: 'flanking', name: 'Flanking Maneuver', aow: 2, size: 2, trigger: 'rearAttack', turns: 1, when: 'An allied unit makes a rear attack.', lasts: '1 turn', text: 'Units in the area gain Attack +2.' },
  { key: 'ambush', name: 'Ambush', aow: 2, size: 2, trigger: 'ambush', turns: 1, when: 'An allied unit attacks from hiding.', lasts: '1 turn', text: 'Units in the area gain Attack +2.' },
  { key: 'cavalryCharge', name: 'Cavalry Charge', aow: 2, size: 2, trigger: 'charge', turns: 1, when: 'An allied unit makes a cavalry charge.', lasts: '1 turn', text: 'Cavalry charges by units in the area gain Attack +4.' },
  { key: 'setAflame', name: 'Set Aflame', aow: 2, size: 1, trigger: 'setFire', turns: 0, when: 'An allied unit in the area takes the Set Fire action instead of attacking.', lasts: '1 action', text: 'A unit in the area takes the Set Fire action instead of attacking and sets an adjacent flammable tile on fire.' },
  { key: 'surround', name: 'Surround the Enemy', aow: 3, size: 2, trigger: 'surrender', turns: 1, when: 'An allied unit forces an enemy unit to surrender.', lasts: '1 turn', text: 'Each time an enemy unit surrenders in the area, all enemy units lose 5 morale (10 if it had an officer).' },
  { key: 'rapidAdvance', name: 'Rapid Advance, Swift Retreat', aow: 3, size: 2, trigger: 'forcedMarch', turns: 2, when: 'An allied unit in the area forced marches.', lasts: '2 turns', text: 'Forced march costs 2 morale per tile instead of 5 for units in the area.' },
  { key: 'backsTurned', name: 'Backs Turned', aow: 3, size: 2, trigger: 'backsTurned', turns: 1, when: 'An enemy unit tries to move away from an allied unit.', lasts: '1 turn', text: 'When an enemy moves away from a unit in the area, that unit makes a free attack on it that cannot be struck back.' },
  { key: 'holdTheLine', name: 'Hold the Line', aow: 3, size: 3, trigger: 'hold', turns: 2, when: 'An allied unit takes the hold action.', lasts: '2 turns', text: 'The holding unit gains Melee defense +3 and Ranged defense +2; adjacent units that hold gain the same.' },
  { key: 'heroNeeded', name: 'A Hero is Needed', aow: 4, size: 2, trigger: 'heroic', turns: 1, bound: true, when: 'An allied officer uses a Heroic Action.', lasts: '1 turn', text: "The officer's unit gains Command rolls +4." },
  { key: 'divineWinds', name: 'Divine Winds', aow: 4, size: 3, trigger: 'rangedAttack', turns: 2, when: 'An allied unit makes a ranged attack.', lasts: '2 turns', text: 'Ranged units in the area gain Attack +2 and Ranged defense +2.' },
  { key: 'allOutAttack', name: 'All Out Attack', aow: 4, size: 3, trigger: 'flankedAttack', turns: 0, when: 'An allied unit attacks an enemy unit who\'s adjacent to another allied unit.', lasts: '1 action', text: 'Every unit in the area that can attack the enemy makes a free attack on it that cannot be struck back.' },
  { key: 'inspiring', name: 'Inspiring the Army', aow: 4, size: 2, trigger: 'officerKill', turns: 0, when: 'An allied unit with an officer defeats an enemy unit with an officer.', lasts: 'Instant', text: 'All units on the side gain 25 morale.' },
  { key: 'phoenix', name: 'Fury of a Phoenix', aow: 5, size: 3, trigger: 'meleeAttack', turns: 1, when: 'An allied unit makes a melee attack.', lasts: '1 turn', text: 'Units in the area may make a second melee attack after their first, with Attack +1 if they won the first.' },
  { key: 'fear', name: 'Surrounded by Fear', aow: 5, size: 2, trigger: 'surrounded', turns: 99, bound: true, when: 'An allied unit is fully surrounded by 4 enemy units.', lasts: 'Until the allied unit or one of the enemies is destroyed', text: 'The surrounded unit does not surrender, gains Command rolls +4 and makes free attacks until one of its attackers is destroyed.' },
  { key: 'brutalize', name: 'Brutalize', aow: 5, size: 3, trigger: 'destroy', turns: 0, when: 'An allied unit destroys an enemy unit.', lasts: 'Instant', text: 'All enemy units in the area lose 25 morale.' },
  { key: 'warrior1000', name: 'A Warrior Worth 1000', aow: 6, size: 5, trigger: 'heroAttack', turns: 3, bound: true, when: 'An allied unit whose officer has weapon skill 5+ attacks.', lasts: '3 turns', text: 'The unit gains Command rolls +5.' },
  { key: 'clearPath', name: 'Clear a Path', aow: 6, size: 5, trigger: 'heroMove', turns: 3, bound: true, when: 'An allied unit whose officer has weapon skill 5+ moves.', lasts: '3 turns', text: 'When the unit attacks after moving it gains Attack +8; if it destroys an enemy unit it may move and attack again.' },
];

// Battlefield terrain from the battle map file (map generator export, Battlefield Terrain Rules sheet, 2026-10-22).
// A square's effects are its terrain plus every overlay on it, added together.
//   move: extra movement to enter · pass: 'none' (no one) | 'noCavalry' · meleeDef/rangedDef: defense of a unit here
//   range: range for a ranged unit here · atk: attacks by a unit here · command: all Command rolls of a unit here
//   moraleTurn/healthTurn: for ending a turn here · hides: units here can hide · campDef: defense only against
//   attacks from outside the camp · wall: walls, gates, towers (units can stand there, but don't walk on for now)
// Fire, destructible objects and gates are listed for later (flammable, fireRes, burnTime, burnsInto, hp).
const MAP_TERRAIN = {
  plains: { name: 'Plains' },
  steppe: { name: 'Steppe' },
  sand: { name: 'Sand', move: 1 },
  paving: { name: 'Paving', move: -1 },
  city: { name: 'City', pass: 'none', flammable: true, fireRes: 2, burnTime: 4, burnsInto: 'ruins' },
  farmland: { name: 'Farmland', move: 1, flammable: true, fireRes: 0, burnTime: 2, burnsInto: 'scorched' },
  'tall-grass': { name: 'Tall grass', move: 1, hides: true, flammable: true, fireRes: 0, burnTime: 2, burnsInto: 'scorched' },
  forest: { name: 'Forest', move: 1, meleeDef: 1, rangedDef: 1, range: -2, hides: true, flammable: true, fireRes: 1, burnTime: 3, burnsInto: 'scorched' },
  marsh: { name: 'Marsh', move: 2 },
  mountain: { name: 'Mountain', pass: 'none' },
  cliffs: { name: 'Cliffs', pass: 'none' },
  river: { name: 'River', pass: 'none' },
  lake: { name: 'Lake', pass: 'none', water: true },
  ford: { name: 'Ford', move: 2, meleeDef: -1, rangedDef: -1, water: true },
  scorched: { name: 'Scorched' },
  rocky: { name: 'Rocky ground' },
};
const MAP_OVERLAYS = {
  road: { name: 'Road', move: -1 },
  bridge: { name: 'Bridge', bridge: true, hp: 50, flammable: true, fireRes: 1, burnTime: 2, burnsInto: null },
  hill: { name: 'Hill', range: 1, command: 1, high: true, downhillAtk: 0 }, // downhillAtk: only against units not on a hill, wall or tower (value to be set)
  trench: { name: 'Trench', move: 2 },
  abatis: { name: 'Abatis', move: 1, pass: 'noCavalry', hp: 20, flammable: true, fireRes: 0, burnTime: 2, burnsInto: null },
  'camp-stakes': { name: 'Camp stakes', move: 1, campDef: 1, hp: 15, flammable: true, fireRes: 0, burnTime: 1, burnsInto: null },
  'camp-palisade': { name: 'Camp palisade', pass: 'none', campDef: 2, hp: 30, flammable: true, fireRes: 1, burnTime: 2, burnsInto: null },
  'camp-wall': { name: 'Camp timber wall', pass: 'none', campDef: 3, hp: 60, flammable: true, fireRes: 2, burnTime: 3, burnsInto: null },
  camp: { name: 'Camp', move: 1, flammable: true, fireRes: 0, burnTime: 2, burnsInto: 'scorched' },
  'command-tent': { name: 'Command tent', moraleTurn: 3, high: true, hp: 25, flammable: true, fireRes: 0, burnTime: 2, burnsInto: 'scorched' },
  'city-wall': { name: 'City wall', meleeDef: 2, rangedDef: 2, range: 1, wall: true, high: true, hp: 100 },
  // units in a gateway are under the gate (ground level): its defense, no range; locked gates can't be entered
  'city-gate': { name: 'City gate', meleeDef: 2, rangedDef: 2, gate: true, hp: 80, flammable: true, fireRes: 4, burnTime: 2, burnsInto: 'ruins' },
  'fortress-tower': { name: 'Fortress tower', meleeDef: 3, rangedDef: 3, range: 1, wall: true, high: true, hp: 120 },
  'small-fort': { name: 'Small fort', meleeDef: 1, rangedDef: 1, command: 1, high: true, hp: 60, flammable: true, fireRes: 2, burnTime: 3, burnsInto: 'ruins' },
  fort: { name: 'Fort', meleeDef: 1, rangedDef: 1, command: 1, high: true },
  'town-hall': { name: 'Town hall', meleeDef: 1, rangedDef: 1, command: 1 },
  watchtower: { name: 'Watchtower', range: 1, hp: 30, flammable: true, fireRes: 1, burnTime: 2, burnsInto: 'ruins' },
  'supply-depot': { name: 'Supply depot', moraleTurn: 5, hp: 40, flammable: true, fireRes: 1, burnTime: 3, burnsInto: 'ruins' },
  fire: { name: 'Fire', moraleTurn: -5, healthTurn: -10 },
  ruins: { name: 'Ruins', meleeDef: 1, rangedDef: 1 },
  farmhouse: { name: 'Farmhouse', meleeDef: 1, rangedDef: 1, hp: 30, flammable: true, fireRes: 1, burnTime: 2, burnsInto: 'ruins' },
  dock: { name: 'Dock', hp: 30, flammable: true, fireRes: 1, burnTime: 2, burnsInto: null },
  boat: { name: 'Boat', pass: 'none', flammable: true, fireRes: 1, burnTime: 2, burnsInto: null },
  catapult: { name: 'Catapult', range: 10, atk: 2, hp: 30, flammable: true, fireRes: 1, burnTime: 2, burnsInto: null },
};

export { TERRAIN, FORMATIONS, UNIT_TYPES, OFFICERS, HEROIC_ACTIONS, TACTICS, MAP_TERRAIN, MAP_OVERLAYS };
