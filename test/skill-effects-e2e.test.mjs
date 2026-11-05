// End-to-end: unique-skill debuffs (intimidation-type actives) from the Battle Sheets data, through the real code
// paths with minimal Foundry mocks (David, 2026-11-05). For each skill: the user's Test with fixed dice -> the effect
// card -> the GM's Resist for several targets at once (one loses, one wins) -> what lands on the loser -> attack and
// defense rolls by the loser against the source (penalty) and against someone else (none) -> round countdown and
// expiry -> the end of the fight clears it. Also: buffs are GM-only (no player Apply, refused on the GM side).
import test from "node:test";
import assert from "node:assert/strict";
import { addUser } from "./mocks.mjs";

/* ---------------------------------------- the Foundry bits the code paths touch */

const hooks = { on: new Map(), once: new Map() };
globalThis.Hooks = {
  on: (n, fn) => { if (!hooks.on.has(n)) hooks.on.set(n, []); hooks.on.get(n).push(fn); },
  once: (n, fn) => { if (!hooks.once.has(n)) hooks.once.set(n, []); hooks.once.get(n).push(fn); },
};
const fire = async (name, ...args) => { for (const fn of hooks.on.get(name) ?? []) fn(...args); await settle(); };
const settle = () => new Promise(r => setTimeout(r, 15));

// Fixed dice: each Yin/Yang roll takes the next [yin, yang] pair
const diceQueue = [];
class Roll {
  constructor(formula) { this.formula = formula; }
  async evaluate() {
    const pair = diceQueue.shift();
    if (!pair) throw new Error("No dice queued for this roll");
    this.dice = pair.map(v => ({ results: [{ result: v === 0 ? 10 : v }] }));
    return this;
  }
}
const templates = [];
const dialogAnswers = [];
let lastApp = null;
class ApplicationV2 {
  constructor(options = {}) { this.options = options; }
  render() { lastApp = this; this.rendered = true; return this; }
  close() { this.rendered = false; }
}
Object.assign(foundry, {
  documents: { Actor: class {} },
  dice: { Roll },
});
foundry.applications.api.ApplicationV2 = ApplicationV2;
foundry.applications.api.HandlebarsApplicationMixin = (B) => B;
foundry.applications.api.Dialog = { input: async () => dialogAnswers.shift() ?? {} };
foundry.applications.handlebars = { renderTemplate: async (path, data) => { templates.push({ path, data }); return ""; } };
const lastTemplate = (path) => [...templates].reverse().find(t => t.path.endsWith(path))?.data;

// Chat messages with ids, kept like game.messages
const messages = new Map();
const chat = [];
let mid = 0;
CONFIG.ChatMessage.documentClass = {
  create: async (d) => { const m = { ...d, id: `msg${++mid}`, flags: d.flags ?? {} }; messages.set(m.id, m); chat.push(m); return m; },
  getSpeaker: ({ actor } = {}) => ({ alias: actor?.name }),
};
game.messages = { get: (id) => messages.get(id), get contents() { return [...messages.values()]; } };
CONFIG.queries = {};
CONFIG.QIN = { BOL_LEVELS: {} };

const uuids = new Map();
globalThis.fromUuid = async (u) => uuids.get(u) ?? null;
globalThis.fromUuidSync = (u) => uuids.get(u) ?? null;

const gm = addUser("gm", true);
const player = addUser("p1", false);
const asGM = () => { game.user = Object.assign(gm, { isActiveGM: true, targets: new Set(), character: null }); };
const asPlayer = (character) => { game.user = Object.assign(player, { isActiveGM: false, targets: new Set(), character }); };
asGM();

const { SKILLS } = await import("../module/config.mjs");
const { QinActor } = await import("../module/documents/actor.mjs");
const { CharacterData, HenchmanData } = await import("../module/data/actor-models.mjs");
const cs = await import("../module/combat-state.mjs");
const fx = await import("../module/skill-effects.mjs");
const { effectButtons, effectAction, playerMayLand, normalizeEffect } = await import("../module/rules/skill-effects.mjs");
const { CombatPanel } = await import("../module/combat-panel.mjs");
cs.registerCombatState();
fx.registerSkillEffects();
for (const fn of hooks.once.get("init") ?? []) fn();

/* ---------------------------------------- actors */

const setPath = (obj, p, v) => { const ks = p.split("."); let o = obj; while (ks.length > 1) { const k = ks.shift(); o = o[k] ??= {}; } o[ks[0]] = v; };
let aid = 0;

/** A QinActor whose system is the real data model's derived data, re-prepared after every update. */
function actor({ name, type = "character", aspects, skills = {}, items = [], owners = [], extra = {} }) {
  const a = Object.create(QinActor.prototype);
  const sk = {};
  for (const k of Object.keys(SKILLS)) sk[k] = { value: skills[k] ?? 0, spec: "", known: false };
  a._sys = type === "character"
    ? { aspects, skills: sk, pdBonus: 0, chi: { value: 20, bonus: 0 }, bol: { damage: 0, override: [0, 0, 0, 0, 0] }, details: {}, ...extra }
    : { aspects, skills: sk, pdBonus: 0, tier: 2, wounds: 0, count: 1, outOfAction: false, ...extra };
  a._Data = type === "character" ? CharacterData : HenchmanData;
  Object.assign(a, { name, type, id: `a${++aid}`, uuid: `Actor.${name.replace(/\W/g, "")}`, flags: {}, owners });
  a.items = Object.assign(items, { get(id) { return items.find(i => i.id === id); } });
  for (const i of items) i.parent = a;
  Object.defineProperty(a, "isOwner", { get: () => game.user.isGM || owners.includes(game.user.id) });
  a.testUserPermission = (u) => u.isGM || owners.includes(u.id);
  a.update = async (upd) => {
    for (const [k, v] of Object.entries(upd)) {
      if (k.startsWith("system.")) setPath(a._sys, k.slice(7), structuredClone(v));
      else setPath(a, k, structuredClone(v));
    }
    a.prepare();
    return a;
  };
  a.prepare = () => {
    const s = Object.assign(Object.create(a._Data.prototype), structuredClone(a._sys));
    Object.defineProperty(s, "parent", { value: a, enumerable: false });
    s.prepareDerivedData();
    a.system = s;
  };
  a.prepare();
  uuids.set(a.uuid, a);
  return a;
}
const item = (id, name, type, system) => ({ id, name, type, system: { ...system }, async update(upd) { for (const [k, v] of Object.entries(upd)) setPath(this, k, structuredClone(v)); return this; } });
const sig = (id, name, s) => item(id, name, "signature", { slot: s.slot ?? "active2", bonuses: s.bonuses ?? [], effect: s.effect ?? null, chiCost: s.chi ?? 0,
  recharge: s.recharge ?? 0, perScene: !!s.perScene, description: `<p>${s.desc}</p>`, lastUse: null });
const dao = () => item("w1", "Dao", "weapon", { skill: "daoshu", damage: 3, attackModifier: 0, isRanged: false, equipped: true });

/* ---------------------------------------- the skills, as stored in the Battle Sheets (read 2026-11-05) */

const VS_RES = { user: { aspect: "fire", skill: "intimidation" }, resist: { aspect: "resistance", skill: "" } };
const SKILLS_UNDER_TEST = [
  { who: "Zhang Liao", aspects: { earth: 4, fire: 5, metal: 5, water: 4, wood: 3 }, intimidation: 5,
    passive: { name: "Eight Hundred Against Ten Thousand", bonuses: [
      { stat: "attack", value: 1, mode: "always", condition: "+1 per opponent in close combat with him past the first", stack: { max: 3, offset: 1, trigger: "opponentsEngaged" } },
      { stat: "ad", value: 2, mode: "always", label: "The Name That Silences Crying (always on)" },
      { stat: "ad", value: 1, mode: "situational", condition: "while two or more opponents are in close combat with him", label: "The Name That Silences Crying (always on)" }] },
    skill: { name: "The Name That Silences Crying", chi: 4, recharge: 4, desc: "One action. He makes a Fire + Intimidation Test opposed by the Resistance of each enemy who can see him. For 3 rounds, those who lose take −3 on Attack Tests and −2 on Active Defense Tests against him.",
      effect: { target: "enemies", test: VS_RES, duration: { rounds: 3 }, note: "Each enemy who can see him rolls Resistance.",
        onFail: [{ stat: "attack", value: -3, mode: "always", vsSource: true }, { stat: "ad", value: -2, mode: "always", vsSource: true }] } },
    expect: { attack: -3, ad: -2, vsSource: true, lastsRounds: 3 } },
  { who: "Zhang Fei", aspects: { earth: 5, fire: 5, metal: 5, water: 3, wood: 2 }, intimidation: 6,
    skill: { name: "Thunder at the Bridge", chi: 5, recharge: 5, desc: "One action. He roars a challenge: a Fire + Intimidation Test opposed by the Resistance of each enemy who can hear him. For 2 rounds, those who lose can't attack him or move toward him.",
      effect: { target: "enemies", test: VS_RES, duration: { rounds: 2 }, note: "can't attack him or move toward him", onFail: [] } },
    expect: { noteOnly: true, lastsRounds: 2 } },
  { who: "Li Damu", aspects: { earth: 3, fire: 3, metal: 4, water: 3, wood: 2 }, intimidation: 4,
    skill: { name: "Glare Down", chi: 2, recharge: 3, desc: "One action. He makes a Fire + Intimidation Test against the Earth + Resistance of one opponent in close combat with him. If he wins, that opponent takes −2 on Attack Tests against him until the end of the round.",
      effect: { target: "enemy", test: VS_RES, duration: { round: true }, note: "One opponent in close combat with him.", onFail: [{ stat: "attack", value: -2, mode: "always", vsSource: true }] } },
    expect: { attack: -2, vsSource: true, lastsRounds: 1 } },
  { who: "Zhang Bao (Shu)", aspects: { earth: 3, fire: 5, metal: 4, water: 3, wood: 4 }, intimidation: 4,
    skill: { name: "Roar of the Son", chi: 3, perScene: true, desc: "Once per fight, a free action. Each opponent within 10 yards makes an Earth + Resistance Test against his Fire + Intimidation; those who fail take −2 on their next Attack Test.",
      effect: { target: "enemies", test: VS_RES, duration: { rounds: 1 }, note: "each opponent within 10 yards; only their next Attack Test", onFail: [{ stat: "attack", value: -2, mode: "always" }] } },
    expect: { attack: -2, vsSource: false, lastsRounds: 1 } },
  { who: "Dong Zhuo", aspects: { earth: 5, fire: 5, metal: 4, water: 2, wood: 3 }, intimidation: 6,
    // The Battle Sheets don't store this passive's bonus yet (read 2026-11-05): mocked as schema v2.1 would have it
    passive: { name: "Rule by Terror", bonuses: [{ stat: "skillTest", value: 3, mode: "always", skills: ["intimidation"] }] },
    skill: { name: "Banquet of Blood", chi: 5, perScene: true, desc: "Once per scene, one action. He makes a Fire + Intimidation Test opposed by the Resistance of everyone who can see him. Those who lose can't attack him or openly defy his orders for the rest of the scene.",
      effect: { target: "enemies", test: VS_RES, duration: { scene: true }, note: "everyone who can see him; can't attack him or openly defy his orders", onFail: [] } },
    expect: { noteOnly: true, restOfFight: true, userSkillBonus: { label: "Rule by Terror", value: 3 } } },
  { who: "Chunyu Qiong", aspects: { earth: 4, fire: 4, metal: 4, water: 2, wood: 3 }, intimidation: 3,
    skill: { name: "Old Colonel's Bluster", chi: 2, recharge: 3, desc: "One action. He makes a Fire + Intimidation Test against one opponent's Earth + Resistance. If he wins, that opponent takes −2 on Attack Tests against him until the end of the round.",
      effect: { target: "enemy", test: VS_RES, duration: { round: true }, note: "one opponent", onFail: [{ stat: "attack", value: -2, mode: "always", vsSource: true }] } },
    expect: { attack: -2, vsSource: true, lastsRounds: 1 } },
];

/* ---------------------------------------- helpers */

const fight = (round = 1) => {
  game.combat = { id: "fight1", started: true, round, combatants: [], scene: null, getFlag: () => 1 };
  return game.combat;
};
const nextRound = async () => { game.combat.round += 1; await fire("updateCombat", game.combat, { round: game.combat.round }); };

/** A chat card's buttons as Foundry would render them, run through the system's render hook. */
function renderCard(message) {
  const btns = [...String(message.content).matchAll(/<button type="button" data-qin-action="(\w+)"[^>]*>([^<]*)<\/button>/g)].map(([, action, label]) => {
    const b = { dataset: { qinAction: action }, textContent: label, removed: false, click: null };
    b.remove = () => { b.removed = true; };
    b.addEventListener = (ev, fn) => { b.click = fn; };
    return b;
  });
  fx.onRenderEffectCard(message, { querySelectorAll: () => btns }, message.flags.qin);
  return btns.filter(b => !b.removed);
}
const click = async (btn) => { btn.click({ preventDefault() {} }); await settle(); };

/** Tick actors in the GM's scene picker and press its main button. */
async function pickerApply(picker, actors) {
  const toks = picker.tokens();
  const ids = toks.filter(t => actors.includes(t.actor)).map(t => t.id);
  picker.element = { querySelectorAll: (sel) => sel.includes(":checked") ? ids.map(value => ({ value })) : [] };
  await fx.EffectTargetPicker.DEFAULT_OPTIONS.actions.apply.call(picker);
  return picker.results;
}

/** Roll an attack with fixed dice against `target`; returns the card's tagged attack parts. */
async function attack(attacker, target, dice = [5, 0]) {
  game.user.targets = new Set([{ actor: target, setTarget() {} }]);
  dialogAnswers.push({ pd: String(target.system.passiveDefense), technique: "", modifier: 0 });
  diceQueue.push(dice);
  await attacker.rollAttack(attacker.items.get("w1"));
  game.user.targets = new Set();
  return lastTemplate("chat/roll.hbs");
}
async function dodge(defender, attacker, total = 12) {
  dialogAnswers.push({ modifier: 0 });
  diceQueue.push([4, 0]);
  await defender.rollDefense("dodge", { attacker: attacker.uuid, total, targetAd: [] });
  return lastTemplate("chat/roll.hbs");
}
const effectsOf = (a) => cs.getState(a).effects.filter(e => e.kind === "skillEffect");
const uniqueParts = (card, name) => card.parts.filter(p => p.kind === "unique" && String(p.label).includes(name));
const panelRows = async (a) => (await CombatPanel.prototype._prepareContext.call({ actor: a })).inEffect ?? null;

/* ---------------------------------------- the e2e run, one skill at a time */

const report = [];
for (const s of SKILLS_UNDER_TEST) {
  test(`e2e: ${s.who}, ${s.skill.name}`, async () => {
    asGM();
    fight(1);
    chat.length = 0;
    const items = [sig("sk", s.skill.name, s.skill), dao()];
    if (s.passive) items.push(sig("pa", s.passive.name, { ...s.passive, slot: "passive", desc: "" }));
    const user = actor({ name: s.who, aspects: s.aspects, skills: { intimidation: s.intimidation, qiangshu: 5 }, items });
    // the loser: a henchman with Resistance 4; the winner: a character with Resistance 10; a bystander to attack
    const loser = actor({ name: `${s.who} target A`, type: "henchman", aspects: { metal: 2, water: 2, fire: 2, wood: 2, earth: 2 }, skills: { daoshu: 3, dodging: 2 }, items: [dao()] });
    const winner = actor({ name: `${s.who} target B`, aspects: { metal: 5, water: 3, fire: 3, wood: 3, earth: 5 }, skills: { daoshu: 3 }, items: [dao()] });
    const other = actor({ name: `${s.who} bystander`, aspects: { metal: 3, water: 3, fire: 3, wood: 3, earth: 3 }, items: [dao()] });
    globalThis.canvas = { scene: { id: "sc", tokens: [
      { id: "tu", name: user.name, disposition: 1, actor: user }, { id: "ta", name: loser.name, disposition: -1, actor: loser },
      { id: "tb", name: winner.name, disposition: -1, actor: winner }, { id: "to", name: other.name, disposition: 1, actor: other },
    ] } };
    game.combat.scene = canvas.scene;
    game.combat.combatants = [{ actor: user, actorId: user.id }];

    // 1. The user's Test: Fire + Intimidation (+ his passive's Intimidation bonus) + Yin 6 / Yang 0
    // (with a passive Intimidation bonus the die is lower by as much, so the targets below still lose / win)
    const chiBefore = user.system.chi.value;
    const sb = s.expect.userSkillBonus;
    const yin = 6 - (sb?.value ?? 0);
    diceQueue.push([yin, 0]);
    const card = await cs.useActive(user, user.items.get("sk"));
    const userTotal = s.aspects.fire + s.intimidation + yin + (sb?.value ?? 0);
    assert.equal(card.flags.qin.kind, "effect");
    assert.equal(card.flags.qin.total, userTotal, "user's Test total");
    if (sb) assert.match(card.content, new RegExp(`${sb.label}`), "the passive's Intimidation bonus is tagged on the card");
    assert.equal(card.flags.qin.user, user.uuid);
    assert.equal(user.system.chi.value, chiBefore - (s.skill.chi ?? 0), "Chi spent");
    assert.deepEqual(user.items.get("sk").system.lastUse, { combat: "fight1", round: 1 }, "recharge started");

    // 2. The card: only Resist (enemy effect with a Test), for the GM and for players
    assert.deepEqual(renderCard(card).map(b => b.dataset.qinAction), ["effectResist"]);
    asPlayer(null);
    assert.deepEqual(renderCard(card).map(b => b.dataset.qinAction), ["effectResist"]);
    asGM();

    // 3. The GM's Resist: picker, tick both targets, roll them at once (A: 4 + 1 = 5 loses; B: 10 + 9 = 19 wins)
    const [btn] = renderCard(card);
    lastApp = null;
    await click(btn);
    const picker = lastApp;
    assert.ok(picker instanceof fx.EffectTargetPicker, "the GM's Resist opens the picker");
    assert.equal(picker.mode, "resist");
    assert.deepEqual(picker.tokens().map(t => t.name), [...[user.name, other.name].sort(), ...[loser.name, winner.name].sort()], "the user's side first");
    diceQueue.push([1, 0], [9, 0]);
    const results = await pickerApply(picker, [loser, winner]);
    const rA = results.find(r => r.name === loser.name), rB = results.find(r => r.name === winner.name);
    assert.equal(rA.total, 5);
    assert.equal(rA.outcome, "fail");
    assert.equal(rB.total, 19);
    assert.equal(rB.outcome, "success");
    assert.match(chat.at(-1).content, /resist rolls/, "one summary card");

    // 4. What lands: the loser gets the timed effect; the winner (no onSuccess) gets nothing
    const [eA] = effectsOf(loser);
    assert.ok(eA, "the loser has the effect");
    assert.equal(effectsOf(winner).length, 0, "the winner has nothing");
    assert.equal(eA.label, s.skill.name);
    assert.equal(eA.source, s.who);
    assert.equal(eA.sourceActor, user.uuid);
    assert.equal(eA.note, s.skill.effect.note);
    assert.equal(eA.combat, "fight1");
    const ex = s.expect;
    if (ex.noteOnly) assert.equal(eA.bonuses.length, 0);
    if (ex.attack) assert.deepEqual(eA.bonuses.find(b => b.stat === "attack") && [eA.bonuses.find(b => b.stat === "attack").value, !!eA.bonuses.find(b => b.stat === "attack").vsSource], [ex.attack, ex.vsSource]);
    if (ex.ad) assert.equal(eA.bonuses.find(b => b.stat === "ad").value, ex.ad);
    if (ex.restOfFight) assert.equal(eA.restOfFight, true);
    else assert.equal(eA.rounds, ex.lastsRounds);
    // shown in the loser's Combat panel with the source and the note
    const rows = await panelRows(loser);
    const row = rows.find(r => r.text.startsWith(s.skill.name));
    assert.ok(row, "panel row");
    assert.match(row.text, new RegExp(`from ${s.who.replace(/[()]/g, ".")}`));
    assert.ok(row.text.includes(s.skill.effect.note));
    assert.equal(row.reminder, !!ex.noteOnly);

    // 5. Attacks by the loser: against the source, and against someone else (henchman: Metal 2 + Daoshu 3 + 5)
    const vsSource = await attack(loser, user);
    const vsOther = await attack(loser, other);
    const penSrc = uniqueParts(vsSource, s.skill.name), penOther = uniqueParts(vsOther, s.skill.name);
    if (ex.attack) {
      assert.deepEqual(penSrc.map(p => p.value), [ex.attack], "penalty on the attack against the source");
      assert.equal(vsSource.total, 2 + 3 + 5 + ex.attack);
      assert.deepEqual(penOther.map(p => p.value), ex.vsSource ? [] : [ex.attack], ex.vsSource ? "no penalty against someone else" : "applies against anyone");
    } else {
      assert.equal(penSrc.length + penOther.length, 0, "note only: no number on the rolls");
      assert.equal(vsSource.total, 10);
    }
    // Active Defense by the loser against the source and against someone else
    const dSrc = await dodge(loser, user), dOther = await dodge(loser, other);
    if (ex.ad) {
      assert.deepEqual(uniqueParts(dSrc, s.skill.name).map(p => p.value), [ex.ad]);
      assert.equal(uniqueParts(dOther, s.skill.name).length, 0);
    } else {
      assert.equal(uniqueParts(dSrc, s.skill.name).length + uniqueParts(dOther, s.skill.name).length, 0);
    }
    // the winner's attack against the source is clean
    assert.equal(uniqueParts(await attack(winner, user), s.skill.name).length, 0);

    // 6. Countdown by round and expiry
    const roundsSeen = [];
    for (let r = 2; r <= 6 && effectsOf(loser).length; r++) {
      await nextRound();
      roundsSeen.push(effectsOf(loser).length);
    }
    if (ex.restOfFight) {
      assert.deepEqual(roundsSeen, [1, 1, 1, 1, 1], "a scene effect stays for the whole fight");
    } else {
      // applied in round 1: in force rounds 1..N, gone at the start of round N + 1
      assert.deepEqual(roundsSeen, [...Array(ex.lastsRounds - 1).fill(1), 0]);
      assert.ok(chat.some(m => /ends\./.test(m.content) && m.content.includes(s.skill.name)), "an 'ends' line in chat");
      assert.equal(uniqueParts(await attack(loser, user), s.skill.name).length, 0, "no penalty after expiry");
    }

    // 7. The end of the fight clears it (re-applied first for the timed ones)
    if (!effectsOf(loser).length) {
      diceQueue.push([1, 0]);
      await pickerApply(new fx.EffectTargetPicker({ message: card, mode: "resist" }), [loser]);
      assert.equal(effectsOf(loser).length, 1);
    }
    await fire("deleteCombat", game.combat);
    assert.equal(effectsOf(loser).length, 0, "fight end clears it");
    game.combat = null;

    report.push(`${s.who}, ${s.skill.name}: ${ex.noteOnly ? `note only ("${s.skill.effect.note}")` : `Attack ${ex.attack}${ex.ad ? `, Active Defense ${ex.ad}` : ""}${ex.vsSource ? " against him only" : " against anyone"}`}; ${ex.restOfFight ? "until the end of the fight" : `${ex.lastsRounds} round(s)`}`);
  });
}

test("e2e: a once-per-fight skill can't be used twice in the fight", async () => {
  asGM();
  fight(1);
  const s = SKILLS_UNDER_TEST.find(x => x.who === "Dong Zhuo");
  const user = actor({ name: "Dong Zhuo again", aspects: s.aspects, skills: { intimidation: 6 }, items: [sig("sk", s.skill.name, s.skill)] });
  diceQueue.push([3, 0]);
  assert.ok(await cs.useActive(user, user.items.get("sk")));
  const n = chat.length;
  await nextRound();
  assert.equal(await cs.useActive(user, user.items.get("sk")), undefined);
  assert.equal(chat.filter((m, i) => i >= n && m.flags?.qin?.kind === "effect").length, 0);
  game.combat = null;
});

test("e2e: ties go to the target", async () => {
  asGM();
  fight(1);
  const s = SKILLS_UNDER_TEST[0];
  const user = actor({ name: "Zhang Liao tie", aspects: s.aspects, skills: { intimidation: 5 }, items: [sig("sk", s.skill.name, s.skill)] });
  const tie = actor({ name: "Tie target", aspects: { metal: 4, water: 2, fire: 2, wood: 2, earth: 3 } }); // Resistance 7
  globalThis.canvas = { scene: { tokens: [{ id: "tt", name: tie.name, disposition: -1, actor: tie }] } };
  diceQueue.push([6, 0]);
  const card = await cs.useActive(user, user.items.get("sk")); // 16
  diceQueue.push([9, 0]); // 7 + 9 = 16
  const [r] = await pickerApply(new fx.EffectTargetPicker({ message: card, mode: "resist" }), [tie]);
  assert.equal(r.total, 16);
  assert.equal(r.outcome, "success");
  assert.equal(effectsOf(tie).length, 0);
  game.combat = null;
});

test("e2e: a player resists with their own character", async () => {
  asGM();
  fight(1);
  const s = SKILLS_UNDER_TEST[0];
  const user = actor({ name: "Zhang Liao vs player", aspects: s.aspects, skills: { intimidation: 5 }, items: [sig("sk", s.skill.name, s.skill)] });
  const hero = actor({ name: "Player Hero", aspects: { metal: 2, water: 2, fire: 2, wood: 2, earth: 2 }, owners: ["p1"], items: [dao()] });
  diceQueue.push([6, 0]);
  const card = await cs.useActive(user, user.items.get("sk"));
  asPlayer(hero);
  const [btn] = renderCard(card);
  assert.equal(btn.dataset.qinAction, "effectResist");
  diceQueue.push([2, 0]); // 4 + 2 = 6 < 16
  await click(btn);
  assert.match(chat.at(-1).content, /Player Hero resists/);
  assert.match(chat.at(-1).content, /Fails to resist/);
  const [e] = effectsOf(hero);
  assert.deepEqual(e.bonuses.map(b => [b.stat, b.value, b.vsSource]), [["attack", -3, true], ["ad", -2, true]]);
  assert.equal(e.messageId, card.id);
  // no second roll to shake it off
  const n = chat.length;
  await fx.onEffectClick("effectResist", card, card.flags.qin);
  assert.equal(chat.length, n);
  assert.equal(diceQueue.length, 0);
  assert.equal(effectsOf(hero)[0].id, e.id);
  asGM();
  game.combat = null;
});

/* ---------------------------------------- buffs are GM-only */

// Zhang Ji, Strike Before They Gather (Battle Sheets): allies, no Test
const strike = { name: "Strike Before They Gather", chi: 3, recharge: 3, desc: "A free action, declared before Initiative is rolled. For the round, he and allies who can hear him get +2 on Attack Tests against opponents who haven't acted yet this round.",
  bonuses: [{ stat: "attack", value: 2, mode: "situational", condition: "against opponents who haven't acted yet this round" }],
  effect: { target: "allies", duration: { round: true }, note: "allies who can hear him; he gets it too", onFail: [{ stat: "attack", value: 2, mode: "situational", condition: "against opponents who haven't acted yet this round" }] } };

test("buffs: one GM-only Apply; hidden from players, refused for players, applied to ticked actors", async () => {
  assert.deepEqual(effectButtons(normalizeEffect(strike.effect)), [{ action: "effectApply", label: "Apply", gmOnly: true }]);
  assert.deepEqual(effectButtons(normalizeEffect({ target: "enemies", onFail: [], note: "x" })).map(b => b.action), ["effectApply"]);
  assert.deepEqual(effectButtons(normalizeEffect(SKILLS_UNDER_TEST[0].skill.effect)).map(b => b.action), ["effectResist"]);
  assert.equal(effectAction("effectTake"), "effectApply");
  assert.equal(effectAction("effectApplyMe"), "effectApply");
  assert.equal(playerMayLand(normalizeEffect(strike.effect), "resist"), false);
  assert.equal(playerMayLand(normalizeEffect(SKILLS_UNDER_TEST[0].skill.effect), "resist"), true);
  assert.equal(playerMayLand(normalizeEffect(SKILLS_UNDER_TEST[0].skill.effect), "apply"), false);

  asGM();
  fight(1);
  const ji = actor({ name: "Zhang Ji", aspects: { earth: 4, fire: 4, metal: 3, water: 3, wood: 4 }, items: [sig("sk", strike.name, { ...strike, slot: "active" })] });
  const hero = actor({ name: "Buffed Hero", aspects: { metal: 3, water: 3, fire: 3, wood: 3, earth: 3 }, owners: ["p1"] });
  const ally = actor({ name: "Buffed Ally", aspects: { metal: 3, water: 3, fire: 3, wood: 3, earth: 3 } });
  globalThis.canvas = { scene: { tokens: [{ id: "h", name: hero.name, disposition: 1, actor: hero }, { id: "al", name: ally.name, disposition: 1, actor: ally },
    { id: "ji", name: ji.name, disposition: 1, actor: ji }] } };
  // a buff with Attack +2 on the slot is not an attack active: no attack dialog, the card is posted at once
  const card = await cs.useActive(ji, ji.items.get("sk"));
  assert.equal(card?.flags?.qin?.kind, "effect", "the buff posts its card (no attack dialog)");
  assert.equal(card.flags.qin.total, null);
  assert.equal(card.flags.qin.selfApplied, true);
  const own = cs.getState(ji).effects.find(e => e.kind === "unique");
  assert.deepEqual([own.bonuses.map(b => [b.stat, b.value]), own.rounds, own.round], [[["attack", 2]], 1, 1], "his share: the buff's duration");
  assert.doesNotMatch(card.content, /Take it|Apply to me/);

  // player: no button at all; a forced click, a direct landEffect and the GM query are all refused
  asPlayer(hero);
  assert.deepEqual(renderCard(card), []);
  await fx.onEffectClick("effectApply", card, card.flags.qin);
  await fx.onEffectClick("effectTake", card, card.flags.qin);
  assert.equal(await fx.landEffect(card, hero, "fail"), null);
  assert.equal(await fx.landEffect(card, hero, "fail", { via: "resist" }), null);
  assert.equal(effectsOf(hero).length, 0);
  asGM();
  const q = CONFIG.queries["qin.skillEffect"];
  assert.deepEqual(await q({ userId: "p1", targetUuid: hero.uuid, outcome: "fail", via: "apply", messageId: card.id }), { ok: false, refused: true });
  assert.deepEqual(await q({ userId: "p1", targetUuid: hero.uuid, outcome: "fail", via: "resist", messageId: card.id }), { ok: false, refused: true });
  assert.equal(effectsOf(hero).length, 0);

  // old cards ("Take it" / "Apply to me"): players lose the buttons, the GM's become Apply
  const old = { ...card, content: card.content.replace(/<div class="qin-buttons">.*<\/div><\/div>$/s, '<div class="qin-buttons"><button type="button" data-qin-action="effectTake">Take it</button><button type="button" data-qin-action="effectApplyMe">Apply to me</button></div></div>') };
  asPlayer(hero);
  assert.deepEqual(renderCard(old), []);
  asGM();
  const gmBtns = renderCard(old);
  assert.deepEqual(gmBtns.map(b => [b.dataset.qinAction, b.textContent]), [["effectTake", "Apply"], ["effectApplyMe", "Apply"]]);

  // the GM: Apply opens the picker; the ticked actors get the buff
  const [apply] = renderCard(card);
  assert.equal(apply.textContent, "Apply");
  lastApp = null;
  await click(apply);
  assert.equal(lastApp.mode, "apply");
  const res = await pickerApply(lastApp, [hero, ally, ji]);
  assert.equal(res.length, 3);
  assert.match(res.find(r => r.name === "Zhang Ji").line, /already has it/);
  assert.equal(effectsOf(ji).length, 0, "no second copy on the user");
  for (const a of [hero, ally]) {
    const [e] = effectsOf(a);
    assert.deepEqual(e.bonuses.map(b => [b.stat, b.value, b.mode]), [["attack", 2, "situational"]]);
    assert.equal(e.rounds, 1);
  }
  // the picker refuses a player too
  asPlayer(hero);
  const p2 = new fx.EffectTargetPicker({ message: card, mode: "apply" });
  p2.element = { querySelectorAll: () => [{ value: "al" }] };
  await fx.EffectTargetPicker.DEFAULT_OPTIONS.actions.apply.call(p2);
  assert.equal(p2.results, null);
  asGM();
  game.combat = null;
});

/* ---------------------------------------- skillTest bonuses (schema v2.1 §4) on the holder's own Tests */

const silver = { name: "Silver Tongue", slot: "passive", desc: "+2 on Eloquence and Diplomacy Tests to persuade someone to change sides.",
  bonuses: [{ stat: "skillTest", value: 2, mode: "situational", skills: ["eloquence", "diplomacy"], condition: "to persuade someone to change sides" }] };
const terror = { name: "Rule by Terror", slot: "passive", desc: "His Intimidation Tests get +3.", bonuses: [{ stat: "skillTest", value: 3, mode: "always", skills: ["intimidation"] }] };
const nimble = { name: "Nimble", slot: "passive", desc: "+1 on Dodging and Jianshu.", bonuses: [{ stat: "skillTest", value: 1, mode: "always", skills: ["dodging", "jianshu"] }] };
const persuader = () => actor({ name: "Li Su test", aspects: { metal: 2, water: 3, fire: 4, wood: 4, earth: 3 }, skills: { eloquence: 4, diplomacy: 4, intimidation: 2, dodging: 2, jianshu: 3 },
  items: [sig("p1", silver.name, silver), sig("p2", terror.name, terror), sig("p3", nimble.name, nimble), dao()] });
const uniq = (card) => card.parts.filter(p => p.kind === "unique").map(p => [p.label, p.value, !!p.situational]);

test("skillTest: rollTest applies always-on bonuses for the listed skill only, with source tags", async () => {
  asGM();
  const a = persuader();
  dialogAnswers.push({ aspect: "fire", skill: "intimidation", st: "", modifier: 0 });
  diceQueue.push([4, 0]);
  const r = await a.rollTest({});
  const dlg = lastTemplate("dialog/test.hbs");
  assert.deepEqual(dlg.always, ["Rule by Terror: Intimidation Tests +3", "Nimble: Dodging / Jianshu Tests +1"], "the dialog lists the always-on ones");
  assert.deepEqual(dlg.sitOpts.map(o => o.text), ["Silver Tongue: Eloquence / Diplomacy Tests +2"], "and offers the situational one");
  assert.equal(r.total, 4 + 2 + 4 + 3);
  assert.deepEqual(uniq(lastTemplate("chat/roll.hbs")), [["Rule by Terror", 3, false]]);
  // another skill: nothing from Rule by Terror
  dialogAnswers.push({ aspect: "fire", skill: "eloquence", st: "", modifier: 0 });
  diceQueue.push([4, 0]);
  assert.equal((await a.rollTest({})).total, 4 + 4 + 4);
  const card = lastTemplate("chat/roll.hbs");
  assert.deepEqual(uniq(card), []);
  assert.deepEqual(card.situational.map(x => x.ticked), [false], "the situational one shows as not ticked");
});

test("skillTest: situational ones are tick boxes in the Test dialog; without a dialog the Combat panel's ticks count", async () => {
  asGM();
  const a = persuader();
  dialogAnswers.push({ aspect: "fire", skill: "diplomacy", st: 9, modifier: 0, sit_0: true });
  diceQueue.push([2, 0]);
  const r = await a.rollTest({});
  assert.equal(r.total, 4 + 4 + 2 + 2);
  assert.equal(r.success, true);
  assert.deepEqual(uniq(lastTemplate("chat/roll.hbs")), [["Silver Tongue (to persuade someone to change sides)", 2, true]]);
  // the Combat panel's Situational section lists it; ticking it there applies it to a roll without a dialog
  const ctx = await CombatPanel.prototype._prepareContext.call({ actor: a });
  const row = ctx.situational.find(x => x.text.startsWith("Silver Tongue"));
  assert.ok(row, "in the panel's Situational section");
  assert.equal(row.text, "Silver Tongue: Eloquence / Diplomacy Tests +2");
  diceQueue.push([2, 0]);
  assert.equal((await a.rollTest({ prompt: false, aspect: "fire", skill: "eloquence" })).total, 4 + 4 + 2, "not ticked in the panel");
  await cs.setSituational(a, row.key, true);
  diceQueue.push([2, 0]);
  assert.equal((await a.rollTest({ prompt: false, aspect: "fire", skill: "eloquence" })).total, 4 + 4 + 2 + 2, "ticked in the panel");
  // and the dialog starts with the panel's tick
  dialogAnswers.push({ aspect: "fire", skill: "eloquence", st: "", modifier: 0 });
  diceQueue.push([2, 0]);
  await a.rollTest({});
  assert.equal(lastTemplate("dialog/test.hbs").sitOpts[0].checked, true);
});

test("skillTest: Dodging (non-martial) gets it; martial attack and Block rolls don't", async () => {
  asGM();
  game.combat = null;
  const a = persuader();
  const foe = actor({ name: "Foe skilltest", aspects: { metal: 3, water: 3, fire: 3, wood: 3, earth: 3 }, items: [dao()] });
  const d = await dodge(a, foe, 30);
  assert.deepEqual(uniq(d), [["Nimble", 1, false]]);
  assert.equal(d.total, 3 + 2 + 4 + 1);
  const atk = await attack(a, foe);
  assert.deepEqual(uniq(atk), [], "a martial skill's attack uses attack bonuses, not skillTest");
  // a pure Test with Jianshu (martial) gets nothing either
  diceQueue.push([1, 0]);
  assert.equal((await a.rollTest({ prompt: false, aspect: "metal", skill: "jianshu" })).total, 2 + 3 + 1);
});

test("skillTest: the effect flow asks for situational ticks before the user's Test", async () => {
  asGM();
  fight(1);
  const s = SKILLS_UNDER_TEST.find(x => x.who === "Dong Zhuo");
  const fierce = { name: "Fearsome at Feasts", slot: "passive", desc: "", bonuses: [{ stat: "skillTest", value: 2, mode: "situational", skills: ["intimidation"], condition: "at a banquet" }] };
  const dz = actor({ name: "Dong Zhuo feast", aspects: s.aspects, skills: { intimidation: 6 },
    items: [sig("sk", s.skill.name, s.skill), sig("pa", s.passive.name, { ...s.passive, slot: "passive", desc: "" }), sig("pb", fierce.name, fierce)] });
  dialogAnswers.push({ sit_0: true });
  diceQueue.push([1, 0]);
  const card = await cs.useActive(dz, dz.items.get("sk"));
  assert.equal(card.flags.qin.total, 5 + 6 + 1 + 3 + 2, "always-on +3 and the ticked +2");
  assert.match(card.content, /Fearsome at Feasts \(at a banquet\)/);
  assert.match(card.content, /· applied/);
  game.combat = null;
});

/* ---------------------------------------- resistTest bonuses (schema v2.2) on resist rolls */

const unflinching = { name: "Unflinching", slot: "passive", desc: "+2 on Tests to resist fear and Intimidation.",
  bonuses: [{ stat: "resistTest", value: 2, mode: "always", against: ["fear", "intimidation"] }] };
const antidote = { name: "Antidote Habit", slot: "passive", desc: "+2 to resist poison.", bonuses: [{ stat: "resistTest", value: 2, mode: "always", against: "poison" }] };
const resistParts_ = (r) => r.parts.filter(p => p.kind === "unique").map(p => [p.label, p.value, !!p.situational]);

test("resistTest e2e: Zhang Liao's intimidation vs '+2 to resist fear and Intimidation' (applied) and '+2 to resist poison' (offered, unticked)", async () => {
  asGM();
  fight(1);
  const s = SKILLS_UNDER_TEST[0];
  const zl = actor({ name: "Zhang Liao resist", aspects: s.aspects, skills: { intimidation: 5 }, items: [sig("sk", s.skill.name, s.skill)] });
  // both Resistance 7 (Metal 4 + Earth 3)
  const brave = actor({ name: "Brave Guard", aspects: { metal: 4, water: 2, fire: 2, wood: 2, earth: 3 }, items: [sig("un", unflinching.name, unflinching)] });
  const doctor = actor({ name: "Wary Doctor", aspects: { metal: 4, water: 2, fire: 2, wood: 2, earth: 3 }, items: [sig("an", antidote.name, antidote)] });
  globalThis.canvas = { scene: { tokens: [{ id: "tz", name: zl.name, disposition: 1, actor: zl },
    { id: "tg", name: brave.name, disposition: -1, actor: brave }, { id: "td", name: doctor.name, disposition: -1, actor: doctor }] } };
  diceQueue.push([6, 0]);
  const card = await cs.useActive(zl, zl.items.get("sk")); // 5 + 5 + 6 = 16
  assert.equal(card.flags.qin.total, 16);
  // the GM's picker shows each actor's resist bonuses: the matching one as applied, the other as an unticked box
  const picker = new fx.EffectTargetPicker({ message: card, mode: "resist" });
  const html = await picker._renderHTML();
  assert.match(html, /Unflinching: \+2 to resist fear, Intimidation · applied/);
  const box = html.match(/<input type="checkbox" name="rb_td_0"[^>]*>/)?.[0];
  assert.ok(box, "a tick box for the doctor's poison bonus");
  assert.doesNotMatch(box, /checked/, "unticked: poison isn't what this effect is");
  assert.doesNotMatch(html, /name="rb_tg_/, "no box for the automatic one");
  // both roll 7 + Yin 7 = 14: the guard's +2 makes 16 (a tie: resisted); the doctor's +2 is not counted (fails)
  diceQueue.push([7, 0], [7, 0]);
  const res = await pickerApply(picker, [brave, doctor]);
  const rg = res.find(r => r.name === brave.name), rd = res.find(r => r.name === doctor.name);
  assert.deepEqual(resistParts_(rg), [["Unflinching (vs fear, Intimidation)", 2, false]]);
  assert.equal(rg.total, 16);
  assert.equal(rg.outcome, "success");
  assert.equal(effectsOf(brave).length, 0);
  assert.deepEqual(resistParts_(rd), []);
  assert.equal(rd.total, 14);
  assert.equal(rd.outcome, "fail");
  assert.deepEqual(rd.situational.map(b => [b.label, b.ticked]), [["Antidote Habit", false]], "offered but unticked");
  assert.match(chat.at(-1).content, /Antidote Habit: \+2 to resist poison.*not ticked/s);
  assert.equal(effectsOf(doctor).length, 1);
  // the GM ticks the doctor's box in the picker: it counts
  const p2 = new fx.EffectTargetPicker({ message: card, mode: "resist" });
  const ids = ["td"];
  p2.element = { querySelectorAll: (sel) => sel.includes(":checked") ? ids.map(value => ({ value }))
    : sel.includes("data-rb-token") ? [{ checked: true, dataset: { rbToken: "td", rbKey: "an:0" } }] : [] };
  diceQueue.push([7, 0]);
  await fx.EffectTargetPicker.DEFAULT_OPTIONS.actions.apply.call(p2);
  assert.equal(p2.results[0].total, 16);
  assert.deepEqual(resistParts_(p2.results[0]), [["Antidote Habit", 2, true]]);
  // shown in the Combat panel's passives and the sheet's list
  const ctx = await CombatPanel.prototype._prepareContext.call({ actor: brave });
  assert.ok(ctx.alwaysRows.some(r => r.text === "Unflinching: +2 to resist fear, Intimidation"));
  game.combat = null;
});

test("resistTest e2e: a player's own resist asks about the offered ones; an ally's buff counts the same way", async () => {
  asGM();
  fight(1);
  const s = SKILLS_UNDER_TEST[0];
  const zl = actor({ name: "Zhang Liao vs doctor", aspects: s.aspects, skills: { intimidation: 5 }, items: [sig("sk", s.skill.name, s.skill)] });
  const doc = actor({ name: "Player Doctor", aspects: { metal: 4, water: 2, fire: 2, wood: 2, earth: 3 }, owners: ["p1"], items: [sig("an", antidote.name, antidote)] });
  diceQueue.push([6, 0]);
  const card = await cs.useActive(zl, zl.items.get("sk"));
  asPlayer(doc);
  const [btn] = renderCard(card);
  dialogAnswers.push({ rb_0: true }); // the player ticks it
  diceQueue.push([7, 0]);
  await click(btn);
  assert.match(chat.at(-1).content, /Antidote Habit/);
  assert.match(chat.at(-1).content, /Resisted/, "7 + 7 + 2 = 16 ties 16");
  asGM();

  // a buff: "+2 to resist fear for the scene", applied by the GM to an ally, then the ally resists
  const rally = { name: "Hold the Line", chi: 2, desc: "Allies get +2 to resist fear for the scene.",
    effect: { target: "allies", duration: { scene: true }, onFail: [{ stat: "resistTest", value: 2, mode: "always", against: ["fear"] }] } };
  const cao = actor({ name: "Cao Ren rally", aspects: { metal: 4, water: 3, fire: 4, wood: 3, earth: 4 }, items: [sig("rl", rally.name, { ...rally, slot: "active" })] });
  const ally = actor({ name: "Rallied Soldier", aspects: { metal: 4, water: 2, fire: 2, wood: 2, earth: 3 } });
  globalThis.canvas = { scene: { tokens: [{ id: "al", name: ally.name, disposition: -1, actor: ally }, { id: "cr", name: cao.name, disposition: -1, actor: cao }] } };
  const buffCard = await cs.useActive(cao, cao.items.get("rl"));
  await pickerApply(new fx.EffectTargetPicker({ message: buffCard, mode: "apply" }), [ally]);
  assert.equal(effectsOf(ally)[0].bonuses[0].stat, "resistTest");
  assert.deepEqual(effectsOf(ally)[0].bonuses[0].against, ["fear"]);
  const panel = await panelRows(ally);
  assert.ok(panel.some(r => r.text.includes("+2 to resist fear")), "the buff in the panel");
  diceQueue.push([7, 0]);
  const [r] = await pickerApply(new fx.EffectTargetPicker({ message: card, mode: "resist" }), [ally]);
  assert.deepEqual(resistParts_(r), [["Hold the Line (vs fear)", 2, false]]);
  assert.equal(r.total, 16);
  game.combat = null;
});

test("resistTest e2e: the sheet's plain Resistance roll offers every one, ticking the untagged always-on ones", async () => {
  asGM();
  const iron = { name: "Iron Will", slot: "passive", desc: "", bonuses: [{ stat: "resistTest", value: 1, mode: "always" }] };
  const a = actor({ name: "Resister", aspects: { metal: 4, water: 2, fire: 2, wood: 2, earth: 3 }, items: [sig("un", unflinching.name, unflinching), sig("ir", iron.name, iron)] });
  diceQueue.push([3, 0]);
  const r = await a.rollResist({ prompt: false });
  assert.equal(r.total, 7 + 3 + 1, "Resistance + die + the untagged one");
  const card = lastTemplate("chat/roll.hbs");
  assert.deepEqual(uniq(card), [["Iron Will", 1, true]]);
  assert.deepEqual(card.situational.map(x => [x.text, x.ticked]), [["Unflinching: +2 to resist fear, Intimidation", false], ["Iron Will: resist rolls +1", true]]);
  // the dialog's ticks
  dialogAnswers.push({ st: 9, modifier: 0, rb_0: true, rb_1: true });
  diceQueue.push([3, 0]);
  const t = await a.rollResist({});
  assert.equal(t.total, 7 + 3 + 2 + 1);
  assert.equal(t.success, true);
});

test("e2e summary", () => {
  assert.equal(report.length, SKILLS_UNDER_TEST.length);
  for (const line of report) console.log(`# ${line}`);
});
