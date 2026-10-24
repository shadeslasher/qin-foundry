// Battle panel (all clients) and the player -> GM request channel.
import { SYSTEM_ID, systemPath, SIDES } from "../config.mjs";
import * as E from "./engine.mjs";
import { getBattle, buildState, runAction, unitTokens, formationsEnabled } from "./adapter.mjs";
import { mapFlag, hasMapRenderer, redrawScene, MapEditorApp } from "./maprender.mjs";
import { scaledPosition } from "../sheets/sheets.mjs";
import { setBattleRequest, highlightUnit } from "./battle-ui.mjs";
import { TacticsApp } from "./tactics-ui.mjs";
import { importBattleMap } from "./battlemap.mjs";
import { deployCardState, startZoneBrush, clearZones, confirmZones, discardZones, savedZones } from "./deploy.mjs";
import { objectivesCardState, addCondition, removeCondition, setRounds, startPick, startExtractionBrush } from "./objectives-ui.mjs";

const QUERY = `${SYSTEM_ID}.battle`;
const PHASE_NAME = { over: "Battle over", tactics: "Tactics", setup: "Setup", formations: "Declare formations", officer: "Officer phase", officerless: "Officer-less phase", final: "Final pass" };

export function registerBattleQuery() {
  CONFIG.queries[QUERY] = async ({ userId, action }) => runAction(userId, action);
}

setTimeout(() => setBattleRequest(battleRequest), 0);

/** Send an action to the battle (runs on the active GM's client). */
export async function battleRequest(action) {
  let res;
  if (game.user.isGM) res = await runAction(game.user.id, action);
  else {
    const gm = game.users.activeGM;
    if (!gm) return ui.notifications.warn("The GM needs to be connected to run the battle.");
    try { res = await gm.query(QUERY, { userId: game.user.id, action }, { timeout: 30000 }); }
    catch (e) { res = { ok: false, error: e.message }; }
  }
  if (res && !res.ok) ui.notifications.warn(res.error);
  else if (res?.warning) ui.notifications.info(res.warning);
  return res;
}

const { api } = foundry.applications;

// v14 renamed ApplicationV2 to Application.
/** Is the Recent log folded away on this computer? */
function recentClosed() { try { return localStorage.getItem("qin.recentClosed") === "1"; } catch { return false; } }

export class BattlePanel extends api.HandlebarsApplicationMixin(api.Application ?? api.ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "qin-battle-panel",
    classes: ["qin", "qin-battle"],
    window: { title: "Battle", icon: "fa-solid fa-chess-rook", resizable: true },
    position: { width: 400, height: 640, top: 80, left: 120 },
    actions: {
      do: BattlePanel.#do,
      startBattle: BattlePanel.#startBattle,
      endBattle: BattlePanel.#endBattle,
      attackTarget: BattlePanel.#attackTarget,
      swapTarget: BattlePanel.#swapTarget,
      selectUnit: BattlePanel.#selectUnit,
      setHidden: BattlePanel.#setHidden,
      importMap: () => importBattleMap(SYSTEM_ID),
      redrawMap: () => redrawScene(canvas.scene),
      toggleCompact: async () => { await game.settings.set(SYSTEM_ID, "compactUnits", !game.settings.get(SYSTEM_ID, "compactUnits")); BattlePanel.refresh(); },
      paintMap: () => MapEditorApp.open(canvas.scene),
      zonePaint: () => startZoneBrush("paint"),
      zoneErase: () => startZoneBrush("erase"),
      zoneClear: () => clearZones(),
      zoneConfirm: () => confirmZones(),
      zoneDiscard: () => discardZones(),
      objPick: (ev, el) => startPick(el.dataset.id, el.dataset.kind),
      objRemove: (ev, el) => removeCondition(el.dataset.id),
      objExtract: (ev, el) => startExtractionBrush(el.dataset.mode),
    },
  };
  static PARTS = { body: { template: systemPath("templates/battle/panel.hbs"), scrollable: [".qin-battle-scroll"] } };

  _initializeApplicationOptions(options) {
    const o = super._initializeApplicationOptions?.(options) ?? options;
    o.position = scaledPosition(o.position);
    return o;
  }

  static instance;
  static open() {
    this.instance ??= new BattlePanel();
    this.instance.render({ force: true });
    return this.instance;
  }
  static refresh() { if (this.instance?.rendered) this.instance.render(); }

  async _prepareContext() {
    const battle = getBattle();
    const ctx = { isGM: game.user.isGM, active: battle.active, sceneName: canvas.scene?.name ?? "—", sideChoices: SIDES, compactUnits: !!game.settings.get(SYSTEM_ID, "compactUnits") };
    // the map generator card: GM only, on scenes imported from the map generator
    const mf = game.user.isGM ? mapFlag(canvas.scene) : null;
    if (mf) ctx.mapCard = !mf.layoutCode ? { why: "This map has no layout code, so it can't be redrawn. Re-import it from a new export." }
      : !hasMapRenderer() ? { why: "Redrawing and painting this map need the map generator, which comes with the Three Kingdoms module." }
      : { ready: true };
    // deployment zones card: the GM, before the battle begins (or back in setup)
    if (game.user.isGM && canvas.scene && (!battle.active || (battle.sceneId === canvas.scene.id && battle.turn?.phase === "setup"))) {
      ctx.deploy = deployCardState();
      ctx.objCard = objectivesCardState(); // victory and defeat conditions, saved with the scene
    }
    if (!battle.active) {
      // players only see the units they control; the GM sees every unit
      ctx.sceneUnits = unitTokens(canvas.scene).filter(t => game.user.isGM || t.actor?.isOwner).map(t => ({ id: t.id, name: t.name, img: t.texture?.src, side: t.actor.system.side }));
      return ctx;
    }
    const { s, scene } = buildState(battle);
    const t = s.turn;
    const p = E.prompt(s);
    const useForms = formationsEnabled();
    const me = { id: game.user.isGM ? "host" : game.user.id, host: game.user.isGM };
    const mine = (u) => u && (u.owner === game.user.id || (game.user.isGM && !u.owner));
    const unit = (id) => E.unitById(s, id);
    const tokenImg = (id) => scene?.tokens.get(id)?.texture?.src;
    const a = t.activation;
    const au = a ? unit(a.unitId) : null;
    const prompt = { kind: p.kind, text: "", buttons: [] };
    const btn = (label, action, extra = {}) => prompt.buttons.push({ label, action, ...extra });

    switch (p.kind) {
      case "setup":
        prompt.text = game.user.isGM ? "Back in setup. Reposition units, then begin again." : "The GM is setting up.";
        if (game.user.isGM) btn(useForms ? "Begin (declare formations)" : "Begin", "startBattle", { primary: true });
        break;
      case "tactics": {
        const T = battle.tactics;
        const tac = T?.sides?.player;
        prompt.text = game.user.isGM ? "Tactics phase: choose tacticians and place their tactics, then finish (or skip)."
          : tac ? `Tactics phase. Player tactician: <b>${foundry.utils.escapeHTML(tac.name)}</b>.` : "Tactics phase: the GM is choosing tacticians.";
        // deployment: players drag their units onto the blue-white squares until tactics are finished
        const zones = savedZones(game.scenes.get(battle.sceneId)).size;
        prompt.text += zones ? `<br><span class="qin-muted">Deployment: drag your units onto the blue-white squares. Deployment locks when tactics are finished.</span>`
          : `<br><span class="qin-muted">No deployment zones on this map: units stay where the GM placed them.</span>`;
        btn("Open tactics", "openTactics", { primary: true });
        break;
      }
      case "over": {
        const r = battle.outcome?.result, byGM = battle.outcome?.declared;
        prompt.text = r === "stalemate" ? "<b>Stalemate.</b> The GM ended the battle."
          : r === "victory" ? `<b>Victory!</b> ${byGM ? "The GM ended the battle." : "Every victory condition is met."}`
          : `<b>Defeat.</b> ${byGM ? "The GM ended the battle." : "A defeat condition was met."}`;
        prompt.text += ""
          + (game.user.isGM ? `<br><span class="qin-muted">Press End battle (GM controls, below) to finish: units then lose XP for their casualties.</span>` : "");
        break;
      }
      case "formations":
        if (useForms) {
          prompt.text = "Choose formations for your units, then mark yourself ready.";
          if (!game.user.isGM) btn(t.ready[game.user.id] ? "Ready ✓" : "Ready", "ready");
        } else prompt.text = game.user.isGM ? "Start the round when you're ready." : "Waiting for the GM to start the round.";
        if (game.user.isGM) btn("Start round (roll initiative)", "startRound", { primary: true });
        break;
      case "decide": case "final": {
        const u = unit(p.unitId);
        prompt.text = `<b>${u.name}</b> (initiative ${t.init[u.id]?.total ?? "?"}): ${p.kind === "decide" ? "act or hold?" : "act now or give up the turn."}`;
        if (mine(u)) {
          btn("Act", "decide", { unitId: u.id, choice: "act", primary: true });
          btn(p.kind === "decide" ? "Hold" : "Give up turn", "decide", { unitId: u.id, choice: p.kind === "decide" ? "hold" : "forfeit" });
        } else prompt.text += `<br><span class="qin-muted">Waiting for ${s.players[u.owner]?.name ?? "the GM"}.</span>`;
        break;
      }
      case "activation": prompt.text = `<b>${au.name}</b> is taking its turn${mine(au) ? " — your move." : "."}`; break;
      case "claim": {
        const left = s.units.filter(u => u.status === "active" && !u.officerId && u.side === "player" && !u.round.activated && mine(u));
        prompt.text = "Player side: officer-less turn. The first player to press <b>Take turn</b> on one of their units moves it"
          + (left.length ? " (below, or click the unit on the map)." : ".");
        break;
      }
      case "pick": prompt.text = `${s.players[p.player]?.name ?? "GM"} claimed the turn${p.player === me.id ? ": choose one of your officer-less units below." : "."}`; break;
      case "host-pick": prompt.text = `${SIDES[p.side]} side: officer-less turn.${game.user.isGM ? " Choose one of their units below." : " The GM is moving."}`; break;
      default: prompt.text = "Waiting…";
    }

    // Units that can be picked to start an officer-less turn
    const pickable = s.units.filter(u => u.status === "active" && !u.officerId && !u.round.activated && (
      ((p.kind === "pick" && p.player === me.id || p.kind === "claim") && u.side === "player" && mine(u)) || (p.kind === "host-pick" && game.user.isGM && u.side === p.side)));

    // Held officers (interject portraits)
    const blocked = a && a.started;
    const shown = (u) => game.user.isGM || (u && u.owner === game.user.id); // players see only their own units
    const held = t.held.map(id => unit(id)).filter(u => u && u.status === "active" && shown(u)).map(u => ({
      id: u.id, name: E.officerOf(s, u)?.name || u.name, img: tokenImg(u.id), init: t.init[u.id]?.total,
      mine: mine(u), can: mine(u) && !blocked && t.order.indexOf(u.id) < (p.rank ?? Infinity) && !(a && a.unitId === u.id),
    }));

    // Active unit controls
    let controls = null;
    if (au && mine(au)) {
      const o = E.officerOf(s, au);
      const ms = E.moraleState(au.morale);
      controls = {
        id: au.id, name: au.name, step: a.step, armed: !!a.armedMarch,
        canMoveStep: a.step === "move", canAct: a.step === "act" && !a.forcedMarched && !au.round.attacked,
        movement: E.movementOf(s, au),
        skill: o?.skill ? { name: o.skill.name, cost: o.skill.moraleCost, disabled: au.round.skillUsed || au.morale < (o.skill.moraleCost || 0) } : null,
        art: o?.battleArt ? { name: o.battleArt.name, disabled: au.round.skillUsed || ms !== "Encouraged" } : null,
        heroics: (o?.heroicActions ?? []).map((h, i) => ({ index: i, name: h.name, disabled: au.round.heroicUsed || au.heroicUsed >= o.fire || au.lastHeroic === h.name })),
        heroicLeft: o ? `${o.fire - au.heroicUsed}/${o.fire}` : null,
      };
    }

    const order = t.order.map(id => {
      const u = unit(id);
      if (!u || !shown(u)) return null;
      const st = u.status !== "active" ? u.status : u.round.activated ? "done" : t.held.includes(id) ? "holding" : (a?.unitId === id ? "acting" : "waiting");
      const off = E.officerOf(s, u)?.name; // officer units go by their officer, with the unit alongside
      return { name: off || u.name, unit: off ? u.name : null, init: t.init[id]?.total, state: st, now: p.unitId === id };
    }).filter(Boolean);

    const units = s.units.filter(shown).map(u => ({
      id: u.id, name: u.name, side: u.side, men: u.men, maxMen: u.maxMen ?? 100, xp: u.xp ?? 0, morale: u.morale, moraleState: E.moraleState(u.morale), status: u.status,
      formation: useForms ? (s.library.formations.find(f => f.id === u.formation)?.name ?? "—") : "", officer: E.officerOf(s, u)?.name ?? null,
      done: u.round.activated, mine: mine(u), img: tokenImg(u.id), pickable: pickable.includes(u),
      sideEditable: game.user.isGM && (t.phase === "formations" || t.phase === "setup"),
      formationOptions: useForms && (t.phase === "formations" || t.phase === "setup") && mine(u)
        ? s.library.formations.filter(f => { const ty = E.typeOf(s, u); return !ty?.formations || ty.formations.includes(f.id); }).map(f => ({ id: f.id, name: f.name, selected: f.id === u.formation }))
        : null,
    })).sort((x, y) => (x.side > y.side ? 1 : -1));

    Object.assign(ctx, {
      round: t.round, phase: t.phase === "formations" && !useForms ? "Start of round" : PHASE_NAME[t.phase], prompt, held, controls, order, units,
      log: (s.log || []).slice(-12).reverse().map(e => e.text), recentClosed: recentClosed(),
      wrongScene: canvas.scene?.id !== battle.sceneId, battleScene: scene?.name,
      showSkip: game.user.isGM && !["setup", "formations", "tactics", "over"].includes(p.kind),
      canDeclare: game.user.isGM && !s.outcome && !["setup", "over"].includes(t.phase),
      tacticsWaiting: game.user.isGM && s.tactics?.phase === "battle" ? s.tactics.placed.filter(t => t.state === "hidden" && !["raiseFlag", "setAflame"].includes(t.key)).length : 0,
      gates: game.user.isGM ? (s.siege?.gates ?? []).map(g => ({ id: g.id, where: g.squares.map(([x, y]) => `${x},${y}`).join(" + "),
        owners: [["friendly", "Friendly (player & ally)"], ["enemy", "Enemy"]].map(([v, l]) => ({ v, l, sel: v === g.owner })),
        states: [["locked", "Locked"], ["open", "Open"], ["broken", "Broken open"], ["burned", "Burned (ruins)"]].map(([v, l]) => ({ v, l, sel: v === g.state })) })) : [],
    });
    return ctx;
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    // the Recent log folds away; remembered on this computer
    this.element.querySelector("details.qin-recent")?.addEventListener("toggle", (ev) => {
      try { localStorage.setItem("qin.recentClosed", ev.currentTarget.open ? "0" : "1"); } catch { /* storage unavailable */ }
    });
    // Hovering a unit button (Take turn, Act, interject...) marks that unit on the map
    this.element.querySelectorAll("[data-unit-id]").forEach(el => {
      el.addEventListener("mouseenter", () => highlightUnit(el.dataset.unitId, true));
      el.addEventListener("mouseleave", () => highlightUnit(el.dataset.unitId, false));
    });
    // Sides: before the battle, and between rounds (before initiative) for betrayals
    this.element.querySelectorAll("select[data-side-unit]").forEach(sel => sel.addEventListener("change", async () => {
      const tok = canvas.scene?.tokens.get(sel.dataset.sideUnit);
      if (tok?.actor) await tok.actor.update({ "system.side": sel.value });
      BattlePanel.refresh();
    }));
    // victory and defeat conditions (GM, before the battle)
    this.element.querySelectorAll("select[data-obj-add]").forEach(sel => sel.addEventListener("change", () => {
      if (sel.value) addCondition(sel.dataset.objAdd, sel.value);
    }));
    this.element.querySelectorAll("input[data-obj-rounds]").forEach(inp => inp.addEventListener("change", () => setRounds(inp.dataset.objRounds, inp.value)));
    this.element.querySelectorAll("select[data-gate]").forEach(sel => sel.addEventListener("change", () => {
      battleRequest({ type: "setGate", gateId: sel.dataset.gate, [sel.dataset.field]: sel.value });
    }));
    this.element.querySelectorAll("select[data-formation-unit]").forEach(sel => sel.addEventListener("change", () => {
      battleRequest({ type: "setFormation", unitId: sel.dataset.formationUnit, formation: sel.value });
    }));
  }

  static async #do(event, target) {
    const d = target.dataset;
    if (d.type === "openTactics") return TacticsApp.open();
    const action = { type: d.type };
    for (const k of ["unitId", "choice", "index", "result"]) if (d[k] !== undefined) action[k] = k === "index" ? Number(d[k]) : d[k];
    await battleRequest(action);
  }
  static async #startBattle() {
    if (!canvas.scene) return ui.notifications.warn("Open the battle scene first.");
    if (!unitTokens(canvas.scene).length) return ui.notifications.warn("Place Unit tokens on this scene first.");
    await battleRequest({ type: "startBattle", sceneId: canvas.scene.id });
  }
  static async #endBattle() {
    const ok = await (api.Dialog ?? api.DialogV2).confirm({ window: { title: "End battle?" }, content: "<p>End the battle? Units keep their health and morale. Each unit then loses XP equal to the casualties it suffered this battle.</p>" });
    if (ok) await battleRequest({ type: "endBattle" });
  }
  static async #attackTarget(event, target) {
    const t = [...game.user.targets][0];
    if (!t) return ui.notifications.warn("Target an enemy unit token first (hover it and press T).");
    await battleRequest({ type: "attack", unitId: target.dataset.unitId, targetId: t.id });
  }
  static async #swapTarget(event, target) {
    const t = [...game.user.targets][0];
    if (!t) return ui.notifications.warn("Target the adjacent allied unit to swap with first.");
    await battleRequest({ type: "swap", unitId: target.dataset.unitId, targetId: t.id });
  }
  /** GM: hide or reveal the selected unit tokens (abilities, landmarks, rulings). */
  static async #setHidden(event, target) {
    if (!game.user.isGM) return;
    const hidden = target.dataset.hidden === "1";
    const toks = (canvas.tokens?.controlled ?? []).filter(t => t.actor?.type === "unit");
    if (!toks.length) return ui.notifications.warn("Select one or more unit tokens on the map first.");
    const battle = getBattle();
    if (battle.active && battle.sceneId === canvas.scene?.id) {
      for (const t of toks) await battleRequest({ type: "setHidden", unitId: t.id, hidden });
    } else {
      // no battle: mark the unit, and keep hidden enemy/neutral tokens out of players' sight
      const manage = game.settings.get(SYSTEM_ID, "manageStealth");
      for (const t of toks) {
        await t.actor.update({ "system.hidden": hidden });
        const side = t.actor.system.side;
        if (manage && (side === "enemy" || side === "neutral")) {
          const flagged = t.document.getFlag(SYSTEM_ID, "stealthHidden");
          if (hidden && !t.document.hidden) await t.document.update({ hidden: true, [`flags.${SYSTEM_ID}.stealthHidden`]: true });
          else if (!hidden && flagged) await t.document.update({ hidden: false, [`flags.${SYSTEM_ID}.stealthHidden`]: false });
        }
      }
    }
    ui.notifications.info(`${toks.length} unit${toks.length === 1 ? "" : "s"} ${hidden ? "hidden" : "revealed"}.`);
  }
  static async #selectUnit(event, target) {
    const tok = canvas.tokens?.get(target.dataset.unitId);
    if (tok) { tok.control({ releaseOthers: true }); canvas.animatePan({ x: tok.center.x, y: tok.center.y }); }
  }
}
