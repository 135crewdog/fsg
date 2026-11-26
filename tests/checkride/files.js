// An aircraft's files, for the tests: where they are on disk, and a WebAssembly module holding them. New in
// FSG, milestone 3 (docs/milestones/3.md, pull request 3), when the first aircraft from outside JSBSim's data
// arrived. An aircraft whose settings say `own: true` (the F-4C) has its files in the repo's aircraft/
// folder, their paths from the repo's root; any other has them in jsbsim/jsbsim-data/. Either way a file goes
// into the module under /data at the same path, where JSBSim's usual layout finds it. The app does the same
// from the page (src/fdm.js, homeOf); native JSBSim is told where to look (tests/checkride/tape.js).
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadVariant } from '../../jsbsim/tests/lib/node.js';
import { TMP_DIR } from '../../jsbsim/tests/lib/scenario.js';

/** The repo's root on disk. */
export const REPO = fileURLToPath(new URL('../../', import.meta.url));

/** The folder an aircraft's file paths start from, on disk. */
export const homeOf = (aircraft) => (aircraft.own ? REPO : join(REPO, 'jsbsim', 'jsbsim-data'));

/** One of an aircraft's files. */
export const bytesOf = (aircraft, file) => readFileSync(join(homeOf(aircraft), file));

/** Puts an aircraft's files (all of them, or the ones given) into a module, under /data. */
export function mount(module, aircraft, files = aircraft.files) {
  for (const file of files) module.writeFile(`/data/${file}`, bytesOf(aircraft, file));
  return module;
}

/** A fresh module of one build holding an aircraft's files (all of them, or the ones given) and nothing else. */
export const moduleWith = async (aircraft, variant, files = aircraft.files) => mount(await loadVariant(variant), aircraft, files);

/**
 * A folder on disk holding an aircraft's files (all of them, or the ones given) and nothing else, laid out as
 * JSBSim's root: for native JSBSim, to show which files it needs. Under jsbsim/build/, which is not committed.
 */
export function rootWith(aircraft, name, files = aircraft.files) {
  const root = join(TMP_DIR, 'roots', name);
  rmSync(root, { recursive: true, force: true });
  for (const file of files) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    cpSync(join(homeOf(aircraft), file), join(root, file));
  }
  return root;
}
