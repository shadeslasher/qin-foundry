import { Chat } from "../dice.mjs";
// Bridges Foundry (scene tokens, unit actors, officer characters) and the pure battle
// engine. Runs only on the active GM's client; players reach it through queries.
import * as E from "./engine.mjs";
import { FORMATIONS } from "./engine-data.mjs";
import { SYSTEM_ID } from "../config.mjs";

const SETTING = "battle";
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
    heroicActions: abilities.filter(a => a.system.kind === "heroic").map(a => ({ name: a.name, text: stripHtml(a.system.description) })),
    battleArt: art ? { name: art.name, text: stripHtml(art.system.description) } : null,
  };
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
export function buildState(battle, { useLastPosition = null } = {}) {
  const scene = game.scenes.get(battle.sceneId);
  const s = E.newState();
  s.freeMovement = true;
  s.turn = battle.turn;
  s.log = battle.log ?? [];
  s.library.formations = game.settings.get(SYSTEM_ID, "formations");
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
    const allowed = (sys.formations || "").split(",").map(x => x.trim()).filter(Boolean);
    s.library.unitTypes.push({
      id: tok.id, name: a.name, faction: sys.faction, tier: sys.tier, category: sys.category, weapon: sys.weapon,
      skill: sys.weaponSkill, unitValue: sys.unitValue, damage: sys.damage, defense: sys.defense, move: sys.move,
      rangeMin: sys.rangeMin, rangeMax: sys.rangeMax, formations: allowed.length ? ["none", ...allowed] : null,
    });
    let officerId = null;
    const officer = sys.officerActor;
    if (officer) {
      if (!officers.has(officer.uuid)) officers.set(officer.uuid, officerLibraryEntry(officer));
      officerId = officer.uuid;
    }
    const meta = battle.meta?.[tok.id] ?? {};
    // A token that was just dragged is already at its new tile; the engine needs where it came from.
    const fromPos = useLastPosition === tok.id && meta.pos ? meta.pos : null;
    s.units.push({
      id: tok.id, typeId: tok.id, officerId, name: tok.name, side: sys.side, owner: ownerUserId(a),
      x: fromPos ? fromPos.x : gx, y: fromPos ? fromPos.y : gy, men: sys.men.value, morale: sys.morale, formation: sys.formation || "none",
      facing: meta.facing ?? { dx: 0, dy: sys.side === "enemy" ? 1 : -1 }, hidden: sys.hidden, status: sys.status,
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
    if ((sys.formation || "none") !== u.formation) upd["system.formation"] = u.formation;
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
    if (manage && u.side === "enemy") {
      const unseen = u.status === "active" && !E.visibleTo(s, u, "player");
      const flagged = tok.getFlag(SYSTEM_ID, "stealthHidden");
      if (unseen && !tok.hidden) { t.hidden = true; t[`flags.${SYSTEM_ID}.stealthHidden`] = true; }
      else if (!unseen && flagged) { t.hidden = false; t[`flags.${SYSTEM_ID}.stealthHidden`] = false; }
    }
    if (Object.keys(t).length > 1) tokenUpdates.push(t);
  }
  await Promise.all(actorUpdates);
  if (scene && tokenUpdates.length) await scene.updateEmbeddedDocuments("Token", tokenUpdates, { qinBattle: true, animate: false });
  battle.turn = s.turn;
  battle.log = s.log.slice(-60);
  await game.settings.set(SYSTEM_ID, SETTING, battle);
}

async function postLog(entries, s) {
  if (!entries.length) return;
  const nameOf = (id) => E.unitById(s, id)?.name ?? "?";
  const parts = entries.map(e => {
    if (e.detail?.type === "attack") {
      const r = e.detail.result;
      const col = (roll, title) => `<div><b>${title}: ${roll.total}</b>${roll.parts.filter(([k, v]) => v !== 0 || /Yin/.test(k)).map(([k, v]) => `<div class="qin-row"><span>${k}</span><span>${v > 0 ? "+" : ""}${v}</span></div>`).join("")}</div>`;
      return `<div class="qin-battle-attack"><p>${e.text}</p><details><summary>Roll breakdown</summary><div class="qin-breakdown">${col(r.attackRoll, nameOf(r.attacker))}${col(r.defendRoll, nameOf(r.defender))}</div></details></div>`;
    }
    return `<p class="${e.detail?.type === "warning" ? "qin-warn" : ""}">${e.text}</p>`;
  });
  await Chat().create({ content: `<div class="qin-chat qin-battle-log">${parts.join("")}</div>`, speaker: { alias: "Battle" } });
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
  const { s, scene } = buildState(battle, { useLastPosition: moving });
  const logLen = s.log.length;
  E.setRng(() => CONFIG.Dice.randomUniform());
  const res = E.act(s, actor, action.type === "startBattle" ? { type: "startBattle" } : action);
  if (!res.ok && action.type === "startBattle") return res;
  await writeBack(battle, s, scene);
  await postLog(s.log.slice(logLen), s);
  return res;
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

