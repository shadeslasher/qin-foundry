// Small stat box under a character's token while it's hovered, for observers and owners.
let box = null;
let current = null;

const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");

function canSee(token) {
  const actor = token?.actor;
  if (!actor || actor.type !== "character") return false;
  if (token.document?.hidden && !game.user.isGM) return false;
  return actor.testUserPermission(game.user, "OBSERVER");
}

function place() {
  if (!box || !current) return;
  const t = current;
  const p = canvas.stage.worldTransform.apply({ x: t.x + t.w / 2, y: t.y + t.h });
  box.style.left = `${Math.round(p.x)}px`;
  box.style.top = `${Math.round(p.y + 6)}px`;
}

function draw() {
  const s = current.actor.system;
  const bol = s.bol ?? {};
  box.innerHTML = `
    <div class="qin-th-name">${esc(current.document.name)}</div>
    <div class="qin-th-row"><span>Breath of Life</span><b>${bol.remaining ?? 0} / ${bol.total ?? 0}</b></div>
    <div class="qin-th-row"><span>Passive Defense</span><b>${s.passiveDefense ?? 0}</b></div>
    <div class="qin-th-row"><span>Armor</span><b>${s.armor?.protection ?? 0}</b></div>`;
  place();
}

export function hideTokenHover() {
  box?.remove();
  box = null;
  current = null;
}

export function onHoverToken(token, hovered) {
  if (!hovered) { if (current === token) hideTokenHover(); return; }
  hideTokenHover();
  if (!canSee(token)) return;
  current = token;
  box = document.createElement("div");
  box.className = "qin qin-token-hover";
  document.body.append(box);
  draw();
}

/** Keep the numbers fresh if the character changes while hovered. */
export function onActorChanged(actor) {
  if (box && current?.actor && (current.actor === actor || current.actor.id === actor.id)) draw();
}

export function registerTokenHover() {
  Hooks.on("hoverToken", onHoverToken);
  Hooks.on("updateActor", onActorChanged);
  Hooks.on("updateItem", (item) => item.parent && onActorChanged(item.parent));
  Hooks.on("canvasPan", () => place());
  for (const h of ["updateToken", "deleteToken", "controlToken", "canvasTearDown"]) Hooks.on(h, () => hideTokenHover());
}
