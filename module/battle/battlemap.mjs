// Battle maps from the map generator: "<name>.battlemap.json" (format "qin-battlemap", version 1).
// Importing creates a scene with the map image and keeps every square's terrain and overlays on the scene,
// where the battle engine reads them (see MAP_TERRAIN / MAP_OVERLAYS in engine-data).
import { MAP_TERRAIN, MAP_OVERLAYS } from "./engine-data.mjs";

export const FLAG = "battlemap";

/** Check a parsed file. Returns an error message, or null when it's usable. */
export function validateBattleMap(json) {
  if (!json || json.format !== "qin-battlemap") return "This isn't a battle map file (format should be \"qin-battlemap\").";
  if (json.version !== 1) return `Unsupported battle map version ${json.version} (this system reads version 1).`;
  if (!json.scene?.cols || !json.scene?.rows || !json.scene?.gridSize) return "The battle map has no scene size.";
  if (!Array.isArray(json.tiles)) return "The battle map has no squares.";
  return null;
}

/**
 * The compact form kept on the scene: terrain per square (row by row), overlays and extras by square index,
 * structures as exported. Unknown terrain/overlay ids are kept (they just have no effects) and reported.
 */
export function encodeBattleMap(json) {
  const { cols, rows, gridSize } = json.scene;
  const terrain = new Array(cols * rows).fill("plains");
  const overlays = {}, extras = {}, unknown = new Set();
  for (const t of json.tiles) {
    if (!(t.x >= 0 && t.y >= 0 && t.x < cols && t.y < rows)) continue;
    const i = t.y * cols + t.x;
    terrain[i] = t.terrain || "plains";
    if (!MAP_TERRAIN[terrain[i]]) unknown.add(terrain[i]);
    if (t.overlays?.length) {
      overlays[i] = [...t.overlays];
      for (const o of t.overlays) if (!MAP_OVERLAYS[o]) unknown.add(o);
    }
    const ex = {};
    for (const k of ["facing", "facingDeg", "gateOpen"]) if (t[k] !== undefined) ex[k] = t[k];
    if (Object.keys(ex).length) extras[i] = ex;
  }
  return {
    data: { version: 1, name: json.name ?? "Battle map", layoutCode: json.layoutCode ?? null, cols, rows, gridSize, terrain, overlays, extras, structures: json.structures ?? [] },
    unknown: [...unknown],
  };
}

/** Squares for the engine: { "x,y": { terrain, overlays?, ...extras } }. */
export function decodeTiles(flag) {
  if (!flag?.terrain) return null;
  const out = {};
  const { cols } = flag;
  flag.terrain.forEach((terrain, i) => {
    const t = { terrain };
    if (flag.overlays?.[i]) t.overlays = flag.overlays[i];
    if (flag.extras?.[i]) Object.assign(t, flag.extras[i]);
    out[`${i % cols},${Math.floor(i / cols)}`] = t;
  });
  return out;
}

/**
 * The map's city gates as battle gates: one per "city-gate" structure (a 1x2 double gate shares one), or, for
 * files without gate structures, gate squares paired with a neighbour along the wall. All start friendly-owned
 * and locked (unless the file says open); the GM changes owners in the Battle panel.
 */
export function gatesFromMap(flag) {
  if (!flag?.terrain) return [];
  const { cols } = flag;
  const isGate = (i) => (flag.overlays?.[i] ?? []).includes("city-gate");
  const openAt = (x, y) => !!flag.extras?.[y * cols + x]?.gateOpen;
  let groups = (flag.structures ?? []).filter(s => s.type === "city-gate" && s.squares?.length).map(s => s.squares.map(([x, y]) => [x, y]));
  if (!groups.length) {
    const used = new Set();
    flag.terrain.forEach((_, i) => {
      if (!isGate(i) || used.has(i)) return;
      const x = i % cols, y = Math.floor(i / cols), sq = [[x, y]];
      used.add(i);
      for (const j of [i + 1, i + cols]) if (isGate(j) && !used.has(j) && (j !== i + 1 || (j % cols) !== 0)) { used.add(j); sq.push([j % cols, Math.floor(j / cols)]); break; }
      groups.push(sq);
    });
  }
  return groups.map((squares, n) => ({ id: `g${n + 1}`, squares, owner: "friendly", state: squares.some(([x, y]) => openAt(x, y)) ? "open" : "locked" }));
}

/* ------------------------------------------------------------ Foundry: import a file as a new scene */

function pickFile() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = ".json,application/json";
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null));
    input.click();
  });
}

function dataUrlToFile(dataUrl, filename) {
  const [head, b64] = dataUrl.split(",");
  const mime = head.match(/data:([^;]+)/)?.[1] ?? "image/png";
  const bin = atob(b64), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], filename, { type: mime });
}

/** GM: pick a .battlemap.json, upload its image, and create a scene laid out for the battle. */
export async function importBattleMap(systemId) {
  if (!game.user.isGM) return ui.notifications.warn("Only the GM can import battle maps.");
  const file = await pickFile();
  if (!file) return;
  let json;
  try { json = JSON.parse(await file.text()); } catch { return ui.notifications.error("That file isn't valid JSON."); }
  const bad = validateBattleMap(json);
  if (bad) return ui.notifications.error(bad);
  ui.notifications.info(`Importing ${json.name ?? file.name}…`);

  // the map image goes in the world's folder: worlds/<world>/battlemaps/
  let src = null;
  if (json.image?.dataUrl) {
    const FP = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
    const dir = `worlds/${game.world.id}/battlemaps`;
    try { await FP.createDirectory("data", dir); } catch { /* already there */ }
    const name = (json.image.filename || `${(json.name || "battle-map").replace(/[^\w-]+/g, "-")}.png`).replace(/[^\w.-]+/g, "-");
    try {
      const res = await FP.upload("data", dir, dataUrlToFile(json.image.dataUrl, name), {}, { notify: false });
      src = res?.path ?? `${dir}/${name}`;
    } catch (e) {
      console.error("Qin | battle map image upload failed", e);
      ui.notifications.warn("The map image couldn't be uploaded; the scene is created without a background.");
    }
  }

  const { data, unknown } = encodeBattleMap(json);
  const sc = json.scene;
  const scene = await Scene.create({
    name: json.name || "Battle map",
    width: sc.width ?? sc.cols * sc.gridSize, height: sc.height ?? sc.rows * sc.gridSize,
    padding: 0, grid: { size: sc.gridSize, type: CONST.GRID_TYPES.SQUARE },
    background: src ? { src } : undefined,
    tokenVision: false, fog: { exploration: false },
    flags: { [systemId]: { [FLAG]: data } },
  });
  // newer Foundry keeps the background on the scene's first level
  if (src && scene && !scene.background?.src && scene.levels?.size) {
    try { await scene.levels.contents[0].update({ background: { src } }); } catch (e) { console.warn("Qin | setting the level background", e); }
  }
  ui.notifications.info(`Created scene "${scene.name}" (${sc.cols} × ${sc.rows} squares).`);
  if (unknown.length) ui.notifications.warn(`Unknown terrain or overlays (no effects yet): ${unknown.join(", ")}.`);
  await scene.view();
  return scene;
}
