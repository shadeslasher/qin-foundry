// GM tool: move everyone's camera to a tile (David, 2026-11-10). Press the button in the GM controls (or the hotkey), then
// click a tile: every client on the scene pans there, centred on that tile, and sees a ping on it. Each player keeps their zoom.
// Esc or right-click cancels.
import { SYSTEM_ID } from "../config.mjs";

const SOCKET = `system.${SYSTEM_ID}`;
let picking = false, onChange = null;
export const cameraPicking = () => picking;
export function setCameraPickListener(fn) { onChange = fn; }

/** Pan this client's view to a scene point and ping it. */
function panLocal(x, y) {
  if (!canvas?.ready) return;
  canvas.animatePan({ x, y, duration: 700 });
  try { canvas.ping?.({ x, y }, { style: "pulse", color: "#e8c45a", duration: 1600 }); } catch { /* older cores */ }
}

/** GM: send everyone's view to the centre of the tile at a scene point. */
export function pullCameras(x, y) {
  if (!game.user.isGM || !canvas?.scene) return;
  const c = canvas.grid?.getCenterPoint ? canvas.grid.getCenterPoint({ x, y }) : { x, y };
  game.socket?.emit(SOCKET, { type: "pullCamera", sceneId: canvas.scene.id, x: c.x, y: c.y });
  panLocal(c.x, c.y);
}

function stop() {
  if (!picking) return;
  picking = false;
  document.body.classList.remove("qin-camera-pick");
  const board = document.getElementById("board");
  board?.removeEventListener("pointerdown", onDown, true);
  onChange?.();
}
function onDown(ev) {
  if (!picking) return;
  ev.preventDefault(); ev.stopImmediatePropagation();
  if (ev.button !== 0) return stop();                    // right-click cancels
  const p = canvas.canvasCoordinatesFromClient
    ? canvas.canvasCoordinatesFromClient({ x: ev.clientX, y: ev.clientY })
    : canvas.stage.toLocal({ x: ev.clientX, y: ev.clientY });
  stop();
  const d = canvas.dimensions;
  if (p.x < d.sceneX || p.y < d.sceneY || p.x > d.sceneX + d.sceneWidth || p.y > d.sceneY + d.sceneHeight)
    return ui.notifications.warn("That's outside the battlefield.");
  pullCameras(p.x, p.y);
}

/** GM: start (or cancel) picking the tile everyone's camera moves to. */
export function toggleCameraPick() {
  if (!game.user.isGM || !canvas?.ready) return;
  if (picking) return stop();
  picking = true;
  document.body.classList.add("qin-camera-pick");
  document.getElementById("board")?.addEventListener("pointerdown", onDown, true);
  ui.notifications.info("Click a tile: everyone's camera moves there. Esc or right-click cancels.");
  onChange?.();
}

document.addEventListener("keydown", (e) => { if (e.key === "Escape" && picking) stop(); });
Hooks.on("canvasTearDown", stop);

Hooks.once("init", () => {
  game.keybindings.register(SYSTEM_ID, "pullCamera", {
    name: "Move everyone's camera to a tile",
    hint: "GM: then click a tile on the battlefield. Every player's view pans there.",
    editable: [{ key: "KeyC", modifiers: ["Shift"] }],
    restricted: true,
    onDown: () => { toggleCameraPick(); return true; },
  });
});
Hooks.once("ready", () => {
  game.socket?.on(SOCKET, (data) => {
    if (data?.type !== "pullCamera" || canvas?.scene?.id !== data.sceneId) return;
    panLocal(data.x, data.y);
  });
});
