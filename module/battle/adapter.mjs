import { Chat } from "../dice.mjs";
import { broadcastBattleAnim } from "../attack-fx.mjs";
// Bridges Foundry (scene tokens, unit actors, officer characters) and the pure battle
// engine. Runs only on the active GM's client; players reach it through queries.
import * as E from "./engine.mjs";
import { FORMATIONS, HEROIC_ACTIONS } from "./engine-data.mjs";
import { SYSTEM_ID } from "../config.mjs";

const SETTING = "battle";
let writing = false;
/** True while the battle itself is moving tokens (so the token lock lets those moves through). */
export const isWritingBack = () => writing;
const BIG = 100000;
let queue = Promise.resolve();

export const defaultFormations = () => foundry.utils.deepClone(FORMATIONS);

export function emptyBattle() {
  return { active: false, sceneId: null, turn: E.newState().turn, log: [], meta: {} };
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
    skill: skill ? { name: skill.name, text: stripHtml(skill.system.description), moraleCost: skill.system.moraleCost } : null,
    heroicActions: HEROIC_ACTIONS.map(h => ({ name: h.name, text: h.text })), // every officer may use the heroic action list
    battleArt: art ? { name: art.name, text: stripHtml(art.system.description) } : null,
  };
}

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

export function unitTokens(scene) {
  return scene ? scene.tokens.filter(t => t.actor?.type === "unit") : [];
}

/** Engine state assembled from the battle setting and the scene's unit tokens. */
export function buildState(battle, { useLastPosition = null, terrainFor = null } = {}) {
  const scene = game.scenes.get(battle.sceneId);
  const s = E.newState();
  s.freeMovement = true;
  s.turn = battle.turn;
  s.log = battle.log ?? [];
  s.library.formations = [{ id: "none", name: "No formation", desc: "No modifiers." }];
  s.library.unitTypes = [];
  s.library.officers = [];
  s.map = { image: null, cols: BIG, rows: BIG, tile: 1, offsetX: 0, offsetY: 0, terrain: {} };
  s.players = { host: { name: "GM", color: "#d9a441" } };
  for (const u of game.users) if (!u.isGM) s.players[u.id] = { name: u.name, color: u.color?.css ?? String(u.color) };
  if (!scene) return { s, scene: null };
  const size = scene.grid.size;
  const officers = new Map();
  for (const tok of unitTokens(scene)) {
    const a = tok.actor, sys = a.system;
    const gx = Math.round(tok.x / size), gy = Math.round(tok.y / size);
    // This unit's formations (embedded items) become engine formations "<token>.<item>"
    const forms = a.items.filter(i => i.type === "formation").map(i => formationEntry(tok.id, i));
    s.library.formations.push(...forms);
    const ranged = sys.range > 1;
    s.library.unitTypes.push({
      id: tok.id, name: a.name, faction: sys.faction, tier: sys.tier, category: sys.category, weapon: ranged ? "ranged" : "melee",
      skill: sys.weaponSkill, unitValue: sys.unitValue, damage: sys.damage, armor: sys.armor, armorPen: sys.armorPen, move: sys.move,
      rangeMin: ranged ? Math.min(sys.rangeMin || 1, sys.range) : 1, rangeMax: ranged ? sys.range : 1, formations: ["none", ...forms.map(f => f.id)],
    });
    let officerId = null;
    const officer = sys.officerActor;
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
      formation: a.items.get(sys.formation)?.type === "formation" ? `${tok.id}.${sys.formation}` : "none",
      facing: meta.facing ?? { dx: 0, dy: sys.side === "enemy" ? 1 : -1 }, hidden: sys.hidden, status: sys.status,
      fierceCharge: fierce ? 1 + fierce[1].length : 0,
      mods: meta.mods ?? [], heroicUsed: meta.heroicUsed ?? 0, lastHeroic: meta.lastHeroic ?? null,
      surrounded: meta.surrounded ?? false, round: meta.round ?? { activated: false, moved: false, cannotMove: false, holding: false, attacked: false, skillUsed: false, heroicUsed: false, meleeTarget: null, meleeAttacker: null },
    });
    // Terrain for this tile and its neighbours (stealth cover, encirclement)
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = (gx + dx) + "," + (gy + dy);
      if (k in s.map.terrain) continue;
      const t = terrainAt(scene, (gx + dx) * size + size / 2, (gy + dy) * size + size / 2);
      if (t !== "flat") s.map.terrain[k] = t;
    }
  }
  s.library.officers = [...officers.values()];
  // Full terrain around one unit (movement range, so impassable regions block its path)
  const tu = terrainFor && s.units.find(u => u.id === terrainFor);
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
    battle.meta[u.id] = { pos: { x: u.x, y: u.y }, facing: u.facing, mods: u.mods, heroicUsed: u.heroicUsed, lastHeroic: u.lastHeroic, surrounded: u.surrounded, round: u.round };
    const sys = tok.actor.system;
    const upd = {};
    if (sys.men.value !== u.men) upd["system.men.value"] = u.men;
    if (sys.morale !== u.morale) upd["system.morale"] = u.morale;
    if ((sys.xp?.value ?? 0) !== (u.xp || 0)) upd["system.xp.value"] = u.xp || 0;
    if ((sys.level ?? 1) !== (u.level || 1)) upd["system.level"] = u.level || 1;
    const formItem = u.formation && u.formation !== "none" ? u.formation.split(".").pop() : "none";
    if ((sys.formation || "none") !== formItem) upd["system.formation"] = formItem;
    // Health at the start of the battle (post-battle XP loss = casualties suffered)
    battle.startMen ??= {};
    if (battle.startMen[u.id] === undefined) battle.startMen[u.id] = sys.men.value;
    if (sys.status !== u.status) upd["system.status"] = u.status;
    if (sys.hidden !== !!u.hidden) upd["system.hidden"] = !!u.hidden;
    if (Object.keys(upd).length) actorUpdates.push(tok.actor.update(upd, { qinBattle: true }));
    const t = { _id: u.id };
    // Only the engine moving a unit (a swap) needs the token moved; dragged tokens are already there.
    if (Math.round(tok.x / size) !== u.x || Math.round(tok.y / size) !== u.y) { t.x = u.x * size; t.y = u.y * size; }
    if (rotate && !tok.lockRotation && u.facing) {
      const rot = ((Math.atan2(u.facing.dy, u.facing.dx) * 180 / Math.PI) - 90 + 360) % 360;
      if (Math.round(tok.rotation) !== Math.round(rot)) t.rotation = rot;
    }
    if (manage && u.side !== "player") {
      const unseen = u.status === "active" && !E.visibleTo(s, u, "player");
      const flagged = tok.getFlag(SYSTEM_ID, "stealthHidden");
      if (unseen && !tok.hidden) { t.hidden = true; t[`flags.${SYSTEM_ID}.stealthHidden`] = true; }
      else if (!unseen && flagged) { t.hidden = false; t[`flags.${SYSTEM_ID}.stealthHidden`] = false; }
    }
    if (Object.keys(t).length > 1) tokenUpdates.push(t);
  }
  await Promise.all(actorUpdates);
  if (scene && tokenUpdates.length) {
    writing = true;
    try { await scene.updateEmbeddedDocuments("Token", tokenUpdates, { qinBattle: true }); }
    finally { writing = false; }
  }
  battle.turn = s.turn;
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
function animateChanges(scene, before, s, entries) {
  if (!scene) return null;
  const steps = [];
  const covered = {}; // what the attack steps already showed, per unit
  const add = (id, k, n) => { (covered[id] ??= { men: 0, morale: 0, xp: 0 })[k] += n; };
  for (const e of entries) {
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
    steps.push({ kind: "attack", attacker: r.attacker, defender: r.defender, toDefender: toD, toAttacker: toA, returnStrike: r.damageToAttacker > 0, attackBonus, ranged: !!r.ranged, returnRanged });
    const gains = [];
    if (r.xpAttacker) { gains.push([r.attacker, "xp", `+${r.xpAttacker} XP`]); add(r.attacker, "xp", r.xpAttacker); }
    if (r.xpDefender) { gains.push([r.defender, "xp", `+${r.xpDefender} XP`]); add(r.defender, "xp", r.xpDefender); }
    if (r.killedBy && r.killMorale) { gains.push([r.killedBy, "moraleUp", `+${r.killMorale} morale`]); add(r.killedBy, "morale", r.killMorale); }
    if (gains.length) steps.push({ kind: "floats", items: gains });
  }
  for (const e of entries) if (e.detail?.type === "levelUp") steps.push({ kind: "levelUp", unit: e.detail.unit, level: e.detail.level });
  // units that were just fully surrounded: white flash + "Surrounded!" before their -50 morale shows
  // (an encirclement applied as an attack commits the move happens before that attack, so it plays first)
  const firstAttack = entries.findIndex(e => e.detail?.type === "attack");
  const preAttack = [], postAttack = [];
  entries.forEach((e, i) => { if (e.detail?.type === "surrounded") (firstAttack >= 0 && i < firstAttack ? preAttack : postAttack).push(e.detail.unit); });
  const surroundSteps = (ids) => {
    ids = [...new Set(ids)];
    for (const id of ids) add(id, "morale", -50);
    return [{ kind: "surrounded", units: ids }, { kind: "floats", items: ids.map(id => [id, "moraleDown", "\u221250 morale"]) }];
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
    // Always end the battle, even if settling XP fails (a missing actor, say), so tokens unlock
    try { await settleXpAfterBattle(battle); }
    catch (e) { console.error("Qin | settling XP after the battle failed", e); ui.notifications.warn("The battle ended, but settling XP failed: see the console (F12)."); }
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
    const shown = animateChanges(scene, before, s, s.log.slice(logLen));
    // Units destroyed or surrendered this action: hide their tokens once the skull/flag and fade have played
    const fallen = s.units.filter(u => before[u.id]?.status === "active" && u.status !== "active" && scene?.tokens.get(u.id) && !scene.tokens.get(u.id).hidden);
    if (fallen.length) Promise.resolve(shown).catch(() => {}).then(() =>
      scene.updateEmbeddedDocuments("Token", fallen.map(u => ({ _id: u.id, hidden: true })), { qinBattle: true }).catch(e => console.warn("Qin | hiding fallen units", e)));
  }
  return res;
}

/** After a battle, each unit loses XP equal to the casualties it suffered (health lost) during it. */
async function settleXpAfterBattle(battle) {
  const scene = game.scenes.get(battle.sceneId);
  if (!scene) return;
  const lines = [];
  for (const tok of unitTokens(scene)) {
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

