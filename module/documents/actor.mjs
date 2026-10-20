import { ASPECTS, SKILLS, SKILL_LEVELS } from "../config.mjs";
import * as Q from "../rules/qin-rules.mjs";
import { rollYinYang, renderTemplate, formDialog, Chat } from "../dice.mjs";

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

  /** Apply damage after armor. Returns a summary string. */
  async applyDamage(amount, { protection = null, pierce = 0, reduction = 0 } = {}) {
    const prot = Math.max(0, (protection ?? this.system.armor?.protection ?? 0) - pierce);
    const dmg = Math.max(0, amount - prot - reduction);
    if (this.isCharacter) {
      await this.update({ "system.bol.damage": this.system.bol.damage + dmg });
      const s = this.system.bol;
      let state = `${s.remaining} Breath of Life left, ${foundry.utils.getProperty(CONFIG.QIN.BOL_LEVELS, s.current)?.label ?? s.current}`;
      if (s.dead) state = "dead";
      else if (s.coma) state = "in a coma (needs medical attention within Metal minutes)";
      return `${this.name} takes ${dmg} damage (${amount} − ${prot} armor${reduction ? ` − ${reduction}` : ""}). Now ${state}.`;
    }
    if (this.isHenchman) {
      const out = dmg > this.system.resistance;
      if (out) await this.update({ "system.outOfAction": true });
      return `${this.name} takes ${dmg} damage (${amount} − ${prot} armor${reduction ? ` − ${reduction}` : ""}): ${out ? "out of action" : `still standing (Resistance ${this.system.resistance})`}.`;
    }
    return "";
  }

  /* ---------------------------------------- Tests */

  /**
   * Roll a Test: Aspect (+ Skill) + YyD. Prompts unless `prompt: false`.
   * opts: aspect, skill, st, modifier, inner, label, physical (apply armor penalty)
   */
  async rollTest(opts = {}) {
    if (this.isUnit) return;
    let o = { aspect: "metal", skill: "", st: "", modifier: 0, inner: 0, physical: false, ...opts };
    if (opts.prompt !== false) {
      const content = await renderTemplate("templates/dialog/test.hbs", {
        aspects: Object.entries(ASPECTS).map(([k, v]) => ({ value: k, label: `${v.label} (${this.system.aspects[k]})`, selected: k === o.aspect })),
        skills: [{ value: "", label: "— none (pure Aspect) —" }, ...this.skillOptions()].map(s => ({ ...s, selected: s.value === o.skill })),
        o, earth: this.system.aspects.earth, isCharacter: this.isCharacter,
      });
      const fd = await formDialog({ title: `${this.name}: Test`, content });
      if (!fd) return;
      o = { ...o, ...fd };
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
    const penalty = this.system.penalty || 0;
    const armorPen = o.physical ? this.system.armor.movementPenalty : 0;
    const mod = Number(o.modifier) || 0;
    const total = aspect + sk.value + dice.value + mod + inner - penalty - armorPen;
    const st = o.st === "" || o.st == null ? null : Number(o.st);
    const success = dice.critFail ? false : st == null ? null : total >= st;
    const parts = [
      [ASPECTS[o.aspect].label, aspect],
      o.skill ? [`${sk.label} (${SKILL_LEVELS[sk.value]})`, sk.value] : null,
      [`Yin/Yang (${dice.yin} / ${dice.yang})${dice.double && !dice.critFail ? (beginner ? ", double: Beginner counts 0" : ", double") : ""}`, dice.value],
      mod ? ["Modifier", mod] : null,
      inner ? [`Inner strength (−${inner * 2} Chi)`, inner] : null,
      penalty ? ["Injury penalty", -penalty] : null,
      armorPen ? ["Armor movement penalty", -armorPen] : null,
    ].filter(Boolean);
    await this._afterDice(dice);
    await this._postRoll({ title: o.label || (o.skill ? `${ASPECTS[o.aspect].label} + ${sk.label}` : `${ASPECTS[o.aspect].label} Test`), roll, dice, parts, total, st, success });
    return { total, dice, success };
  }

  async _afterDice(dice) {
    if (dice.chiGain) await this.gainChi(dice.chiGain);
    if (dice.chiLoss) await this.loseChi(dice.chiLoss);
  }

  async _postRoll({ title, roll, dice, parts, total, st, success, extra = "", flags = {}, buttons = [] }) {
    const content = await renderTemplate("templates/chat/roll.hbs", {
      title, parts, total, st, success, dice, extra, buttons,
      margin: success && st != null ? total - st : null,
      isCharacter: this.isCharacter,
    });
    return Chat().create({
      speaker: Chat().getSpeaker({ actor: this }),
      content, rolls: [roll], flags: { qin: flags },
    });
  }

  /* ---------------------------------------- Combat */

  /** Attack with a weapon item: Metal + Skill + YyD vs the target's Passive Defense. */
  async rollAttack(weapon) {
    const target = [...game.user.targets][0]?.actor ?? null;
    const techniques = this.items.filter(i => i.type === "technique" && i.system.roll === "attack" && (i.system.skill === weapon.system.skill || i.system.skill === "any"));
    const content = await renderTemplate("templates/dialog/attack.hbs", {
      weapon, target, targetPD: target?.system?.passiveDefense ?? null,
      techniques, earth: this.system.aspects.earth, isCharacter: this.isCharacter, isRanged: weapon.system.isRanged,
    });
    const fd = await formDialog({ title: `${this.name}: attack with ${weapon.name}`, content, okLabel: "Attack" });
    if (!fd) return;
    const sk = this.getSkill(weapon.system.skill);
    const tech = fd.technique ? this.items.get(fd.technique) : null;
    const inner = this.isCharacter ? Math.max(0, Math.min(Number(fd.inner) || 0, this.system.aspects.earth)) : 0;
    if (inner) await this.spendChi(inner * 2, "inner strength");
    const { roll, dice } = await rollYinYang({ beginner: sk.value === 0 });
    const metal = this.system.aspects.metal;
    const penalty = this.system.penalty || 0;
    const armorPen = this.system.armor.movementPenalty;
    const mod = (Number(fd.modifier) || 0) + (Number(fd.aim) || 0);
    const total = metal + sk.value + dice.value + mod + inner - penalty - armorPen;
    const basePD = fd.pd === "" || fd.pd == null ? null : Number(fd.pd);
    const st = basePD == null ? null : basePD + (tech ? tech.system.stIncrease : 0) + (Number(fd.situation) || 0);
    const hit = dice.critFail ? false : st == null ? true : total >= st;
    const dmgBonus = Number(fd.damageBonus) || 0;
    const damage = Q.attackDamage({ metal, weapon: weapon.system.damage, dice, hit, bonus: dmgBonus });
    const parts = [
      ["Metal", metal],
      [`${sk.label} (${SKILL_LEVELS[sk.value]})`, sk.value],
      [`Yin/Yang (${dice.yin} / ${dice.yang})${dice.double && !dice.critFail ? ", double" : ""}`, dice.value],
      mod ? ["Modifiers / aim", mod] : null,
      inner ? [`Inner strength (−${inner * 2} Chi)`, inner] : null,
      penalty ? ["Injury penalty", -penalty] : null,
      armorPen ? ["Armor movement penalty", -armorPen] : null,
    ].filter(Boolean);
    const dmgParts = [`Metal ${metal}`, `${weapon.name} ${weapon.system.damage}`];
    if (dice.yangDiff) dmgParts.push(`Yang over Yin ${dice.yangDiff}`);
    if (dice.double && !dice.critFail && hit) dmgParts.push(`double ${dice.value}`);
    if (dmgBonus) dmgParts.push(`bonus ${dmgBonus}`);
    const pierce = tech && /direct hit|masterstroke/i.test(tech.name) ? 2 : 0;
    await this._afterDice(dice);
    const extra = (tech ? `<p><b>Technique:</b> ${esc(tech.name)} (ST +${tech.system.stIncrease})</p>` : "")
      + (target ? `<p><b>Target:</b> ${esc(target.name)} (Passive Defense ${basePD ?? "?"})</p>` : "")
      + `<p class="qin-damage"><b>Damage if it lands: ${damage}</b> <span class="qin-muted">(${dmgParts.join(" + ")})</span>${pierce ? " · armor −2" : ""}</p>`;
    const buttons = [];
    if (hit) {
      buttons.push({ action: "defend", type: "block", label: "Block" });
      buttons.push({ action: "defend", type: "dodge", label: "Dodge" });
      buttons.push({ action: "applyDamage", label: "Damage" });
    }
    await this._postRoll({
      title: `${weapon.name} attack`, roll, dice, parts, total, st, success: st == null ? null : hit, extra, buttons,
      flags: { kind: "attack", attacker: this.uuid, target: target?.uuid ?? null, total, damage, pierce, skill: weapon.system.skill, ranged: weapon.system.isRanged, hit },
    });
  }

  /** Active Defense against an attack total: block (Water + weapon Skill) or dodge (Water + Dodging). */
  async rollDefense(type, attack) {
    let skillKey = "dodging";
    let shieldBonus = 0;
    if (type === "block") {
      const weapons = this.items.filter(i => i.type === "weapon" && i.system.equipped);
      const best = weapons.sort((a, b) => this.getSkill(b.system.skill).value - this.getSkill(a.system.skill).value)[0];
      skillKey = best?.system.skill ?? "handToHand";
      shieldBonus = this.system.armor.defenseBonus || 0;
      if (attack.ranged && this.getSkill(skillKey).value < 3) {
        ui.notifications.warn("Blocking a ranged attack needs Expert level in the martial Skill. Dodge instead.");
        return;
      }
    }
    const sk = this.getSkill(skillKey);
    const { roll, dice } = await rollYinYang({ beginner: sk.value === 0 && type === "block" });
    const water = this.system.aspects.water;
    const penalty = this.system.penalty || 0;
    const armorPen = this.system.armor.movementPenalty;
    const total = water + sk.value + dice.value + shieldBonus - penalty - armorPen;
    const success = !dice.critFail && total >= attack.total;
    const parts = [
      ["Water", water], [`${sk.label} (${SKILL_LEVELS[sk.value]})`, sk.value],
      [`Yin/Yang (${dice.yin} / ${dice.yang})${dice.double && !dice.critFail ? ", double" : ""}`, dice.value],
      shieldBonus ? ["Shield", shieldBonus] : null, penalty ? ["Injury penalty", -penalty] : null, armorPen ? ["Armor movement penalty", -armorPen] : null,
    ].filter(Boolean);
    await this._afterDice(dice);
    await this._postRoll({
      title: type === "block" ? "Block" : "Dodge", roll, dice, parts, total, st: attack.total, success,
      extra: success ? "<p><b>The blow is turned aside.</b></p>" : "<p><b>The attack lands.</b></p>",
    });
  }

  /* ---------------------------------------- Taos, magic */

  async useTao(item) {
    const max = item.system.level;
    const levels = [1, 2, 3, 4].filter(l => l <= max).map(l => ({ level: l, text: item.system.effects[`l${l}`] }));
    if (!levels.length) return ui.notifications.warn(`${item.name}: no levels known.`);
    const content = await renderTemplate("templates/dialog/tao.hbs", { item, levels });
    const fd = await formDialog({ title: `${this.name}: ${item.name}`, content, okLabel: "Use" });
    if (!fd) return;
    const lvl = Number(fd.level);
    await this.spendChi(lvl, item.name);
    const effect = item.system.effects[`l${lvl}`];
    await Chat().create({
      speaker: Chat().getSpeaker({ actor: this }),
      content: `<div class="qin-chat"><h3>${esc(item.name)} — Level ${lvl}</h3><p>${esc(effect)}</p><p class="qin-muted">−${lvl} Chi</p></div>`,
    });
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
