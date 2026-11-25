// The battle AI on the GM computer's spare cores (David, 2026-11-24: "run on my cores/pc to run faster").
// thinkStep() gives the same answer as aiStep(), worked out in background threads (ai-worker.mjs):
//  - choosing which unit goes next (the slow part at Art of War 2+): every unit's best move is scored, the units
//    shared out between the threads, and the best one picked as before (ties to the earlier unit)
//  - anything else: the whole step in one thread, so the screen keeps drawing meanwhile
// If the threads can't start or fail, the AI thinks on the main thread as it always did.
import * as AI from './ai.mjs';
import * as E from './engine.mjs';
import * as SK from './skills.mjs';

const SIZE = Math.max(1, Math.min(8, ((globalThis.navigator?.hardwareConcurrency) || 4) - 2));
const TIMEOUT = 30000;
let workers = null, broken = false, seq = 0, rr = 0;
const waiting = new Map();

function pool() {
  if (broken || typeof Worker === 'undefined') return null;
  if (workers) return workers;
  try {
    workers = Array.from({ length: SIZE }, () => {
      const w = new Worker(new URL('./ai-worker.mjs', import.meta.url), { type: 'module' });
      w.onmessage = (ev) => { const d = ev.data || {}, p = waiting.get(d.id); if (!p) return; waiting.delete(d.id); clearTimeout(p.timer); d.ok ? p.resolve(d.result) : p.reject(new Error(d.error)); };
      w.onerror = (ev) => { ev.preventDefault?.(); fail('a thread failed: ' + (ev.message || 'error')); };
      return w;
    });
  } catch (e) { fail('threads unavailable: ' + e); return null; }
  return workers;
}
/** Give up on the threads for this session (the main thread takes over). */
function fail(why) {
  if (!broken) console.warn('Qin | battle AI threads off, thinking on the main thread instead:', why);
  broken = true;
  for (const [, p] of waiting) { clearTimeout(p.timer); p.reject(new Error(why)); }
  waiting.clear();
  try { workers?.forEach(w => w.terminate()); } catch { /* */ }
  workers = null;
}
function call(w, op, s, args) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { if (waiting.delete(id)) reject(new Error('timed out')); }, TIMEOUT);
    waiting.set(id, { resolve, reject, timer });
    try { w.postMessage({ id, op, s, args }); } catch (e) { waiting.delete(id); clearTimeout(timer); reject(e); }
  });
}

/** How many background threads the AI uses (0: thinking on the main thread). */
export const aiThreads = () => (broken ? 0 : SIZE);

/** The AI's next action, like aiStep(s, sides, opts), worked out in the background threads. */
export async function thinkStep(s, sides, opts = {}) {
  const ws = pool();
  if (!ws) return AI.aiStep(s, sides, opts);
  try {
    const pick = pickJob(s, sides, opts);
    if (pick?.done) return pick.action;
    if (pick && pick.ids.length > 1) {
      const n = Math.min(ws.length, pick.ids.length), parts = Array.from({ length: n }, () => []);
      pick.ids.forEach((id, i) => parts[i % n].push(i)); // dealt out in turn: neighbours in the list cost about the same
      const res = await Promise.all(parts.map((idx, k) => call(ws[k], 'scores', s, { side: pick.side, ids: idx.map(i => pick.ids[i]), opts })));
      const scores = new Array(pick.ids.length);
      parts.forEach((idx, k) => idx.forEach((i, j) => { scores[i] = res[k][j]; }));
      return AI.pickBest(pick.ids, scores);
    }
    const w = ws[rr++ % ws.length];
    return await call(w, 'step', s, { sides, opts });
  } catch (e) {
    if (!broken) console.warn('Qin | battle AI thread', e);
    if (/not defined|import|module|DataClone|could not be cloned/i.test(String(e))) fail(String(e));
    return AI.aiStep(s, sides, opts);
  }
}
/** Is this step the "which unit goes next" choice of an AI side? Then { side, ids } to score, or { done, action }. */
function pickJob(s, sides, opts) {
  if (s.duels?.pending || s.turn?.phase === 'tactics') return null;
  const rv = SK.pendingReveal(s); if (rv) return null;
  const p = E.prompt(s);
  if (p.kind !== 'host-pick' || !sides?.[p.side]) return null;
  const c = AI.pickCandidates(s, p.side, opts);
  if (!c) return { done: true, action: null };
  if (c.pick) return { done: true, action: c.pick };
  return { side: p.side, ids: c.ids };
}
