// Replacing the ground grid after load and between steps, on the two WebAssembly builds: the checks
// tests/native/ground_swap_selftest.h runs natively, and the heap. New in FSG, milestone 1 (pull request 2):
// the game replaces the patch of ground under the airplane as it flies, so the host layer must let it.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { State } from "../../src/sim/codes.js";
import { Fdm, FdmError } from "../../src/sim/core.js";
import { VARIANTS } from "./lib/node.js";
import { geodeticToEcef } from "./lib/grids.js";
import { loadWithData } from "./lib/harness.js";

const RAD = Math.PI / 180;
const LAT = 21.3, LON = -157.9, D = 0.0005;   // posts about 180 ft apart

// A patch of one sloping field: post (i, j) of the whole field is 0.5 i + 0.2 j ft high, wherever the
// patch's corner is. The airplane stands on post (16, 16).
function patch(row0, col0, n) {
  const heights = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) heights[i * n + j] = 0.5 * (row0 + i) + 0.2 * (col0 + j);
  return { lat0: (LAT + (row0 - 16) * D) * RAD, lon0: (LON + (col0 - 16) * D) * RAD, dlat: D * RAD, dlon: D * RAD, nlat: n, nlon: n, heights };
}

const OUTS = ["position/ecef-x-ft", "position/ecef-y-ft", "position/ecef-z-ft", "position/h-agl-ft", "velocities/u-fps", "velocities/v-fps",
  "velocities/w-fps", "velocities/p-rad_sec", "velocities/q-rad_sec", "velocities/r-rad_sec", "attitude/phi-rad", "attitude/theta-rad",
  "attitude/psi-rad", "forces/fbx-gear-lbs", "forces/fbz-gear-lbs", "velocities/vg-fps", "gear/unit[1]/WOW"];

/** A Cessna on that field, engine running, a little power: a ground roll. */
function start(module, gridAfterLoad) {
  const fdm = Fdm.create(module, { dt: 1 / 120, ground: gridAfterLoad ? undefined : patch(0, 0, 33) });
  fdm.loadModel("c172x");
  if (gridAfterLoad) fdm.setGround(patch(0, 0, 33));
  for (const [name, value] of [["ic/lat-geod-deg", LAT], ["ic/long-gc-deg", LON], ["ic/psi-true-deg", 90], ["ic/h-agl-ft", 4.3], ["propulsion/set-running", -1]]) fdm.setByName(name, value);
  fdm.bindOutputs(OUTS);
  const inputs = fdm.bindInputs(["fcs/throttle-cmd-norm"]);
  fdm.runIC();
  inputs[0] = 0.4;
  return fdm;
}

/** Height above the ground of 20 points 50 ft above the ellipsoid, scattered round the airplane. */
function probe(fdm) {
  const heights = [];
  for (let k = 0; k < 20; k++) {
    const [x, y, z] = geodeticToEcef((LAT + (Math.floor(k / 5) - 1.6) * 0.41 * D) * RAD, (LON + (k % 5 - 2.3) * 0.37 * D) * RAD, 50);
    heights.push(fdm.groundProbe(x, y, z).height);
  }
  return heights;
}

for (const variant of VARIANTS) {
  describe(`ground grid replaced in flight (${variant})`, () => {
    test("the same grid replaced before each of 3600 steps of a ground roll changes nothing, bit for bit", async () => {
      const { module } = await loadWithData(variant);
      const a = start(module, false), b = start(module, true);
      assert.equal(b.state, State.RUNNING, "a grid given after load is accepted");
      for (let k = 0; k < 3600; k++) {
        b.setGround(patch(0, 0, 33));   // the same ground, a new grid, before every step
        a.step(1);
        b.step(1);
        for (let c = 0; c < OUTS.length; c++) assert.ok(Object.is(a.curr[c], b.curr[c]), `step ${k}, ${OUTS[c]}: ${a.curr[c]} vs ${b.curr[c]}`);
      }
      // Read back that the run is what its name says: 30 s, moving, wheels on the ground.
      assert.ok(a.curr[15] > 5 && a.curr[16] === 1 && a.simTime > 29.9, `ground speed ${a.curr[15]} ft/s, wheel on ground ${a.curr[16]}, ${a.simTime} s`);
      console.log(`  ${variant}: 3600 steps identical; ground speed at the end ${a.curr[15].toFixed(1)} ft/s`);
      a.dispose();
      b.dispose();
    });

    test("a patch of the same field with another corner: 20 heights within 0.000001 ft", async () => {
      const { module } = await loadWithData(variant);
      const fdm = start(module, false);
      fdm.step(120);
      const before = probe(fdm);
      fdm.setGround(patch(8, 5, 20));
      const after = probe(fdm);
      const worst = Math.max(...before.map((h, k) => Math.abs(after[k] - h)));
      assert.ok(Math.abs(before[0] - before[19]) > 0.1, "the 20 points are on a slope, not all at one height");
      assert.ok(worst <= 1e-6, `largest difference ${worst} ft`);
      console.log(`  ${variant}: largest difference ${worst.toExponential(2)} ft`);

      // A grid the host refuses leaves the ground in place, and the flight goes on.
      const broken = patch(0, 0, 33);
      broken.heights[5] = NaN;
      assert.throws(() => fdm.setGround(broken), (e) => e instanceof FdmError && /invalid grid/.test(e.message));
      assert.deepEqual(probe(fdm), after);
      assert.equal(fdm.step(1), 0);
      fdm.dispose();
    });

    // What "heap in use" reads is the allocator's blocks, not the bytes asked for. Two things were found
    // when these tests were written (docs/milestones/1.md has the numbers):
    //  - In some runs the reading goes down 8 bytes and up 8 bytes on alternate swaps: the new grid lands by
    //    turns in two free blocks 8 bytes apart in size. Which runs depends on JSBSim's own load, which leaves
    //    the heap a few tens of bytes different from run to run.
    //  - Stepping the airplane between swaps, the reading drops 192 bytes at step 52, with or without swaps:
    //    JSBSim's own. This test's first form stepped between swaps and compared for equality; it failed
    //    (372,720 bytes after swap 10, 372,528 after swap 1,000) for that reason, not for anything a swap does.
    test("the heap in use after swap 1,000 equals that after swap 10", async () => {
      const { module } = await loadWithData(variant);
      const fdm = start(module, false);
      fdm.step(120);
      const used = [];
      for (let k = 1; k <= 1000; k++) {
        fdm.setGround(patch(k % 9, (k * 5) % 9, 20));
        used.push(module.heapInUse());
      }
      const values = [...new Set(used)].sort((x, y) => x - y);
      console.log(`  ${variant}: heap in use after swap 10: ${used[9]} bytes; after swap 1,000: ${used[999]} bytes; values seen over the 1,000 swaps: ${values.join(", ")}`);
      assert.equal(used[999], used[9]);
      assert.ok(Math.max(...used.slice(10)) <= Math.max(...used.slice(0, 10)), "no reading after swap 10 is above the highest of the first ten");
      fdm.dispose();
    });

    test("with a step between swaps the heap does not grow", async () => {
      const { module } = await loadWithData(variant);
      const fdm = start(module, false);
      const used = [];
      for (let k = 1; k <= 1000; k++) {
        fdm.setGround(patch(k % 9, (k * 5) % 9, 20));
        fdm.step(1);
        used.push(module.heapInUse());
      }
      console.log(`  ${variant}: with a step after each swap: ${used[9]} bytes after swap 10, ${used[999]} after swap 1,000`);
      assert.ok(used[999] <= used[9], `${used[999]} bytes after swap 1,000, ${used[9]} after swap 10`);
      assert.ok(Math.max(...used.slice(500)) <= Math.max(...used.slice(0, 500)), "the second 500 swaps read no higher than the first 500");
      fdm.dispose();
    });
  });
}
