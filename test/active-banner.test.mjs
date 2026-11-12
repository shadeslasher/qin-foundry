import { test } from "node:test";
import assert from "node:assert/strict";
import { setFullArtMap, fullArtFor, fullArtInfo } from "../module/full-art.mjs";
import { bannerInfo, artLayout } from "../module/battle/active-banner.mjs";
import { logSoundSteps, stepSounds } from "../module/sound.mjs";

test("full art: own flag, then id, then the compendium id it came from, then name", () => {
  setFullArtMap({ byId: { abc: "a.webp", src1: "s.webp" }, byName: { "Huang Gai": "hg.webp" } });
  assert.equal(fullArtFor({ id: "x", flags: { qin: { fullArt: "own.webp" } } }), "own.webp");
  assert.equal(fullArtFor({ id: "abc" }), "a.webp");
  assert.equal(fullArtFor({ id: "w1", _stats: { compendiumSource: "Compendium.m.p.Actor.src1" } }), "s.webp");
  assert.equal(fullArtFor({ id: "w2", name: "Huang Gai" }), "hg.webp");
  assert.equal(fullArtFor({ id: "w3", name: "Nobody" }), null);
  setFullArtMap(null);
  assert.equal(fullArtFor({ id: "abc" }), null);
});

test("banner: side colour and edge, full art before the token", () => {
  setFullArtMap({ byId: { o1: "full.webp" } });
  const b = bannerInfo({ side: "enemy", skill: "Bitter Flesh Ruse" }, { officer: { id: "o1", name: "Huang Gai", img: "tok.png" } });
  assert.equal(b.fromRight, true); assert.equal(b.rgb, "200,68,58"); assert.equal(b.img, "full.webp"); assert.equal(b.full, true);
  const p = bannerInfo({ side: "player", skill: "X" }, { officer: { id: "o2", name: "A", img: "tok.png" } });
  assert.equal(p.fromRight, false); assert.equal(p.img, "tok.png"); assert.equal(p.full, false);
  setFullArtMap(null);
});

test("an active's sound plays with its banner, not again at the end", () => {
  assert.deepEqual(logSoundSteps([{ detail: { type: "skill", active: true } }]), []);
  assert.deepEqual(logSoundSteps([{ detail: { type: "skill" } }]), [{ kind: "sound", moment: "Officer skill" }]);
  assert.deepEqual(stepSounds({ kind: "activeBanner" }), []); // the banner plays it as it lands
});

test("full art entries with sizes; the banner box is the visible width of the upper half", () => {
  setFullArtMap({ byId: { pd: { src: "pd.webp", w: 700, h: 1000, up: [100, 500] } } });
  assert.equal(fullArtFor({ id: "pd" }), "pd.webp");
  const a = fullArtInfo({ id: "pd" });
  assert.deepEqual(artLayout(a), { imgH: 760, boxW: 304, offX: -76 }); // 400 px visible × 0.76
  assert.deepEqual(artLayout({ src: "x" }, 500, 1000), { imgH: 760, boxW: 380, offX: -0 });
  assert.equal(artLayout({ src: "x" }, 0, 0), null);
  setFullArtMap(null);
});

test('the epithet comes from the officer\'s title (empty when he has none)', () => {
  assert.strictEqual(bannerInfo({ side: 'player' }, { officer: { name: 'Guan Yu', system: { details: { title: 'God of War' } } }, artFor: () => null }).epithet, 'God of War');
  assert.strictEqual(bannerInfo({ side: 'player' }, { officer: { name: 'Nobody', system: { details: {} } }, artFor: () => null }).epithet, '');
});
