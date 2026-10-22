// Generates compendium source JSON from tools/content.mjs and compiles it into
// LevelDB packs with Foundry's official CLI. Usage: npm run build:packs
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { compilePack } from "@foundryvtt/foundryvtt-cli";
import * as C from "./content.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SRC = path.join(ROOT, "src/packs");
const OUT = path.join(ROOT, "packs");

// Stable 16-character ids derived from names, so rebuilding doesn't break links.
const idFor = (pack, name) => crypto.createHash("sha1").update(pack + ":" + name).digest("base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, 16);
const p = (s) => `<p>${s}</p>`;
const stats = () => ({ coreVersion: "14.369", systemId: "qin", systemVersion: "0.1.0", createdTime: 0, modifiedTime: 0, lastModifiedBy: null, compendiumSource: null, duplicateSource: null });

function item(pack, name, type, system, img = "icons/svg/item-bag.svg") {
  const _id = idFor(pack, name);
  return { _id, _key: `!items!${_id}`, name, type, img, system, effects: [], folder: null, sort: 0, ownership: { default: 0 }, flags: {}, _stats: stats() };
}
function actor(pack, name, type, system, img = "icons/svg/combat.svg") {
  const _id = idFor(pack, name);
  return {
    _id, _key: `!actors!${_id}`, name, type, img, system, items: [], effects: [], folder: null, sort: 0, ownership: { default: 0 }, flags: {}, _stats: stats(),
    prototypeToken: { name, actorLink: false, displayName: 20, displayBars: 20, bar1: { attribute: "men" }, texture: { src: img } },
  };
}

const packs = {
  taos: C.TAOS.map(([key, name, desc, levels]) => item("taos", name, "tao", {
    key, level: 1, effects: { l1: levels[0], l2: levels[1], l3: levels[2], l4: levels[3] }, description: p(desc),
  }, "icons/svg/aura.svg")),
  techniques: C.TECHNIQUES.map(([name, kind, st, roll, avail, desc]) => item("techniques", name, "technique", {
    skill: "any", skillLevel: 1, stIncrease: st, kind, roll, description: p(desc) + p(`<b>Available:</b> ${avail}`),
  }, "icons/svg/sword.svg")),
  equipment: [
    ...C.WEAPONS.map(([name, skill, damage, resilience, range, price]) => item("equipment", name, "weapon", {
      skill, damage, resilience, range: range ? { c: range[0], m: range[1], l: range[2], e: range[3] } : { c: 0, m: 0, l: 0, e: 0 },
      price, equipped: true, description: "",
    }, range ? "icons/svg/target.svg" : "icons/svg/sword.svg")),
    ...C.ARMOR.map(([name, protection, resilience, defenseBonus, price]) => item("equipment", name, "armor", {
      protection, resilience, defenseBonus, price, equipped: true, description: "",
    }, "icons/svg/shield.svg")),
  ],
  "gifts-weaknesses": [
    ...C.GIFTS.map(([name, d]) => item("gifts-weaknesses", name, "gift", { description: p(d) }, "icons/svg/sun.svg")),
    ...C.WEAKNESSES.map(([name, d]) => item("gifts-weaknesses", name, "weakness", { description: p(d) }, "icons/svg/skull.svg")),
  ],
  formations: C.FORMATIONS.map(([name, fx, desc]) => item("formations", name, "formation", {
    key: fx.key, moveMod: fx.moveMod ?? 0, immobile: !!fx.immobile, defMelee: fx.defMelee ?? 0,
    defRanged: fx.defRanged ?? 0, atkMod: fx.atkMod ?? 0, rearAtk: fx.rearAtk ?? 0, noChargeBonus: !!fx.noChargeBonus,
    winReposition: !!fx.winReposition, rulesVersion: 2, defAll: fx.defAll ?? 0, defFront: fx.defFront ?? 0,
    frontMelee: fx.frontMelee ?? 0, chargeBonus: fx.chargeBonus ?? 0, dmgMod: fx.dmgMod ?? 0, casReduce: fx.casReduce ?? 0,
    noAttackerBonus: !!fx.noAttackerBonus, noRear: !!fx.noRear, description: desc,
  }, "icons/svg/combat.svg")),
};

fs.rmSync(SRC, { recursive: true, force: true });
fs.rmSync(OUT, { recursive: true, force: true });
for (const [name, docs] of Object.entries(packs)) {
  const dir = path.join(SRC, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const d of docs) fs.writeFileSync(path.join(dir, `${d.name.replace(/[^a-zA-Z0-9]+/g, "_")}_${d._id}.json`), JSON.stringify(d, null, 2));
  await compilePack(dir, path.join(OUT, name), { log: false });
  console.log(`${name}: ${docs.length} entries`);
}
