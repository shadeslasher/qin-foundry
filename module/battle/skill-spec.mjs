// Battlefield skill specs (David, 2026-11-05): the vocabulary officers' battlefield passives and actives are written
// in, and a validator. The runtime that applies them is skills.mjs. Pure (no Foundry). Format: SCHEMA.md
// (kept beside the translation work; summarised in the comments below).

export const STATS = ['attack', 'command', 'commandAtk', 'commandDef', 'meleeDef', 'rangedDef', 'move', 'range', 'armor', 'pen',
  'damage', 'resist', 'moraleLossLess', 'checkpointLess', 'skillLossLess', 'anyLossLess', 'enemyLoss', 'enemyLossAtk',
  'startMorale', 'overwatch', 'forcedMarchCost', 'regenCap', 'moraleFloor',
  // v3
  'damageTaken', 'reflectMelee', 'moraleCapAttack', 'moraleCapRound', 'surroundLossLess', 'fireLossLess', 'fireCasualties',
  'contestAtk', 'contestNext', 'skillCost', 'moveAway', 'moveNoAttack'];
export const FLAGS = ['noSurrender', 'noRout', 'cantBeSurrounded', 'noRearAgainst', 'noChargeAgainst', 'cantBePushed',
  'ignoreLowMorale', 'ignoreStrength', 'noCounterDamage', 'noStrikeBack', 'revealHidden', 'revealTactics', 'ignoreTerrainCost',
  'splash', 'stopAdjacent', 'reroll', 'noRoutLoss', 'untargetable',
  // v3
  'asRanged', 'asRear', 'asCharge', 'noTileDefense', 'ignoreDefensiveTraits', 'passThroughEnemies', 'crossWater', 'ignoreZoc', 'stopOn',
  'hideAnywhere', 'cantBeAmbushed', 'noRevealBySkills', 'noOverwatchAgainst', 'regenEvenIfFought', 'regenToResting', 'routLossNear',
  'casualtyHalf', 'noRearNearby', 'challengeFirstAttacker', 'drawMeleeAttacks', 'rideThrough', 'extraTactic', 'gateRange', 'gateDouble', 'noStrikeBackIfWin', 'checkpointHalf', 'ignoreTraits', 'cantRefuseDuel', 'ignoreMoveLimits'];
export const EVENTS = ['battleStart', 'roundStart', 'turnStart', 'turnEnd', 'win', 'lose', 'attackWin', 'defendWin', 'kill',
  'allyFalls', 'enemyEndsAdjacent', 'alliesTurnStart', 'firstBelowHalfMorale',
  'enemyTurnStart', 'roundEnd', 'enemyFalls', 'attacked', 'allyWins',
  // v3
  'enemyMoves', 'allyMoves', 'allyTurnEnd', 'enemyTurnEnd', 'duelWin', 'duelLose', 'duelRefused', 'allyDuelWin'];
export const STATUSES = ['cantMove', 'cantAttack', 'cantMoveOrAttack', 'skipTurn', 'moveOrAttack', 'noSkills', 'stripDefenses',
  'halfMove', 'cantAttackSource', 'maxMove1',
  // v3
  'isolated', 'noTactics', 'noOverwatchAgainst', 'cantMoveAway', 'cantAttackNearSource'];
export const DURATIONS = ['thisTurn', 'nextAttack', 'nextRoll', 'untilNextTurnEnd', 'untilNextTurnStart', 'battle', 'nextTurn',
  'untilSourceTurnStart', 'untilSourceTurnEnd', 'nextContest', 'nextSkill'];
export const TERRAINS = ['plains', 'forest', 'trees', 'tall-grass', 'marsh', 'sand', 'rocky', 'steppe', 'farmland', 'ford', 'river',
  'lake', 'scorched', 'road', 'bridge', 'hill', 'city-wall', 'city-gate', 'fortress-tower', 'town', 'fort', 'camp', 'command-tent',
  'watchtower', 'ruins', 'supply-depot', 'dock', 'pass', 'water', 'wall', 'village', 'gate', 'paving', 'city', 'mountain', 'palisade', 'burning', 'catapult', 'boat'];
const FILTER_KEYS = ['category', 'melee', 'levy', 'trait', 'officer', 'officerType', 'onTerrain', 'nearWater', 'hidden', 'notActed',
  'acted', 'moraleBelow', 'moraleAbove', 'healthBelow', 'surroundedOrEngaged', 'notAttackedLastTurn', 'noEnemyAdjacent',
  'attackedMeLastTurn', 'tierAbove', 'flammable',
  // v2
  'isPick', 'isSource', 'isTarget', 'allyAdjacent', 'allyWithin', 'enemyAdjacent', 'tierBelow', 'officerTierAtLeast', 'lessMoraleThanSource',
  'holding', 'wasAttackedThisTurn', 'attackedThisTurn', 'any',
  // v3
  'not', 'adjacentToSource', 'wonLastMelee', 'lostLastMelee', 'attackedAllyLastTurn', 'beatAllyLastTurn', 'attackedSourceRecently', 'attackedBySource',
  'lostAttackRecently', 'moraleLostAtLeast', 'moraleLostThisRound', 'movedThisBattle', 'movedLastTurn', 'adjacentAtTurnStart', 'startedOn',
  'startedNearWater', 'belowResting', 'fullMorale', 'firstAttackTaken', 'unitTier', 'unitFaction', 'officerRank', 'officerTier', 'aspectAbove',
  'ledByFactionLeader', 'sameFamily', 'allyAdjacentWhere', 'allyWithinWhere', 'noAllyWithin', 'attackFrom', 'fromHiding', 'higherGround',
  'lowerGround', 'fallKind', 'byAllyWithin', 'allyFallenThisBattle', 'nearPick',
  'nextToTerrain', 'impassableAdjacent', 'carrying', 'onCatapult', 'arrivedAsReinforcement', 'attackedSinceItsTurn', 'empty', 'ownSide'];
const COND_KEYS = [...FILTER_KEYS, 'attacking', 'defending', 'kind', 'moved', 'notMoved', 'movedAtLeast', 'firstAttackOfBattle',
  'firstAttackOfTurn', 'notAttackedThisBattle', 'selfOnTerrain', 'selfHidden', 'selfNotMoved', 'selfMoraleAbove', 'selfMoraleBelow'];
const STEP_KEYS = ['morale', 'health', 'buff', 'move', 'attack', 'contest', 'status', 'push', 'reveal', 'fire', 'resetCooldown',
  'extraTurn', 'reinforce', 'swap', 'selfStatus', 'if', 'onKill', 'onWin', 'onLose', 'manual', 'hide', 'fireArea',
  // v3
  'casualties', 'turnOrder', 'setTerrain', 'openGate', 'repair', 'leave', 'convert', 'spawn', 'grantTrait', 'removeTrait', 'stealTrait',
  'stepTrait', 'cancelTactic', 'cooldown', 'overwatchOn', 'custom', 'counter', 'forceToward', 'forceAttack', 'moveInto', 'splitMorale', 'blast', 'overwatchShot', 'cleanse', 'swapUnits', 'climb'];

/** Check a spec; returns a list of problems (empty = fine). `kind`: 'passive' | 'active'. */
export function validateSpec(spec, kind) {
  const errs = [];
  const bad = (path, msg) => errs.push(path + ': ' + msg);
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return ['spec: must be an object'];
  const top = kind === 'active' ? ['pick', 'do', 'manual', 'oncePerBattle', 'mods', 'flags', 'triggers', 'require', 'custom'] : ['mods', 'flags', 'triggers', 'manual', 'custom'];
  for (const k of Object.keys(spec)) if (!top.includes(k)) bad(k, 'unknown top-level key for a ' + kind);
  const picks = new Set((spec.pick || []).map(p => p && p.id));
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const terrains = (p, v) => { if (!Array.isArray(v)) return bad(p, 'must be a list'); for (const t of v) if (!TERRAINS.includes(t)) bad(p, 'unknown terrain "' + t + '"'); };
  const filter = (p, f, extra = []) => {
    if (f === undefined) return;
    if (!f || typeof f !== 'object' || Array.isArray(f)) return bad(p, 'must be an object');
    for (const [k, v] of Object.entries(f)) {
      if (![...FILTER_KEYS, ...extra].includes(k)) { bad(p + '.' + k, 'unknown condition'); continue; }
      if (k === 'onTerrain' || k === 'selfOnTerrain') terrains(p + '.' + k, v);
      if (k === 'any') { if (!Array.isArray(v) || !v.length) bad(p + '.any', 'list of filters (any one may match)'); else v.forEach((g, i) => filter(p + '.any[' + i + ']', g, extra)); }
      if (k === 'isPick' && !picks.has(v)) bad(p + '.isPick', 'pick "' + v + '" is not defined');
      if (k === 'not' || k === 'allyAdjacentWhere') filter(p + '.' + k, v, extra);
      if (k === 'allyWithinWhere') { if (!v || !isNum(v.range)) bad(p + '.allyWithinWhere', '{"range": N, "filter": {...}}'); else filter(p + '.allyWithinWhere.filter', v.filter, extra); }
      if ((k === 'officerRank' || k === 'officerTier') && !['above', 'below'].includes(v) && !isNum(v)) bad(p + '.' + k, '"above", "below" or a number');
      if (k === 'aspectAbove' && !['command', 'chi', 'earth', 'fire', 'metal', 'water', 'wood'].includes(v)) bad(p + '.aspectAbove', 'command or an aspect');
      if (k === 'attackFrom' && ![].concat(v).every(x => ['rear', 'side', 'front'].includes(x))) bad(p + '.attackFrom', 'rear|side|front (or a list)');
      if (k === 'fallKind' && ![].concat(v).every(x => ['routed', 'surrendered', 'destroyed'].includes(x))) bad(p + '.fallKind', 'routed|surrendered|destroyed');
      if (k === 'startedOn' || k === 'nextToTerrain') terrains(p + '.' + k, v);
      if (k === 'carrying' && !['ladders', 'engine'].includes(v)) bad(p + '.carrying', 'ladders|engine');
      if (k === 'category' && !['cavalry', 'infantry', 'ranged'].includes(v)) bad(p + '.category', 'cavalry|infantry|ranged');
      if (k === 'officerType' && !['Strategist', 'Commander', 'Vanguard', 'Champion', 'Sentinel'].includes(v)) bad(p + '.officerType', 'bad type');
      if (k === 'kind' && !['melee', 'ranged', 'charge', 'overwatch'].includes(v)) bad(p + '.kind', 'melee|ranged|charge|overwatch');
      if (['moraleBelow', 'moraleAbove', 'selfMoraleAbove', 'selfMoraleBelow'].includes(k) && !(isNum(v) || v === 'half')) bad(p + '.' + k, 'number or "half"');
      if (k === 'healthBelow' && !(isNum(v) || v === 'half')) bad(p + '.' + k, 'fraction or "half"');
    }
  };
  const who = (p, w, inStep) => {
    if (w === undefined) return;
    if (!w || typeof w !== 'object') return bad(p, 'must be an object');
    const keys = Object.keys(w);
    if (w.self === true && keys.length === 1) return;
    if (w.pick !== undefined) { if (!picks.has(w.pick)) bad(p, 'pick "' + w.pick + '" is not defined'); for (const k of keys) if (!['pick', 'filter'].includes(k)) bad(p + '.' + k, 'unexpected with pick'); filter(p + '.filter', w.filter); return; }
    if (w.target === true) { if (!inStep) bad(p, '"target" only inside steps/triggers/attacks'); return; }
    if (!['allies', 'enemies'].includes(w.side)) return bad(p, 'needs self, side (allies|enemies), pick or target');
    if (!(isNum(w.range) || isNum(w.exact) || w.all === true)) bad(p, 'needs range, exact or all');
    for (const k of keys) if (!['side', 'range', 'exact', 'all', 'self', 'filter', 'from'].includes(k)) bad(p + '.' + k, 'unknown WHO key');
    if (w.from !== undefined && !(w.from && (w.from.target === true || picks.has(w.from.pick)))) bad(p + '.from', '{"pick": id} or {"target": true}');
    filter(p + '.filter', w.filter);
  };
  const duration = (p, d) => {
    if (d === undefined) return bad(p, 'needs "for"');
    if (typeof d === 'string') { if (!DURATIONS.includes(d)) bad(p, 'unknown duration "' + d + '"'); return; }
    if (!d || !isNum(d.rounds) || d.rounds < 1) bad(p, 'duration must be a name or {"rounds": N}');
  };
  const mod = (p, m, inBuff) => {
    if (!m || typeof m !== 'object') return bad(p, 'must be an object');
    if (!STATS.includes(m.stat)) bad(p + '.stat', 'unknown stat "' + m.stat + '"');
    if (!isNum(m.value)) bad(p + '.value', 'must be a number');
    for (const k of Object.keys(m)) if (!['stat', 'value', 'who', 'if', 'vs', 'per', 'max'].includes(k)) bad(p + '.' + k, 'unknown MOD key');
    if (m.per !== undefined && typeof m.per !== 'string') bad(p + '.per', 'counter name ("routs" or one a counter step keeps)');
    if (!inBuff) who(p + '.who', m.who, false);
    filter(p + '.if', m.if, COND_KEYS);
    filter(p + '.vs', m.vs);
  };
  const flag = (p, f, inBuff) => {
    if (!f || typeof f !== 'string' && typeof f !== 'object') return bad(p, 'must be an object');
    const name = String(f.flag || '').split(':')[0];
    if (!FLAGS.includes(name)) bad(p + '.flag', 'unknown flag "' + f.flag + '"');
    if (['revealHidden', 'revealTactics', 'splash', 'asRanged', 'routLossNear', 'gateRange'].includes(name) && !isNum(Number(String(f.flag).split(':')[1]))) bad(p + '.flag', name + ':N needs a number');
    if (name === 'ignoreTerrainCost' || name === 'stopOn') for (const t of String(f.flag).split(':')[1]?.split(',') || []) if (!TERRAINS.includes(t) && t !== 'all') bad(p + '.flag', 'unknown terrain "' + t + '"');
    for (const k of Object.keys(f)) if (!['flag', 'who', 'if', 'limit'].includes(k)) bad(p + '.' + k, 'unknown FLAG key');
    if (!inBuff) who(p + '.who', f.who, false);
    filter(p + '.if', f.if, COND_KEYS);
  };
  const steps = (p, list) => {
    if (!Array.isArray(list)) return bad(p, 'must be a list of steps');
    list.forEach((st, i) => step(p + '[' + i + ']', st));
  };
  const step = (p, st) => {
    if (!st || typeof st !== 'object') return bad(p, 'must be an object');
    const main = Object.keys(st).filter(k => STEP_KEYS.includes(k));
    if (!main.length) return bad(p, 'unknown step (keys: ' + Object.keys(st).join(',') + ')');
    if (main.length > 1) bad(p, 'one step per object (found ' + main.join(', ') + ')');
    const k = main[0];
    const allowed = { morale: ['who', 'upToResting'], health: ['who'], buff: ['who', 'for'], move: ['who', 'mode', 'toward'], attack: ['who', 'moveFirst', 'extraMove'],
      contest: ['aspect', 'lose', 'win'], status: ['who', 'for', 'from'], push: ['who', 'thenAdvance', 'ifBlocked'], reveal: [], fire: [], resetCooldown: [], extraTurn: ['moveOnly'],
      reinforce: ['near', 'filter', 'onTerrain', 'arriveBuff'], swap: [], selfStatus: ['for'], if: ['who', 'then', 'else'], onKill: [], onWin: [], onLose: [], manual: [], hide: [], fireArea: ['from'],
      casualties: ['who', 'ignoreArmor'], turnOrder: ['who'], setTerrain: ['tiles', 'for'], openGate: ['for', 'oneSide'], repair: ['range'], leave: [], convert: [], spawn: [],
      grantTrait: ['who', 'tier', 'for'], removeTrait: ['who', 'for'], stealTrait: ['who', 'for'], stepTrait: ['who', 'for'], cancelTactic: [], cooldown: ['who'],
      overwatchOn: [], custom: ['args'], counter: ['add', 'set', 'max'], forceToward: ['who'], forceAttack: ['at'], moveInto: [], splitMorale: ['who', 'max'],
      blast: ['moraleLoss', 'fire', 'selfHalf'], overwatchShot: [], cleanse: ['only'], swapUnits: ['with'], climb: [] }[k];
    for (const x of Object.keys(st)) if (x !== k && !allowed.includes(x)) bad(p + '.' + x, 'unexpected key on a "' + k + '" step');
    switch (k) {
      case 'morale': case 'health': if (!isNum(st[k])) bad(p + '.' + k, 'number'); who(p + '.who', st.who, true); break;
      case 'buff':
        if (!st.buff || typeof st.buff !== 'object') { bad(p + '.buff', 'object with mods/flags'); break; }
        for (const x of Object.keys(st.buff)) if (!['mods', 'flags', 'triggers', 'endSteps'].includes(x)) bad(p + '.buff.' + x, 'only mods, flags, triggers and endSteps');
        if (st.buff.endSteps) steps(p + '.buff.endSteps', st.buff.endSteps);
        (st.buff.triggers || []).forEach((t, i) => trigger(p + '.buff.triggers[' + i + ']', t));
        (st.buff.mods || []).forEach((m, i) => mod(p + '.buff.mods[' + i + ']', m, true));
        (st.buff.flags || []).forEach((f, i) => flag(p + '.buff.flags[' + i + ']', f, true));
        who(p + '.who', st.who, true); duration(p + '.for', st.for); break;
      case 'move': if (!isNum(st.move)) bad(p + '.move', 'number'); who(p + '.who', st.who, true);
        if (st.mode && !['any', 'away', 'toward', 'line'].includes(st.mode)) bad(p + '.mode', 'any|away|toward|line'); if (st.toward) who(p + '.toward', st.toward, true); break;
      case 'attack': if (!st.attack || typeof st.attack !== 'object') { bad(p + '.attack', 'object'); break; }
        (st.attack.mods || []).forEach((m, i) => mod(p + '.attack.mods[' + i + ']', m, true));
        (st.attack.flags || []).forEach((f, i) => flag(p + '.attack.flags[' + i + ']', f, true));
        for (const x of Object.keys(st.attack)) if (!['mods', 'flags', 'target'].includes(x)) bad(p + '.attack.' + x, 'only mods, flags and target');
        filter(p + '.attack.target', st.attack.target);
        who(p + '.who', st.who, true); if (st.moveFirst !== undefined && !isNum(st.moveFirst)) bad(p + '.moveFirst', 'number'); break;
      case 'contest': who(p + '.contest', st.contest, true); if (st.lose) steps(p + '.lose', st.lose); if (st.win) steps(p + '.win', st.win); break;
      case 'status': case 'selfStatus': if (!STATUSES.includes(st[k])) bad(p + '.' + k, 'unknown status'); if (k === 'status') who(p + '.who', st.who, true); duration(p + '.for', st.for); break;
      case 'push': if (!isNum(st.push)) bad(p + '.push', 'number'); who(p + '.who', st.who, true); break;
      case 'reveal': case 'reinforce': if (!isNum(st[k])) bad(p + '.' + k, 'number'); if (k === 'reinforce' && st.near && !['edge', 'hidden', 'self'].includes(st.near)) bad(p + '.near', 'edge|hidden|self'); break;
      case 'casualties': if (!isNum(st.casualties)) bad(p + '.casualties', 'number'); who(p + '.who', st.who, true); break;
      case 'turnOrder': if (!['actNext', 'actFirst', 'actLast'].includes(st.turnOrder)) bad(p + '.turnOrder', 'actNext|actFirst|actLast'); who(p + '.who', st.who, true); break;
      case 'setTerrain': if (!TERRAINS.includes(st.setTerrain) && !['stakes'].includes(st.setTerrain)) bad(p + '.setTerrain', 'terrain'); if (!st.tiles || !picks.has(st.tiles.pick)) bad(p + '.tiles', '{"pick": id of a tile pick}'); if (st.for !== undefined) duration(p + '.for', st.for); break;
      case 'openGate': case 'repair': if (!isNum(st[k])) bad(p + '.' + k, 'number'); break;
      case 'leave': case 'convert': case 'overwatchOn': who(p + '.' + k, st[k], true); break;
      case 'spawn': if (typeof st.spawn !== 'string') bad(p + '.spawn', 'unit kind, e.g. "levy"'); break;
      case 'grantTrait': case 'removeTrait': case 'stepTrait': if (typeof st[k] !== 'string') bad(p + '.' + k, 'trait name'); who(p + '.who', st.who, true); if (st.for !== undefined) duration(p + '.for', st.for); break;
      case 'stealTrait': if (!(st.stealTrait === true || Array.isArray(st.stealTrait))) bad(p + '.stealTrait', 'true or a list of trait names'); who(p + '.who', st.who, true); if (st.for !== undefined) duration(p + '.for', st.for); break;
      case 'cancelTactic': break;
      case 'cooldown': if (!isNum(st.cooldown)) bad(p + '.cooldown', 'number'); who(p + '.who', st.who, true); break;
      case 'custom': if (typeof st.custom !== 'string') bad(p + '.custom', 'script name'); break;
      case 'counter': if (typeof st.counter !== 'string') bad(p + '.counter', 'name'); break;
      case 'forceToward': if (!(st.forceToward && (st.forceToward.source === true || st.forceToward.target === true || picks.has(st.forceToward.pick)))) bad(p + '.forceToward', '{"pick": id} | {"target": true} | {"source": true}'); who(p + '.who', st.who, true); break;
      case 'forceAttack': who(p + '.forceAttack', st.forceAttack, true); who(p + '.at', st.at, true); break;
      case 'moveInto': if (st.moveInto !== 'vacated') bad(p + '.moveInto', '"vacated"'); break;
      case 'splitMorale': if (!isNum(st.splitMorale)) bad(p + '.splitMorale', 'number'); who(p + '.who', st.who, true); break;
      case 'blast': break;
      case 'cleanse': who(p + '.cleanse', st.cleanse, true); break;
      case 'swapUnits': who(p + '.swapUnits', st.swapUnits, true); who(p + '.with', st.with, true); break;
      case 'climb': if (!st.climb || !picks.has(st.climb.pick)) bad(p + '.climb', '{"pick": id of a tile pick}'); break;
      case 'overwatchShot': who(p + '.overwatchShot', st.overwatchShot, true); break;
      case 'fire': if (!st.fire || !picks.has(st.fire.pick)) bad(p + '.fire', '{"pick": id of a tile pick}'); break;
      case 'resetCooldown': case 'swap': case 'extraTurn': who(p + '.' + k, st[k], true); break;
      case 'if': filter(p + '.if', st.if, COND_KEYS); who(p + '.who', st.who, true); steps(p + '.then', st.then || []); if (st.else) steps(p + '.else', st.else); break;
      case 'onKill': case 'onWin': case 'onLose': steps(p + '.' + k, st[k]); break;
      case 'manual': if (typeof st.manual !== 'string') bad(p + '.manual', 'text'); break;
      case 'hide': who(p + '.hide', st.hide, true); break;
      case 'fireArea': if (!isNum(st.fireArea)) bad(p + '.fireArea', 'number (range)'); if (st.from !== undefined && !(st.from && (st.from.target === true || picks.has(st.from.pick)))) bad(p + '.from', '{"pick": id} or {"target": true}'); break;
    }
  };
  (spec.mods || []).forEach((m, i) => mod('mods[' + i + ']', m, false));
  (spec.flags || []).forEach((f, i) => flag('flags[' + i + ']', f, false));
  function trigger(p, t) {
    if (!EVENTS.includes(t && t.on)) bad(p + '.on', 'unknown event "' + (t && t.on) + '"');
    for (const k of Object.keys(t || {})) if (!['on', 'if', 'do', 'limit', 'range', 'targetIf'].includes(k)) bad(p + '.' + k, 'unknown TRIGGER key');
    if (t && t.targetIf) filter(p + '.targetIf', t.targetIf, COND_KEYS);
    if (t && t.range !== undefined && !isNum(t.range)) bad(p + '.range', 'number');
    if (t && t.limit !== undefined && !['battle', 'round', 'turn'].includes(t.limit)) bad(p + '.limit', 'battle|round|turn');
    filter(p + '.if', t && t.if, COND_KEYS);
    steps(p + '.do', (t && t.do) || []);
  }
  (spec.triggers || []).forEach((t, i) => trigger('triggers[' + i + ']', t));
  if (spec.require !== undefined) filter('require', spec.require, COND_KEYS);
  if (spec.custom !== undefined && typeof spec.custom !== 'string') bad('custom', 'script name');
  (spec.pick || []).forEach((pk, i) => {
    const p = 'pick[' + i + ']';
    if (!pk || typeof pk.id !== 'string') bad(p + '.id', 'needs an id');
    if (!['allies', 'enemies', 'tile'].includes(pk && pk.side)) bad(p + '.side', 'allies|enemies|tile');
    if (!(isNum(pk && pk.range) || (pk && pk.range === 'any'))) bad(p + '.range', 'number or "any"');
    if (!isNum(pk && pk.count)) bad(p + '.count', 'number');
    for (const k of Object.keys(pk || {})) if (!['id', 'side', 'range', 'count', 'upTo', 'self', 'filter'].includes(k)) bad(p + '.' + k, 'unknown PICK key');
    filter(p + '.filter', pk && pk.filter);
  });
  if (spec.do) steps('do', spec.do);
  if (spec.manual !== undefined && typeof spec.manual !== 'string') bad('manual', 'text');
  return errs;
}
