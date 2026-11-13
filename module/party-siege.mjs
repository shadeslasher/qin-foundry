// The Party panel's Siege tab (David, 2026-11-13; mockup approved the same day). Each player's siege equipment stock
// (ladders, siege engines, catapults; at most their max unit count in all), and during deployment, once the GM allows
// it, who carries what and where the catapults stand. Rules in battle/siege-deploy.mjs.
import { getBattle } from "./battle/adapter.mjs";
import { SIEGE_KINDS, SIEGE_LABEL, stockTotal } from "./battle/siege-deploy.mjs";
import { getStock, setStock, stockCap, stockHolder } from "./siege-stock.mjs";

const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const ICON = { ladders: "fa-solid fa-stairs", engine: "fa-solid fa-truck-monster", catapult: "fa-solid fa-dungeon" };

/** The token of a party unit on the battle scene (or null). */
function battleToken(battle, actor) {
  const sc = battle.active ? game.scenes.get(battle.sceneId) : null;
  return sc?.tokens.find(t => t.actorId === actor.id && t.actor?.type === "unit") ?? null;
}

/** What a player has out: carried by their units, catapults standing. */
function inUse(battle, group) {
  const n = { ladders: 0, engine: 0, catapult: 0 };
  if (!battle.active) return n;
  for (const a of group.units) { const t = battleToken(battle, a), c = t && battle.meta?.[t.id]?.carry; if (c === "ladders" || c === "engine") n[c]++; }
  for (const c of battle.siege?.catapults ?? []) if (c.owner === group.user.id && !battle.siege?.burnt?.[c.x + "," + c.y]) n.catapult++;
  return n;
}

/** A small icon on the Units tab for a unit carrying ladders or an engine in the battle. */
export function carryTag(actor) {
  const b = getBattle(); if (!b.active) return "";
  const t = battleToken(b, actor), c = t && b.meta?.[t.id]?.carry;
  return c === "ladders" || c === "engine" ? ` <i class="${ICON[c]} qin-sg-carry" data-tooltip="Carrying ${c === "ladders" ? "siege ladders" : "a siege engine"}"></i>` : "";
}

export function siegeTabHTML(groups, gm) {
  const b = getBattle(), deploying = b.active && b.turn?.phase === "tactics", allowed = deploying && !!b.siegeDeploy, fighting = b.active && !deploying && b.turn?.phase !== "setup";
  const banner = allowed
    ? `<div class="qin-sg-ban on"><i class="fa-solid fa-circle-check"></i><span>Deployment · siege equipment allowed. Hand out ladders and engines, and place catapults in your deployment zone.</span>${gm ? `<button type="button" data-action="siegeAllow" data-on="false">Lock</button>` : ""}</div>`
    : deploying
      ? `<div class="qin-sg-ban"><i class="fa-solid fa-hourglass-half"></i><span>Deployment · ${gm ? "siege equipment is locked." : "waiting for the GM to allow siege equipment."}</span>${gm ? `<button type="button" data-action="siegeAllow" data-on="true"><i class="fa-solid fa-unlock"></i> Allow siege equipment</button>` : ""}</div>`
      : `<div class="qin-sg-ban"><i class="fa-solid fa-circle-info"></i><span>${fighting ? "The battle is on: siege equipment stays where it was handed out. After it, only what was used is lost." : "Siege equipment is handed out during deployment, once the GM allows it. Buy more at a city's Siege Workshop."}</span></div>`;
  const card = (g) => {
    const u = g.user, mine = u.id === game.user.id, edit = (gm || mine), pc = stockHolder(u);
    const st = getStock(u), cap = stockCap(u), used = inUse(b, g), total = stockTotal(st);
    const capTxt = cap != null ? `${total} / ${cap} siege equipment <span class="qin-muted">(max units)</span>` : `${total} siege equipment`;
    const tile = (k) => {
      const out = used[k], note = k === "catapult" ? `${out} placed` : `${out} handed out`;
      return `<div class="qin-sg-stock"><i class="${ICON[k]}"></i><b>${st[k]}</b><span>${esc(SIEGE_LABEL[k])}<small>${b.active ? note : "in stock"}</small></span>
        ${gm && pc ? `<span class="qin-sg-adj"><a data-action="siegeStock" data-id="${u.id}" data-kind="${k}" data-n="1" data-tooltip="Add one"><i class="fa-solid fa-plus"></i></a><a data-action="siegeStock" data-id="${u.id}" data-kind="${k}" data-n="-1" data-tooltip="Take one away"><i class="fa-solid fa-minus"></i></a></span>` : ""}</div>`;
    };
    let rows = "";
    if (b.active) {
      for (const a of g.units) {
        const t = battleToken(b, a);
        if (!t) continue;
        const cur = b.meta?.[t.id]?.carry ?? null, cav = (a.system.category ?? "") === "cavalry", can = allowed && edit;
        const opt = (k, label) => {
          const on = (cur || null) === k, out = k && !on && used[k] >= st[k];
          const why = !k ? "" : cav ? "Cavalry can't carry siege equipment" : out ? (st[k] ? `All ${u.name === game.user.name ? "your" : "the"} ${label.toLowerCase()} are handed out` : `No ${label.toLowerCase()} in stock`) : "";
          const off = !on && (!can || (k && (cav || out)));
          return `<button type="button" class="${on ? "on" : ""}" ${off ? "disabled" : ""} data-action="siegeAssign" data-token="${t.id}" data-kind="${k ?? ""}" ${why ? `data-tooltip="${esc(why)}"` : ""}>${esc(label)}</button>`;
        };
        rows += `<div class="qin-sg-row"><img src="${esc(a.img)}" alt=""><span class="qin-sg-nm">${esc(a.name)}<small>T${esc(a.system.tier ?? 1)} · ${esc(a.system.unitType ?? a.system.category ?? "")}</small></span>
          <span class="qin-sg-seg">${opt(null, "None")}${opt("ladders", "Ladders")}${opt("engine", "Engine")}</span></div>`;
      }
      if (!rows) rows = `<div class="qin-muted qin-sg-none">None of ${esc(u.name)}'s units are on the battlefield.</div>`;
      const cats = (b.siege?.catapults ?? []).filter(c => c.owner === u.id);
      const left = st.catapult - used.catapult;
      rows += `<div class="qin-sg-row cat"><i class="${ICON.catapult}"></i><span class="qin-sg-nm">Catapults<small>${left > 0 ? `${left} to place · click, then click a square in ${mine ? "your" : "the"} deployment zone` : st.catapult ? "All placed" : "None in stock"}</small></span>
        ${allowed && edit && left > 0 ? `<button type="button" class="qin-sg-place" data-action="siegeCatapult" data-id="${u.id}"><i class="fa-solid fa-location-crosshairs"></i> Place catapult</button>` : ""}</div>`
        + cats.map(c => { const burnt = !!b.siege?.burnt?.[c.x + "," + c.y];
          return `<div class="qin-sg-row sub"><span class="qin-sg-nm">Catapult at ${c.x + 1}, ${c.y + 1}${burnt ? ` <span class="qin-sg-burnt">burned</span>` : ""}</span>
            <a data-action="siegePing" data-x="${c.x}" data-y="${c.y}" data-tooltip="Show it on the map"><i class="fa-solid fa-eye"></i></a>
            ${allowed && edit ? `<button type="button" data-action="siegeTakeDown" data-x="${c.x}" data-y="${c.y}">Take down</button>` : ""}</div>`; }).join("");
    }
    return `<section class="qin-sg-card"><div class="qin-sg-head"><span class="qin-party-dot" style="background:${esc(u.color?.css ?? u.color ?? "#888")}"></span><b>${esc(u.name)}</b>${pc ? `<span class="qin-muted">${esc(pc.name)}</span>` : `<span class="qin-muted">no character (stock needs one)</span>`}<span class="qin-sg-cap">${capTxt}</span></div>
      <div class="qin-sg-stocks">${SIEGE_KINDS.map(tile).join("")}</div>${rows}</section>`;
  };
  return `<div class="qin-sg">${banner}${groups.map(card).join("") || `<p class="qin-muted">There are no player accounts yet.</p>`}</div>`;
}

export const siegeActions = {
  siegeAllow: async (ev, el) => { const { battleRequest } = await import("./battle/battle.mjs"); await battleRequest({ type: "allowSiege", on: el.dataset.on === "true" }); },
  siegeAssign: async (ev, el) => { const { battleRequest } = await import("./battle/battle.mjs"); await battleRequest({ type: "assignSiege", unitId: el.dataset.token, kind: el.dataset.kind || null }); },
  siegeCatapult: async (ev, el) => { (await import("./battle/catapult-place.mjs")).startCatapultPlacement(el.dataset.id); },
  siegeTakeDown: async (ev, el) => { const { battleRequest } = await import("./battle/battle.mjs"); await battleRequest({ type: "removeCatapult", x: Number(el.dataset.x), y: Number(el.dataset.y) }); },
  siegePing: (ev, el) => { const s = canvas?.grid?.size; if (!canvas?.ready || !s) return; const p = { x: (Number(el.dataset.x) + 0.5) * s, y: (Number(el.dataset.y) + 0.5) * s }; canvas.ping?.(p); canvas.animatePan?.({ ...p, duration: 400 }); },
  siegeStock: async (ev, el) => { // GM: add or take away one piece of a player's stock
    if (!game.user.isGM) return;
    const user = game.users.get(el.dataset.id), k = el.dataset.kind, n = Number(el.dataset.n);
    const st = getStock(user); st[k] = Math.max(0, st[k] + n);
    const cap = stockCap(user);
    if (n > 0 && cap != null && stockTotal(st) > cap) ui.notifications.warn(`${user.name} now has more siege equipment than their max unit count (${cap}).`);
    await setStock(user, st);
  },
};
