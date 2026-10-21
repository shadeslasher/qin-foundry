// Factions a unit can belong to. The list itself comes from content modules (e.g. a campaign module
// registers its factions and flag images); the system only stores the chosen faction's key on the unit.
const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");

/** Shown first, in this order; everything else follows alphabetically. */
export const PINNED_FACTIONS = ["han-empire", "liu-bei", "cao-cao", "sun-jian"];

export function factionSlug(name) {
  return String(name ?? "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// Kept on CONFIG itself: CONFIG.QIN is the config module's namespace object, which can't take new keys
function registry() {
  CONFIG.qinFactions ??= {};
  return CONFIG.qinFactions;
}

/**
 * Add factions: { key: { name, img } } or [{ key?, name, img }]. Content modules call this from their
 * "init" or "setup" hook: game.qin.registerFactions({...}).
 */
export function registerFactions(list) {
  const reg = registry();
  const entries = Array.isArray(list) ? list.map(f => [f.key ?? factionSlug(f.name), f]) : Object.entries(list ?? {});
  for (const [key, f] of entries) if (key && f?.name) reg[key] = { key, name: f.name, img: f.img ?? null };
}

/** Every faction, the pinned ones first, then A–Z. */
export function factionList() {
  const all = Object.values(registry());
  const pinned = PINNED_FACTIONS.map(k => all.find(f => f.key === k)).filter(Boolean);
  const rest = all.filter(f => !PINNED_FACTIONS.includes(f.key)).sort((a, b) => a.name.localeCompare(b.name));
  return [...pinned, ...rest];
}

/** What a unit's faction value refers to. Old free-text values still show, just without a flag. */
export function factionOf(value) {
  if (!value) return null;
  const reg = registry();
  const f = reg[value] ?? reg[factionSlug(value)] ?? Object.values(reg).find(x => x.name.toLowerCase() === String(value).toLowerCase());
  return f ?? { key: value, name: String(value), img: null, unknown: true };
}

/** A panel of every faction (flag + name) with a search box; picking one sets the unit's faction. */
export function openFactionPicker(actor) {
  const list = factionList();
  const current = factionOf(actor.system.faction)?.key ?? "";
  const tile = (f) => `<button type="button" class="qin-faction-tile${f.key === current ? " active" : ""}${PINNED_FACTIONS.includes(f.key) ? " pinned" : ""}" data-key="${esc(f.key)}" data-name="${esc(f.name.toLowerCase())}" title="${esc(f.name)}">
      ${f.img ? `<img src="${esc(f.img)}" alt="">` : `<span class="qin-faction-noflag"><i class="fa-solid fa-flag"></i></span>`}<span>${esc(f.name)}</span></button>`;
  const content = `<div class="qin-faction-picker">
    <input type="search" class="qin-faction-search" placeholder="Search factions…" autocomplete="off">
    <div class="qin-faction-grid">
      <button type="button" class="qin-faction-tile none${current ? "" : " active"}" data-key="" data-name="no faction"><span class="qin-faction-noflag"><i class="fa-solid fa-ban"></i></span><span>No faction</span></button>
      ${list.map(tile).join("")}
    </div>
    ${list.length ? "" : `<p class="qin-muted">No factions are registered. A campaign module adds them (with their flags).</p>`}
  </div>`;
  const DialogV2 = foundry.applications.api.DialogV2;
  const dlg = new DialogV2({
    window: { title: `Faction: ${actor.name}`, icon: "fa-solid fa-flag" },
    classes: ["qin", "qin-faction-dialog"],
    position: { width: 640 },
    content,
    buttons: [{ action: "cancel", label: "Cancel", icon: "fa-solid fa-xmark", default: true }],
  });
  const wire = () => {
    const el = dlg.element;
    if (!el || el.dataset.qinWired) return;
    el.dataset.qinWired = "1";
    const search = el.querySelector(".qin-faction-search");
    search?.addEventListener("input", () => {
      const q = search.value.trim().toLowerCase();
      for (const b of el.querySelectorAll(".qin-faction-tile")) b.hidden = !!q && !b.dataset.name.includes(q);
    });
    search?.focus();
    el.querySelector(".qin-faction-grid")?.addEventListener("click", async (ev) => {
      const b = ev.target.closest(".qin-faction-tile");
      if (!b) return;
      ev.preventDefault();
      await actor.update({ "system.faction": b.dataset.key });
      dlg.close();
    });
  };
  dlg.render({ force: true }).then(wire);
  return dlg;
}
