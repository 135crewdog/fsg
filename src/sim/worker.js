// From 135crewdog/FDM, ts/worker.ts, commit e478825. Made by tools/from-fdm.mjs: the types are removed
// (a line that was only types is kept as a comment), ".ts" in file names becomes ".js", and import paths
// follow FSG's folders. Also changed: 2 lines, listed in tools/from-fdm.mjs.
// In the comments below, host/, dist-wasm/, jsbsim-data/, build/ and tests/ are folders of jsbsim/; REPORT.md
// and RESEARCH.md are FDM's, at that commit; and "TypeScript" means this file, which is now JavaScript.
// Browser Web Worker entry point: the game path. All the logic is in worker-handler.js.
import { createHandler } from "./worker-handler.js";
import { flightRun } from "./flight-run.js";   // FSG

const scope = self;
const handle = createHandler((message, transfer) => scope.postMessage(message, transfer ?? []), flightRun());
scope.onmessage = (e) => {
  void handle(e.data);
};
