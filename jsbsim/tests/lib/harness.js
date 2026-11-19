// From 135crewdog/FDM, tests/lib/harness.ts, commit e478825. Made by tools/from-fdm.mjs: the types are removed
// (a line that was only types is kept as a comment), ".ts" in file names becomes ".js", and import paths
// follow FSG's folders. Also changed: 2 lines, listed in tools/from-fdm.mjs.
// In the comments below, host/, dist-wasm/, jsbsim-data/, build/ and tests/ are folders of jsbsim/; REPORT.md
// and RESEARCH.md are FDM's, at that commit; and "TypeScript" means this file, which is now JavaScript.
// Shared by the test files: load the WebAssembly builds with the data mounted, and write result files.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { REPO_ROOT, loadVariant, mountDir, mountJsbsimData } from "./node.js";
import { prepareFixtures } from "./fixtures.js";

export const RESULTS_DIR = join(REPO_ROOT, "build", "results");

// export interface Loaded {
//   variant: Variant;
//   module: FdmModule;
//   logs: LogRecord[];
// }

/** A fresh module with jsbsim-data at /data and the fixtures at /fix. */
export async function loadWithData(variant) {
  const logs = [];
  const module = await loadVariant(variant, { onLog: (r) => logs.push(r) });
  mountJsbsimData(module);
  mountDir(module, prepareFixtures(), "/fix");
  return { variant, module, logs };
}

/** Collects lines and writes them to build/results/<name>.txt; also echoes to the console. */
export class Report {
  lines = [];
  name;
  constructor(name) {
    this.name = name;
  }
  line(text = "") {
    this.lines.push(text);
    console.log(text);
  }
  save() {
    mkdirSync(RESULTS_DIR, { recursive: true });
    writeFileSync(join(RESULTS_DIR, `${this.name}.txt`), `${this.lines.join("\n")}\n`);
  }
}
