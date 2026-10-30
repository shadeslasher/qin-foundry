// GM controls, in their own window apart from the Battle panel (David, 2026-10-29):
// hide/reveal and level up/down for the selected unit tokens, and, during a battle, fire, tactics,
// skip, back to setup, end battle and the Victory / Defeat / Stalemate declarations.
import { SYSTEM_ID, systemPath } from "../config.mjs";
import * as E from "./engine.mjs";
import { getBattle, buildState } from "./adapter.mjs";
import { scaledPosition } from "../sheets/sheets.mjs";
import { battleRequest, setHiddenSelected, confirmEndBattle, toggleGmFire, gmFireActive, setGmRefresh } from "./battle.mjs";
import { TacticsApp } from "./tactics-ui.mjs";
import { levelChevronsSVG } from "../icons.mjs";
import { broadcastBattleAnim } from "../attack-fx.mjs";
import { pickRandomChoices } from "./traits.mjs";

const { api } = foundry.applications;
const MAX_LEVEL = E.MAX_LEVEL ?? 5;

/** Unit tokens the GM has selected on the map. */
const selectedUnits = () => (canvas.tokens?.controlled ?? []).filter(t => t.actor?.type === "unit");

/** Raise or lower the selected units' level by `step`, between 1 and 5. A rise plays the Level up animation. */
export async function stepLevel(step) {
  if (!game.user.isGM) return;
  const toks = selectedUnits();
  if (!toks.length) return ui.notifications.warn("Select one or more unit tokens on the map first.");
  const changed = [], capped = [];
  for (const t of toks) {
    const cur = Math.max(1, Math.min(MAX_LEVEL, Number(t.actor.system.level) || 1));
    const next = Math.max(1, Math.min(MAX_LEVEL, cur + step));
    if (next === cur) { capped.push(t.name); continue; }
    const upd = { "system.level": next };
    // Enemy, allied and neutral units pick their level-up trait choices at random (David, 2026-10-30); players choose their own
    const picks = [];
    if (step > 0 && t.actor.system.side !== "player") {
      const list = foundry.utils.deepClone(t.actor.system.traitList ?? []);
      picks.push(...pickRandomChoices(list, next));
      if (picks.length) upd["system.traitList"] = list;
    }
    await t.actor.update(upd);
    if (picks.length) ui.notifications.info(`${t.name} picks ${picks.join(", ")}.`);
    changed.push([t, next]);
  }
  const ups = changed.filter(() => step > 0).map(([t, lv]) => ({ kind: "levelUp", unit: t.id, level: lv }));
  if (ups.length && canvas.scene) broadcastBattleAnim(canvas.scene.id, ups);
  if (capped.length) ui.notifications.info(`${capped.join(", ")} ${capped.length === 1 ? "is" : "are"} already at level ${step > 0 ? MAX_LEVEL : 1}.`);
  GmPanel.refresh();
}

export class GmPanel extends api.HandlebarsApplicationMixin(api.Application ?? api.ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "qin-gm-panel",
    classes: ["qin", "qin-battle", "qin-gm-panel"],
    window: { title: "GM controls", icon: "fa-solid fa-sliders", resizable: true },
    position: { width: 340, height: "auto", top: 80, left: 540 },
    actions: {
      setHidden: async (ev, el) => { await setHiddenSelected(el.dataset.hidden === "1"); GmPanel.refresh(); },
      level: (ev, el) => stepLevel(Number(el.dataset.step) || 0),
      gmFire: () => toggleGmFire(),
      endBattle: () => confirmEndBattle(),
      do: async (ev, el) => {
        const d = el.dataset;
        if (d.type === "openTactics") return TacticsApp.open();
        const action = { type: d.type };
        if (d.result !== undefined) action.result = d.result;
        await battleRequest(action);
      },
    },
  };
  static PARTS = { body: { template: systemPath("templates/battle/gm-panel.hbs"), scrollable: [".qin-battle-scroll"] } };

  _initializeApplicationOptions(options) {
    const o = super._initializeApplicationOptions?.(options) ?? options;
    o.position = scaledPosition(o.position);
    return o;
  }

  static instance;
  static open() {
    if (!game.user.isGM) return null;
    this.instance ??= new GmPanel();
    this.instance.render({ force: true });
    return this.instance;
  }
  static toggle() { return this.instance?.rendered ? this.instance.close() : this.open(); }
  static refresh() { if (this.instance?.rendered) this.instance.render(); }

  async _prepareContext() {
    const battle = getBattle();
    const ctx = { isGM: game.user.isGM, active: battle.active, gmFireOn: gmFireActive() };
    const sel = selectedUnits();
    ctx.selected = sel.map(t => { const lv = Math.max(1, Math.min(MAX_LEVEL, Number(t.actor.system.level) || 1));
      return { name: t.name, img: t.actor.img, level: lv, chev: levelChevronsSVG(lv, 13) }; });
    ctx.canUp = sel.some(t => (Number(t.actor.system.level) || 1) < MAX_LEVEL);
    ctx.canDown = sel.some(t => (Number(t.actor.system.level) || 1) > 1);
    if (battle.active) {
      const { s } = buildState(battle);
      const t = s.turn, p = E.prompt(s);
      Object.assign(ctx, {
        showSkip: !["setup", "start", "tactics", "over"].includes(p.kind),
        canDeclare: !s.outcome && !["setup", "over"].includes(t.phase),
        tacticsWaiting: s.tactics?.phase === "battle" ? s.tactics.placed.filter(tc => tc.state === "hidden" && !["raiseFlag", "setAflame"].includes(tc.key)).length : 0,
      });
    }
    return ctx;
  }
}

setGmRefresh(() => GmPanel.refresh());
// the selection list follows the tokens the GM picks
const refreshSoon = foundry.utils.debounce ? foundry.utils.debounce(() => GmPanel.refresh(), 60) : () => GmPanel.refresh();
Hooks.on("controlToken", () => { if (GmPanel.instance?.rendered) refreshSoon(); });
Hooks.on("updateActor", (actor) => { if (actor.type === "unit" && GmPanel.instance?.rendered) GmPanel.refresh(); });
