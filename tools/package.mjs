// Builds dist/qin.zip and dist/system.json for a GitHub release.
import { execSync } from "node:child_process";
import fs from "node:fs";

const files = ["system.json", "qin.mjs", "module", "templates", "styles", "lang", "packs", "README.md", "LICENSE"];
fs.rmSync("dist", { recursive: true, force: true });
fs.mkdirSync("dist");
execSync(`zip -rq dist/qin.zip ${files.join(" ")} -x "packs/*/LOCK" "packs/*/LOG*"`, { stdio: "inherit" });
fs.copyFileSync("system.json", "dist/system.json");
const v = JSON.parse(fs.readFileSync("system.json", "utf8")).version;
console.log(`dist/qin.zip and dist/system.json ready for release v${v}`);
