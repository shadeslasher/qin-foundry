import { test } from "node:test";
import assert from "node:assert/strict";
import { keyLabel } from "../module/dock.mjs";

test("dock hotkey labels", () => {
  assert.equal(keyLabel({ key: "KeyP" }), "P");
  assert.equal(keyLabel({ key: "Digit3" }), "3");
  assert.equal(keyLabel({ key: "PageDown" }), "PageDown");
  assert.equal(keyLabel({ key: "KeyB", modifiers: ["Shift"] }), "Shift+B");
  assert.equal(keyLabel({ key: "BracketLeft" }), "[");
  assert.equal(keyLabel(null), "");
});
