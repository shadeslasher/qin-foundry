// Battle panel (all clients) and the player -> GM request channel.
import { SYSTEM_ID, systemPath, SIDES } from "../config.mjs";
import * as E from "./engine.mjs";
import { getBattle, buildState, runAction, unitTokens } from "./adapter.mjs";

const QUERY = `${SYSTEM_ID}.battle`;
const PHASE_NAME = { setup: "Setup", formations: "Declare formations", officer: "Officer phase", officerless: "Officer-less phase", final: "Final pass" };

export function registerBattleQuery() {
  CONFIG.queries[QUERY] = async ({ userId, action }) => runAction(userId, action);
}

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
    },
  };
  static PARTS = { body: { template: systemPath("templates/battle/panel.hbs"), scrollable: [".qin-battle-scroll"] } };

  static instance;
  static open() {
    this.instance ??= new BattlePanel();
    this.instance.render({ force: true });
    return this.instance;
  }
  static refresh() { if (this.instance?.rendered) this.instance.render(); }

  async _prepareContext() {
    const battle = getBattle();
    const ctx = { isGM: game.user.isGM, active: battle.active, sceneName: canvas.scene?.name ?? "—" };
    if (!battle.active) return ctx;
    const { s, scene } = buildState(battle);
    const t = s.turn;
    const p = E.prompt(s);
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
        if (game.user.isGM) btn("Begin (declare formations)", "startBattle", { primary: true });
        break;
      case "formations":
        prompt.text = "Choose formations for your units, then mark yourself ready.";
        if (!game.user.isGM) btn(t.ready[game.user.id] ? "Ready ✓" : "Ready", "ready");
        else btn("Start round (roll initiative)", "startRound", { primary: true });
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
        prompt.text = "Player side: officer-less turn. First to claim moves one of their units.";
        btn("Claim turn", "claim", { primary: true, disabled: !left.length });
        break;
      }
      case "pick": prompt.text = `${s.players[p.player]?.name ?? "GM"} claimed the turn${p.player === me.id ? ": choose one of your officer-less units below." : "."}`; break;
      case "host-pick": prompt.text = `${SIDES[p.side]} side: officer-less turn.${game.user.isGM ? " Choose one of their units below." : " The GM is moving."}`; break;
      default: prompt.text = "Waiting…";
    }

    // Units that can be picked to start an officer-less turn
    const pickable = s.units.filter(u => u.status === "active" && !u.officerId && !u.round.activated && (
      (p.kind === "pick" && p.player === me.id && u.side === "player" && mine(u)) || (p.kind === "host-pick" && game.user.isGM && u.side === p.side)));

    // Held officers (interject portraits)
    const blocked = a && a.started;
    const held = t.held.map(id => unit(id)).filter(u => u && u.status === "active").map(u => ({
      id: u.id, name: u.name, img: tokenImg(u.id), init: t.init[u.id]?.total,
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
      if (!u) return null;
      const st = u.status !== "active" ? u.status : u.round.activated ? "done" : t.held.includes(id) ? "holding" : (a?.unitId === id ? "acting" : "waiting");
      return { name: u.name, init: t.init[id]?.total, state: st, now: p.unitId === id };
    }).filter(Boolean);

    const units = s.units.map(u => ({
      id: u.id, name: u.name, side: u.side, men: u.men, morale: u.morale, moraleState: E.moraleState(u.morale), status: u.status,
      formation: s.library.formations.find(f => f.id === u.formation)?.name ?? "—", officer: E.officerOf(s, u)?.name ?? null,
      done: u.round.activated, mine: mine(u), img: tokenImg(u.id), pickable: pickable.includes(u),
      formationOptions: (t.phase === "formations" || t.phase === "setup") && mine(u)
        ? s.library.formations.filter(f => { const ty = E.typeOf(s, u); return !ty?.formations || ty.formations.includes(f.id); }).map(f => ({ id: f.id, name: f.name, selected: f.id === u.formation }))
        : null,
    })).sort((x, y) => (x.side > y.side ? 1 : -1));

    Object.assign(ctx, {
      round: t.round, phase: PHASE_NAME[t.phase], prompt, held, controls, order, units,
      log: (s.log || []).slice(-12).reverse().map(e => e.text),
      wrongScene: canvas.scene?.id !== battle.sceneId, battleScene: scene?.name,
      showSkip: game.user.isGM && !["setup", "formations"].includes(p.kind),
    });
    return ctx;
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    this.element.querySelectorAll("select[data-formation-unit]").forEach(sel => sel.addEventListener("change", () => {
      battleRequest({ type: "setFormation", unitId: sel.dataset.formationUnit, formation: sel.value });
    }));
  }

  static async #do(event, target) {
    const d = target.dataset;
    const action = { type: d.type };
    for (const k of ["unitId", "choice", "index"]) if (d[k] !== undefined) action[k] = k === "index" ? Number(d[k]) : d[k];
    await battleRequest(action);
  }
  static async #startBattle() {
    if (!canvas.scene) return ui.notifications.warn("Open the battle scene first.");
    if (!unitTokens(canvas.scene).length) return ui.notifications.warn("Place Unit tokens on this scene first.");
    await battleRequest({ type: "startBattle", sceneId: canvas.scene.id });
  }
  static async #endBattle() {
    const ok = await (api.Dialog ?? api.DialogV2).confirm({ window: { title: "End battle?" }, content: "<p>End the battle? Unit men and morale stay as they are.</p>" });
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
  static async #selectUnit(event, target) {
    const tok = canvas.tokens?.get(target.dataset.unitId);
    if (tok) { tok.control({ releaseOthers: true }); canvas.animatePan({ x: tok.center.x, y: tok.center.y }); }
  }
}
