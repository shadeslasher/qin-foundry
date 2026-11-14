// The Troops window (David, 2026-11-12): opened from a city's "Troops" item on the world map; two tabs, Recruit and
// Promote, showing the same panels as the Recruit and Promote windows. Each tab is drawn by a hidden Recruit / Promote
// app whose buttons are routed here, so both stay the single source of their rules and layout.
import { RecruitApp } from "./recruit.mjs";
import { PromoteApp } from "./promote.mjs";
import { attachUnitHover, hideUnitHover } from "./unit-hover.mjs";
import { budgetOf } from "./budget.mjs";
import { partyGroups } from "./party.mjs";

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
    // the units this player already has, as small boxes (David, 2026-11-13, option A)
    const esc2 = (t) => foundry.utils.escapeHTML?.(String(t ?? "")) ?? String(t ?? "");
    const units = partyGroups().find(g => g.user.id === this.userId)?.units ?? [];
    let c = null; try { c = game.modules.get("rtk13-map")?.api?.commandLimit?.(game.users.get(this.userId)) ?? null; } catch { }
    const box = (a) => { const s = a.system, m = s.men ?? {}, pct = m.max ? Math.max(0, Math.min(100, Math.round(100 * (m.value ?? 0) / m.max))) : 0;
      return `<a class="qin-tr-unit ${s.status && s.status !== "active" ? "down" : ""}" data-troops-sheet="${a.id}" data-tooltip="${esc2(a.name)} · ${m.value ?? "?"}/${m.max ?? "?"} men · morale ${s.morale ?? "?"}${s.status && s.status !== "active" ? ` · ${esc2(s.status)}` : ""}">
        <img src="${esc2(a.img)}" alt=""><span class="n">${esc2(a.name)}</span><span class="t">T${s.tier ?? "?"} · Lv${s.level ?? 1}</span><span class="hb"><span style="width:${pct}%"></span></span></a>`; };
    const mine = `<div class="qin-tr-units"><div class="cap">${this.userId === game.user.id ? "Your units" : `${esc2(game.users.get(this.userId)?.name ?? "")}'s units`}</div>
      <div class="strip">${units.map(box).join("") || `<span class="qin-muted">No units yet.</span>`}</div>
      ${c && c.limit && c.used >= c.limit ? `<div class="full">Command full: promote or disband a unit to make room.</div>` : ""}</div>`;
    const at = body.indexOf('<div class="qin-pr-head">'), end = at >= 0 ? body.indexOf("</div>", at) + 6 : -1;
    const withUnits = end > 5 ? body.slice(0, end) + mine + body.slice(end) : mine + body;
    return `${who}${tabs}<div class="qin-tr-body">${withUnits}</div>`;
  }
  _replaceHTML(result, content) {
    hideUnitHover();
    content.innerHTML = result;
    attachUnitHover(content);
    content.querySelectorAll("[data-troops-sheet]").forEach(a => a.addEventListener("click", () => game.actors.get(a.dataset.troopsSheet)?.sheet?.render(true)));
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
