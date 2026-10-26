// Equipment a unit can carry (David's Equipment traits from the Battle Sheets page, snapshot 2026-10-25; regenerate from
// r20import/sheets/traits.json when the sheet changes). Each piece is stored on the unit as a trait-list entry flagged
// `equip`, so the engine reads it like any other trait. Kinds (David, 2026-10-25):
//   upgrade — Sharpened Weapons, Reinforced Armor, Saddle: one of each, a higher tier replaces a lower
//   gear    — War Drums, Rallying Banner, War Horn: a unit carries only ONE piece of gear in all
//   siege   — Siege Ladders or Siege Engine, never both
export const KIND_LABEL = { upgrade: "Upgrades", gear: "Gear (one piece)", siege: "Siege equipment (one piece)" };
export const EQUIPMENT = [
  { family: "Sharpened Weapons", kind: "upgrade", tiers: [
    { name: "Sharpened Weapons", desc: "Attack +1 at start of battle." },
    { name: "Sharpened Weapons+", desc: "Attack +2 at start of battle." },
    { name: "Sharpened Weapons++", desc: "Attack +3 at start of battle." },
  ] },
  { family: "Reinforced Armor", kind: "upgrade", tiers: [
    { name: "Reinforced Armor", desc: "Armor +1 at start of battle." },
    { name: "Reinforced Armor+", desc: "Armor +2 at start of battle." },
    { name: "Reinforced Armor++", desc: "Armor +3 at start of battle." },
  ] },
  { family: "Saddle", kind: "upgrade", tiers: [
    { name: "Saddle", desc: "Attack +1." },
    { name: "Saddle+", desc: "Attack +1, Melee defense +1." },
    { name: "Saddle++", desc: "Attack +1, Melee defense +1, Movement +1." },
  ] },
  { family: "War Drums", kind: "gear", tiers: [
    { name: "War Drums", desc: "Allied units within 2 tiles gain Command rolls +1." },
    { name: "War Drums+", desc: "Allied units within 3 tiles gain Command rolls +1." },
    { name: "War Drums++", desc: "Allied units within 3 tiles gain Command rolls +2." },
  ] },
  { family: "Rallying Banner", kind: "gear", tiers: [
    { name: "Rallying Banner", desc: "Adjacent allied units gain 1 morale at the end of this unit's turn." },
    { name: "Rallying Banner+", desc: "Adjacent allied units gain 2 morale at the end of this unit's turn." },
    { name: "Rallying Banner++", desc: "Adjacent allied units gain 3 morale at the end of this unit's turn." },
  ] },
  { family: "War Horn", kind: "gear", tiers: [
    { name: "War Horn", desc: "Adds the Reinvigorate action: an adjacent allied unit reactivates and takes another turn immediately. Using it ends this unit's turn. Needs 1 turn to recharge after use." },
  ] },
  { family: "Siege Ladders", kind: "siege", tiers: [
    { name: "Siege Ladders", desc: "Movement -1 while carried. Gives the Place Ladder action next to a city wall or tower square without a ladder (not gates); it ends the turn and uses the ladders. Outside units next to a laddered wall square can fight the unit on it in melee, and can climb onto it if it is empty (all their movement; not cavalry or units carrying siege equipment). Can be dropped, and is dropped when the unit falls; an empty-handed unit moving onto it picks it up." },
  ] },
  { family: "Siege Engine", kind: "siege", tiers: [
    { name: "Siege Engine", desc: "Movement -2 while carried. This unit makes two attacks on structures instead of one. Can be dropped, and is dropped when the unit falls; an empty-handed unit moving onto it picks it up. A unit carries ladders or a siege engine, never both." },
  ] },
];
const byName = new Map(EQUIPMENT.flatMap(f => f.tiers.map(t => [t.name, { ...t, family: f.family, kind: f.kind }])));
/** The catalogue entry for a name (exact), or null. */
export const equipmentByName = (name) => byName.get(String(name ?? "").trim()) ?? null;
/** The family a name belongs to (War Drums+ -> War Drums), or null when it isn't equipment. */
export const equipmentFamily = (name) => equipmentByName(name)?.family ?? null;
/** The kind of a piece: upgrade | gear | siege, or null. */
export const equipmentKind = (name) => equipmentByName(name)?.kind ?? null;
