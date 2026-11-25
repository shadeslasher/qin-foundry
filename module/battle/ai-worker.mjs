// Battle AI background thread (David, 2026-11-24): works out AI moves away from the screen, so the map doesn't
// freeze while the AI thinks, and several of these split one decision between the computer's cores (ai-pool.mjs).
// Plain battle logic only: no Foundry here.
import * as AI from './ai.mjs';

self.onmessage = (ev) => {
  const { id, op, s, args } = ev.data || {};
  try {
    let result = null;
    if (op === 'step') result = AI.aiStep(s, args.sides, args.opts || {});
    else if (op === 'scores') {
      const S = AI.pickStrategy(s, args.side, args.opts || {});
      result = args.ids.map(uid => AI.pickScore(s, args.side, uid, args.opts || {}, S));
    } else if (op === 'ping') result = 'pong';
    self.postMessage({ id, ok: true, result });
  } catch (e) {
    self.postMessage({ id, ok: false, error: String((e && e.stack) || e) });
  }
};
