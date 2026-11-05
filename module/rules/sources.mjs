// Source tags for the parts of a roll total or of damage (David, 2026-11-05). Pure: no Foundry dependencies.
// A part is { kind, label, value, aspect?, situational?, note? }. `kind` says where the number comes from.

export const SOURCE_KINDS = {
  aspect: "Aspect", skill: "Skill", base: "Base", dice: "Dice", gear: "Gear", tao: "Tao",
  unique: "Unique", houseRule: "House rule", wound: "Wound", modifier: "Modifier",
};

/** Kinds whose positive values read as bonuses ("+2") rather than plain amounts ("6"). */
const SIGNED = new Set(["unique", "tao", "modifier"]);

export function part(kind, label, value, extra = {}) {
  return { kind: SOURCE_KINDS[kind] ? kind : "modifier", label: String(label ?? ""), value: Number(value) || 0, ...extra };
}

/** "+2", "−3" (true minus sign) or "6". */
export function formatValue(value, kind) {
  const v = Number(value) || 0;
  if (v < 0) return `−${Math.abs(v)}`;
  return SIGNED.has(kind) && v > 0 ? `+${v}` : String(v);
}

export const sumParts = (parts) => (parts ?? []).reduce((t, p) => t + (Number(p?.value) || 0), 0);

const escHTML = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** The small tag chip for a part: Aspect in its aspect colour, Unique solid (automatic) or dashed (situational, ticked). */
export function chipHTML(p) {
  const kind = SOURCE_KINDS[p?.kind] ? p.kind : "modifier";
  const cls = ["qin-src", `qin-src-${kind}`];
  if (kind === "aspect" && p.aspect) cls.push(`qin-src-${p.aspect}`);
  if (p?.situational) cls.push("qin-src-situational");
  const title = p?.situational ? `${SOURCE_KINDS[kind]} (situational, ticked)` : SOURCE_KINDS[kind];
  return `<span class="${cls.join(" ")}" title="${escHTML(title)}">${escHTML(SOURCE_KINDS[kind])}</span>`;
}

/** A part as a chat-card row: chip + label, value on the right. */
export function partRowHTML(p) {
  const note = p.note ? ` <span class="qin-muted">${escHTML(p.note)}</span>` : "";
  return `<li class="qin-part"><span class="qin-part-label">${chipHTML(p)}${escHTML(p.label)}${note}</span><span class="qin-part-value">${escHTML(p.display ?? formatValue(p.value, p.kind))}</span></li>`;
}
