// Battle unit details for everyone at the table: the hover tooltip, a movement preview while hovering,
// and a read-only "Info" window (portrait, stats, officer, formations, traits).
import * as E from "./battle/engine.mjs";
import { getBattle, buildState, emptyBattle } from "./battle/adapter.mjs";
import { formationSummary } from "./sheets/sheets.mjs";
import { factionOf } from "./factions.mjs";
import { SKILLS } from "./config.mjs";
import { healthColor, moraleColor, SIDE_COLORS } from "./unit-bars.mjs";

const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");

/** Can this user see the unit at all (hidden tokens stay secret from players)? */
export function unitVisible(token) {
  return token?.actor?.type === "unit" && !(token.document?.hidden && !game.user.isGM);
}

function rangeText(sys) {
  if (!(sys.range > 1)) return "";
  const lo = Math.min(sys.rangeMin || 1, sys.range);
  return lo > 1 ? `${lo}–${sys.range}` : `${sys.range}`;
}

/** Every unit shows its weapon; ranged units add their range. */
function weaponLine(sys) {
  const r = rangeText(sys);
  const weapon = esc(sys.unitType || (r ? "Ranged" : "Melee"));
  return r ? `${weapon} · Range ${r}` : weapon;
}

/** Officer actor for a unit (world actors resolve synchronously). */
function officerOf(sys) {
  try { return sys.officerActor ?? null; } catch { return null; }
}

/* ------------------------------------------------------------ hover tooltip */

const hex = (n) => "#" + Number(n).toString(16).padStart(6, "0");

export function unitTooltipHTML(token) {
  const sys = token.actor.system, officer = officerOf(sys);
  const unitName = token.document.name;
  const fac = factionOf(sys.faction);
  // the faction name is left out when it just repeats the officer's name (Sun Jian's army, led by Sun Jian)
  const facName = fac && !(officer && fac.name.toLowerCase() === officer.name.toLowerCase()) ? fac.name : "";
  const men = sys.men?.value ?? 0, max = sys.men?.max || 100, morale = sys.morale ?? 0;
  const pct = (v) => Math.max(0, Math.min(100, v));
  let html = `<div class="qin-tt" style="--qin-side:${hex(SIDE_COLORS[sys.side] ?? 0x888888)}">`;
  if (officer) {
    const title = officer.system?.details?.title;
    if (title) html += `<div class="qin-tt-title">${esc(title)}</div>`;
    html += `<div class="qin-tt-name">${esc(officer.name)}</div>`;
    html += `<div class="qin-tt-sub">${esc(unitName)} <em>· Tier ${sys.tier}${facName ? ` · ${esc(facName)}` : ""}</em></div>`;
  } else {
    html += `<div class="qin-tt-name">${esc(unitName)}</div>`;
    html += `<div class="qin-tt-sub"><em>Tier ${sys.tier}${facName ? ` · ${esc(facName)}` : ""}</em></div>`;
  }
  if (sys.hidden) html += `<div class="qin-tt-sub"><i class="fa-solid fa-eye-slash"></i> Hidden</div>`;
  html += `<div class="qin-tt-bl"><span>Health</span><span>${men} / ${max}</span></div>
    <div class="qin-tt-bar"><i style="width:${pct((100 * men) / max)}%;background:${hex(healthColor(men / max))}"></i></div>
    <div class="qin-tt-bl"><span>Morale</span><span>${morale}${sys.moraleState ? ` · ${esc(sys.moraleState)}` : ""}</span></div>
    <div class="qin-tt-bar"><i style="width:${pct(morale)}%;background:${hex(moraleColor(morale))}"></i></div>
    <div class="qin-tt-stats"><span>Dmg <b>${sys.damage ?? 0}</b></span><span>Arm <b>${sys.armor ?? 0}</b></span><span>Pen <b>${sys.armorPen ?? 0}</b></span><span>Mov <b>${sys.move ?? 0}</b></span></div>`;
  const w = weaponLine(sys);
  if (w) html += `<div class="qin-tt-weapon">${w}</div>`;
  return html + `</div>`;
}

/* ------------------------------------------------------------ hover movement preview */

let preview = null;
let pickingCheck = () => false;
export function setPickingCheck(fn) { pickingCheck = fn; }

export function clearMovePreview() {
  if (preview && !preview.destroyed) preview.destroy();
  preview = null;
}

/** Normal (non-forced-march) movement range of the hovered unit: orange-red for enemies, green otherwise. */
export function showMovePreview(token) {
  clearMovePreview();
  if (!canvas?.ready || !unitVisible(token) || pickingCheck()) return;
  let battle = getBattle();
  if (!battle.active || battle.sceneId !== canvas.scene?.id) battle = { ...emptyBattle(), sceneId: canvas.scene?.id };
  let s;
  try { ({ s } = buildState(battle, { terrainFor: token.id })); } catch (e) { return console.warn("Qin | move preview", e); }
  const u = E.unitById(s, token.id);
  if (!u || u.status !== "active") return;
  const move = E.movementOf(s, u);
  if (!move) return;
  const tiles = E.reachable(s, u, move);
  const size = canvas.scene.grid.size, color = token.actor.system.side === "enemy" ? 0xff5a24 : 0x3fbf5f;
  const g = new PIXI.Graphics();
  g.eventMode = "none";
  for (const k of tiles.keys()) {
    const [x, y] = k.split(",").map(Number);
    g.lineStyle(2, color, 0.75).beginFill(color, 0.22).drawRect(x * size + 3, y * size + 3, size - 6, size - 6).endFill();
  }
  (canvas.interface ?? canvas.controls ?? canvas.stage).addChild(g);
  preview = g;
}

/* ------------------------------------------------------------ officer sheet, view only */

/** Open an officer's character sheet read-only, even for players without permission to see it. */
export async function openOfficerView(uuidOrActor) {
  const officer = typeof uuidOrActor === "string" ? await fromUuid(uuidOrActor) : uuidOrActor;
  if (!officer) return ui.notifications.warn("That officer can't be found.");
  if (officer.testUserPermission(game.user, "OBSERVER")) return officer.sheet.render(true);
  const Cls = officer.sheet?.constructor;
  if (!Cls) return;
  const sheet = new Cls({
    document: officer, id: `qin-officer-view-${officer.id}`, viewPermission: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE,
    window: { title: `${officer.name} (view only)` },
  });
  return sheet.render({ force: true });
}

/* ------------------------------------------------------------ the Info window */

function traitsHTML(raw) {
  const d = document.createElement("div");
  d.innerHTML = String(raw ?? "").replace(/<\/(p|div|li)>|<br\s*\/?>/gi, "\n");
  const lines = d.textContent.split(/\n+/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return `<p class="qin-muted">No traits.</p>`;
  return `<ul class="qin-ui-traits">${lines.map(l => {
    const m = l.match(/^(.+?)\s+[-–]\s+(.+)$/);
    return m ? `<li><b>${esc(m[1])}</b> <span>${esc(m[2])}</span></li>` : `<li><b>${esc(l)}</b></li>`;
  }).join("")}</ul>`;
}

const Base = foundry.applications.api.ApplicationV2;

export class UnitInfoApp extends Base {
  static DEFAULT_OPTIONS = {
    classes: ["qin", "qin-unit-info"],
    window: { resizable: true, icon: "fa-solid fa-chess-rook" },
    position: { width: 560, height: "auto" },
  };

  constructor(token, options = {}) {
    super({ id: `qin-unit-info-${token.id}`, ...options });
    this.token = token;
  }

  get title() { return this.token?.document?.name ?? "Unit"; }

  async _renderHTML() {
    const tok = this.token, actor = tok.actor, sys = actor.system;
    const officer = officerOf(sys);
    const faction = factionOf(sys.faction);
    const forms = actor.items.filter(i => i.type === "formation").sort((a, b) => (a.sort || 0) - (b.sort || 0));
    const stat = (k, v, sub = "") => `<div class="qin-ui-stat"><span>${k}</span><b>${v}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</div>`;
    const menPct = Math.max(0, Math.min(100, Math.round(100 * sys.men.value / (sys.men.max || 100))));
    const w = weaponLine(sys);
    const sideLabel = { player: "Player", enemy: "Enemy", ally: "Ally", neutral: "Neutral" }[sys.side] ?? sys.side;
    const skill = SKILLS[sys.weaponSkill]?.label ?? sys.weaponSkill;
    return `<div class="qin-ui">
      <header class="qin-ui-head">
        <img class="qin-ui-portrait" src="${esc(actor.img)}" alt="">
        <div class="qin-ui-id">
          <h2>${esc(tok.document.name)}</h2>
          <div class="qin-ui-sub">Tier ${sys.tier} · Level ${sys.level ?? 1}${sys.unitType ? ` · ${esc(sys.unitType)}` : ""}${sys.category ? ` · ${esc(sys.category[0].toUpperCase() + sys.category.slice(1))}` : ""}</div>
          <div class="qin-ui-sub"><span class="qin-ui-side ${esc(sys.side)}">${esc(sideLabel)}</span>${faction ? ` ${faction.img ? `<img class="qin-ui-flag" src="${esc(faction.img)}" alt="">` : ""}${esc(faction.name)}` : ""}</div>
          <div class="qin-ui-bars">
            <div><span>Health</span><div class="qin-bar"><i style="width:${menPct}%"></i></div><b>${sys.men.value} / ${sys.men.max}</b></div>
            <div><span>Morale</span><div class="qin-bar morale"><i style="width:${Math.max(0, Math.min(100, sys.morale))}%"></i></div><b>${sys.morale} <small>${esc(sys.moraleState ?? "")}</small></b></div>
          </div>
        </div>
      </header>
      <section class="qin-ui-stats">
        ${stat("Damage", sys.damage ?? 0)}${stat("Armor", sys.armor ?? 0, sys.armorNote)}${stat("Armor Pen", sys.armorPen ?? 0)}
        ${stat("Movement", sys.move ?? 0)}${stat("Range", rangeText(sys) || "Melee")}${stat("Unit Value", sys.unitValue ?? 0)}
      </section>
      <section><h3>Officer</h3>${officer ? `
        <a class="qin-ui-officer" data-officer="${esc(officer.uuid)}" title="View ${esc(officer.name)}'s sheet">
          <img src="${esc(officer.img)}" alt="">
          <div>${officer.system?.details?.title ? `<div class="gold">${esc(officer.system.details.title)}</div>` : ""}<b>${esc(officer.name)}</b>
          <div class="qin-muted">Fights with ${esc(skill)} · click to view sheet</div></div>
        </a>` : `<p class="qin-muted">No officer. The unit rolls with Command, Fire and Skill at 0.</p>`}
      </section>
      <section><h3>Formations</h3>${forms.length ? `<ul class="qin-ui-forms">${forms.map(f => {
        const sum = formationSummary(f.system);
        const active = sys.formation === f.id;
        return `<li class="${active ? "active" : ""}"><div><b>${esc(f.name)}</b>${active ? ` <span class="qin-tag">in use</span>` : ""}</div>${sum ? `<div class="qin-ui-fx">${esc(sum)}</div>` : ""}</li>`;
      }).join("")}</ul>` : `<p class="qin-muted">No formations known.</p>`}</section>
      <section><h3>Traits</h3>${traitsHTML(sys.traits)}</section>
    </div>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
    content.querySelector("[data-officer]")?.addEventListener("click", (ev) => { ev.preventDefault(); openOfficerView(ev.currentTarget.dataset.officer); });
  }
}

export function openUnitInfo(token) {
  if (!unitVisible(token)) return;
  const id = `qin-unit-info-${token.id}`;
  const open = foundry.applications.instances?.get(id);
  if (open) { open.token = token; return open.render({ force: true }); }
  return new UnitInfoApp(token).render({ force: true });
}

/** Keep open Info windows current when the unit changes. */
export function registerUnitInfo() {
  const refresh = (actor) => {
    for (const app of foundry.applications.instances?.values() ?? []) {
      if (app instanceof UnitInfoApp && (app.token?.actor === actor || app.token?.actor?.id === actor?.id)) app.render();
    }
  };
  Hooks.on("updateActor", refresh);
  Hooks.on("createItem", (i) => refresh(i.parent));
  Hooks.on("updateItem", (i) => refresh(i.parent));
  Hooks.on("deleteItem", (i) => refresh(i.parent));
  Hooks.on("hoverToken", (token, hovered) => { if (hovered) showMovePreview(token); else clearMovePreview(); });
  for (const h of ["updateToken", "deleteToken", "canvasTearDown"]) Hooks.on(h, () => clearMovePreview());
}
