// Suggest structured bonuses for a signature (unique) skill from its description text (David, 2026-11-05).
// Recognises the common phrasings; anything with a condition word (while, when, against, if, in, on, during,
// mounted...) outside the matched phrase becomes situational, with that clause as its condition.
//   node tools/suggest-sig-bonuses.mjs "+2 on Active Defense Tests while mounted."
//   echo "description" | node tools/suggest-sig-bonuses.mjs
// Prints the suggested bonuses as JSON. The function is exported for scripts (e.g. populating character sheets).
import { fileURLToPath } from "node:url";

const N = String.raw`(\d+)`;
const PLUS = String.raw`(?:\+|plus\s+)\s?`;
const MINUS = String.raw`(?:[−–-]|minus\s+)\s?`;
const ASPECT = String.raw`(Earth|Metal|Water|Fire|Wood)`;
const PRONOUN = String.raw`(?:him|her|them|this character)`;

/** [stat, regex, (match) => ({ value, aspect })]. Order matters: earlier patterns claim their text first. */
const PATTERNS = [
  ["attackersPenalty", new RegExp(String.raw`(?:opponents|attackers|enemies|foes|anyone attacking ${PRONOUN})(?:\s+\w+){0,3}?\s+(?:take|takes|suffer|suffers|get|gets|have|has|are at)\s+(?:a\s+)?${MINUS}${N}(?:\s+penalty)?\s+(?:on|to)\s+(?:their\s+|all\s+)?Attack Tests?(?:\s+against\s+${PRONOUN})?`, "i"), (m) => ({ value: +m[1] })],
  ["firstHitReduction", new RegExp(String.raw`once\s+(?:per|a|each)\s+round,?\s+(?:one|a|the first)\s+(?:hit|blow)(?:\s+(?:against|on)\s+${PRONOUN})?\s+is\s+reduced\s+by\s+(?:his|her|their)\s+${ASPECT}`, "i"), (m) => ({ value: 0, aspect: m[1].toLowerCase() })],
  ["firstHitReduction", new RegExp(String.raw`the\s+first\s+(?:hit|blow)(?:\s+(?:he|she|they)\s+takes?)?(?:\s+(?:against|on)\s+${PRONOUN})?\s+each\s+(?:round|turn)\s+(?:does|deals|inflicts)\s+${N}\s+less\s+damage`, "i"), (m) => ({ value: +m[1] })],
  ["firstHitReduction", new RegExp(String.raw`the\s+first\s+(?:hit|blow)(?:\s+(?:he|she|they)\s+takes?)?\s+each\s+(?:round|turn)\s+is\s+reduced\s+by\s+${N}`, "i"), (m) => ({ value: +m[1] })],
  ["hitReduction", new RegExp(String.raw`(?:every|each)\s+(?:hit|blow)(?:\s+(?:he|she|they)\s+takes?)?(?:\s+(?:against|on)\s+${PRONOUN})?\s+(?:does|deals|inflicts)\s+${N}\s+less\s+damage`, "i"), (m) => ({ value: +m[1] })],
  ["hitReduction", new RegExp(String.raw`(?:reduces?|reduce)\s+(?:all|every|each)\s+(?:damage|hit|blow)(?:\s+(?:he|she|they)\s+takes?|\s+taken)?\s+by\s+${N}`, "i"), (m) => ({ value: +m[1] })],
  ["ad", new RegExp(String.raw`${PLUS}${N}\s+(?:on|to)\s+(?:all\s+)?(?:his\s+|her\s+|their\s+)?Active\s+Defen[cs]es?(?:\s+Tests?)?`, "i"), (m) => ({ value: +m[1] })],
  ["ad", new RegExp(String.raw`${PLUS}${N}\s+Active\s+Defen[cs]es?(?:\s+Tests?)?`, "i"), (m) => ({ value: +m[1] })],
  ["pd", new RegExp(String.raw`${PLUS}${N}\s+(?:to\s+|on\s+)?(?:his\s+|her\s+|their\s+)?Passive\s+Defen[cs]e`, "i"), (m) => ({ value: +m[1] })],
  ["attack", new RegExp(String.raw`${PLUS}${N}\s+(?:on|to)\s+(?:all\s+)?(?:his\s+|her\s+|their\s+)?Attack\s+Tests?`, "i"), (m) => ({ value: +m[1] })],
  ["initiative", new RegExp(String.raw`${PLUS}${N}\s+(?:on\s+|to\s+)?(?:his\s+|her\s+|their\s+)?Initiative(?:\s+Tests?)?`, "i"), (m) => ({ value: +m[1] })],
  ["damage", new RegExp(String.raw`${PLUS}${N}\s+(?:to\s+)?(?:his\s+|her\s+|their\s+)?damage`, "i"), (m) => ({ value: +m[1] })],
];

const CONDITION = /\b(while|when|whenever|against|if|in|on|during|mounted|unless|after|before|versus|vs\.?)\b/i;

/** The clause around a match that holds a condition word, or "". */
function conditionFor(sentence, start, end) {
  const after = sentence.slice(end);
  const am = after.match(CONDITION);
  if (am) {
    const from = after.slice(am.index);
    return from.split(/[,;.\u0000]/)[0].trim();
  }
  const before = sentence.slice(0, start);
  const clauses = before.split(/[,;\u0000]/);
  for (let i = clauses.length - 1; i >= 0; i--) {
    const bm = clauses[i].match(CONDITION);
    if (bm) return clauses[i].slice(bm.index).trim();
  }
  return "";
}

/** Strip HTML tags and entities from a description. */
function plain(text) {
  return String(text ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&minus;/g, "−").replace(/&amp;/g, "&").replace(/&#0?39;|&apos;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
}

/**
 * Suggested bonuses for a signature description: [{ stat, value, aspect, mode, condition, label, match }].
 * label is left empty (the sheet shows the signature's name).
 */
export function suggestBonuses(text) {
  const out = [];
  const sentences = plain(text).split(/(?<=[.;!?])\s+/);
  for (const sentence of sentences) {
    const found = [];
    const free = (a, b) => found.every((f) => b <= f.a || a >= f.b);
    for (const [stat, re, read] of PATTERNS) {
      const g = new RegExp(re.source, "gi");
      let m;
      while ((m = g.exec(sentence))) {
        const a = m.index, b = a + m[0].length;
        if (free(a, b)) found.push({ stat, a, b, m, ...read(m) });
      }
    }
    found.sort((x, y) => x.a - y.a);
    for (const f of found) {
      // Other bonus phrases in the sentence are not part of this one's condition
      let masked = sentence;
      for (const o of found) if (o !== f) masked = masked.slice(0, o.a) + "\u0000".repeat(o.b - o.a) + masked.slice(o.b);
      const condition = conditionFor(masked, f.a, f.b);
      out.push({ stat: f.stat, value: f.value, aspect: f.aspect ?? "", mode: condition ? "situational" : "always", condition, label: "", match: f.m[0] });
    }
  }
  return out;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const arg = process.argv.slice(2).join(" ");
  const run = (t) => console.log(JSON.stringify(suggestBonuses(t), null, 2));
  if (arg) run(arg);
  else {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (d) => { buf += d; });
    process.stdin.on("end", () => run(buf));
  }
}
