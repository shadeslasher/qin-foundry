/**
 * The panel dock (David, 2026-11-13): one drawer at the left of the screen, beside Foundry's scene controls,
 * that opens every custom panel. Folds down to an icon rail (remembered per computer).
 * Other packages add entries with game.qinDock.add({...}) during or after "ready".
 *
 * Entry: { id, section: "campaign"|"battle"|"tools"|"gm", label, icon (Font Awesome classes), order,
 *          key: "namespace.action" (shows the current hotkey), gm: true (GM only), visible(): bool,
 *          onClick(ev), switch(): bool (draws an on/off switch), active(): bool (highlighted while open),
 *          badge(): number|string, warn(): bool (red badge) }
 */
const SYSTEM_ID = "qin";
const SECTIONS = [["campaign", "Campaign"], ["battle", "Battle"], ["tools", "Tools"], ["gm", "GM tools"]];
const entries = new Map();
let el = null, timer = null;

const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const safe = (fn, d) => { try { return fn ? fn() : d; } catch { return d; } };
const collapsed = () => { try { return !!game.settings.get(SYSTEM_ID, "dockCollapsed"); } catch { return false; } };
const shown = () => { try { return game.settings.get(SYSTEM_ID, "dockShown") !== false; } catch { return true; } };

/** "KeyP" → "P", "Digit3" → "3"; with modifiers ("Shift+P"). */
export function keyLabel(binding) {
  if (!binding?.key) return "";
  const SYM = { BracketLeft: "[", BracketRight: "]", Backslash: "\\", Slash: "/", Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Minus: "-", Equal: "=", Backquote: "`" };
  const k = SYM[binding.key] ?? binding.key.replace(/^Key/, "").replace(/^Digit/, "").replace(/^Numpad/, "Num ");
  return [...(binding.modifiers ?? []), k].join("+");
}
function hotkey(e) {
  if (!e.key) return "";
  const [ns, ...rest] = e.key.split(".");
  return keyLabel(safe(() => game.keybindings.get(ns, rest.join("."))?.[0], null));
}

export const dockApi = {
  add(entry) { if (entry?.id) { entries.set(entry.id, entry); schedule(); } },
  remove(id) { entries.delete(id); schedule(); },
  get: (id) => entries.get(id),
  refresh: () => schedule(),
  get element() { return el; },
};

function visibleEntries() {
  return [...entries.values()].filter(e => (!e.gm || game.user.isGM) && safe(e.visible, true) !== false);
}

function schedule() { clearTimeout(timer); timer = setTimeout(render, 30); }

function render() {
  if (!game.ready) return;
  if (!shown()) { el?.remove(); el = null; return; }
  if (!el) {
    el = Object.assign(document.createElement("nav"), { id: "qin-dock" });
    el.addEventListener("click", onClick);
    document.body.appendChild(el);
  }
  const rail = collapsed();
  el.classList.toggle("rail", rail);
  const list = visibleEntries();
  const groups = SECTIONS.map(([id, name]) => [name, list.filter(e => (e.section ?? "tools") === id).sort((a, b) => (a.order ?? 50) - (b.order ?? 50))]).filter(([, l]) => l.length);
  const item = (e) => {
    const k = hotkey(e), on = !!safe(e.switch ?? e.active, false), b = safe(e.badge, 0);
    const tip = `${e.label}${k ? ` (${k})` : ""}`;
    return `<a class="qd-i${on ? " on" : ""}${e.switch ? " sw" : ""}" data-id="${esc(e.id)}"${rail ? ` data-tooltip="${esc(tip)}" data-tooltip-direction="RIGHT"` : ""}>
      <i class="${esc(e.icon)}"></i>${rail ? "" : `<span class="qd-l">${esc(e.label)}</span>`}
      ${b ? `<b class="qd-b${safe(e.warn, false) ? " w" : ""}">${esc(b)}</b>` : ""}
      ${rail ? "" : e.switch ? `<span class="qd-s"></span>` : k ? `<kbd>${esc(k)}</kbd>` : ""}</a>`;
  };
  el.innerHTML = `<div class="qd-h">${rail ? "" : `<span>Command</span>`}<a class="qd-c" data-a="fold" data-tooltip="${rail ? "Show names" : "Fold to icons"}" data-tooltip-direction="RIGHT"><i class="fa-solid fa-angles-${rail ? "right" : "left"}"></i></a></div>
    <div class="qd-body">${groups.map(([name, l], gi) => `${rail ? (gi ? `<div class="qd-sep"></div>` : "") : `<div class="qd-sec">${esc(name)}</div>`}${l.map(item).join("")}`).join("")}</div>`;
  place();
}

/** Beside Foundry's scene controls, under the scene list (Foundry 13+ puts it in the same column),
 *  down to just above the hotbar (or the bottom of the screen). */
function place() {
  if (!el) return;
  const sc = document.getElementById("scene-controls") ?? document.getElementById("controls");
  const r = sc?.getBoundingClientRect();
  const left = r?.width ? Math.round(r.right + 8) : 60;
  let top = r?.height ? Math.round(r.top) : 10;
  const nav = document.querySelector("#scene-navigation .scene-navigation-menu, #scene-navigation #scene-list, #navigation");
  const nb = nav?.getBoundingClientRect();
  if (nb?.height && nb.left < left + 200 && nb.right > left) top = Math.max(top, Math.round(nb.bottom + 8));
  const w = el.offsetWidth || 196;
  let bottom = window.innerHeight - 10;
  for (const id of ["hotbar", "players"]) {
    const b = document.getElementById(id)?.getBoundingClientRect();
    if (b?.height && b.left < left + w && b.right > left && b.top > top + 120) bottom = Math.min(bottom, b.top - 8);
  }
  el.style.left = `${left}px`; el.style.top = `${top}px`; el.style.maxHeight = `${Math.max(120, bottom - top)}px`;
}

async function onClick(ev) {
  const a = ev.target.closest("[data-a], [data-id]");
  if (!a) return;
  ev.preventDefault();
  if (a.dataset.a === "fold") { await game.settings.set(SYSTEM_ID, "dockCollapsed", !collapsed()); return; }
  const e = entries.get(a.dataset.id);
  if (!e) return;
  try { await e.onClick?.(ev); } catch (err) { console.error("Qin | dock", e.id, err); ui.notifications.error(`Couldn't open ${e.label}.`); }
  setTimeout(render, 60); setTimeout(render, 400);
}

/** Light state refresh (open panels, switches, badges) without a full rebuild unless something changed. */
function stateKey() {
  return visibleEntries().map(e => `${e.id}:${safe(e.switch ?? e.active, false) ? 1 : 0}:${safe(e.badge, 0)}:${safe(e.warn, false) ? 1 : 0}`).join("|");
}

export function registerDock() {
  game.settings.register(SYSTEM_ID, "dockShown", {
    name: "Panel dock", hint: "The drawer at the left of the screen that opens the Party, Battle, Officers and other panels.",
    scope: "client", config: true, type: Boolean, default: true, onChange: () => render(),
  });
  game.settings.register(SYSTEM_ID, "dockCollapsed", { scope: "client", config: false, type: Boolean, default: false, onChange: () => render() });
  game.qinDock = dockApi;
  Hooks.once("ready", () => {
    render();
    let last = "";
    setInterval(() => { if (!el) return; const k = stateKey(); if (k !== last) { last = k; render(); } else place(); }, 700);
    window.addEventListener("resize", place);
    Hooks.callAll("qinDockReady", dockApi);
  });
  for (const h of ["renderSceneControls", "renderSceneNavigation", "renderPlayers", "renderHotbar", "collapseSidebar", "canvasReady"]) Hooks.on(h, () => setTimeout(place, 50));
  Hooks.on("canvasReady", () => schedule());
}
