// Whose turn it is: a banner at the top centre of the screen while a battle runs on this scene (style B: a band in
// the side's colour, the officer's portrait, "Your turn" / "Bob's turn" / "Enemy turn", and the round).
import { getBattle, buildState } from "./adapter.mjs";
import * as E from "./engine.mjs";

const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");
const SIDE_RGB = { player: "58,120,200", ally: "63,166,106", enemy: "200,68,58", neutral: "184,150,40" };
const SIDE_TURN = { enemy: "Enemy turn", ally: "Ally turn", neutral: "Neutral turn", player: "Player turn" };
let el = null;

function hide() { el?.remove(); el = null; }

/** The banner's content for this user, or null when there's nothing to show. Exported for tests. */
export function bannerFor(s, p, { me, isGM, names = {}, img = () => null, canSee = () => true, officerName = () => "" }) {
  const round = s.turn?.round ?? 0;
  const mine = (u) => u && (u.owner === me || (isGM && !u.owner));
  switch (p.kind) {
    case "tactics": return { side: "neutral", title: "Tactics", sub: "Tacticians place their tactics · players deploy their units", round };
    case "formations": return { side: "neutral", title: "Next round", sub: "Waiting for the GM to start the round", round: null };
    case "claim": return { side: "player", title: "Player side", sub: "Units without an officer: the first to press Take turn moves", round };
    case "pick": return { side: "player", title: p.player === me ? "Your turn" : `${names[p.player] ?? "The GM"}'s turn`, sub: "Choosing a unit without an officer", round };
    case "host-pick": return { side: p.side, title: SIDE_TURN[p.side] ?? "GM's turn", sub: "Units without an officer", round };
    case "decide": case "final": case "activation": {
      const u = E.unitById(s, p.unitId); if (!u) return null;
      if (!canSee(u)) return { side: u.side, title: SIDE_TURN[u.side] ?? "Turn", sub: "", round };
      const title = mine(u) ? "Your turn" : u.side === "player" && u.owner ? `${names[u.owner] ?? "A player"}'s turn` : SIDE_TURN[u.side] ?? "Turn";
      const off = officerName(u);
      const what = p.kind === "decide" ? " · act or hold?" : p.kind === "final" ? " · act now or give up the turn" : "";
      return { side: u.side, title, sub: `${u.name}${off ? ` · led by ${off}` : ""}${what}`, img: img(u), round };
    }
  }
  return null;
}

export function renderTurnBanner() {
  const b = getBattle(), scene = canvas?.scene;
  if (!scene || !b.active || b.sceneId !== scene.id || ["setup", "over"].includes(b.turn?.phase)) return hide();
  let s, p;
  try { ({ s } = buildState(b)); p = E.prompt(s); } catch { return hide(); }
  const tok = (id) => scene.tokens.get(id);
  const info = bannerFor(s, p, {
    me: game.user.isGM ? "host" : game.user.id, isGM: game.user.isGM,
    names: Object.fromEntries(game.users.map(u => [u.id, u.name])),
    canSee: (u) => game.user.isGM || !tok(u.id)?.hidden,
    officerName: (u) => { try { return u.officerId ? fromUuidSync(u.officerId)?.name ?? "" : ""; } catch { return ""; } },
    img: (u) => { try { const o = u.officerId ? fromUuidSync(u.officerId) : null; return o?.img ?? tok(u.id)?.actor?.img ?? null; } catch { return null; } },
  });
  if (!info) return hide();
  const key = JSON.stringify(info);
  if (el?.dataset.key === key) return;
  if (!el) { el = document.createElement("div"); el.id = "qin-turn-banner"; document.body.appendChild(el); }
  el.dataset.key = key;
  el.className = "qin-turn-banner";
  el.style.setProperty("--c", SIDE_RGB[info.side] ?? SIDE_RGB.neutral);
  el.innerHTML = `${info.img ? `<img src="${esc(info.img)}" alt="">` : `<span class="qin-tb-none"><i class="fa-solid fa-${info.title === "Tactics" ? "chess-knight" : "flag"}"></i></span>`}
    <div><div class="qin-tb-title">${esc(info.title)}</div>${info.sub ? `<div class="qin-tb-sub">${esc(info.sub)}</div>` : ""}</div>
    ${info.round ? `<div class="qin-tb-round">ROUND<big>${info.round}</big></div>` : "<div></div>"}`;
  el.classList.remove("qin-tb-in"); void el.offsetWidth; el.classList.add("qin-tb-in");
}

export function registerTurnBanner() {
  Hooks.on("canvasReady", () => renderTurnBanner());
  Hooks.on("updateToken", (doc, change) => { if ("hidden" in change) renderTurnBanner(); });
}
