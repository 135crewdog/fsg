// The wrapper's checks, run natively: fdm_native --selftest (tests/native/host_selftest.cpp), the same
// checks tests/wrapper.test.js runs on the two WebAssembly builds.
// New in FSG; in FDM this ran from scripts/run-all-tests.sh, with the same three folders.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { prepareFixtures } from "./lib/fixtures.js";
import { REPO_ROOT } from "./lib/node.js";
import { NATIVE_DIR } from "./lib/scenario.js";

test("native self-test: every check passes", () => {
  const binary = join(NATIVE_DIR, "fdm_native");
  assert.ok(existsSync(binary), `${binary} is not built: run jsbsim/scripts/build-native.sh`);
  const out = join(REPO_ROOT, "build", "tmp", "out");
  mkdirSync(out, { recursive: true });
  const run = spawnSync(binary, ["--selftest", join(REPO_ROOT, "jsbsim-data"), prepareFixtures(), out], { encoding: "utf8", env: { ...process.env, JSBSIM_DEBUG: "" } });
  const lines = (run.stdout + run.stderr).trim().split("\n");
  const passed = lines.filter((line) => line.startsWith("ok ")).length;
  console.log(`  ${passed} checks passed; ${lines.at(-1)}`);
  assert.equal(run.status, 0, lines.slice(-30).join("\n"));
  assert.equal(passed, 41, "the 41 checks FDM's REPORT.md records");
});
