// Battle sounds (David, 2026-10-25). The system ships no audio: a module hands it a sound pack in "setup" with
//   game.qin.registerSoundPack({ "Melee hit": ["modules/<id>/sounds/a.ogg", ...], ... })
// keyed by the moment names below. The GM can also pick files per moment in the Sounds panel (a world setting that
// takes the place of the pack's list for that moment). A moment with several sounds plays one of them at random.
// Each player has their own volume and mute, separate from Foundry's sliders. Battle sounds play for everyone
// (they ride on the battle animation every client already plays); menu sounds only for the person clicking.
import { SYSTEM_ID } from "./config.mjs";

/** Every moment the battle can play a sound for, grouped as in the panel. `local`: only the person acting hears it. */
export const MOMENT_GROUPS = [
  ["Combat", ["Melee hit", "Miss or blocked", "Bow shot", "Crossbow shot", "Arrow hit", "Cavalry charge", "Overwatch shot",
    "Counter-attack", "Unit destroyed", "Unit surrenders", "Morale drop", "Morale up / rally", "Level up", "XP gained", "Fire catches / burning"]],
  ["Turn and actions", ["Battle start", "Condition shown", "Round start", "Player turn", "Enemy turn",
    "Unit selected", "Infantry moves", "Cavalry moves", "Hold", "Overwatch set", "Reload", "Tactic placed", "Tactic triggered",
    "Officer skill", "Gate opens", "Gate destroyed", "Ladder placed", "Victory", "Defeat"]],
  ["Menus", ["Menu opens", "Select / confirm", "Cancel / back", "Cursor move", "Error / not allowed"]],
];
export const MOMENTS = MOMENT_GROUPS.flatMap(([, list]) => list);
export const LOCAL_MOMENTS = new Set(["Unit selected", "Tactic placed", "Condition shown",
  "Menu opens", "Select / confirm", "Cancel / back", "Cursor move", "Error / not allowed"]);
/** A moment with no sounds of its own borrows these (in order). */
export const FALLBACKS = {
  "Crossbow shot": ["Bow shot"], "Overwatch shot": ["Bow shot"], "Cavalry charge": ["Melee hit"],
  "Cavalry moves": ["Infantry moves"], "Unit surrenders": ["Unit destroyed"],
};

let pack = {};
/** Old moment names that now share one (David, 2026-10-25: one sound for every condition the tour shows). */
export const ALIASES = { "Victory condition shown": "Condition shown", "Defeat condition shown": "Condition shown" };

/** Moment → list of files, from a module's pack (later packs add to earlier ones). Unknown moment names are kept. */
export function registerSoundPack(map) {
  for (const [name, list] of Object.entries(map ?? {})) {
    const m = ALIASES[name] ?? name;
    const files = (Array.isArray(list) ? list : [list]).filter(f => typeof f === "string" && f);
    if (files.length) pack[m] = [...new Set([...(pack[m] ?? []), ...files])];
  }
}
export function soundPack() { return pack; }

/** The files a moment plays (pure): the GM's own list if it has one, else the pack's, else a fallback moment's. */
export function soundsFor(moment, packMap, overrides, seen = new Set()) {
  if (seen.has(moment)) return [];
  seen.add(moment);
  const own = overrides?.[moment]?.length ? overrides[moment] : packMap?.[moment] ?? [];
  if (own.length) return own;
  for (const f of FALLBACKS[moment] ?? []) { const l = soundsFor(f, packMap, overrides, seen); if (l.length) return l; }
  return [];
}
/** One file from a list, at random (rnd in [0, 1)). */
export function pickSound(list, rnd = Math.random()) { return list.length ? list[Math.min(list.length - 1, Math.floor(rnd * list.length))] : null; }

/* ---------------------------------------- playing */

const get = (k, d) => { try { return game.settings.get(SYSTEM_ID, k); } catch { return d; } };
const overrides = () => get("soundOverrides", {}) ?? {};
export function soundVolume() { return get("soundMuted", false) ? 0 : Math.max(0, Math.min(1, Number(get("soundVolume", 0.7)))); }

const lastPlayed = new Map();
/** Play a moment on this computer. `minGap` (ms) stops the same moment piling up (cursor moves, several falls). */
export function playMoment(moment, { minGap = 60 } = {}) {
  const vol = soundVolume();
  if (!vol) return null;
  const now = Date.now();
  if (now - (lastPlayed.get(moment) ?? 0) < minGap) return null;
  const src = pickSound(soundsFor(moment, pack, overrides()));
  if (!src) return null;
  lastPlayed.set(moment, now);
  try {
    const a = new Audio(src); // a plain audio element: Foundry's own volume sliders don't touch it
    a.volume = vol;
    a.play().catch(() => {}); // the browser blocks sound until the page has been clicked once
    return a;
  } catch { return null; }
}

/** What a battle animation step should sound like (pure; exported for tests). Returns [[delayMs, moment], ...]. */
export function stepSounds(st) {
  switch (st?.kind) {
    case "attack": return []; // attacks play theirs in time with the animation (attackSounds)
    case "floats": {
      const styles = new Set((st.items ?? []).map(i => i[1]));
      const out = [];
      if (styles.has("moraleDown")) out.push([0, "Morale drop"]);
      else if (styles.has("moraleUp")) out.push([0, "Morale up / rally"]);
      if (styles.has("xp")) out.push([150, "XP gained"]);
      return out;
    }
    case "levelUp": return [[0, "Level up"]];
    case "tactic": return [[0, "Tactic triggered"]];
    case "setFire": return [[0, "Fire catches / burning"]];
    case "fallen": {
      const how = new Set((st.units ?? []).map(u => u[1]));
      return [...(how.has("skull") ? [[0, "Unit destroyed"]] : []), ...(how.has("flag") ? [[how.has("skull") ? 250 : 0, "Unit surrenders"]] : [])];
    }
    case "sound": return [[0, st.moment]];
  }
  return [];
}
/** An attack's sounds (pure; exported for tests): as it starts, as it lands, and the defender striking back. */
export function attackSounds(st) {
  const hurt = (st.toDefender ?? []).some(([style]) => style === "unitDamage");
  const shot = st.overwatch ? "Overwatch shot" : st.crossbow ? "Crossbow shot" : "Bow shot";
  return {
    start: st.ranged ? shot : null,
    hit: !hurt ? "Miss or blocked" : st.ranged ? "Arrow hit" : st.charge ? "Cavalry charge" : "Melee hit",
    back: st.returnStrike ? "Counter-attack" : null,
  };
}
/** Play a step's sounds (called by every client as it plays the battle animation). */
export function playStepSounds(st) {
  for (const [ms, m] of stepSounds(st)) { if (ms) setTimeout(() => playMoment(m), ms); else playMoment(m); }
}

/** Sound-only steps for log entries that have no animation of their own (pure; exported for tests). */
export function logSoundSteps(entries, actionType) {
  const out = [];
  const add = (moment) => { if (!out.some(s => s.moment === moment)) out.push({ kind: "sound", moment }); };
  for (const e of entries) {
    const d = e.detail ?? {};
    if (d.type === "overwatch" && d.on) add("Overwatch set");
    else if (d.type === "ladder") add("Ladder placed");
    else if (d.type === "skill") add("Officer skill");
    else if (d.type === "outcome" && d.result === "victory") add("Victory");
    else if (d.type === "outcome" && d.result === "defeat") add("Defeat");
    else if (d.type === "gate" && d.state === "open" && d.by) add("Gate opens");
    else if (d.type === "gate" && (d.state === "broken" || d.state === "burned")) add("Gate destroyed");
    else if (d.type === "burntDown" && d.gate) add("Gate destroyed");
  }
  if (actionType === "holdPosition") add("Hold");
  if (actionType === "reload") add("Reload");
  return out;
}

/* ---------------------------------------- turns, moves */

let lastTurn = { active: false, round: 0, unit: null, phase: null };
/** Battle start, round start and whose turn: from the battle setting, on every client. */
export function turnSounds(prev, next) {
  const out = [];
  if (!next.active) return out;
  if (!prev.active || (prev.phase === "setup" && next.phase && next.phase !== "setup")) { if (next.phase && next.phase !== "setup") out.push("Battle start"); return out; }
  if (next.round > prev.round && next.round >= 1) out.push("Round start");
  if (next.unit && next.unit !== prev.unit) out.push(next.side === "enemy" ? "Enemy turn" : "Player turn");
  return out;
}
function turnState(b, sideOf) {
  const ac = b?.turn?.activation;
  const next = { active: !!b?.active && b.sceneId === canvas?.scene?.id, round: b?.turn?.round ?? 0, unit: ac?.unitId ?? null, phase: b?.turn?.phase ?? null };
  next.side = next.unit ? sideOf(next.unit) : null;
  return next;
}
/** Remember where the battle stands without playing anything (a page load or a scene change mid-battle). */
export function primeBattleSounds(b, sideOf = () => null) { lastTurn = turnState(b, sideOf); }
export function onBattleSetting(b, sideOf = () => null) {
  const next = turnState(b, sideOf);
  const list = turnSounds(lastTurn, next);
  lastTurn = next;
  list.forEach((m, i) => (i ? setTimeout(() => playMoment(m), i * 700) : playMoment(m)));
}

/** A unit token sliding to a new square during a battle: footsteps or hooves, for whoever can see it. */
export function onUnitTokenMoved(doc, change, battle) {
  if (!("x" in change || "y" in change) || doc.actor?.type !== "unit") return;
  if (!battle?.active || battle.sceneId !== doc.parent?.id || canvas?.scene?.id !== doc.parent?.id) return;
  if (doc.hidden && !game.user.isGM) return;
  playMoment(doc.actor.system.category === "cavalry" ? "Cavalry moves" : "Infantry moves", { minGap: 400 });
}

/* ---------------------------------------- the panel */

const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");
const fileName = (p) => decodeURIComponent(String(p).split("/").pop() ?? p).replace(/\.(ogg|wav|mp3|webm|flac|m4a)$/i, "");

/** The Sounds window. Built on first use, so this file also loads where Foundry's window classes don't exist (tests). */
export const SoundPanel = {
  instance: null,
  toggle() { if (this.instance?.rendered) this.instance.close(); else (this.instance ??= new (panelClass())()).render({ force: true }); },
  refresh() { if (this.instance?.rendered) this.instance.render(); },
};
let PanelClass = null;
const panelClass = () => PanelClass ??= class SoundPanelApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "qin-sounds", classes: ["qin", "qin-sounds"],
    window: { title: "Sounds", icon: "fa-solid fa-volume-high", resizable: true },
    position: { width: 420, height: game.user?.isGM ? 640 : "auto" },
    actions: {
      test: (ev, el) => { lastPlayed.delete(el.dataset.m); playMoment(el.dataset.m, { minGap: 0 }); },
      add: (ev, el) => addFile(el.dataset.m),
      reset: async (ev, el) => { const o = { ...overrides() }; delete o[el.dataset.m]; await game.settings.set(SYSTEM_ID, "soundOverrides", o); },
      mute: async () => { await game.settings.set(SYSTEM_ID, "soundMuted", !get("soundMuted", false)); SoundPanel.instance?.render(); },
    },
  };
  async _renderHTML() {
    const vol = Math.round(Number(get("soundVolume", 0.7)) * 100), muted = !!get("soundMuted", false);
    let html = `<div class="qin-snd-top"><button type="button" data-action="mute" class="qin-snd-mute ${muted ? "on" : ""}" title="${muted ? "Unmute" : "Mute"}"><i class="fa-solid fa-volume-${muted ? "xmark" : "high"}"></i></button>
      <input type="range" class="qin-snd-vol" min="0" max="100" step="1" value="${vol}" ${muted ? "disabled" : ""}><span class="qin-snd-pct">${vol}%</span></div>
      <p class="qin-muted">Your volume only. Foundry's own sliders don't change it.</p>`;
    if (game.user.isGM) {
      const o = overrides();
      for (const [g, list] of MOMENT_GROUPS) {
        html += `<h4>${esc(g)}</h4><ul class="qin-snd-list">`;
        for (const m of list) {
          const custom = !!o[m]?.length, files = soundsFor(m, pack, o), own = custom ? o[m] : pack[m] ?? [];
          const borrowed = !own.length && files.length ? (FALLBACKS[m] ?? []).find(f => soundsFor(f, pack, o).length) : null;
          const what = own.length ? own.map(fileName).join(", ") : borrowed ? `uses ${borrowed}` : "silent";
          html += `<li class="${files.length ? "" : "off"}"><button type="button" data-action="test" data-m="${esc(m)}" ${files.length ? "" : "disabled"} title="Play"><i class="fa-solid fa-play"></i></button>
            <div><b>${esc(m)}</b>${LOCAL_MOMENTS.has(m) ? ` <span class="qin-snd-tag">only you</span>` : ""}<div class="qin-muted" title="${esc(own.join("\n"))}">${esc(what)}${custom ? " · yours" : ""}</div></div>
            <button type="button" data-action="add" data-m="${esc(m)}" title="Add a sound file"><i class="fa-solid fa-plus"></i></button>
            ${custom ? `<button type="button" data-action="reset" data-m="${esc(m)}" title="Back to the module's sounds"><i class="fa-solid fa-rotate-left"></i></button>` : "<span></span>"}</li>`;
        }
        html += `</ul>`;
      }
      html += `<p class="qin-muted">A moment with several sounds plays one at random. Files you add here take the place of the module's for that moment.</p>`;
    }
    return html;
  }
  _replaceHTML(result, content) {
    content.innerHTML = result;
    const r = content.querySelector(".qin-snd-vol"), pct = content.querySelector(".qin-snd-pct");
    r?.addEventListener("input", () => { pct.textContent = `${r.value}%`; });
    r?.addEventListener("change", async () => { await game.settings.set(SYSTEM_ID, "soundVolume", Number(r.value) / 100); playMoment("Select / confirm", { minGap: 0 }); });
  }
};

/** GM: add a file (from Foundry's file browser, where you can also upload) to a moment's own list. */
function addFile(moment) {
  const FP = foundry.applications.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
  new FP({ type: "audio", callback: async (path) => {
    const o = { ...overrides() };
    o[moment] = [...new Set([...(o[moment] ?? []), path])];
    await game.settings.set(SYSTEM_ID, "soundOverrides", o);
  } }).render(true);
}

export function registerSounds() {
  const { ObjectField } = foundry.data.fields;
  game.settings.register(SYSTEM_ID, "soundVolume", { scope: "client", config: false, type: Number, default: 0.7 });
  game.settings.register(SYSTEM_ID, "soundMuted", { scope: "client", config: false, type: Boolean, default: false });
  game.settings.register(SYSTEM_ID, "soundOverrides", { scope: "world", config: false, type: new ObjectField(), default: {}, onChange: () => SoundPanel.refresh() });
  game.keybindings.register(SYSTEM_ID, "soundPanel", {
    name: "Sounds", hint: "Opens the Sounds window (your volume; the GM also picks which sound plays when). Press again to close it.",
    editable: [{ key: "KeyM" }], precedence: CONST.KEYBINDING_PRECEDENCE?.NORMAL,
    onDown: () => { SoundPanel.toggle(); return true; },
  });
}
