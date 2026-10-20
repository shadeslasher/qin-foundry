// Yin/Yang Die rolling for Foundry: rolls two d10 (10 counts as 0) through Foundry's
// dice so Dice So Nice and roll logs work, then applies the Qin rules.
import { yinYangResult } from "./rules/qin-rules.mjs";
import { systemPath } from "./config.mjs";

export async function rollYinYang({ beginner = false } = {}) {
  const roll = new foundry.dice.Roll("1d10[Yin] + 1d10[Yang]");
  await roll.evaluate();
  const faces = roll.dice.map(d => d.results[0].result % 10);
  const dice = yinYangResult(faces[0], faces[1], { beginner });
  return { roll, dice };
}

/** The configured ChatMessage class (avoids relying on deprecated globals). */
export const Chat = () => CONFIG.ChatMessage.documentClass;

export const renderTemplate = (path, data) => foundry.applications.handlebars.renderTemplate(systemPath(path), data);

/** Generic dialog returning the form values as an object, or null if cancelled. */
export async function formDialog({ title, content, okLabel = "Roll", width = 420 }) {
  try {
    const fd = await dialogClass().input({
      window: { title },
      position: { width },
      content,
      ok: { label: okLabel },
      rejectClose: false,
    });
    return fd ?? null;
  } catch {
    return null;
  }
}

export function dialogClass() {
  return foundry.applications.api.Dialog ?? foundry.applications.api.DialogV2;
}
