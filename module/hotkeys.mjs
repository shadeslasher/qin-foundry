// Hotkey guide (H): a small window listing the system's keyboard shortcuts as they are bound right now
// (rebinds in Configure Controls show up here), plus the mouse actions worth knowing.
import { SYSTEM_ID } from "./config.mjs";

const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");

const MOUSE = [
  ["Click a unit", "Opens its box: Take turn, Info, Threat range (enemy units)."],
  ["Hover a unit", "Shows where it can move this turn and, in orange, where it could attack from there."],
  ["Hover a condition marker", "Shows what the victory or defeat condition asks for."],
  ["Right-click", "Backs out of a Move or Attack pick; stops a paint brush."],
  ["Drag a unit (deployment)", "Places it on a deployment square during the tactics phase."],
];

/** The system's keybindings with their current keys, for everyone or restricted to the GM. */
export function hotkeyRows(isGM = game.user.isGM) {
  const rows = [];
  for (const [id, action] of game.keybindings.actions.entries()) {
    if (!id.startsWith(`${SYSTEM_ID}.`)) continue;
    if (action.restricted && !isGM) continue;
    const keys = (game.keybindings.bindings.get(id) ?? []).map(b => keyLabel(b)).filter(Boolean);
    rows.push({ name: action.name, hint: action.hint ?? "", keys: keys.length ? keys : ["—"], gm: !!action.restricted });
  }
  return rows;
}

function keyLabel(b) {
  const mods = (b.modifiers ?? []).map(m => ({ Control: "Ctrl", Shift: "Shift", Alt: "Alt" })[m] ?? m);
  const k = String(b.key ?? "").replace(/^Key/, "").replace(/^Digit/, "").replace(/^Arrow/, "").replace(/^Page/, "Page ");
  return [...mods, k].join(" + ");
}

export class HotkeyGuide extends foundry.applications.api.ApplicationV2 {
  static instance = null;
  static DEFAULT_OPTIONS = {
    id: "qin-hotkeys", classes: ["qin", "qin-hotkeys"],
    window: { title: "Hotkeys", icon: "fa-solid fa-keyboard", resizable: true },
    position: { width: 400, height: "auto" },
  };
  static toggle() { if (this.instance?.rendered) this.instance.close(); else (this.instance ??= new HotkeyGuide()).render({ force: true }); }
  async _renderHTML() {
    const rows = hotkeyRows();
    const key = (k) => `<kbd>${esc(k)}</kbd>`;
    return `<div class="qin-hk-wrap">
      <table class="qin-hk"><tbody>${rows.map(r => `<tr><td class="k">${r.keys.map(key).join(" / ")}</td><td><b>${esc(r.name)}</b>${r.gm ? ` <span class="qin-hk-gm">GM</span>` : ""}${r.hint ? `<div class="qin-muted">${esc(r.hint)}</div>` : ""}</td></tr>`).join("")}</tbody></table>
      <h4>Mouse</h4>
      <table class="qin-hk"><tbody>${MOUSE.map(([a, b]) => `<tr><td class="k"><span class="qin-hk-m">${esc(a)}</span></td><td>${esc(b)}</td></tr>`).join("")}</tbody></table>
      <p class="qin-muted">Keys can be changed in Configure Controls (the gear in the sidebar).</p></div>`;
  }
  _replaceHTML(result, content) { content.innerHTML = result; }
}
