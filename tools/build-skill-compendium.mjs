// Unique-skill compendium data (David, 2026-11-05, skill-effects schema v2 §3): turns Battle Sheets character docs
// into signature item data for every in-person unique skill, for the private module's build to pack.
//   node tools/build-skill-compendium.mjs characters.json [out.json]
// Input: an array of character docs (or { characters: [...] }) in the Battle Sheets format: name, and sig.<slot>
// (either a nested `sig` object or flat "sig.<slot>" keys) with name, desc, chi, recharge, perScene, bonuses,
// effect, generalDesc, generalName. Slots: passive, active, active2, active3, active4 (battle slots are skipped).
// The compendium copy uses generalName / generalDesc when present (the character keeps the original), adds
// "Taught by: <officer>" to the description, and keeps the officer's name in flags.qin.source.
// Output: a JSON array of Item data (type "signature") with stable _ids. Nothing here touches the private module.
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

export const IN_PERSON_SLOTS = ["passive", "active", "active2", "active3", "active4"];

const idFor = (officer, slot) => crypto.createHash("sha1").update(`unique-skills:${officer}:${slot}`).digest("base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, 16);
const escHTML = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
/** Plain text becomes paragraphs; HTML is kept. */
const asHTML = (t) => {
  const s = String(t ?? "").trim();
  if (!s) return "";
  return /<[a-z][\s\S]*>/i.test(s) ? s : s.split(/\n\s*\n/).map(p => `<p>${escHTML(p).replace(/\n/g, "<br>")}</p>`).join("");
};
const int = (v) => Math.max(0, Math.trunc(Number(v) || 0));

/** The signature slots of a character doc: { slot: sig } from a nested `sig` object or flat "sig.<slot>" keys. */
export function sigSlots(doc) {
  const out = {};
  const nested = doc?.sig && typeof doc.sig === "object" ? doc.sig : {};
  for (const slot of IN_PERSON_SLOTS) {
    const s = doc?.[`sig.${slot}`] ?? nested[slot];
    if (s && typeof s === "object" && String(s.name ?? "").trim()) out[slot] = s;
  }
  return out;
}

/** Item data for one unique skill as the compendium (learnable) copy. */
export function skillItem(officer, slot, sig) {
  const name = String(sig.generalName || sig.name).trim();
  const desc = asHTML(sig.generalDesc || sig.desc);
  const system = {
    slot,
    chiCost: int(sig.chi ?? sig.chiCost),
    recharge: int(sig.recharge),
    perScene: !!sig.perScene,
    bonuses: Array.isArray(sig.bonuses) ? structuredClone(sig.bonuses) : [],
    effect: slot !== "passive" && sig.effect && typeof sig.effect === "object" ? structuredClone(sig.effect) : null,
    generalName: "",
    generalDesc: "",
    description: `${desc}<p><i>Taught by: ${escHTML(officer)}</i></p>`,
  };
  const _id = idFor(officer, slot);
  return {
    _id, name, type: "signature", img: "icons/svg/aura.svg", system, effects: [], folder: null, sort: 0, ownership: { default: 0 },
    flags: { qin: { source: officer, sourceSkill: String(sig.name).trim(), sourceSlot: slot, general: !!(sig.generalName || sig.generalDesc) } },
  };
}

/** Every in-person unique skill of every character doc, as item data. */
export function buildSkillCompendium(docs) {
  const list = Array.isArray(docs) ? docs : Array.isArray(docs?.characters) ? docs.characters : [];
  const out = [];
  for (const doc of list) {
    const officer = String(doc?.name ?? "").trim();
    if (!officer) continue;
    for (const [slot, sig] of Object.entries(sigSlots(doc))) out.push(skillItem(officer, slot, sig));
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [input, output] = process.argv.slice(2);
  if (!input) { console.error("Usage: node tools/build-skill-compendium.mjs characters.json [out.json]"); process.exit(1); }
  const items = buildSkillCompendium(JSON.parse(fs.readFileSync(input, "utf8")));
  const json = JSON.stringify(items, null, 2);
  if (output) { fs.writeFileSync(output, json); console.log(`${items.length} unique skills written to ${output}`); }
  else process.stdout.write(json + "\n");
}
