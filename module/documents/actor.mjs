import { activeCombatantFor, remainingActions, defenseActionFor } from "../combat-actions.mjs";
import { pickAttackTarget, attackerToken, playAttackFx, showFloat, showDefense } from "../attack-fx.mjs";
import { ASPECTS, SKILLS, SKILL_LEVELS } from "../config.mjs";
import * as Q from "../rules/qin-rules.mjs";
import { rollYinYang, renderTemplate, formDialog, Chat } from "../dice.mjs";
import { part, sumParts } from "../rules/sources.mjs";
import { pdBreakdown, collectBonuses, attackerSideBonuses, targetAdParts, skillTestParts, skillTestBonuses, appliesToSkill, resistParts } from "../rules/bonuses.mjs";
import { damageAfterReductions, isFirstHitThisRound, resolveTao } from "../rules/tao-rules.mjs";
import { getState, tickedOf, queuedFor, consumeUpdate, currentFight, taoOf, activateTao, markActiveUsed, rollBonuses, afterAttackStacks, stackEventFor } from "../combat-state.mjs";
import { stackDefs, stackEvent, droppedLevel } from "../rules/stacks.mjs";
import { postEffectCard, resistBoxesHTML } from "../skill-effects.mjs";

const esc = (s) => foundry.utils.escapeHTML ? foundry.utils.escapeHTML(String(s ?? "")) : String(s ?? "");

export class QinActor extends foundry.documents.Actor {
  get isCharacter() { return this.type === "character"; }
  get isHenchman() { return this.type === "henchman"; }
  get isUnit() { return this.type === "unit"; }

  /** Skill level and metadata for a built-in skill key or a "skill" item id. */
  getSkill(key) {
    if (!key) return { key: "", label: "No skill", value: 0, complex: false, martial: false, domain: null };
    if (SKILLS[key]) {
      const s = this.system.skills?.[key] ?? { value: 0, spec: "" };
      const label = SKILLS[key].label + (s.spec ? ` (${s.spec})` : "");
      return { key, label, value: s.value, complex: SKILLS[key].complex, martial: SKILLS[key].martial, domain: SKILLS[key].domain };
    }
    const item = this.items.get(key);
    if (item?.type === "skill") return { key, label: item.name, value: item.system.value, complex: item.system.complex, martial: item.system.martial, domain: item.system.domain };
    return { key, label: key, value: 0, complex: false, martial: false, domain: null };
  }

  /** Options for skill <select>s: built-in skills plus extra skill items. */
  skillOptions() {
    const opts = Object.entries(SKILLS).map(([k, v]) => {
      const lvl = this.system.skills?.[k]?.value ?? 0;
      return { value: k, label: `${v.label}${this.system.skills?.[k]?.spec ? ` (${this.system.skills[k].spec})` : ""} — ${lvl}` };
    });
    for (const i of this.items) if (i.type === "skill") opts.push({ value: i.id, label: `${i.name} — ${i.system.value}` });
    return opts;
  }

  /* ---------------------------------------- Chi & damage */

  async spendChi(cost, reason = "") {
    if (!this.isCharacter || !cost) return true;
    const { chi, damage } = Q.spendChi(this.system.chi.value, cost);
    const update = { "system.chi.value": chi };
    if (damage) update["system.bol.damage"] = this.system.bol.damage + damage;
    await this.update(update);
    if (damage) ui.notifications.warn(`${this.name} draws on negative Chi: ${damage} damage taken${reason ? ` (${reason})` : ""}.`);
    return true;
  }

  async gainChi(n) {
    if (!this.isCharacter || !n) return;
    const max = this.system.chi.max;
    const cur = this.system.chi.value;
    if (cur >= max) return;
    await this.update({ "system.chi.value": Math.min(max, cur + n) });
  }

  async loseChi(n) {
    if (!this.isCharacter || !n) return;
    // A critical failure can't push Chi below 0.
    const cur = this.system.chi.value;
    if (cur <= 0) return;
    await this.update({ "system.chi.value": Math.max(0, cur - n) });
  }

  /**
   * Apply one hit's damage. Reductions in order (David, 2026-11-05): armour (protection − pierce), then hit
   * reductions (Hard Hide, unique "every hit" and "first hit each round"), then the Invisible Shield's Strong
   * Defense (queued or ticked; its Chi is spent only when it reduces something), then any manual reduction.
   * strongDefense: true / false, or null = use it if it was queued. card: post the tagged damage card.
   * Returns a summary string.
   */
  async applyDamage(amount, { protection = null, pierce = 0, reduction = 0, strongDefense = null, card = false, attacker = null, pierceParts = [] } = {}) {
    const sys = this.system;
    const prot = protection ?? sys.armor?.protection ?? 0;
    const fight = currentFight();
    const state = getState(this);
    const ticked = tickedOf(this);
    // Bonuses "against <someone>" count only when that someone is the attacker
    const list = rollBonuses(this, attacker);
    const woundBefore = this._woundLevel();
    const reductions = [];
    for (const h of sys.hitReductions ?? []) reductions.push({ label: `Strengthened Body, ${h.label}`, value: h.value, kind: "tao", step: "hit" });
    const on = (b) => b.mode !== "situational" || ticked[b.key];
    for (const b of list) if (b.stat === "hitReduction" && on(b)) reductions.push({ label: b.label, value: b.value, kind: "unique", situational: b.mode === "situational", step: "hit" });
    const first = isFirstHitThisRound(state.firstHit, fight);
    if (first) for (const b of list) if (b.stat === "firstHitReduction" && on(b)) reductions.push({ label: `${b.label} (first hit this round)`, value: b.value, kind: "unique", situational: b.mode === "situational", step: "hit" });
    const shield = taoOf(this, "invisibleShield");
    const queuedSD = state.queued.find(q => q.key === "invisibleShield.1");
    const useSD = shield.level >= 1 && (strongDefense ?? !!queuedSD);
    if (useSD) reductions.push({ label: `Invisible Shield ${shield.level}, Strong Defense (${shield.level} Chi)`, value: shield.level, kind: "tao", step: "strongDefense", cost: shield.level });
    if (Number(reduction)) reductions.push({ label: "Other reduction", value: Number(reduction), kind: "modifier", step: "manual" });
    const res = damageAfterReductions({ amount, protection: prot, pierce, reductions });
    const dmg = res.final;
    // One update: damage, Chi for Strong Defense (only if it reduced something), the first hit of the round
    const update = {};
    const sdStep = res.steps.find(s => s.step === "strongDefense");
    if (sdStep?.used) {
      if (queuedSD) state.queued = state.queued.filter(q => q.id !== queuedSD.id);
      if (this.isCharacter) {
        const { chi, damage } = Q.spendChi(sys.chi.value, shield.level);
        update["system.chi.value"] = chi;
        if (damage) { update["system.bol.damage"] = (sys.bol.damage || 0) + damage; ui.notifications.warn(`${this.name} draws on negative Chi: ${damage} damage taken (Strong Defense).`); }
      }
    }
    if (Number(amount) > 0 && fight) state.firstHit = { combat: fight.id, round: fight.round };
    // Growing bonuses that count hits taken
    state.stacks = stackEvent(state.stacks, stackDefs(sys.bonusListAll), "hitTaken").stacks;
    update[`flags.qin.combatState`] = state;
    const pierceNote = pierce ? ` (armour −${pierce})` : "";
    const redText = res.steps.filter(s => s.applied).map(s => ` − ${s.applied} ${s.label}`).join("");
    let text = "", stateLine = "", lost = null;
    if (this.isCharacter) {
      update["system.bol.damage"] = (update["system.bol.damage"] ?? sys.bol.damage) + dmg;
      await this.update(update);
      const s = this.system.bol;
      stateLine = `${s.remaining} of ${s.total} left · ${foundry.utils.getProperty(CONFIG.QIN.BOL_LEVELS, s.current)?.label ?? s.current}`;
      if (s.dead) stateLine = "Dead";
      else if (s.coma) stateLine = "In a coma (needs medical attention within Metal minutes)";
      text = `${this.name} takes ${dmg} damage (${amount} − ${res.armor.applied} armour${pierceNote}${redText}). ${stateLine}.`;
    } else if (this.isHenchman) {
      // Homebrew: health = tier. Any damage costs 1; 2x Resistance costs 2, 3x costs 3, 4x costs 4.
      lost = Q.henchmanHealthLoss(dmg, sys.resistance);
      const wounds = Math.min(sys.tier, sys.wounds + lost);
      const out = wounds >= sys.tier;
      if (lost) Object.assign(update, { "system.wounds": wounds, "system.outOfAction": out });
      await this.update(update);
      const left = sys.tier - wounds;
      stateLine = out ? "Out of action" : `${left} / ${sys.tier} health left`;
      text = `${this.name} takes ${dmg} damage (${amount} − ${res.armor.applied} armour${pierceNote}${redText}) and loses ${lost} health (Resistance ${sys.resistance}): ${out ? "out of action" : `${left} / ${sys.tier} health left`}.`;
    } else return "";
    // The attacker's "each opponent he drops" bonuses grow when this hit made the wound level worse
    const attackerActor = attacker ? await fromUuid(attacker) : null;
    if (attackerActor && droppedLevel(woundBefore, this._woundLevel())) await stackEventFor(attackerActor, "dropOpponent");
    if (card) {
      const parts = [part("base", "Incoming damage", amount)];
      if (prot || pierce) parts.push(part("gear", `${sys.armor?.name || "Armour"} ${prot}${pierce ? `, pierced −${pierce}` : ""}`, -res.armor.applied));
      for (const p of pierceParts ?? []) if (p.value) parts.push(part("unique", `${p.label}: armour counts ${p.value} less`, 0, { situational: !!p.situational, display: `pierce ${p.value}` }));
      const unused = [];
      for (const s of res.steps) {
        if (s.used) parts.push(part(s.kind, s.label, -s.applied, { situational: !!s.situational }));
        else unused.push({ kind: s.kind, text: `${s.label}: nothing left to reduce` });
      }
      if (sys.noPain) parts.push(part("tao", "Strengthened Body, Feel no pain: injury penalties ignored", 0, { display: "active" }));
      if (shield.level >= 1 && !useSD) unused.push({ kind: "tao", text: `Invisible Shield ${shield.level}, Strong Defense: −${shield.level} (${shield.level} Chi)` });
      const sb = taoOf(this, "strengthenedBody");
      if (sb.level >= 4 && !(sys.hitReductions ?? []).length) unused.push({ kind: "tao", text: `Strengthened Body ${sb.level}, Hard Hide: −Metal ${sys.aspects.metal} (4 Chi)` });
      const content = await renderTemplate("templates/chat/damage.hbs", {
        name: this.name, parts, final: dmg, lostLabel: this.isCharacter ? "Breath of Life lost" : `Damage taken (${lost} health lost)`, stateLine, unused,
      });
      await Chat().create({ speaker: { alias: "Damage" }, content, flags: { qin: { kind: "damage", target: this.uuid, damage: dmg } } });
    }
    return text;
  }

  /** Wound state for "dropped to a worse wound level": characters by Breath of Life level, henchmen by health. */
  _woundLevel() {
    const sys = this.system;
    if (this.isCharacter) return { level: sys.bol?.current, coma: !!sys.bol?.coma, dead: !!sys.bol?.dead, out: !!(sys.bol?.coma || sys.bol?.dead) };
    if (this.isHenchman) return { health: (sys.tier || 0) - (sys.wounds || 0), out: !!sys.outOfAction };
    return null;
  }

  /* ---------------------------------------- Tests */

  /** Injury and armour penalties as tagged parts (Feel no pain shows as an ignored injury penalty). */
  _penaltyParts(physical = true) {
    const out = [];
    const penalty = this.system.penalty || 0;
    if (penalty) out.push(part("wound", "Injury penalty", -penalty));
    else if (this.system.noPain && this.system.woundPenalty) out.push(part("tao", `Feel no pain: injury penalty −${this.system.woundPenalty} ignored`, 0, { display: "0" }));
    const armorPen = physical ? this.system.armor?.movementPenalty || 0 : 0;
    if (armorPen) out.push(part("gear", "Armour movement penalty", -armorPen));
    return out;
  }

  /**
   * Roll a Test: Aspect (+ Skill) + YyD. Prompts unless `prompt: false`.
   * opts: aspect, skill, st, modifier, inner, label, physical (apply armor penalty)
   */
  async rollTest(opts = {}) {
    if (this.isUnit) return;
    let o = { aspect: "metal", skill: "", st: "", modifier: 0, inner: 0, physical: false, ...opts };
    // Unique skills' "Tests with given skills" bonuses (schema v2.1): always-on ones count when the skill matches;
    // situational ones are tick boxes here (pre-ticked from the Combat panel), or the panel's ticks without a dialog
    const ticked = tickedOf(this);
    const skillBs = skillTestBonuses(rollBonuses(this, opts.vs ?? null));
    const sitOpts = skillBs.filter(b => b.mode === "situational").map((b, i) => ({ i, b, checked: !!ticked[b.key], text: `${b.label}: ${b.text}`, condition: b.condition }));
    let sitTicked = { ...ticked };
    if (opts.prompt !== false) {
      const content = await renderTemplate("templates/dialog/test.hbs", {
        aspects: Object.entries(ASPECTS).map(([k, v]) => ({ value: k, label: `${v.label} (${this.system.aspects[k]})`, selected: k === o.aspect })),
        skills: [{ value: "", label: "— none (pure Aspect) —" }, ...this.skillOptions()].map(s => ({ ...s, selected: s.value === o.skill })),
        o, earth: this.system.aspects.earth, isCharacter: this.isCharacter,
        always: skillBs.filter(b => b.mode !== "situational").map(b => `${b.label}: ${b.text}`), sitOpts,
      });
      const fd = await formDialog({ title: `${this.name}: Test`, content });
      if (!fd) return;
      o = { ...o, ...fd };
      sitTicked = {};
      for (const s of sitOpts) if (fd[`sit_${s.i}`]) sitTicked[s.b.key] = true;
    }
    const aspect = Number(this.system.aspects[o.aspect] ?? 0);
    const sk = this.getSkill(o.skill);
    if (o.skill && sk.complex && sk.value === 0) {
      ui.notifications.warn(`${sk.label} needs at least Apprentice level to attempt.`);
      return;
    }
    const beginner = !!o.skill && sk.value === 0;
    const inner = this.isCharacter ? Math.max(0, Math.min(Number(o.inner) || 0, this.system.aspects.earth)) : 0;
    if (inner) await this.spendChi(inner * 2, "inner strength");
    const { roll, dice } = await rollYinYang({ beginner });
    const mod = Number(o.modifier) || 0;
    const uniq = skillTestParts(skillBs, o.skill, { ticked: sitTicked, martial: sk.martial });
    const parts = [
      part("aspect", ASPECTS[o.aspect].label, aspect, { aspect: o.aspect }),
      o.skill ? part("skill", `${sk.label} (${SKILL_LEVELS[sk.value]})`, sk.value) : null,
      part("dice", `Yin / Yang ${dice.yin} / ${dice.yang}${dice.double && !dice.critFail ? (beginner ? ", double: Beginner counts 0" : ", double") : ""}`, dice.value),
      ...uniq.parts,
      mod ? part("modifier", "Modifier", mod) : null,
      inner ? part("modifier", `Inner strength (−${inner * 2} Chi)`, inner) : null,
      ...this._penaltyParts(!!o.physical),
    ].filter(Boolean);
    const total = sumParts(parts);
    const st = o.st === "" || o.st == null ? null : Number(o.st);
    const success = dice.critFail ? false : st == null ? null : total >= st;
    await this._afterDice(dice);
    const situational = uniq.situational.map(b => ({ kind: "unique", situational: true, ticked: b.ticked, text: `${b.label}: ${b.text}${b.condition ? ` (${b.condition})` : ""}` }));
    await this._postRoll({ title: o.label || (o.skill ? `${ASPECTS[o.aspect].label} + ${sk.label}` : `${ASPECTS[o.aspect].label} Test`), roll, dice, parts, total, st, success, situational });
    return { total, dice, success };
  }

  /**
   * A plain Resistance roll (schema v2.2): Resistance + Yin/Yang, like an effect's resist side. Every resistTest
   * bonus is offered as a tick box (the untagged always-on ones, and the Combat panel's ticks, start ticked).
   * Prompts unless `prompt: false` (then the defaults). opts: st, modifier, label, ticked ({ key: bool }).
   */
  async rollResist(opts = {}) {
    if (this.isUnit) return;
    let o = { st: "", modifier: 0, ...opts };
    const list = rollBonuses(this, opts.vs ?? null);
    const offer = resistParts(list, null, { panelTicked: tickedOf(this) });
    let ticked = opts.ticked ?? null;
    if (opts.prompt !== false) {
      const boxes = offer.offered.length ? `<div class="qin-dlg-bonuses"><span class="qin-muted">Resist bonuses: tick the ones that apply to this roll</span>${resistBoxesHTML(offer.offered)}</div>` : "";
      const fd = await formDialog({ title: `${this.name}: Resistance roll`,
        content: `<div class="qin-dialog"><div class="form-group"><label>ST (optional)</label><input type="number" name="st" value="${o.st}"></div>
          <div class="form-group"><label>Modifier</label><input type="number" name="modifier" value="${Number(o.modifier) || 0}"></div>${boxes}</div>` });
      if (!fd) return;
      o = { ...o, ...fd };
      ticked = Object.fromEntries(offer.offered.map((b, i) => [b.key, !!fd[`rb_${i}`]]));
    }
    const { roll, dice } = await rollYinYang({ beginner: false });
    const mod = Number(o.modifier) || 0;
    const uniq = resistParts(list, null, { ticked, panelTicked: tickedOf(this) });
    const parts = [
      part("base", "Resistance", this.system.resistance ?? 0),
      part("dice", `Yin / Yang ${dice.yin} / ${dice.yang}${dice.double && !dice.critFail ? ", double" : ""}`, dice.value),
      ...uniq.parts,
      mod ? part("modifier", "Modifier", mod) : null,
      ...this._penaltyParts(false),
    ].filter(Boolean);
    const total = sumParts(parts);
    const st = o.st === "" || o.st == null ? null : Number(o.st);
    const success = dice.critFail ? false : st == null ? null : total >= st;
    await this._afterDice(dice);
    const situational = uniq.offered.map(b => ({ kind: "unique", situational: true, ticked: b.ticked, text: `${b.label}: ${b.text}${b.condition ? ` (${b.condition})` : ""}` }));
    await this._postRoll({ title: o.label || "Resistance roll", roll, dice, parts, total, st, success, situational });
    return { total, dice, success, parts };
  }

  async _afterDice(dice) {
    if (dice.chiGain) await this.gainChi(dice.chiGain);
    if (dice.chiLoss) await this.loseChi(dice.chiLoss);
  }

  async _postRoll({ title, roll, dice, parts, total, st, success, extra = "", flags = {}, buttons = [], stLabel = "ST", pdBox = null, damageBox = null, situational = [], notes = [] }) {
    const content = await renderTemplate("templates/chat/roll.hbs", {
      title, parts, total, st, hasST: st != null, stLabel, success, dice, extra, buttons, pdBox, damageBox, situational, notes,
      margin: success && st != null ? total - st : null,
      isCharacter: this.isCharacter,
    });
    return Chat().create({
      speaker: Chat().getSpeaker({ actor: this }),
      content, rolls: [roll], flags: { qin: flags },
    });
  }

  /* ---------------------------------------- Combat */

  /**
   * Attack with a weapon item: Metal + Skill + YyD vs the target's Passive Defense. Unique-skill bonuses apply:
   * always-on ones automatically, situational ones when ticked; the target's "attackers take −N" too.
   * active: an in-person active used from the Combat panel; its attack and damage bonuses are applied, and its
   * Chi and recharge are taken when the attack is rolled.
   */
  async rollAttack(weapon, { active = null } = {}) {
    // On a scene: pick the hex to attack (highlighted reach), which also targets any token there.
    const source = attackerToken(this);
    let targetToken = [...game.user.targets][0] ?? null;
    let picked = null;
    if (source && game.settings.get("qin", "attackTargeting")) {
      // Tuck the sheet out of the way while choosing the hex
      const sheet = this.sheet?.rendered && !this.sheet.minimized ? this.sheet : null;
      if (sheet) await sheet.minimize?.();
      try { picked = await pickAttackTarget(source, weapon); }
      finally { if (sheet) sheet.maximize?.(); }
      if (!picked) return;
      targetToken = picked.token;
      if (targetToken) targetToken.setTarget(true, { releaseOthers: true, groupSelection: false });
      else for (const t of [...game.user.targets]) t.setTarget(false, { releaseOthers: false, groupSelection: false });
    }
    const target = targetToken?.actor ?? null;
    const sys = this.system;
    const ticked = tickedOf(this);
    const tSys = target && target.type !== "unit" ? target.system : null;
    // Growing bonuses at their current steps; bonuses "against <someone>" only between the two of them
    // Allies' auras (schema v2.3) count for both: worked out for the two tokens now (the target's PD included)
    const list = rollBonuses(this, tSys ? target : null, { token: source });
    const tTicked = tSys ? tickedOf(target) : {};
    const tList = tSys ? rollBonuses(target, this, { token: targetToken }) : [];
    const tPD = tSys?.aspects ? pdBreakdown({
      aspects: tSys.aspects, pdBonus: tSys.pdBonus || 0, armor: tSys.armor?.list ?? [], bonuses: tList, ticked: tTicked,
      tao: (tSys.combatEffects ?? []).filter(e => e.effect === "pd").map(e => ({ label: `${e.source ? `${e.source}, ` : ""}${e.label}`, value: e.value })),
    }) : null;
    const chiDefIncluded = (tSys?.combatEffects ?? []).filter(e => e.effect === "pd" && e.exchange).reduce((t, e) => t + (Number(e.value) || 0), 0);
    const activeList = active ? collectBonuses([{ id: active.id, name: active.name, bonuses: active.system.bonuses }], { aspects: sys.aspects }).filter(b => ["attack", "damage", "targetAd", "armorPierce"].includes(b.stat)) : [];
    // Tick boxes: own situational attack/damage bonuses, and the target's situational "attackers take −N"
    const sitOpts = [];
    for (const b of list) if (b.mode === "situational" && ["attack", "damage", "targetAd", "armorPierce"].includes(b.stat)) sitOpts.push({ b, owner: "self", checked: !!ticked[b.key], text: `${b.label}: ${b.text}`, condition: b.condition });
    for (const b of tList) if (b.mode === "situational" && b.stat === "attackersPenalty") sitOpts.push({ b, owner: "target", checked: !!tTicked[b.key], text: `Target: ${target.name}, ${b.label}: attack −${b.value}`, condition: b.condition });
    sitOpts.forEach((s, i) => { s.i = i; });
    const queued = queuedFor(this, "attack").map((q, i) => ({ ...q, i }));
    const techniques = this.items.filter(i => i.type === "technique" && i.system.roll === "attack" && (i.system.skill === weapon.system.skill || i.system.skill === "any"));
    const content = await renderTemplate("templates/dialog/attack.hbs", {
      weapon, target, targetPD: tPD?.total ?? target?.system?.passiveDefense ?? null,
      techniques, earth: sys.aspects.earth, isCharacter: this.isCharacter, isRanged: weapon.system.isRanged,
      distance: picked ? Math.round(picked.yards) : null, band: picked?.band ?? null, situation: picked?.band?.st ?? 0,
      sitOpts, queued, active: active ? { name: active.name, chiCost: active.system.chiCost, text: activeList.map(b => b.text).join(", ") } : null,
      always: [...list.filter(b => b.mode !== "situational" && ["attack", "damage", "targetAd", "armorPierce"].includes(b.stat)).map(b => `${b.label}: ${b.text}`),
        ...tList.filter(b => b.mode !== "situational" && b.stat === "attackersPenalty").map(b => `Target: ${target.name}, ${b.label}: attack −${b.value}`)],
    });
    const fd = await formDialog({ title: `${this.name}: attack with ${weapon.name}${active ? ` (${active.name})` : ""}`, content, okLabel: "Attack" });
    if (!fd) return;
    if (active && !(await markActiveUsed(this, active))) return;
    const sk = this.getSkill(weapon.system.skill);
    const tech = fd.technique ? this.items.get(fd.technique) : null;
    const inner = this.isCharacter ? Math.max(0, Math.min(Number(fd.inner) || 0, sys.aspects.earth)) : 0;
    if (inner) await this.spendChi(inner * 2, "inner strength");
    const { roll, dice } = await rollYinYang({ beginner: sk.value === 0 });
    const metal = sys.aspects.metal;
    const mod = (Number(fd.modifier) || 0) + (Number(fd.aim) || 0);
    const wpnMod = weapon.system.attackModifier || 0;
    const sitOn = sitOpts.map(s => !!fd[`sit_${s.i}`]);
    // targetAd (the defender's Active Defense −N) and armorPierce (the target's armour counts N less) go on the card's
    // flags, tagged with the skill, for the defense and the damage
    const atkUnique = [], dmgUnique = [];
    for (const b of list) if (b.mode !== "situational") {
      if (b.stat === "attack") atkUnique.push(part("unique", b.label, b.value));
      if (b.stat === "damage") dmgUnique.push(part("unique", b.label, b.value));
    }
    for (const b of tList) if (b.mode !== "situational" && b.stat === "attackersPenalty") atkUnique.push(part("unique", `Target: ${target.name}, ${b.label}`, -b.value));
    for (const b of activeList) if (b.stat === "attack" || b.stat === "damage") (b.stat === "attack" ? atkUnique : dmgUnique).push(part("unique", `${active.name} (active)`, b.value));
    const dialogTicked = {};
    sitOpts.forEach((s, i) => {
      if (!sitOn[i]) return;
      if (s.owner === "self" && (s.b.stat === "targetAd" || s.b.stat === "armorPierce")) { dialogTicked[s.b.key] = true; return; }
      const label = `${s.owner === "target" ? `Target: ${target.name}, ` : ""}${s.b.label}${s.condition ? ` (${s.condition})` : ""}`;
      if (s.b.stat === "attack") atkUnique.push(part("unique", label, s.b.value, { situational: true }));
      else if (s.b.stat === "damage") dmgUnique.push(part("unique", label, s.b.value, { situational: true }));
      else atkUnique.push(part("unique", label, -s.b.value, { situational: true }));
    });
    const parts = [
      part("aspect", "Metal", metal, { aspect: "metal" }),
      part("skill", `${sk.label} (${SKILL_LEVELS[sk.value]})`, sk.value),
      part("dice", `Yin / Yang ${dice.yin} / ${dice.yang}${dice.double && !dice.critFail ? ", double" : ""}`, dice.value),
      wpnMod ? part("gear", `${weapon.name} modifier`, wpnMod) : null,
      ...atkUnique,
      mod ? part("modifier", "Modifiers / aim", mod) : null,
      inner ? part("modifier", `Inner strength (−${inner * 2} Chi)`, inner) : null,
      ...this._penaltyParts(true),
    ].filter(Boolean);
    const total = sumParts(parts);
    const basePD = fd.pd === "" || fd.pd == null ? null : Number(fd.pd);
    const situation = Number(fd.situation) || 0;
    const st = basePD == null ? null : basePD + (tech ? tech.system.stIncrease : 0) + situation;
    const hit = dice.critFail ? false : st == null ? true : total >= st;
    // Queued attack effects (Destructive Breath...) are used by the next attack that hits; their Chi is spent then
    const useQ = hit ? queued.filter(q => fd[`q_${q.i}`]) : [];
    const qParts = useQ.map(q => part("tao", `${q.label} (${q.cost} Chi)`, q.value));
    const dmgBonus = Number(fd.damageBonus) || 0;
    const dmg = Q.attackDamageParts({ metal, weapon: weapon.system.damage, weaponName: weapon.name, dice, hit,
      extra: [...dmgUnique, ...qParts, dmgBonus ? part("modifier", "Damage bonus", dmgBonus) : null] });
    const damage = dmg.total;
    if (useQ.length) {
      const { update } = consumeUpdate(this, useQ.map(q => q.id));
      await this.update(update);
    }
    const techPierce = tech && /direct hit|masterstroke/i.test(tech.name) ? 2 : 0;
    const { targetAd, pierceParts, pierce } = attackerSideBonuses(list, { ticked: dialogTicked, activeList, activeName: active?.name ?? "", techniquePierce: techPierce, techniqueName: tech?.name ?? "" });
    await this._afterDice(dice);
    const extra = (active ? `<p><span class="qin-src qin-src-unique">Unique</span> <b>${esc(active.name)}</b> used${active.system.chiCost ? ` (${active.system.chiCost} Chi)` : ""}</p>` : "")
      + (tech ? `<p><b>Technique:</b> ${esc(tech.name)} (ST +${tech.system.stIncrease})</p>` : "")
      + (situation && st != null ? `<p class="qin-muted">Situation ${situation > 0 ? "+" : ""}${situation} to the ST</p>` : "")
      + (target && !tPD ? `<p><b>Target:</b> ${esc(target.name)} (Passive Defense ${basePD ?? "?"})</p>` : "");
    const notes = targetAd.map(t => ({ kind: "unique", situational: !!t.situational, text: `${t.label}: the defender's Active Defense −${t.value}` }));
    const pdBox = target && tPD ? (basePD === tPD.total
      ? { title: `${target.name}'s Passive Defense ${tPD.total}`, parts: tPD.parts }
      : { title: `${target.name}'s Passive Defense ${tPD.total} (${basePD ?? "none"} entered by hand)`, parts: tPD.parts }) : null;
    const situational = sitOpts.map((s, i) => ({ kind: "unique", situational: true, ticked: sitOn[i], text: s.text + (s.condition ? ` (${s.condition})` : "") }));
    const buttons = [];
    if (hit) {
      buttons.push({ action: "defend", type: "block", label: "Block" });
      buttons.push({ action: "defend", type: "dodge", label: "Dodge" });
      buttons.push({ action: "applyDamage", label: "Damage" });
      const tShield = tSys ? taoOf(target, "invisibleShield").level : 0;
      if (tShield >= 2 && st != null && !chiDefIncluded) buttons.push({ action: "chiDefense", label: `Chi Defense +${tShield}` });
    }
    await this._postRoll({
      title: `${weapon.name} attack`, roll, dice, parts, total, st, success: st == null ? null : hit, extra, buttons,
      stLabel: tech || situation ? "ST" : "Passive Defense", pdBox, situational, notes,
      damageBox: { total: damage, parts: dmg.parts, note: pierceParts.map(p => `armour −${p.value} (${p.technique ? "technique" : p.label})`).join(", ") },
      flags: { kind: "attack", attacker: this.uuid, target: target?.uuid ?? null, total, damage, pierce, pierceParts, targetAd, skill: weapon.system.skill, ranged: weapon.system.isRanged, hit,
        st, basePD, critFail: !!dice.critFail, fight: currentFight(), chiDefIncluded },
    });
    // Growing bonuses: remember the attack ("no attack last round"), reset the ones that reset when he attacks
    await afterAttackStacks(this);
    // An attack active that also acts on others posts its effect card
    if (active?.system.effect?.target) await postEffectCard(this, active);
    playAttackFx({ source, target: targetToken, point: picked?.point, weapon, hit }).catch(e => console.warn("Qin | attack animation", e));
    // The card remembers the target, so drop the targeting arrows once the attack is posted
    if (picked) for (const t of [...game.user.targets]) t.setTarget(false, { releaseOthers: false, groupSelection: false });
  }

  /** Active Defense against an attack total: block (Water + weapon Skill) or dodge (Water + Dodging). */
  async rollDefense(type, attack) {
    let skillKey = "dodging";
    let shieldBonus = 0;
    const sys = this.system;
    if (type === "block") {
      const weapons = this.items.filter(i => i.type === "weapon" && i.system.equipped);
      const best = weapons.sort((a, b) => this.getSkill(b.system.skill).value - this.getSkill(a.system.skill).value)[0];
      skillKey = best?.system.skill ?? "handToHand";
      shieldBonus = sys.armor.defenseBonus || 0;
      if (attack.ranged && this.getSkill(skillKey).value < 3) {
        ui.notifications.warn("Blocking a ranged attack needs Expert level in the martial Skill. Dodge instead.");
        return;
      }
    }
    // Options first (cancelling here doesn't use an action)
    const skPre = this.getSkill(skillKey);
    const shield = taoOf(this, "invisibleShield").level;
    const qDef = queuedFor(this, "defense");
    const qStrong = qDef.find(q => q.key === "invisibleShield.3"), qChiBlock = qDef.find(q => q.key === "invisibleShield.4");
    const ticked = tickedOf(this);
    const list = rollBonuses(this, attack.attacker ?? null);
    // Active Defense bonuses, plus "Tests with given skills" bonuses when the skill is a non-martial one (Dodging)
    const forDef = (b) => b.stat === "ad" || (!skPre.martial && appliesToSkill(b, skillKey));
    const sitOpts = list.filter(b => forDef(b) && b.mode === "situational").map((b, i) => ({ i, b, checked: !!ticked[b.key], text: `${b.label}: ${b.text}`, condition: b.condition }));
    const alwaysAD = list.filter(b => forDef(b) && b.mode !== "situational");
    const techniques = this.items.filter(i => i.type === "technique" && i.system.roll === "defense" && (i.system.skill === skillKey || i.system.skill === "any"));
    const combatant = activeCombatantFor(this);
    const content = await renderTemplate("templates/dialog/defense.hbs", {
      label: type === "block" ? "Block" : "Dodge", skillLabel: `${skPre.label} (${SKILL_LEVELS[skPre.value]})`, attackTotal: attack.total,
      attacker: attack.attacker ? fromUuidSync(attack.attacker)?.name : null,
      techniques, isCharacter: this.isCharacter, earth: sys.aspects.earth,
      strongBlock: shield >= 3, strongQueued: !!qStrong, chiBlock: shield >= 4, chiBlockQueued: !!qChiBlock, wood: sys.aspects.wood,
      sitOpts, always: [...alwaysAD.map(b => `${b.label}: ${b.text}`), ...(attack.targetAd ?? []).map(t => `Attacker, ${t.label}: Active Defense −${t.value}`)],
      actionsNote: combatant ? `Uses 1 action (${remainingActions(combatant)} left this round), unless Chi Block is ticked.` : "",
    });
    const fd = await formDialog({ title: `${this.name}: ${type === "block" ? "Block" : "Dodge"}`, content, okLabel: type === "block" ? "Block" : "Dodge" });
    if (!fd) return;
    // A Block or Dodge uses one of the defender's actions this round (the Invisible Shield's Chi Block doesn't).
    const act = await defenseActionFor(this, { chiBlock: !!fd.chiBlock && shield >= 4, canChiBlock: shield >= 4 });
    if (!act.ok) return;
    const inner = this.isCharacter ? Math.max(0, Math.min(Number(fd.inner) || 0, sys.aspects.earth)) : 0;
    if (inner) await this.spendChi(inner * 2, "inner strength");
    const tech = fd.technique ? this.items.get(fd.technique) : null;
    const strong = fd.strongBlock && shield >= 3 ? sys.aspects.wood : 0;
    // Strong Block 3 Chi, Chi Block 4 Chi: queued ones are taken off the queue, ticked ones are paid now
    const ids = [];
    let chiNow = 0;
    if (strong) { if (qStrong) ids.push(qStrong.id); else chiNow += 3; }
    if (act.chiBlock) { if (qChiBlock) ids.push(qChiBlock.id); else chiNow += 4; }
    if (ids.length) await this.update(consumeUpdate(this, ids).update);
    if (chiNow) await this.spendChi(chiNow, "Invisible Shield");
    const mod = Number(fd.modifier) || 0;
    const sk = this.getSkill(skillKey);
    const { roll, dice } = await rollYinYang({ beginner: sk.value === 0 && type === "block" });
    const water = sys.aspects.water;
    const attackerName = attack.attacker ? fromUuidSync(attack.attacker)?.name ?? "" : "";
    const shieldName = (sys.armor.list ?? []).filter(a => a.defenseBonus).map(a => a.name).join(", ") || "Shield";
    const sitOn = sitOpts.map(s => !!fd[`sit_${s.i}`]);
    const parts = [
      part("aspect", "Water", water, { aspect: "water" }),
      part("skill", `${sk.label} (${SKILL_LEVELS[sk.value]})`, sk.value),
      part("dice", `Yin / Yang ${dice.yin} / ${dice.yang}${dice.double && !dice.critFail ? ", double" : ""}`, dice.value),
      shieldBonus ? part("gear", shieldName, shieldBonus) : null,
      strong ? part("tao", `Invisible Shield ${shield}, Strong Block: +Wood (3 Chi)`, strong) : null,
      ...alwaysAD.map(b => part("unique", b.label, b.value)),
      ...sitOpts.filter((s, i) => sitOn[i]).map(s => part("unique", `${s.b.label}${s.condition ? ` (${s.condition})` : ""}`, s.b.value, { situational: true })),
      // The attacker's "opponents take −N on Active Defense" (targetAd), from the attack card
      ...targetAdParts(attack.targetAd, attackerName),
      inner ? part("modifier", `Inner strength (−${inner * 2} Chi)`, inner) : null,
      mod ? part("modifier", "Modifier", mod) : null,
      ...this._penaltyParts(true),
    ].filter(Boolean);
    const total = sumParts(parts);
    const st = attack.total + (tech ? tech.system.stIncrease : 0);
    const success = !dice.critFail && total >= st;
    await this._afterDice(dice);
    const defTok = attackerToken(this);
    if (defTok) {
      showFloat(defTok.center, success ? type : `${type}Fail`);
      const atk = attack.attacker ? fromUuidSync(attack.attacker) : null;
      const atkTok = atk ? attackerToken(atk) : null;
      showDefense(defTok, type, success, atkTok?.center ?? null).catch(e => console.warn("Qin | defense animation", e));
    }
    const notes = [];
    if (act.chiBlock) notes.push({ kind: "tao", text: `Invisible Shield ${shield}, Chi Block: a free Active Defense (4 Chi)` });
    const situational = sitOpts.map((s, i) => ({ kind: "unique", situational: true, ticked: sitOn[i], text: s.text + (s.condition ? ` (${s.condition})` : "") }));
    await this._postRoll({
      title: type === "block" ? "Block" : "Dodge", roll, dice, parts, total, st, success, notes, situational,
      extra: (tech ? `<p><b>Technique:</b> ${esc(tech.name)} (ST +${tech.system.stIncrease})</p>` : "")
        + (success ? "<p><b>Success: the blow is turned aside.</b></p>" : "<p><b>The attack lands.</b></p>")
        + (act.note ? `<p class="qin-muted">${esc(act.note)}</p>` : ""),
    });
  }

  /* ---------------------------------------- Taos, magic */

  /** Use a Tao: pick a level. Automated effects (Strong Defense, Hard Hide...) are queued or started; others post. */
  async useTao(item) {
    const max = item.system.level;
    const aspects = this.system.aspects;
    const levels = [1, 2, 3, 4].filter(l => l <= max).map(l => {
      const r = resolveTao(item.system.key, l, max, aspects);
      return { level: l, value: l, text: item.system.effects[`l${l}`], cost: r ? r.cost : l, auto: r ? `${r.name}: ${r.text}` : "" };
    });
    const any = resolveTao(item.system.key, "any", max, aspects);
    if (any) levels.unshift({ level: "Any", value: "any", text: "", cost: any.cost, auto: `${any.name}: ${any.text}` });
    if (!levels.length) return ui.notifications.warn(`${item.name}: no levels known.`);
    const content = await renderTemplate("templates/dialog/tao.hbs", { item, levels });
    const fd = await formDialog({ title: `${this.name}: ${item.name}`, content, okLabel: "Use" });
    if (!fd) return;
    const lvl = fd.level === "any" ? "any" : Number(fd.level);
    return activateTao(this, item, lvl);
  }

  async useMagic(item) {
    const way = item.system.way;
    const sk = this.getSkill(way);
    const content = await renderTemplate("templates/dialog/magic.hbs", { item, skill: sk });
    const fd = await formDialog({ title: `${this.name}: ${item.name}`, content, okLabel: "Cast" });
    if (!fd) return;
    const extra = Math.max(0, Number(fd.extraChi) || 0);
    await this.spendChi(item.system.chiCost + extra, item.name);
    if (item.system.prepST > 0) {
      await this.rollTest({ prompt: false, aspect: "earth", skill: way, st: item.system.prepST, label: `${item.name} (${item.system.chiCost + extra} Chi)` });
    } else {
      await Chat().create({
        speaker: Chat().getSpeaker({ actor: this }),
        content: `<div class="qin-chat"><h3>${esc(item.name)}</h3><p class="qin-muted">${item.system.chiCost + extra} Chi spent</p>${item.system.description || ""}</div>`,
      });
    }
  }

  /* ---------------------------------------- Recovery */

  async meditate() {
    const res = await this.rollTest({ prompt: false, aspect: "earth", skill: "meditation", st: 7, label: "Meditation (regain Chi)" });
    // Regain Chi equal to the Success Margin (a double's own Chi recovery is already applied).
    if (res?.success) await this.gainChi(res.total - 7);
  }
}
