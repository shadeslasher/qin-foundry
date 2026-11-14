// The Troops window (David, 2026-11-12): opened from a city's "Troops" item on the world map; two tabs, Recruit and
// Promote, showing the same panels as the Recruit and Promote windows. Each tab is drawn by a hidden Recruit / Promote
// app whose buttons are routed here, so both stay the single source of their rules and layout.
import { RecruitApp } from "./recruit.mjs";
import { PromoteApp } from "./promote.mjs";
import { attachUnitHover, hideUnitHover } from "./unit-hover.mjs";
import { budgetOf } from "./budget.mjs";

export class TroopsApp extends foundry.applications.api.ApplicationV2 {
  static #open = new Map();
  static DEFAULT_OPTIONS = {
    classes: ["qin", "qin-recruit", "qin-promote", "qin-troops"],
    window: { title: "Troops", icon: "fa-solid fa-people-group", resizable: true },
    position: { width: 480, height: 660 },
  };
  /** The players the GM can switch between: everyone with a character. */
  static players() { return game.users.filter(u => !u.isGM && u.character).sort((a, b) => a.name.localeCompare(b.name)); }
  /** The GM gets one window with a player switcher (David, 2026-11-13); a player gets their own. */
  static open(userId = null, tab = "recruit") {
    const gm = game.user.isGM, key = gm ? "gm" : game.user.id;
    userId ??= gm ? (this.#open.get("gm")?.userId ?? this.players()[0]?.id ?? game.user.id) : game.user.id;
    let app = this.#open.get(key);
    if (!app) { app = new TroopsApp({ id: `qin-troops-${key}` }); this.#open.set(key, app); }
    if (app.userId !== userId) app.switchTo(userId);
    app.tab = tab;
    app.render({ force: true });
    return app;
  }
  static refreshAll() { for (const app of this.#open.values()) if (app.rendered) app.render(); }
  get title() { return game.user.isGM ? "Troops" : `Troops: ${game.users.get(this.userId)?.name ?? ""}`; }
  switchTo(userId) { this.userId = userId; this.rec = null; this.pro = null; }

  /** The hidden panel apps: never rendered themselves; their re-renders redraw this window. */
  #panel(kind) {
    const key = kind === "promote" ? "pro" : "rec";
    if (!this[key]) {
      const Cls = kind === "promote" ? PromoteApp : RecruitApp;
      const p = new Cls({ id: `qin-troops-${kind}-${this.userId}` });
      p.userId = this.userId;
      p.render = () => this.render();
      this[key] = p;
    }
    return this[key];
  }
  async _renderHTML() {
    this.tab ??= "recruit";
    const panel = this.#panel(this.tab), body = await panel._renderHTML();
    const tabs = `<nav class="qin-tr-tabs">${[["recruit", "Recruit", "fa-user-plus"], ["promote", "Promote", "fa-angles-up"]].map(([k, l, i]) =>
      `<a class="${k === this.tab ? "on" : ""}" data-troops-tab="${k}"><i class="fa-solid ${i}"></i> ${l}</a>`).join("")}</nav>`;
    let who = "";
    if (game.user.isGM) {
      const esc = (t) => foundry.utils.escapeHTML?.(String(t ?? "")) ?? String(t ?? "");
      const cmd = (u) => { try { return game.modules.get("rtk13-map")?.api?.commandLimit?.(u) ?? null; } catch { return null; } };
      who = `<div class="qin-tr-players">${TroopsApp.players().map(u => { const c = cmd(u);
        return `<a class="qin-tr-pl ${u.id === this.userId ? "on" : ""}" data-troops-user="${u.id}" data-tooltip="${esc(u.character.name)}">
          <span class="n"><span class="dot" style="background:${esc(u.color?.css ?? u.color ?? "#888")}"></span>${esc(u.name)}</span>
          <span class="s"><i class="fa-solid fa-sack-dollar"></i> ${budgetOf(u.character).toLocaleString()}${c ? ` · ${c.used}/${c.limit}` : ""}</span></a>`; }).join("")
        || `<span class="qin-muted">No players have a character yet.</span>`}</div>`;
    }
    return `${who}${tabs}<div class="qin-tr-body">${body}</div>`;
  }
  _replaceHTML(result, content) {
    hideUnitHover();
    content.innerHTML = result;
    attachUnitHover(content);
    content.querySelectorAll("[data-troops-user]").forEach(a => a.addEventListener("click", () => { this.switchTo(a.dataset.troopsUser); this.render(); }));
    content.querySelectorAll("[data-troops-tab]").forEach(a => a.addEventListener("click", () => { this.tab = a.dataset.troopsTab; this.render(); }));
    // route the panel's own buttons (Recruit, tabs, Side-grade / Promote, …) to its handlers
    const panel = this.#panel(this.tab), actions = panel.options.actions ?? {};
    content.querySelectorAll(".qin-tr-body [data-action]").forEach(el => el.addEventListener("click", (ev) => {
      const fn = actions[el.dataset.action]; if (!fn) return;
      ev.preventDefault(); ev.stopPropagation();
      (typeof fn === "function" ? fn : fn.handler)?.call(panel, ev, el);
    }));
  }
  _onClose(options) { hideUnitHover(); super._onClose?.(options); }
}

if (globalThis.Hooks) for (const h of ["updateActor", "createActor", "deleteActor", "updateUser"]) Hooks.on(h, () => TroopsApp.refreshAll());
