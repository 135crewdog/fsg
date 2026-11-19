// From 135crewdog/FDM, tests/lib/node-worker.ts, commit e478825. Made by tools/from-fdm.mjs: the types are removed
// (a line that was only types is kept as a comment), ".ts" in file names becomes ".js", and import paths
// follow FSG's folders. Nothing else is changed.
// In the comments below, host/, dist-wasm/, jsbsim-data/, build/ and tests/ are folders of jsbsim/; REPORT.md
// and RESEARCH.md are FDM's, at that commit; and "TypeScript" means this file, which is now JavaScript.
// Node worker_threads entry point: the same handler as the browser Worker (src/sim/worker.js).
import { parentPort } from "node:worker_threads";

import { createHandler } from "../../../src/sim/worker-handler.js";

const port = parentPort;
const handle = createHandler((message, transfer) => port.postMessage(message, transfer ?? []));
port.on("message", (request) => {
  void handle(request);
});
