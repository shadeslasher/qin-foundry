// Animation recorder (David, 2026-11-11): records battle animations frame by frame on a virtual clock, so they can be
// turned into a video even when no one is watching the screen (a hidden browser tab doesn't animate). GM only.
//
//   const r = await game.qin.recorder.record({ start: () => game.qin.battleRequest({...}), dir: "some/folder" });
//
// While it records, timers, Date.now, CSS animations and the canvas ticker all run on the virtual clock; each frame is
// the canvas as drawn plus the page overlays the battle shows over it (the activation dim, the skill banner, ...),
// drawn into the frame through an SVG snapshot. Sounds are not played: each one is logged with its time. The result
// is a folder in `dir` holding the frames (JPEGs) and meta.json (frame times and the sound log).

/** Page overlays drawn into the frames. */
export const OVERLAYS = [".qin-act-dim", ".qin-ab"];
/** The overlays that mean an animation is still playing (the turn banner can stay on the page). */
export const BUSY_OVERLAYS = [".qin-act-dim", ".qin-ab"];
/** Is this overlay showing at all? */
function shown(el) {
  const cs = getComputedStyle(el), r = el.getBoundingClientRect();
  return cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity) > 0.01 && r.width > 0 && r.height > 0;
}

/* ------------------------------------------------------------ virtual clock */

function virtualClock() {
  const real = { setTimeout: window.setTimeout, clearTimeout: window.clearTimeout, setInterval: window.setInterval,
    clearInterval: window.clearInterval, dateNow: Date.now, Audio: window.Audio };
  const V = { now: 0, q: [], seq: 1, sounds: [], base: performance.now(), dateBase: real.dateNow.call(Date), started: new Map(), real };
  const add = (fn, ms, args, every) => { const id = "v" + V.seq++; V.q.push({ id, at: V.now + Math.max(0, Number(ms) || 0), fn, args, every }); return id; };
  const drop = (id) => { if (typeof id === "string" && id[0] === "v") { V.q = V.q.filter(x => x.id !== id); return true; } return false; };
  V.install = () => {
    window.setTimeout = (fn, ms, ...args) => (typeof fn === "function" ? add(fn, ms, args) : real.setTimeout.call(window, fn, ms));
    window.clearTimeout = (id) => { if (!drop(id)) real.clearTimeout.call(window, id); };
    window.setInterval = (fn, ms, ...args) => (typeof fn === "function" ? add(fn, ms, args, Math.max(10, Number(ms) || 10)) : real.setInterval.call(window, fn, ms));
    window.clearInterval = (id) => { if (!drop(id)) real.clearInterval.call(window, id); };
    Date.now = () => V.dateBase + V.now;
    window.Audio = function (src) { V.sounds.push([V.now, String(src ?? "")]); return { play: () => Promise.resolve(), pause() {}, volume: 1, addEventListener() {} }; };
  };
  V.uninstall = () => {
    Object.assign(window, { setTimeout: real.setTimeout, clearTimeout: real.clearTimeout, setInterval: real.setInterval, clearInterval: real.clearInterval, Audio: real.Audio });
    Date.now = real.dateNow;
    // let page animations carry on in real time (not the finished ones: playing those would start them again)
    for (const a of V.started.keys()) try { const end = a.effect?.getComputedTiming?.().endTime ?? Infinity; if (a.effect?.target?.isConnected && Number(a.currentTime) < end) a.play(); } catch { /* gone */ }
  };
  /** Run due timers, set every CSS animation to its virtual time and draw the canvas at this time. */
  V.sync = () => {
    for (let guard = 0; guard < 1000; guard++) {
      V.q.sort((a, b) => a.at - b.at);
      const d = V.q[0];
      if (!d || d.at > V.now) break;
      if (d.every) d.at += d.every; else V.q.shift();
      try { d.fn(...(d.args ?? [])); } catch (e) { console.warn("Qin | recorder timer", e); }
    }
    for (const a of document.getAnimations()) {
      if (!V.started.has(a)) V.started.set(a, V.now - (Number(a.currentTime) || 0));
      try { a.pause(); a.currentTime = V.now - V.started.get(a); } catch { /* gone */ }
    }
    canvas.app.ticker.update(V.base + V.now);
  };
  // a yield that a hidden tab doesn't throttle (its timers run at most once a second): a message to ourselves
  const ch = new MessageChannel(), waiting = [];
  ch.port1.onmessage = () => waiting.shift()?.();
  const tick = () => new Promise(r => { waiting.push(r); ch.port2.postMessage(0); });
  V.realWait = async (ms) => { const end = performance.now() + ms; do { await tick(); } while (performance.now() < end); };
  return V;
}

/* ------------------------------------------------------------ overlays into the frame */

const dataUrls = new Map();
function toDataUrl(src) {
  if (!src || src.startsWith("data:")) return Promise.resolve(src);
  if (!dataUrls.has(src)) dataUrls.set(src, fetch(src).then(r => r.blob()).then(b => new Promise(res => {
    const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => res(src); fr.readAsDataURL(b);
  })).catch(() => src));
  return dataUrls.get(src);
}

/** The page's CSS rules the overlays need (their own rules, keyframes left out, and the fonts they use), fonts inlined. */
let cssCache = null;
/** Every CSS rule on the page with the sheet it came from, through @import, @layer and @media. */
function allRules() {
  const out = [];
  const walk = (rules, href) => {
    for (const r of rules ?? []) {
      if (r.styleSheet) { try { walk(r.styleSheet.cssRules, r.styleSheet.href ?? href); } catch { /* other origin */ } }
      else if (r.type === CSSRule.STYLE_RULE || r.type === CSSRule.FONT_FACE_RULE) out.push([r, href]);
      else if (r.cssRules) walk(r.cssRules, href);
    }
  };
  for (const sheet of document.styleSheets) { try { walk(sheet.cssRules, sheet.href ?? location.href); } catch { /* other origin */ } }
  return out;
}
async function overlayCss(selectors) {
  if (cssCache) return cssCache;
  const keys = selectors.map(s => s.replace(/^[.#]/, "").split(/[\s.#:[]/)[0]);
  const rules = allRules(), parts = [], fonts = new Set();
  for (const [r] of rules) {
    if (r.type !== CSSRule.STYLE_RULE || !keys.some(k => r.selectorText?.includes(k))) continue;
    parts.push(r.cssText);
    const ff = r.style.fontFamily || (r.style.font?.match(/"([^"]+)"/)?.[1] ?? "");
    for (const f of ff.split(",")) fonts.add(f.trim().replace(/^["']|["']$/g, ""));
  }
  for (const [r, href] of rules) {
    if (r.type !== CSSRule.FONT_FACE_RULE) continue;
    const fam = r.style.getPropertyValue("font-family").trim().replace(/^["']|["']$/g, "");
    if (!fonts.has(fam)) continue;
    let txt = r.cssText;
    for (const m of [...txt.matchAll(/url\(["']?([^"')]+)["']?\)/g)]) txt = txt.replace(m[0], `url("${await toDataUrl(new URL(m[1], href).href)}")`);
    parts.push(txt);
  }
  return (cssCache = parts.join("\n"));
}

/** Draw one overlay element as it looks now (its animations frozen at their current values). */
async function overlaySvg(el, W, H, css) {
  const clone = el.cloneNode(true);
  const anims = new Map(); // element -> animated properties
  for (const a of document.getAnimations()) {
    const t = a.effect?.target; if (!t || !el.contains(t)) continue;
    const props = new Set(); for (const k of a.effect.getKeyframes?.() ?? []) for (const p of Object.keys(k)) if (!["offset", "easing", "composite", "computedOffset"].includes(p)) props.add(p);
    anims.set(t, new Set([...(anims.get(t) ?? []), ...props]));
  }
  const walk = (o, c) => {
    if (o.nodeType !== 1) return;
    const cs = getComputedStyle(o);
    c.style.animation = "none"; c.style.transition = "none";
    for (const p of anims.get(o) ?? []) { const css = p.replace(/[A-Z]/g, m => "-" + m.toLowerCase()); c.style.setProperty(css, cs.getPropertyValue(css)); }
    if (o.style?.opacity !== undefined && o === el) c.style.opacity = cs.opacity;
    for (let i = 0; i < o.children.length; i++) walk(o.children[i], c.children[i]);
  };
  walk(el, clone);
  for (const img of clone.querySelectorAll("img")) img.setAttribute("src", await toDataUrl(img.getAttribute("src")));
  const html = new XMLSerializer().serializeToString(clone);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><foreignObject x="0" y="0" width="${W}" height="${H}">`
    + `<div xmlns="http://www.w3.org/1999/xhtml" style="position:relative;width:${W}px;height:${H}px;overflow:hidden"><style><![CDATA[${css.replaceAll("]]>", "")}]]></style>${html}</div></foreignObject></svg>`;
}

/** The spotlight dim (styles/qin.css .qin-act-dim / .qin-deep): dark everywhere but a soft circle at --x/--y of radius --r. */
function drawDim(ctx, el, k) {
  const cs = getComputedStyle(el), num = (v) => parseFloat(cs.getPropertyValue(v)) || 0;
  const x = num("--x") * k, y = num("--y") * k, r = Math.max(1, num("--r") * k), deep = el.classList.contains("qin-deep");
  const g = ctx.createRadialGradient(x, y, r, x, y, r * (deep ? 1.6 : 1.85));
  g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, `rgba(0,0,0,${deep ? 0.7 : 0.55})`);
  ctx.save(); ctx.globalAlpha = Number(cs.opacity); ctx.fillStyle = g; ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height); ctx.restore();
}

/* ------------------------------------------------------------ record */

/**
 * Record an animation. `start`: called once recording runs (e.g. runs a battle action); the virtual clock stays still
 * until it settles. Stops when the battle animation queue, every overlay and every extra ticker job are done (plus
 * `tailMs`), or at `maxMs`. `preMs` of frames come before `start`. Returns { path (the folder), frames, ms, sounds, result }.
 */
export async function record({ start = null, fps = 20, preMs = 600, tailMs = 900, maxMs = 20000, dir = "", name = null,
  overlays = OVERLAYS, quality = 0.88, onFrame = null } = {}) {
  if (!game.user?.isGM) throw new Error("Only the GM can record");
  const { battleAnimBusy } = await import("../attack-fx.mjs");
  const { uniqueFxBusy } = await import("../battle/unique-fx.mjs");
  const view = canvas.app.view, W = view.width, H = view.height, step = 1000 / fps;
  const out = document.createElement("canvas"); out.width = W; out.height = H;
  const ctx = out.getContext("2d");
  const css = await overlayCss(overlays);
  const V = virtualClock(), frames = [];
  const grab = async () => {
    canvas.app.renderer.render(canvas.stage);
    ctx.drawImage(view, 0, 0, W, H);
    for (const el of document.querySelectorAll(overlays.join(","))) {
      if (el.parentElement?.closest(overlays.join(","))) continue; // drawn with its parent
      if (!shown(el)) continue;
      // the activation dim is drawn straight onto the frame: as an SVG picture it sometimes didn't decode in time and
      // whole stretches of frames lost it (2026-11-12: the dim looked late in the Battle Sheets videos)
      if (el.matches(".qin-act-dim")) { try { drawDim(ctx, el, W / innerWidth); continue; } catch (e) { console.warn("Qin | recorder dim", e); } }
      try {
        const img = new Image();
        img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(await overlaySvg(el, W, H, css));
        await img.decode(); ctx.drawImage(img, 0, 0, W, H);
      } catch (e) { console.warn("Qin | recorder overlay", e); }
    }
    // toDataURL, not toBlob: it is synchronous, and toBlob's callback can wait a long time in a hidden tab
    const b64 = atob(out.toDataURL("image/jpeg", quality).split(",")[1]), data = new Uint8Array(b64.length);
    for (let i = 0; i < b64.length; i++) data[i] = b64.charCodeAt(i);
    frames.push({ t: Math.round(V.now), data });
    onFrame?.(frames.length, V.now);
  };
  const perf = { sync: 0, wait: 0, grab: 0 };
  const timed = async (k, fn) => { const t = performance.now(); await fn(); perf[k] += performance.now() - t; };
  const advance = async () => { V.now += step; await timed("sync", () => V.sync()); await timed("wait", () => V.realWait(2)); await timed("grab", grab); };
  // The canvas ticker keeps the last time it ran (and, with a frame cap, the last frame time). A recording runs faster
  // than real time, so after one recording those times lie ahead of the next one's clock, and the ticker skipped every
  // update until the clock caught up: the activation dim and light showed late (2026-11-12). Start it from our clock.
  const resetTicker = (t) => { const tk = canvas.app.ticker; tk.lastTime = t; if ("_lastFrame" in tk) tk._lastFrame = t; };
  resetTicker(V.base);
  V.install();
  try {
    V.sync();
    for (let t = 0; t < preMs; t += step) await advance();
    // the action: the clock waits for it (the server round trip) so nothing jumps ahead
    let done = !start, failed = null, result = null;
    if (start) Promise.resolve().then(start).then(r => { result = r; done = true; }, e => { failed = e; done = true; });
    for (let i = 0; i < 600 && !done; i++) { await V.realWait(25); V.sync(); }
    if (failed) throw failed;
    const t0 = V.now;
    let idleSince = null;
    while (V.now - t0 < maxMs) {
      await advance();
      const bursting = (canvas.tokens?.placeables ?? []).some(t => t.qinBurst && !t.qinBurst.destroyed); // a buff/debuff burst still playing
      const busy = battleAnimBusy() || uniqueFxBusy() || bursting || [...document.querySelectorAll(BUSY_OVERLAYS.join(","))].some(shown);
      if (busy) idleSince = null; else if (idleSince === null) idleSince = V.now; else if (V.now - idleSince >= tailMs) break;
    }
    const meta = { fps, width: W, height: H, start: t0, frames: frames.map((f, i) => ({ i, t: f.t, file: `f${String(i).padStart(4, "0")}.jpg` })), sounds: V.sounds, result };
    V.uninstall(); resetTicker(performance.now());
    // a folder per recording: the frames and meta.json (Foundry only takes media and text files, so no archive)
    const folder = `${dir ? dir + "/" : ""}${name ?? `rec-${new Date(V.real.dateNow.call(Date)).toISOString().replace(/[:.]/g, "-")}`}`;
    const FP = foundry.applications?.apps?.FilePicker?.implementation ?? FilePicker;
    for (const d of [dir, folder].filter(Boolean)) try { await FP.createDirectory("data", d); } catch { /* exists */ }
    const up = async (fname, data, type) => {
      const r = await FP.upload("data", folder, new File([data], fname, { type }), {}, { notify: false });
      if (!r || r.status === "error") throw new Error(`Upload of ${fname} failed`);
    };
    const queue = frames.map((f, i) => () => up(meta.frames[i].file, f.data, "image/jpeg"));
    await Promise.all(Array.from({ length: 6 }, async () => { while (queue.length) await queue.shift()(); }));
    await up("meta.json", JSON.stringify(meta), "application/json");
    return { path: folder, frames: frames.length, ms: Math.round(V.now - t0), sounds: V.sounds, result, perf: Object.fromEntries(Object.entries(perf).map(([k, v]) => [k, Math.round(v)])) };
  } finally {
    try { V.uninstall(); resetTicker(performance.now()); } catch { /* already */ }
  }
}
