// From 135crewdog/FDM, tests/lib/fixtures.ts, commit e478825. Made by tools/from-fdm.mjs: the types are removed
// (a line that was only types is kept as a comment), ".ts" in file names becomes ".js", and import paths
// follow FSG's folders. Nothing else is changed.
// In the comments below, host/, dist-wasm/, jsbsim-data/, build/ and tests/ are folders of jsbsim/; REPORT.md
// and RESEARCH.md are FDM's, at that commit; and "TypeScript" means this file, which is now JavaScript.
// Builds build/fixtures/ ("@fix" in scenarios): the committed fixtures of tests/fixtures/ plus generated ones.
// Nothing is ever written into jsbsim-data/.
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { REPO_ROOT } from "./node.js";

export const FIX_DIR = join(REPO_ROOT, "build", "fixtures");
export const NUM_FORCES = 20;

/** Name of force i in the c172x_ext20 fixture. */
export const forceName = (i) => `f${String(i).padStart(2, "0")}`;

/** The <external_reactions> block added to c172x: 20 body-frame forces along the wing. */
export function externalReactionsXml() {
  let xml = "  <external_reactions>\n";
  for (let i = 0; i < NUM_FORCES; i++) {
    // Spread across the span (y from -190 in to +190 in), at the wing's height.
    const y = -190 + (380 * i) / (NUM_FORCES - 1);
    xml += `    <force name="${forceName(i)}" frame="BODY">\n` +
      `      <location unit="IN"> <x> 43.2 </x> <y> ${y} </y> <z> 59.4 </z> </location>\n` +
      `      <direction> <x> 0 </x> <y> 0 </y> <z> -1 </z> </direction>\n` +
      "    </force>\n";
  }
  return `${xml}  </external_reactions>\n`;
}

/** c172x_ext20 = upstream c172x, byte for byte, plus the block above before </fdm_config>. */
export function makeExt20(c172xXml) {
  const end = c172xXml.lastIndexOf("</fdm_config>");
  if (end < 0) throw new Error("c172x.xml: </fdm_config> not found");
  if (c172xXml.includes("<external_reactions")) throw new Error("c172x.xml already has external reactions");
  return c172xXml.slice(0, end) + externalReactionsXml() + c172xXml.slice(end);
}

let prepared = false;

export function prepareFixtures() {
  if (prepared) return FIX_DIR;
  rmSync(FIX_DIR, { recursive: true, force: true });
  mkdirSync(FIX_DIR, { recursive: true });
  cpSync(join(REPO_ROOT, "tests", "fixtures"), FIX_DIR, { recursive: true });
  // c172x_ext20: every file of the upstream c172x folder, the main file renamed and extended.
  const src = join(REPO_ROOT, "jsbsim-data", "aircraft", "c172x");
  const dst = join(FIX_DIR, "aircraft", "c172x_ext20");
  mkdirSync(dst, { recursive: true });
  for (const name of readdirSync(src)) {
    if (name === "c172x.xml") writeFileSync(join(dst, "c172x_ext20.xml"), makeExt20(readFileSync(join(src, name), "utf8")));
    else cpSync(join(src, name), join(dst, name), { recursive: true });
  }
  prepared = true;
  return FIX_DIR;
}
