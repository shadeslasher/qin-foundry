// Unit cards in windows (Recruit, Promote): hovering a unit's picture or name shows its stat card (the same card as the
// map's token hover), and clicking opens its full unit sheet (David, 2026-11-12). Elements carry data-unit-uuid.
import { unitTooltipHTML } from "./unit-info.mjs";

let box = null;
const cache = new Map();
async function actorOf(uuid) {
  if (!cache.has(uuid)) cache.set(uuid, fromUuid(uuid).catch(() => null));
  return cache.get(uuid);
}

function hide() { box?.remove(); box = null; }
async function show(el) {
  const uuid = el.dataset.unitUuid, actor = await actorOf(uuid);
  if (!actor || !el.matches(":hover")) return;
  hide();
  box = document.createElement("div");
  box.className = "qin qin-token-hover qin-tt-box qin-unit-hover";
  // a token-shaped stand-in: the card reads the actor, the name and (in a battle) the token's effects
  box.innerHTML = unitTooltipHTML({ actor, document: { name: actor.name }, id: null });
  document.body.append(box);
  const r = el.getBoundingClientRect(), w = box.offsetWidth, h = box.offsetHeight;
  let left = r.right + 10, top = r.top - 4;
  if (left + w > window.innerWidth - 8) left = Math.max(8, r.left - w - 10);
  if (top + h > window.innerHeight - 8) top = Math.max(8, window.innerHeight - h - 8);
  Object.assign(box.style, { left: `${left}px`, top: `${top}px` });
}

/** Wire every [data-unit-uuid] inside root: hover = stat card, click = unit sheet. */
export function attachUnitHover(root) {
  for (const el of root.querySelectorAll("[data-unit-uuid]")) {
    el.addEventListener("mouseenter", () => show(el));
    el.addEventListener("mouseleave", hide);
    el.addEventListener("click", async (ev) => {
      ev.preventDefault(); ev.stopPropagation(); hide();
      const a = await actorOf(el.dataset.unitUuid);
      a?.sheet?.render(true);
    });
  }
}
export const hideUnitHover = hide;
