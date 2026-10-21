// Small stat box under a character's token while it's hovered, for observers and owners.
let box = null;
let current = null;

const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");

/** "stats" = observers/owners of a character or henchman; "title" = anyone, for characters with a title. */
function canSee(token) {
  const actor = token?.actor;
  if (!actor || !["character", "henchman"].includes(actor.type)) return null;
  if (token.document?.hidden && !game.user.isGM) return null;
  if (actor.testUserPermission(game.user, "OBSERVER")) return "stats";
  return actor.type === "character" && actor.system.details?.title ? "title" : null;
}
let level = null;

function place() {
  if (!box || !current) return;
  const t = current;
  const p = canvas.stage.worldTransform.apply({ x: t.x + t.w / 2, y: t.y + t.h });
  box.style.left = `${Math.round(p.x)}px`;
  box.style.top = `${Math.round(p.y + 6)}px`;
}

function draw() {
  const actor = current.actor, s = actor.system;
  const title = actor.type === "character" ? s.details?.title : "";
  let html = `<div class="qin-th-name">${esc(current.document.name)}</div>`;
  if (title) html += `<div class="qin-th-title">${esc(title)}</div>`;
  if (level === "stats") {
    const row = (k, v) => `<div class="qin-th-row"><span>${k}</span><b>${v}</b></div>`;
    if (actor.type === "character") {
      const bol = s.bol ?? {};
      html += row("Breath of Life", `${bol.remaining ?? 0} / ${bol.total ?? 0}`);
    } else {
      const hp = s.hp ?? { value: 0, max: 0 };
      const pips = Array.from({ length: hp.max }, (_, i) => `<i class="qin-th-pip ${i < hp.value ? "full" : ""}"></i>`).join("");
      html += `<div class="qin-th-row"><span>Health</span><b>${pips} ${hp.value} / ${hp.max}</b></div>`;
    }
    html += row("Armor", s.armor?.protection ?? 0) + row("Passive Defense", s.passiveDefense ?? 0);
    if (actor.type === "henchman") html += row("Resistance", s.resistance ?? 0);
  }
  box.innerHTML = html;
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
  level = canSee(token);
  if (!level) return;
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
