// Unique-skill picker (David, 2026-11-10): adding or changing a unique skill opens every unique skill of that kind
// that the officers in the characters compendium have (Passive, Active, Battle Passive or Battle Active), with search.
// Taking one copies the officer's item with everything that automates it: in-person bonuses and effects ride on the
// item, and a battlefield skill keeps its spec key (flags.qin.specKey), so it is as automated as on the officer.
// "Write my own" still opens a blank skill.
import { SIGNATURE_SLOTS } from "./config.mjs";
import { specKeyForItem } from "./battle/skill-data.mjs";

const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");
const PACK_ID = "qin-3k-characters.characters";
/** Which kind of skill a slot holds: every Active slot shares one list. */
export const slotKind = (slot) => (String(slot).startsWith("active") ? "active" : slot);
const KIND_LABEL = { passive: "Passive", active: "Active", battlePassive: "Battle Passive", battleActive: "Battle Active" };
const plain = (html) => String(html ?? "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

/** Is this skill automated? Battlefield ones have a spec; in-person ones carry bonuses, an effect or fixed effects. */
export function isAutomated(item) {
  const s = item.system ?? {};
  if (SIGNATURE_SLOTS[s.slot]?.battle) return !!specKeyForItem(item);
  return !!(s.bonuses?.length || s.effect?.target || Object.values(s.effects ?? {}).some(v => v));
}

let library = null;     // Promise<[{ key, kind, name, item(plain), owners:[name], auto, text }]>
async function loadLibrary() {
  const pack = game.packs.get(PACK_ID);
  const actors = pack ? await pack.getDocuments() : [];
  const byKey = new Map();
  for (const a of [...actors, ...game.actors.contents.filter(x => x.type === "character")]) {
    for (const it of a.items) {
      if (it.type !== "signature") continue;
      const text = plain(it.system.description);
      if (!text && !it.name) continue;
      const kind = slotKind(it.system.slot), key = `${kind}|${it.name}|${text}`;
      let e = byKey.get(key);
      if (!e) {
        const item = it.toObject();
        const spec = specKeyForItem(it);
        if (spec) item.flags = foundry.utils.mergeObject(item.flags ?? {}, { qin: { specKey: spec } });
        e = { key, kind, name: it.name, item, owners: [], auto: isAutomated(it), text, uuid: it.uuid };
        byKey.set(key, e);
      }
      const owner = a.name.replace(/\s*\(.*\)\s*$/, "");
      if (!e.owners.includes(owner)) e.owners.push(owner);
    }
  }
  return [...byKey.values()].sort((x, y) => (y.auto - x.auto) || x.name.localeCompare(y.name));
}
const getLibrary = () => (library ??= loadLibrary().catch(e => { library = null; throw e; }));
Hooks.on("updateActor", (a) => { if (a.type === "character" && !a.pack) library = null; });

/** Put a skill from the list into a slot (replacing what is there). */
export async function takeSignature(actor, slot, entry) {
  const data = foundry.utils.deepClone(entry.item);
  delete data._id; delete data._stats; delete data.folder; delete data.sort; delete data.ownership;
  data.system = { ...data.system, slot, lastUse: { combat: "", round: 0 } };
  data.flags = foundry.utils.mergeObject(data.flags ?? {}, { qin: { signatureFrom: entry.uuid } });
  const old = actor.items.filter(i => i.type === "signature" && i.system.slot === slot);
  const [made] = await actor.createEmbeddedDocuments("Item", [data]);
  if (made && old.length) await actor.deleteEmbeddedDocuments("Item", old.map(i => i.id));
  if (made) ui.notifications.info(`${actor.name} takes ${made.name}${entry.auto ? " (automated)" : ""}.`);
  return made;
}

export class SignaturePicker extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    classes: ["qin", "qin-sigpick"],
    window: { title: "Unique skills", icon: "fa-solid fa-star", resizable: true },
    position: { width: 760, height: 620 },
    actions: {
      pick: SignaturePicker.#pick, take: SignaturePicker.#take, own: SignaturePicker.#own,
      filter: function (ev, el) { this.autoOnly = el.dataset.f === "auto"; this.render(); },
    },
  };
  constructor(actor, slot, { onOwn } = {}) {
    super({ id: `qin-sigpick-${actor.id}-${slot}` });
    this.actor = actor; this.slot = slot; this.kind = slotKind(slot); this.onOwn = onOwn;
    this.q = ""; this.sel = null; this.autoOnly = false; this.list = null;
  }
  get title() { return `${this.actor.name}: choose a ${KIND_LABEL[this.kind]} skill`; }
  static open(actor, slot, opts) { return new SignaturePicker(actor, slot, opts).render({ force: true }); }

  async _renderHTML() {
    if (!this.list) {
      getLibrary().then(l => { this.list = l.filter(e => e.kind === this.kind); this.render(); })
        .catch(e => { console.error(e); ui.notifications.error("The unique skills couldn't be loaded."); });
      return `<p class="qin-sp-wait"><i class="fa-solid fa-spinner fa-spin"></i> Gathering every officer's ${esc(KIND_LABEL[this.kind])} skills…</p>`;
    }
    const words = this.q.toLowerCase().split(/\s+/).filter(Boolean);
    const rows = this.list.filter(e => (!this.autoOnly || e.auto) && words.every(w => `${e.name} ${e.owners.join(" ")} ${e.text}`.toLowerCase().includes(w)));
    const sel = this.list.find(e => e.key === this.sel) ?? rows[0] ?? null;
    this.sel = sel?.key ?? null;
    const nAuto = this.list.filter(e => e.auto).length;
    const badge = (e) => e.auto ? `<span class="qin-sp-auto" data-tooltip="Works by itself: the system applies it">Automated</span>` : `<span class="qin-sp-manual" data-tooltip="Text only: the GM applies it">Text</span>`;
    const cost = (s) => [s.chiCost ? `${s.chiCost} Chi` : "", s.moraleCost ? `${s.moraleCost} morale` : "", s.perScene ? "once per fight" : s.recharge ? `recharge ${s.recharge}` : ""].filter(Boolean).join(" · ");
    const li = rows.map(e => `<li data-action="pick" data-key="${esc(e.key)}" class="${e.key === this.sel ? "on" : ""}"><b>${esc(e.name)}</b>${badge(e)}<small>${esc(e.owners.slice(0, 3).join(", "))}${e.owners.length > 3 ? ` +${e.owners.length - 3}` : ""}</small></li>`).join("");
    const cur = this.actor.items.find(i => i.type === "signature" && i.system.slot === this.slot);
    const detail = sel ? `<h3>${esc(sel.name)} ${badge(sel)}</h3>
        <div class="qin-sp-meta">${esc([KIND_LABEL[sel.kind], cost(sel.item.system)].filter(Boolean).join(" · "))}</div>
        <div class="qin-sp-from">From ${esc(sel.owners.join(", "))}</div>
        <div class="qin-sp-desc">${sel.item.system.description || "<p><i>No description.</i></p>"}</div>
        <button type="button" data-action="take"><i class="fa-solid fa-check"></i> ${cur ? `Replace ${esc(cur.name)} with this` : "Take this skill"}</button>`
      : `<p class="qin-muted">No skill matches.</p>`;
    return `<div class="qin-sp-top"><input type="search" name="q" placeholder="Search names, officers or text…" value="${esc(this.q)}" autocomplete="off">
        <nav><a data-action="filter" data-f="all" class="${this.autoOnly ? "" : "on"}">All (${this.list.length})</a><a data-action="filter" data-f="auto" class="${this.autoOnly ? "on" : ""}">Automated (${nAuto})</a></nav>
        <button type="button" data-action="own" data-tooltip="Write a new skill from scratch"><i class="fa-solid fa-feather"></i> Write my own</button></div>
      <div class="qin-sp-body"><ul class="qin-sp-list">${li || `<li class="qin-muted">No skill matches.</li>`}</ul><div class="qin-sp-detail">${detail}</div></div>`;
  }
  _replaceHTML(result, content) {
    const had = content.querySelector('input[name="q"]'), caret = had === document.activeElement ? had.selectionStart : null;
    const scroll = content.querySelector(".qin-sp-list")?.scrollTop ?? 0;
    content.innerHTML = result;
    const q = content.querySelector('input[name="q"]');
    if (q) {
      q.addEventListener("input", () => { this.q = q.value; this.sel = null; this.render(); });
      if (caret !== null || had === null) { q.focus(); if (caret !== null) q.setSelectionRange(caret, caret); }
    }
    const list = content.querySelector(".qin-sp-list"); if (list) list.scrollTop = scroll;
  }
  static #pick(ev, el) { this.sel = el.dataset.key; this.render(); }
  static async #take() {
    const e = this.list?.find(x => x.key === this.sel); if (!e) return;
    if (await takeSignature(this.actor, this.slot, e)) this.close();
  }
  static #own() { this.close(); this.onOwn?.(); }
}
