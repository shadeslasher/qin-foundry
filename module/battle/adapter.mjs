import { Chat } from "../dice.mjs";
import { broadcastBattleAnim } from "../attack-fx.mjs";
import { logSoundSteps } from "../sound.mjs";
// Bridges Foundry (scene tokens, unit actors, officer characters) and the pure battle
// engine. Runs only on the active GM's client; players reach it through queries.
import * as E from "./engine.mjs";
import { traitTiersOf, shieldArmorOf } from "./traits.mjs";
import { REINFORCE_FLAG, REINFORCE_TOKEN_FLAG, zonesOf as reinforceZonesOf, isWaiting as isWaitingReinforcement } from "./reinforce-rules.mjs";
import { equipmentByName } from "./equipment-data.mjs";
import { officerEligibility } from "../officer-rules.mjs";
export { traitTiersOf, shieldArmorOf };
import { FORMATIONS, HEROIC_ACTIONS } from "./engine-data.mjs";
import { SYSTEM_ID } from "../config.mjs";
import { decodeTiles, gatesFromMap, FLAG as MAP_FLAG } from "./battlemap.mjs";
import { DEPLOY_FLAG } from "./deploy-rules.mjs";
import { OBJECTIVES_FLAG, emptyObjectives, freshObjState } from "./objectives.mjs";

const SETTING = "battle";
let writing = false;
/** True while the battle itself is moving tokens (so the token lock lets those moves through). */
export const isWritingBack = () => writing;
const BIG = 100000;
let queue = Promise.resolve();

export const defaultFormations = () => foundry.utils.deepClone(FORMATIONS);
/** Formations are on hold unless the GM turns them back on (Use formations in battles). */
export function formationsEnabled() { try { return !!game.settings.get(SYSTEM_ID, "useFormations"); } catch { return false; } }

export function emptyBattle() {
  return { active: false, sceneId: null, turn: E.newState().turn, log: [], meta: {}, tactics: null, siege: null };
}

export function getBattle() {
  return foundry.utils.deepClone(game.settings.get(SYSTEM_ID, SETTING) ?? emptyBattle());
}

/* ------------------------------------------------------------ build engine state */

function stripHtml(html) {
  const d = document.createElement("div");
  d.innerHTML = html || "";
  return d.textContent.trim();
}

function ownerUserId(actor) {
  const user = game.users.find(u => !u.isGM && actor.testUserPermission(u, "OWNER"));
  return user?.id ?? null;
}

function officerLibraryEntry(officer) {
  const skills = {};
  for (const [k, v] of Object.entries(officer.system.skills ?? {})) skills[k] = v.value;
  // Signature Battle Passive / Battle Active slots count as a passive and a battle skill.
  const sig = (slot) => officer.items.find(i => i.type === "signature" && i.system.slot === slot);
  const asTactic = (item, kind) => item && { name: item.name, system: { ...item.system, kind } };
  const abilities = [
    asTactic(sig("battlePassive"), "passive"), asTactic(sig("battleActive"), "skill"),
  ].filter(Boolean);
  const effects = {};
  for (const a of abilities.filter(a => a.system.kind === "passive")) {
    for (const [k, v] of Object.entries(a.system.effects)) {
      if (typeof v === "boolean") effects[k] = effects[k] || v;
      else if (v) effects[k] = (effects[k] || 0) + v;
    }
  }
  const skill = abilities.find(a => a.system.kind === "skill");
  const art = abilities.find(a => a.system.kind === "battleArt");
  return {
    id: officer.uuid, name: officer.name,
    fire: officer.system.aspects.fire, command: officer.system.skills.command?.value ?? 0, skills,
    passive: { name: abilities.filter(a => a.system.kind === "passive").map(a => a.name).join(", "), text: "", effects },
    skill: skill ? { name: skill.name, text: stripHtml(skill.system.description), moraleCost: skill.system.moraleCost,
      recharge: skill.system.recharge ?? 0, perBattle: !!skill.system.perScene, lastStand: !!skill.system.lastStand } : null,
    heroicActions: HEROIC_ACTIONS.map(h => ({ name: h.name, text: h.text })), // every officer may use the heroic action list
    battleArt: art ? { name: art.name, text: stripHtml(art.system.description) } : null,
  };
}

/**
 * Traits from a unit's Traits tab, as { "base name": tier } (1 = base, 2 = "+", 3 = "++").
 * Each line reads "Name - effect"; only the name matters here.
 */
/** Engine formation entry from a unit's formation item. */
function formationEntry(tokenId, item) {
  const f = item.system;
  const e = { id: `${tokenId}.${item.id}`, name: item.name, desc: stripHtml(f.description) };
  for (const k of ["moveMod", "defAll", "defMelee", "defRanged", "defFront", "frontMelee", "atkMod", "rearAtk", "chargeBonus", "dmgMod", "casReduce"]) if (f[k]) e[k] = f[k];
  for (const k of ["immobile", "noAttackerBonus", "noRear", "noChargeBonus", "winReposition"]) if (f[k]) e[k] = true;
  return e;
}

function terrainAt(scene, x, y) {
  for (const region of scene.regions ?? []) {
    const name = (region.name || "").toLowerCase();
    const kind = /impassable|cliff|wall|river/.test(name) ? "impassable" : /tree|forest|wood/.test(name) ? "trees" : /grass/.test(name) ? "grass" : null;
    if (!kind) continue;
    try {
      if (region.testPoint({ x, y, elevation: 0 })) return kind;
    } catch { /* region API unavailable: ignore terrain */ }
  }
  return "flat";
}

/** High ground for tactics like Raise Flag: a region named hill, high ground, fort, command tent or wall. */
const HIGH_GROUND = ["hill", "city-wall", "fortress-tower", "fort", "small-fort", "command-tent"];
function isHighGround(scene, gx, gy) {
  // scenes from the map generator: the square's own overlays (hill, city wall or tower, fort, command tent)
  const bm = scene.getFlag?.(SYSTEM_ID, MAP_FLAG);
  if (bm?.terrain) {
    if (gx < 0 || gy < 0 || gx >= bm.cols || gy >= bm.rows) return false;
    if ((bm.overlays?.[gy * bm.cols + gx] ?? []).some(o => HIGH_GROUND.includes(o))) return true;
  }
  // other scenes: Regions named for it
  const size = scene.grid.size, pt = { x: gx * size + size / 2, y: gy * size + size / 2, elevation: 0 };
  return (scene.regions ?? []).some(r => /hill|high ground|fort|command tent|wall/i.test(r.name || "") && (() => { try { return r.testPoint(pt); } catch { return false; } })());
}

export function unitTokens(scene) {
  return scene ? scene.tokens.filter(t => t.actor?.type === "unit") : [];
}

/** Siege equipment a unit starts a battle with, from its traits (one or the other, ladders first). */
export function startingCarry(traits) {
  const t = traitTiersOf(traits);
  return t["siege ladders"] || t["siege ladder"] ? "ladders" : t["siege engine"] ? "engine" : null;
}

const tileCache = new Map(); // sceneId -> { flag, tiles } (decoded battle map squares)

const warned = new Set();
function warnOnce(msg) { if (warned.has(msg) || !game.user?.isGM) return; warned.add(msg); ui.notifications?.warn(msg); }

/** Engine state assembled from the battle setting and the scene's unit tokens. */
export function buildState(battle, { useLastPosition = null, terrainFor = null } = {}) {
  const scene = game.scenes.get(battle.sceneId);
  const s = E.newState();
  s.freeMovement = true;
  s.turn = battle.turn;
  s.log = battle.log ?? [];
  s.tactics = battle.tactics ?? null;
  s.siege = battle.siege ?? null;
  s.deployZones = scene?.getFlag?.(SYSTEM_ID, DEPLOY_FLAG) ?? []; // deployment squares, saved with the scene
  s.objectives = foundry.utils.deepClone(scene?.getFlag?.(SYSTEM_ID, OBJECTIVES_FLAG) ?? emptyObjectives()); // victory / defeat conditions
  s.objState = battle.objState ?? freshObjState();
  s.objEval = battle.objEval ?? null;
  s.outcome = battle.outcome ?? null;
  s.introAt = battle.introAt ?? null;
  s.library.formations = [{ id: "none", name: "No formation", desc: "No modifiers." }];
  s.library.unitTypes = [];
  s.library.officers = [];
  s.map = { image: null, cols: BIG, rows: BIG, tile: 1, offsetX: 0, offsetY: 0, terrain: {} };
  s.players = { host: { name: "GM", color: "#d9a441" } };
  for (const u of game.users) if (!u.isGM) s.players[u.id] = { name: u.name, color: u.color?.css ?? String(u.color) };
  if (!scene) return { s, scene: null };
  const size = scene.grid.size;
  // A scene imported from a battle map knows every square's terrain; others fall back to named regions
  const bm = scene.getFlag?.(SYSTEM_ID, MAP_FLAG) ?? scene.flags?.[SYSTEM_ID]?.[MAP_FLAG];
  const tiles = bm ? (tileCache.get(scene.id)?.flag === bm ? tileCache.get(scene.id).tiles : decodeTiles(bm)) : null;
  if (tiles) { tileCache.set(scene.id, { flag: bm, tiles }); s.map.tiles = tiles; s.map.cols = bm.cols; s.map.rows = bm.rows; }
  // city gates live with the battle (owners, locked/open/broken/burned); a new battle starts from the map
  if (tiles && !(s.siege?.gates?.length)) {
    const gates = gatesFromMap(bm);
    if (gates.length) s.siege = { ladders: [], dropped: [], ...(s.siege ?? {}), gates };
  }
  const officers = new Map();
  const rzones = reinforceZonesOf(scene.getFlag?.(SYSTEM_ID, REINFORCE_FLAG));
  for (const tok of unitTokens(scene)) {
    if (isWaitingReinforcement(tok.getFlag?.(SYSTEM_ID, REINFORCE_TOKEN_FLAG), rzones)) continue; // reinforcements not yet arrived: not in the battle
    const a = tok.actor, sys = a.system;
    const gx = Math.round(tok.x / size), gy = Math.round(tok.y / size);
    // This unit's formations (embedded items) become engine formations "<token>.<item>"
    const forms = formationsEnabled() ? a.items.filter(i => i.type === "formation").map(i => formationEntry(tok.id, i)) : [];
    s.library.formations.push(...forms);
    const ranged = sys.range > 1;
    s.library.unitTypes.push({
      id: tok.id, name: a.name, faction: sys.faction, tier: sys.tier, category: sys.category, weapon: ranged ? "ranged" : "melee",
      skill: sys.weaponSkill, unitValue: sys.unitValue, damage: sys.damage, armor: sys.armor, armorPen: sys.armorPen, move: sys.move,
      shieldArmor: shieldArmorOf(sys.armorNote), // the part of its armor that comes from shields (Shield Breaker ignores it)
      rangeMin: ranged ? Math.min(sys.rangeMin || 1, sys.range) : 1, rangeMax: ranged ? sys.range : 1, formations: ["none", ...forms.map(f => f.id)],
    });
    let officerId = null;
    let officer = sys.officerActor;
    const elig = officer ? officerEligibility(officer, sys) : null;
    if (officer && !elig.ok) { warnOnce(`${a.name}: ${officer.name} can't lead it (${elig.reason}), so it fights without an officer.`); officer = null; }
    if (officer) {
      if (!officers.has(officer.uuid)) officers.set(officer.uuid, officerLibraryEntry(officer));
      officerId = officer.uuid;
    }
    const meta = battle.meta?.[tok.id] ?? {};
    const fierce = String(sys.traits ?? "").match(/^\s*Fierce Charge(\+{0,2})\s*(?:-|–|:|$)/mi);
    // During rounds the battle's own record of positions is the truth (tokens may still be animating);
    // a token that was just dragged is already at its new tile, so the engine needs where it came from.
    const fromPos = (useLastPosition === tok.id || battle.turn?.phase !== "setup") && meta.pos ? meta.pos : null;
    s.units.push({
      id: tok.id, typeId: tok.id, officerId, name: tok.name, side: sys.side, owner: ownerUserId(a),
      x: fromPos ? fromPos.x : gx, y: fromPos ? fromPos.y : gy, men: sys.men.value, maxMen: sys.men.max, morale: sys.morale, xp: sys.xp?.value ?? 0, level: sys.level ?? 1,
      formation: formationsEnabled() && a.items.get(sys.formation)?.type === "formation" ? `${tok.id}.${sys.formation}` : "none",
      facing: meta.facing ?? null, hidden: sys.hidden, status: sys.status,
      fierceCharge: fierce ? 1 + fierce[1].length : 0,
      traitTiers: traitTiersOf(sys.traits), fx: meta.fx ?? {},
      carry: meta.carry !== undefined ? meta.carry : startingCarry(sys.traits),
      mods: meta.mods ?? [], overwatch: !!meta.overwatch, heroicUsed: meta.heroicUsed ?? 0, lastHeroic: meta.lastHeroic ?? null,
      surrounded: meta.surrounded ?? false, round: meta.round ?? { activated: false, moved: false, cannotMove: false, holding: false, attacked: false, skillUsed: false, heroicUsed: false, meleeTarget: null, meleeAttacker: null },
    });
    // Terrain for this tile and its neighbours (stealth cover, encirclement)
    if (!s.map.tiles) for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = (gx + dx) + "," + (gy + dy);
      if (k in s.map.terrain) continue;
      const t = terrainAt(scene, (gx + dx) * size + size / 2, (gy + dy) * size + size / 2);
      if (t !== "flat") s.map.terrain[k] = t;
    }
  }
  s.library.officers = [...officers.values()];
  // Full terrain around one unit (movement range, so impassable regions block its path)
  const tu = terrainFor && !s.map.tiles && s.units.find(u => u.id === terrainFor);
  if (tu) {
    const r = Math.min(30, (E.movementOf(s, tu) || 0) * 2 + 1);
    for (let x = tu.x - r; x <= tu.x + r; x++) for (let y = tu.y - r; y <= tu.y + r; y++) {
      const k = x + "," + y;
      if (k in s.map.terrain || Math.abs(x - tu.x) + Math.abs(y - tu.y) > r) continue;
      const t = terrainAt(scene, x * size + size / 2, y * size + size / 2);
      if (t !== "flat") s.map.terrain[k] = t;
    }
  }
  return { s, scene };
}

/* ------------------------------------------------------------ write back */

async function writeBack(battle, s, scene) {
  const size = scene?.grid.size ?? 100;
  const tokenUpdates = [];
  const actorUpdates = [];
  const manage = game.settings.get(SYSTEM_ID, "manageStealth");
  const rotate = game.settings.get(SYSTEM_ID, "rotateFacing");
  battle.meta = {};
  for (const u of s.units) {
    const tok = scene?.tokens.get(u.id);
    if (!tok) continue;
    battle.meta[u.id] = { pos: { x: u.x, y: u.y }, facing: u.facing, mods: u.mods, overwatch: !!u.overwatch, heroicUsed: u.heroicUsed, lastHeroic: u.lastHeroic, surrounded: u.surrounded, round: u.round, fx: u.fx ?? {}, carry: u.carry ?? null };
    const sys = tok.actor.system;
    const upd = {};
    if (sys.men.value !== u.men) upd["system.men.value"] = u.men;
    if (sys.morale !== u.morale) upd["system.morale"] = u.morale;
    if ((sys.xp?.value ?? 0) !== (u.xp || 0)) upd["system.xp.value"] = u.xp || 0;
    if ((sys.level ?? 1) !== (u.level || 1)) upd["system.level"] = u.level || 1;
    const formItem = u.formation && u.formation !== "none" ? u.formation.split(".").pop() : "none";
    if (formationsEnabled() && (sys.formation || "none") !== formItem) upd["system.formation"] = formItem; // on hold: leave the sheet's choice alone
    // Health at the start of the battle (post-battle XP loss = casualties suffered)
    battle.startMen ??= {};
    if (battle.startMen[u.id] === undefined) battle.startMen[u.id] = sys.men.value;
    if (sys.status !== u.status) upd["system.status"] = u.status;
    if (sys.hidden !== !!u.hidden) upd["system.hidden"] = !!u.hidden;
    // siege equipment dropped or picked up in battle: the sheet's Equipment follows (ladders / engine entries)
    const carried = u.carry === "ladders" ? "Siege Ladders" : u.carry === "engine" ? "Siege Engine" : null;
    const list = tok.actor._source?.system?.traitList ?? sys.traitList ?? [];
    const has = list.filter(e => e.equip && (e.name === "Siege Ladders" || e.name === "Siege Engine")).map(e => e.name);
    if (!(has.length === (carried ? 1 : 0) && (!carried || has[0] === carried))) {
      const kept = list.filter(e => !(e.equip && (e.name === "Siege Ladders" || e.name === "Siege Engine")));
      const piece = carried ? equipmentByName(carried) : null;
      upd["system.traitList"] = piece ? [...kept, { name: piece.name, desc: piece.desc, level: 1, upgrades: [], options: [], chosen: -1, equip: true }] : kept;
      if (sys.traits) upd["system.traits"] = "";
    }
    if (Object.keys(upd).length) actorUpdates.push(tok.actor.update(upd, { qinBattle: true }));
    const t = { _id: u.id };
    // Only the engine moving a unit (a swap) needs the token moved; dragged tokens are already there.
    if (Math.round(tok.x / size) !== u.x || Math.round(tok.y / size) !== u.y) { t.x = u.x * size; t.y = u.y * size; }
    if (rotate && !tok.lockRotation) {
      // no facing: the token goes back to how it was drawn
      const rot = u.facing ? ((Math.atan2(u.facing.dy, u.facing.dx) * 180 / Math.PI) - 90 + 360) % 360 : 0;
      if (Math.round(tok.rotation) !== Math.round(rot)) t.rotation = rot;
    }
    if (manage && u.side !== "player") {
      const unseen = u.status === "active" && !E.visibleTo(s, u, "player");
      const flagged = tok.getFlag(SYSTEM_ID, "stealthHidden");
      if (unseen && !tok.hidden) { t.hidden = true; t[`flags.${SYSTEM_ID}.stealthHidden`] = true; }
      else if (!unseen && flagged) { t.hidden = false; t[`flags.${SYSTEM_ID}.stealthHidden`] = false; }
    }
    if (u.status === "escaped" && !tok.hidden) t.hidden = true; // escaped units leave the map
    if (Object.keys(t).length > 1) tokenUpdates.push(t);
  }
  await Promise.all(actorUpdates);
  if (scene && tokenUpdates.length) {
    writing = true;
    try { await scene.updateEmbeddedDocuments("Token", tokenUpdates, { qinBattle: true }); }
    finally { writing = false; }
  }
  battle.turn = s.turn;
  battle.tactics = s.tactics ?? null;
  battle.siege = s.siege ?? null;
  battle.objState = s.objState ?? null;
  battle.objEval = s.objEval ?? null;
  battle.outcome = s.outcome ?? null;
  battle.introAt = s.introAt ?? null;
  battle.log = s.log.slice(-60);
  await game.settings.set(SYSTEM_ID, SETTING, battle);
}

async function postLog(entries, s) {
  if (!entries.length) return;
  const nameOf = (id) => E.unitById(s, id)?.name ?? "?";
  const signed = (n) => (n > 0 ? `+${n}` : `${n}`);
  const attackIds = new Set();
  for (const e of entries) if (e.detail?.type === "attack") { attackIds.add(e.detail.result.attacker); attackIds.add(e.detail.result.defender); }
  const parts = [];
  for (const e of entries) {
    const d = e.detail;
    if (d?.type === "attack") {
      const r = d.result;
      const A = nameOf(r.attacker), D = nameOf(r.defender);
      const tags = [r.ranged ? "Ranged" : "Melee", r.charge && "Cavalry charge", r.rear && "Rear", r.ambush && "Ambush"].filter(Boolean).join(" · ");
      const win = r.winner === "attacker" ? A : r.winner === "defender" ? D : null;
      const col = (roll) => roll.parts.filter(([k, v]) => v !== 0 || /Yin/.test(k)).map(([k, v]) => `<div class="qin-row"><span>${k}</span><span>${signed(v)}</span></div>`).join("");
      const line = (cls, label, a, b) => (a || b) ? `<div class="qin-bc-line ${cls}"><span>${a || "—"}</span><span class="qin-bc-label">${label}</span><span>${b || "—"}</span></div>` : "";
      const moraleA = (r.loser === r.attacker ? -r.moraleLoss : 0) + (r.killedBy === r.attacker ? r.killMorale || 0 : 0);
      const moraleD = (r.loser === r.defender ? -r.moraleLoss : 0) + (r.killedBy === r.defender ? r.killMorale || 0 : 0);
      parts.push(`<div class="qin-battle-card">
        <div class="qin-bc-head"><b>${A}</b> <i class="fa-solid fa-swords"></i> <b>${D}</b><div class="qin-bc-tags">${tags}</div></div>
        <div class="qin-bc-rolls"><div class="${r.winner === "attacker" ? "win" : ""}"><span>${A}</span><b>${r.attackRoll.total}</b></div><div class="qin-bc-vs">vs</div><div class="${r.winner === "defender" ? "win" : ""}"><span>${D}</span><b>${r.defendRoll.total}</b></div></div>
        <div class="qin-bc-result">${win ? `${win} wins by ${r.diff}` : "Tie"}${r.moraleMultiplier > 1 ? ` · morale loss ×${r.moraleMultiplier}` : ""}</div>
        ${line("cas", "Casualties", r.casualtiesAttacker ? `−${r.casualtiesAttacker}` : "", r.casualtiesDefender ? `−${r.casualtiesDefender}` : "")}
        ${line("mor", "Morale", moraleA ? signed(moraleA) : "", moraleD ? signed(moraleD) : "")}
        ${line("xp", "XP", r.xpAttacker ? `+${r.xpAttacker}` : "", r.xpDefender ? `+${r.xpDefender}` : "")}
        <details><summary>Roll breakdown</summary><div class="qin-breakdown"><div><b>${A}: ${r.attackRoll.total}</b>${col(r.attackRoll)}</div><div><b>${D}: ${r.defendRoll.total}</b>${col(r.defendRoll)}</div></div></details>
      </div>`);
      continue;
    }
    // XP and killing-blow morale for an attack are already on its card
    if ((d?.type === "xp" || d?.type === "moraleGain") && attackIds.has(d.unit) && /XP|killing blow/.test(e.text)) continue;
    if (/ ends its turn\.$/.test(e.text)) continue;
    parts.push(`<p class="qin-bc-note ${d?.type === "warning" ? "qin-warn" : ""}">${e.text}</p>`);
  }
  if (!parts.length) return;
  await Chat().create({ content: `<div class="qin-chat qin-battle-log">${parts.join("")}</div>`, speaker: { alias: "Battle" } });
}

/**
 * After an action, animate it for everyone: for each attack the attacker lunges (casualties and morale
 * over the defender), then the defender strikes back (numbers over the attacker), then both gain XP;
 * level-ups glow; any other changes (e.g. end-of-turn morale) float last.
 */
function animateChanges(scene, before, s, entries, actionType = null) {
  if (!scene) return null;
  const steps = [];
  let overwatchShot = false; // the next attack is an overwatch shot
  const covered = {}; // what the attack steps already showed, per unit
  const add = (id, k, n) => { (covered[id] ??= { men: 0, morale: 0, xp: 0 })[k] += n; };
  for (const e of entries) {
    // a tactic plays where it fired: before the attack that set it off
    if (e.detail?.type === "tactic") { steps.push({ kind: "tactic", tactic: e.detail.tactic }); continue; }
    if (e.detail?.type === "setFire") { steps.push({ kind: "setFire", x: e.detail.x, y: e.detail.y }); continue; }
    if (e.detail?.type === "overwatch" && e.detail.fired) { overwatchShot = true; continue; }
    const r = e.detail?.type === "attack" ? e.detail.result : null;
    if (!r) continue;
    const toD = [], toA = [];
    if (r.casualtiesDefender) { toD.push(["unitDamage", `−${r.casualtiesDefender}`]); add(r.defender, "men", r.casualtiesDefender); }
    if (r.loser === r.defender && r.moraleLoss) { toD.push(["moraleDown", `−${r.moraleLoss} morale`]); add(r.defender, "morale", -r.moraleLoss); }
    if (r.casualtiesAttacker) { toA.push(["unitDamage", `−${r.casualtiesAttacker}`]); add(r.attacker, "men", r.casualtiesAttacker); }
    if (r.loser === r.attacker && r.moraleLoss) { toA.push(["moraleDown", `−${r.moraleLoss} morale`]); add(r.attacker, "morale", -r.moraleLoss); }
    // the attacker's sword icon shows this attack's situational total (not the dice or the officer's stats)
    const base = /^(Yin\/Yang|Command|Fire|Skill|Unit Value|Encouraged|Demoralized|One soldier left|Two soldiers left|Modifier:)/;
    const attackBonus = (r.attackRoll?.parts ?? []).reduce((t, [label, v]) =>
      base.test(label) || (!r.ranged && /^Attacker bonus/.test(label)) ? t : t + (Number(v) || 0), 0);
    const dUnit = E.unitById(s, r.defender);
    const returnRanged = !!dUnit && E.typeOf(s, dUnit)?.weapon === "ranged";
    const aType = E.unitById(s, r.attacker) ? E.typeOf(s, E.unitById(s, r.attacker)) : null;
    steps.push({ kind: "attack", attacker: r.attacker, defender: r.defender, toDefender: toD, toAttacker: toA, returnStrike: r.damageToAttacker > 0, attackBonus, ranged: !!r.ranged, returnRanged,
      crossbow: /nushu/i.test(aType?.skill ?? ""), charge: !!r.charge && aType?.category === "cavalry", overwatch: overwatchShot });
    overwatchShot = false;
    const gains = [];
    if (r.xpAttacker) { gains.push([r.attacker, "xp", `+${r.xpAttacker} XP`]); add(r.attacker, "xp", r.xpAttacker); }
    if (r.xpDefender) { gains.push([r.defender, "xp", `+${r.xpDefender} XP`]); add(r.defender, "xp", r.xpDefender); }
    if (r.killedBy && r.killMorale) { gains.push([r.killedBy, "moraleUp", `+${r.killMorale} morale`]); add(r.killedBy, "morale", r.killMorale); }
    if (gains.length) steps.push({ kind: "floats", items: gains });
  }
  for (const e of entries) if (e.detail?.type === "levelUp") steps.push({ kind: "levelUp", unit: e.detail.unit, level: e.detail.level });
  // units that were just fully surrounded: white flash + "Surrounded!" before their -25 morale shows
  // (an encirclement applied as an attack commits the move happens before that attack, so it plays first)
  const firstAttack = entries.findIndex(e => e.detail?.type === "attack");
  const preAttack = [], postAttack = [];
  entries.forEach((e, i) => { if (e.detail?.type === "surrounded") (firstAttack >= 0 && i < firstAttack ? preAttack : postAttack).push(e.detail.unit); });
  const surroundSteps = (ids) => {
    ids = [...new Set(ids)];
    for (const id of ids) add(id, "morale", -50);
    return [{ kind: "surrounded", units: ids }, { kind: "floats", items: ids.map(id => [id, "moraleDown", "\u221225 morale"]) }];
  };
  if (preAttack.length) steps.unshift(...surroundSteps(preAttack));
  if (postAttack.length) steps.push(...surroundSteps(postAttack));
  // anything else that changed (end-of-turn morale, forced march, adjacent defeats...)
  const rest = [];
  for (const u of s.units) {
    const b = before[u.id]; if (!b) continue;
    const c = covered[u.id] ?? { men: 0, morale: 0, xp: 0 };
    const men = b.men - u.men - c.men, morale = u.morale - b.morale - c.morale;
    if (men > 0) rest.push([u.id, "unitDamage", `−${men}`]);
    if (morale) rest.push([u.id, morale > 0 ? "moraleUp" : "moraleDown", `${morale > 0 ? "+" : "−"}${Math.abs(morale)} morale`]);
  }
  if (rest.length) steps.push({ kind: "floats", items: rest });
  const fallen = s.units.filter(u => before[u.id]?.status === "active" && u.status !== "active")
    .map(u => [u.id, u.status === "surrendered" ? "flag" : "skull"]);
  if (fallen.length) steps.push({ kind: "fallen", units: fallen });
  steps.push(...logSoundSteps(entries, actionType));
  return broadcastBattleAnim(scene.id, steps);
}

/* ------------------------------------------------------------ run actions (GM only) */

/**
 * Run an engine action as a user. Adapter-only actions: startBattle (binds the
 * current scene), endBattle, armMarch.
 */
export function runAction(userId, action) {
  const job = queue.then(() => runActionNow(userId, action));
  queue = job.catch(() => {});
  return job;
}

async function runActionNow(userId, action) {
  if (!game.user.isGM) return { ok: false, error: "Only the GM's client can run battle actions" };
  const user = game.users.get(userId);
  const actor = { id: user?.isGM ? "host" : userId, host: !!user?.isGM };
  let battle = getBattle();

  if (action.type === "startBattle") {
    if (!actor.host) return { ok: false, error: "Only the GM can start a battle" };
    const scene = game.scenes.get(action.sceneId) ?? canvas.scene;
    if (!scene) return { ok: false, error: "Open the battle scene first" };
    if (!unitTokens(scene).length) return { ok: false, error: "Place some Unit tokens on the scene first" };
    battle = emptyBattle();
    battle.active = true;
    battle.sceneId = scene.id;
  } else if (action.type === "endBattle") {
    if (!actor.host) return { ok: false, error: "Only the GM can end the battle" };
    // (Units no longer lose XP for their casualties when the battle ends: David, 2026-10-24.)
    // units that escaped come back: active again and visible (tokens on the scene, and any unit actor left Escaped)
    try {
      const sc = game.scenes.get(battle.sceneId);
      for (const tok of unitTokens(sc)) if (tok.actor?.system?.status === "escaped") {
        await tok.actor.update({ "system.status": "active" }, { qinBattle: true });
        if (tok.hidden) await tok.update({ hidden: false }, { qinBattle: true });
      }
      const left = (game.actors?.contents ?? []).filter(a => a.type === "unit" && a.system.status === "escaped");
      if (left.length) await Actor.updateDocuments(left.map(a => ({ _id: a.id, "system.status": "active" })), { qinBattle: true });
    } catch (e) { console.warn("Qin | restoring escaped units", e); }
    try { (await import("./reinforce.mjs")).clearReinforcements(game.scenes.get(battle.sceneId)); } catch (e) { console.warn("Qin | clearing reinforcements", e); }
    await game.settings.set(SYSTEM_ID, SETTING, emptyBattle());
    return { ok: true };
  } else if (!battle.active) {
    return { ok: false, error: "No battle is running" };
  }

  if (action.type === "armMarch") {
    const ac = battle.turn.activation;
    const u = ac && game.scenes.get(battle.sceneId)?.tokens.get(ac.unitId)?.actor;
    if (!ac || ac.unitId !== action.unitId || !(actor.host || ownerUserId(u) === userId)) return { ok: false, error: "It isn't that unit's turn" };
    ac.armedMarch = !ac.armedMarch;
    await game.settings.set(SYSTEM_ID, SETTING, battle);
    return { ok: true };
  }

  if (action.type === "placeTactic") {
    const sc = game.scenes.get(battle.sceneId);
    action = { ...action, highGround: !!sc && isHighGround(sc, action.x, action.y) };
  }
  // Reinforcements due this round arrive first, so the round starts with them on the field
  if (action.type === "startRound") { try { await (await import("./reinforce.mjs")).arriveDue(game.scenes.get(battle.sceneId), battle.turn?.round ?? 0); } catch (e) { console.warn("Qin | reinforcements", e); } }
  if (action.type === "resetBattle") { try { await (await import("./reinforce.mjs")).clearReinforcements(game.scenes.get(battle.sceneId)); } catch (e) { console.warn("Qin | reinforcements", e); } }
  const moving = ["move", "forcedMarch"].includes(action.type) ? action.unitId : null;
  const { s, scene } = buildState(battle, { useLastPosition: moving, terrainFor: action.type === "moveTo" ? action.unitId : null });
  if (action.type === "moveTo") s.freeMovement = false;
  const logLen = s.log.length;
  const before = Object.fromEntries(s.units.map(u => [u.id, { men: u.men, morale: u.morale, xp: u.xp || 0, status: u.status }]));
  E.setRng(() => CONFIG.Dice.randomUniform());
  const res = E.act(s, actor, action.type === "startBattle" ? { type: "startBattle" } : action);
  if (!res.ok && action.type === "startBattle") return res;
  await writeBack(battle, s, scene);
  await postLog(s.log.slice(logLen), s);
  if (res.ok) {
    const shown = animateChanges(scene, before, s, s.log.slice(logLen), action.type);
    // Units destroyed or surrendered this action: remove their tokens once the skull/flag and fade have played.
    // The unit itself stays in the Actors directory; linked units are remembered for the XP count at the end.
    const fallen = s.units.filter(u => before[u.id]?.status === "active" && u.status !== "active" && scene?.tokens.get(u.id));
    if (fallen.length) {
      const b2 = getBattle();
      b2.fallen ??= {};
      for (const u of fallen) { const tok = scene.tokens.get(u.id); b2.fallen[u.id] = { actorId: tok.actorLink ? tok.actorId : null, name: tok.name }; }
      await game.settings.set(SYSTEM_ID, SETTING, b2);
      Promise.resolve(shown).catch(() => {}).then(() =>
        scene.deleteEmbeddedDocuments("Token", fallen.map(u => u.id).filter(id => scene.tokens.get(id)), { qinBattle: true }).catch(e => console.warn("Qin | removing fallen units", e)));
    }
  }
  return res;
}

/** No longer used (David, 2026-10-24): after a battle, each unit lost XP equal to the casualties it suffered. */
// eslint-disable-next-line no-unused-vars
async function settleXpAfterBattle(battle) {
  const scene = game.scenes.get(battle.sceneId);
  if (!scene) return;
  const lines = [];
  // units still on the scene, and fallen units whose tokens were removed (linked ones: their actor remains)
  const entries = unitTokens(scene).map(tok => ({ id: tok.id, name: tok.name, actor: tok.actor }));
  for (const [id, f] of Object.entries(battle.fallen ?? {})) if (!entries.some(e => e.id === id) && f.actorId) entries.push({ id, name: f.name, actor: game.actors.get(f.actorId) });
  for (const tok of entries) {
    const start = battle.startMen?.[tok.id];
    if (start === undefined || !tok.actor || tok.actor.system.side !== "player") continue; // XP is for Player units only
    const sys = tok.actor.system;
    const lost = Math.max(0, start - sys.men.value);
    const xp = sys.xp?.value ?? 0;
    const after = Math.max(0, xp - lost);
    if (after !== xp) await tok.actor.update({ "system.xp.value": after }, { qinBattle: true });
    lines.push(`<li><b>${tok.name}</b>: ${lost} casualties${lost ? `, XP ${xp} → ${after}` : `, XP ${xp}`}</li>`);
  }
  if (lines.length) await Chat().create({ content: `<div class="qin-chat qin-battle-log"><h3>Battle over</h3><p>Units lose XP equal to the casualties they suffered.</p><ul>${lines.join("")}</ul></div>`, speaker: { alias: "Battle" } });
}

/** GM-side reaction to a token being dragged during a battle. */
export async function onTokenMoved(tokenDoc, change, options) {
  if (!game.user.isGM || game.users.activeGM?.id !== game.user.id) return;
  if (options?.qinBattle || !("x" in change || "y" in change)) return;
  const battle = getBattle();
  if (!battle.active || tokenDoc.parent?.id !== battle.sceneId || tokenDoc.actor?.type !== "unit") return;
  const size = tokenDoc.parent.grid.size;
  const x = Math.round((change.x ?? tokenDoc.x) / size), y = Math.round((change.y ?? tokenDoc.y) / size);
  const ac = battle.turn.activation;
  if (ac && ac.unitId === tokenDoc.id) {
    const type = ac.armedMarch ? "forcedMarch" : "move";
    if (ac.armedMarch) { ac.armedMarch = false; await game.settings.set(SYSTEM_ID, SETTING, battle); }
    return runAction(game.user.id, { type, unitId: tokenDoc.id, x, y });
  }
  // Moves outside the unit's own turn: just record the new position.
  return runAction(game.user.id, { type: "place", unitId: tokenDoc.id, x, y, silent: true });
}

