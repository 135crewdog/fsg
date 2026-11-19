// From 135crewdog/FDM, ts/node.ts, commit e478825. Made by tools/from-fdm.mjs: the types are removed
// (a line that was only types is kept as a comment), ".ts" in file names becomes ".js", and import paths
// follow FSG's folders. Also changed: one line, listed in tools/from-fdm.mjs.
// In the comments below, host/, dist-wasm/, jsbsim-data/, build/ and tests/ are folders of jsbsim/; REPORT.md
// and RESEARCH.md are FDM's, at that commit; and "TypeScript" means this file, which is now JavaScript.
// Node-only helpers (tests and tools): load a committed WebAssembly build and copy folders from disk into it.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadFdmModule } from "../../../src/sim/core.js";
import { writeFiles } from "../../../src/sim/files.js";

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// export type Variant = "weh" | "jseh";
export const VARIANTS = ["weh", "jseh"];

/** Loads dist-wasm/fdm-<variant>. */
export async function loadVariant(variant, options = {}) {
  const dir = join(REPO_ROOT, "dist-wasm");
  const factory = (await import(pathToFileURL(join(dir, `fdm-${variant}.mjs`)).href)).default;
  return loadFdmModule(factory, { ...options, wasmBinary: readFileSync(join(dir, `fdm-${variant}.wasm`)) });
}

/** Reads a folder from disk into a FileSet (paths relative to the folder, "/" separators). */
export function readDir(dir, prefix = "", into = new Map()) {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) readDir(full, `${prefix}${name}/`, into);
    else into.set(`${prefix}${name}`, readFileSync(full));
  }
  return into;
}

/** Copies a folder from disk to `mountPoint` inside the module. */
export function mountDir(module, dir, mountPoint) {
  writeFiles(module, mountPoint, readDir(dir));
}

/** Copies jsbsim-data/ to /data: the layout every test uses. */
export function mountJsbsimData(module) {
  mountDir(module, join(REPO_ROOT, "jsbsim-data"), "/data");
}
