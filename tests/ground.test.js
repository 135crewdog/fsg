// The patch of ground that follows the airplane (src/sim/ground.js, and Flight in src/sim/game.js), over the
// test terrain. docs/milestones/1.md, pull request 7.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { C172X } from '../src/sim/aircraft/c172x.js';
import { F16 } from '../src/sim/aircraft/f16.js';
import { DT, Flight } from '../src/sim/game.js';
import { PATCH_MARGIN, PATCH_POSTS, TEST_TERRAIN, cutPatch, flatSource, heightAt, postsInside, testTerrain, waterAt } from '../src/sim/ground.js';
import { FT, toLatLon, toWorld } from '../src/sim/world.js';
import { geodeticToEcef } from '../jsbsim/tests/lib/grids.js';
import { VARIANTS, loadVariant } from '../jsbsim/tests/lib/node.js';

const data = (file) => readFileSync(new URL(`../jsbsim/jsbsim-data/${file}`, import.meta.url));
async function moduleWith(files, variant) {
  const module = await loadVariant(variant);
  for (const file of files) module.writeFile(`/data/${file}`, data(file));
  return module;
}
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const place = (flight) => toWorld(flight.value('position/lat-geod-rad'), flight.value('position/long-gc-rad'));
/** The same made-up numbers every run. */
function dice(seed) {
  let x = seed;
  return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 2 ** 32; };
}

test('the test terrain is what it says: a flat field, a sea, a lake, a 5 degree slope, a 1,000 ft hill, a 30 degree face', () => {
  const t = testTerrain(), { slope, hill, face, lake, sea } = TEST_TERRAIN;
  assert.equal(t.post, 10);
  assert.equal(heightAt(t, 0, 0), 0);
  assert.equal(heightAt(t, 20, 3000), 0, 'the runway is level');
  assert.ok(!waterAt(t, 0, 0) && waterAt(t, sea.southOf - 100, 0) && waterAt(t, lake.north, lake.east) && !waterAt(t, lake.north, lake.east + lake.radius + 50));
  const rise = (heightAt(t, 0, slope.fromEast + 1010) - heightAt(t, 0, slope.fromEast + 1000)) * FT / 10;
  assert.ok(Math.abs(Math.atan(rise) * 180 / Math.PI - slope.degrees) < 0.01, `the slope is ${Math.atan(rise) * 180 / Math.PI} degrees`);
  assert.equal(heightAt(t, hill.north, hill.east), hill.heightFt);
  const steep = (heightAt(t, face.fromNorth + 1010, 0) - heightAt(t, face.fromNorth + 1000, 0)) * FT / 10;
  assert.ok(Math.abs(Math.atan(steep) * 180 / Math.PI - face.degrees) < 0.01);
  // Water is at sea level wherever it is, also where the sea lies under the line of the slope (Codex's
  // finding on pull request 14: the sea there stood 287 ft high). Every water post of the whole terrain:
  assert.ok(waterAt(t, -4000, 6000) && heightAt(t, -4000, 6000) === 0, `the sea south of the slope is at ${heightAt(t, -4000, 6000)} ft`);
  let water = 0;
  for (let row = -600; row <= 1200; row += 3) {
    const heights = t.heights(row, -900, 1, 1900);
    for (let column = 0; column < 1900; column++) if (t.water(row, column - 900)) { water++; assert.equal(heights[column], 0, `water post ${row}, ${column - 900}`); }
  }
  assert.ok(water > 100000, `${water} water posts looked at`);
  assert.ok(heightAt(t, sea.southOf + 100, 6000) > 200, 'the slope stands where the sea is not: the coast there is a cliff');
});

test('a patch is cut on the terrain\'s own posts, round the place asked for', () => {
  const t = testTerrain();
  const patch = cutPatch(t, 6003, 2996), again = cutPatch(t, 6040, 3050);
  assert.equal(patch.posts, PATCH_POSTS);
  assert.deepEqual([patch.row0, patch.column0], [600 - 64, 300 - 64]);
  assert.ok(Math.abs(postsInside(patch, 6003, 2996) - 63.6) < 1e-9);
  // The same post has the same height whichever patch it is in.
  const at = (p, row, column) => p.heights[(row - p.row0) * p.posts + (column - p.column0)];
  for (const [row, column] of [[600, 300], [560, 290], [650, 330]]) assert.equal(at(patch, row, column), at(again, row, column));
  const corner = toWorld(patch.grid.lat0, patch.grid.lon0);
  assert.ok(Math.abs(corner.north - patch.row0 * 10) < 1e-6 && Math.abs(corner.east - patch.column0 * 10) < 1e-6);
});

for (const variant of VARIANTS) {
  test(`${variant}: seen is hit: at 1,000 places JSBSim's ground is the terrain's own, within 0.001 ft`, async () => {
    const t = testTerrain();
    const flight = Flight.start(await moduleWith(C172X.files, variant), C172X, { terrain: t, settleSeconds: 0 });
    const random = dice(20261120);
    let worst = 0, flatTriangles = 0, sloping = 0;
    for (let i = 0; i < 1000; i++) {
      const north = -4000 + 16000 * random(), east = -2000 + 12000 * random();
      flight.fdm.setGround(cutPatch(t, north, east, 9).grid);
      const { lat, lon } = toLatLon(north, east);
      const jsbsim = 20000 - flight.fdm.groundProbe(...geodeticToEcef(lat, lon, 20000)).height;
      const own = heightAt(t, north, east);
      worst = Math.max(worst, Math.abs(jsbsim - own));
      if (own > 0) sloping++;
      // The same four posts drawn as two flat triangles, split along the south-west to north-east diagonal.
      const r = north / t.post, c = east / t.post, r0 = Math.floor(r), c0 = Math.floor(c), u = r - r0, s = c - c0;
      const [h00, h01, h10, h11] = t.heights(r0, c0, 2, 2);
      const triangle = u >= s ? h00 + u * (h10 - h00) + s * (h11 - h10) : h00 + s * (h01 - h00) + u * (h11 - h01);
      flatTriangles = Math.max(flatTriangles, Math.abs(triangle - own));
    }
    console.log(`  ${variant}: 1,000 places (${sloping} of them on sloping ground): largest difference between JSBSim's ground and the terrain's own ${worst.toExponential(2)} ft`);
    console.log(`  ${variant}: for the record, the same posts drawn as two flat triangles a square differ from that by at most ${flatTriangles.toFixed(3)} ft on this terrain`);
    assert.ok(sloping > 300, 'enough of the places are on sloping ground');
    assert.ok(worst <= 0.001, `largest difference ${worst} ft`);
    flight.dispose();
  });

  test(`${variant}: no bump at a swap: the Cessna rolling up the slope across patch swaps, against the same roll on one grid`, async () => {
    const t = testTerrain();
    const at = { north: 0, east: TEST_TERRAIN.slope.fromEast + 1000, headingDeg: 90 };
    // The first roll is flown by a pilot holding about 20 knots up the slope with the throttle; the others are
    // given the same throttle, step for step, so that nothing differs between them but the ground's patches.
    const roll = async (options, tape) => {
      const flight = Flight.start(await moduleWith(C172X.files, variant), C172X, { at, terrain: t, ...options });
      const rows = [], throttles = [];
      for (let step = 0; step < 60 / DT; step++) {
        const throttle = tape ? tape[step] : clamp(0.9 + 0.1 * (20 - flight.value('velocities/vg-fps') / 1.6878), 0, 1);
        throttles.push(throttle);
        flight.fly({ brake: false, throttle });
        assert.equal(flight.step(1), 0);
        const p = place(flight);
        rows.push([p.north / FT, p.east / FT, flight.value('position/h-sl-ft'), flight.value('accelerations/Nz')]);
      }
      const out = { rows, throttles, swaps: flight.swaps, outside: flight.stepsOutside, wheels: flight.value('gear/unit[1]/WOW'), knots: flight.value('velocities/vg-fps') / 1.6878, climbed: flight.value('position/h-sl-ft') - rows[0][2],
        rolled: Math.hypot(rows.at(-1)[0] - rows[0][0], rows.at(-1)[1] - rows[0][1]) };
      flight.dispose();
      return out;
    };
    const apart = (a, b) => {   // largest distance (ft) and largest difference in g, over every step
      let feet = 0, g = 0;
      a.rows.forEach((row, i) => { feet = Math.max(feet, Math.hypot(row[0] - b.rows[i][0], row[1] - b.rows[i][1], row[2] - b.rows[i][2])); g = Math.max(g, Math.abs(row[3] - b.rows[i][3])); });
      return { feet, g };
    };
    const swapping = await roll({ patchPosts: 17, patchMargin: 4 });
    const oneGrid = await roll({ patchPosts: 513, patchMargin: 4 }, swapping.throttles);
    // How far the one-grid roll differs from itself after a one-last-digit nudge of its start height (8 nudges, as FDM).
    let own = { feet: 0, g: 0 };
    for (const nudge of [1, -1, 2, -2, 3, -3, 4, -4]) {
      const d = apart(await roll({ patchPosts: 513, patchMargin: 4, nudge }, swapping.throttles), oneGrid);
      own = { feet: Math.max(own.feet, d.feet), g: Math.max(own.g, d.g) };
    }
    const d = apart(swapping, oneGrid);
    const allowed = { feet: Math.max(0.01, 3 * own.feet), g: Math.max(0.001, 3 * own.g) };
    console.log(`  ${variant}: 60 s up the 5 degree slope: rolled ${swapping.rolled.toFixed(0)} ft and climbed ${swapping.climbed.toFixed(0)} ft, ${swapping.swaps} swaps, ending at ${swapping.knots.toFixed(0)} kt with its wheels ${swapping.wheels ? 'on the ground' : 'OFF the ground'}`);
    assert.equal(swapping.wheels, 1, 'it is a roll: the wheels are on the ground');
    console.log(`  ${variant}: against one grid: ${d.feet.toExponential(2)} ft and ${d.g.toExponential(2)} g apart at most; allowed ${allowed.feet.toExponential(2)} ft and ${allowed.g.toExponential(2)} g (the one-grid roll differs from itself by ${own.feet.toExponential(2)} ft and ${own.g.toExponential(2)} g)`);
    assert.ok(swapping.swaps >= 5, `${swapping.swaps} swaps`);
    assert.equal(oneGrid.swaps, 0, 'the one grid covers the whole roll');
    assert.equal(swapping.outside, 0);
    assert.ok(d.feet <= allowed.feet, `position ${d.feet} ft apart`);
    assert.ok(d.g <= allowed.g, `g ${d.g} apart`);
  });

  test(`${variant}: fast: the F-16 at 600 knots, level at 2,000 ft across the terrain for a minute, never leaves its patch`, async () => {
    const t = testTerrain();
    const flight = Flight.start(await moduleWith(F16.files, variant), F16, { at: { north: TEST_TERRAIN.hill.north, east: -8000, headingDeg: 90 }, terrain: t, airborne: { heightFt: 2000, knots: 600 } });
    assert.ok(Math.abs(flight.value('velocities/vc-kts') - 600) < 0.5, 'started at 600 knots');
    let worst = 0, low = Infinity, heights = [Infinity, -Infinity], knots = [Infinity, -Infinity];
    for (let step = 0; step < 60 / DT; step++) {
      // A pilot holding 2,000 ft and the wings level with the stick.
      const h = flight.value('position/h-sl-ft'), climb = -flight.value('velocities/v-down-fps');
      flight.fly({ pitch: clamp(flight.trimmed.pitch + 0.002 * (2000 - h) - 0.004 * climb, -1, 1), roll: clamp(-2 * flight.value('attitude/phi-rad'), -1, 1) });
      assert.equal(flight.step(1), 0);
      const p = place(flight), above = flight.value('position/h-agl-ft'), height = flight.value('position/h-sl-ft'), kt = flight.value('velocities/vc-kts');
      worst = Math.max(worst, Math.abs(above - (height - heightAt(t, p.north, p.east))));
      low = Math.min(low, above);
      heights = [Math.min(heights[0], height), Math.max(heights[1], height)];
      knots = [Math.min(knots[0], kt), Math.max(knots[1], kt)];
    }
    const end = place(flight);
    console.log(`  ${variant}: ${knots[0].toFixed(0)} to ${knots[1].toFixed(0)} kt at ${heights[0].toFixed(0)} to ${heights[1].toFixed(0)} ft for 60 s, ${((end.east + 8000) / 1000).toFixed(1)} km over the hill and the slope (as low as ${low.toFixed(0)} ft above the ground): ` +
      `${flight.swaps} swaps (${(flight.swaps / 60).toFixed(2)} a second), ${flight.stepsOutside} steps outside the patch; height above ground against altitude minus the terrain's own height: ${worst.toFixed(4)} ft at most`);
    assert.ok(knots[0] > 590 && knots[1] < 610 && heights[0] > 1900 && heights[1] < 2100, 'it held 600 knots and 2,000 ft');
    assert.ok(low < 1500, 'it crossed high ground');
    assert.equal(flight.stepsOutside, 0);
    assert.ok(flight.swaps / 60 <= 2, `${flight.swaps / 60} swaps a second`);
    assert.ok(worst <= 0.01, `${worst} ft`);
    flight.dispose();
  });

  test(`${variant}: never over unloaded ground: the flight waits at the edge of what has loaded, and carries on when the ground arrives`, async () => {
    const whole = flatSource(0);
    let loaded = true;
    const late = { post: whole.post, water: whole.water, heights: (...args) => (loaded ? whole.heights(...args) : null) };
    const module = await moduleWith(C172X.files, variant);
    loaded = false;
    assert.equal(Flight.start(module, C172X, { terrain: late }), null, 'a flight cannot start without its first patch');
    loaded = true;
    const flight = Flight.start(module, C172X, { terrain: late, patchPosts: 17, patchMargin: 4 });
    const first = flight.patch;
    loaded = false;   // from here the ground ahead does not load
    flight.fly({ brake: false, throttle: 1 });
    let steps = 0;
    while (!flight.waiting && steps < 120 / DT) { assert.equal(flight.step(1), 0); steps += flight.stepsRun; }
    assert.ok(flight.waiting, 'it stopped to wait');
    const here = place(flight), time = flight.value('simulation/sim-time-sec');
    assert.equal(flight.patch, first, 'still on the first patch');
    assert.ok(postsInside(first, here.north, here.east) >= 0 && postsInside(first, here.north, here.east) < 1, `it stopped ${postsInside(first, here.north, here.east).toFixed(2)} posts inside the edge`);
    // Asked for ten more seconds, it runs no step: no time passes for it.
    assert.equal(flight.step(Math.round(10 / DT)), 0);
    assert.equal(flight.stepsRun, 0);
    assert.equal(flight.value('simulation/sim-time-sec'), time);
    assert.equal(flight.stepsOutside, 0);
    loaded = true;    // the ground arrives
    assert.equal(flight.step(120), 0);
    assert.equal(flight.stepsRun, 120, 'it carries on, with exactly the steps asked for: nothing is caught up');
    assert.ok(!flight.waiting && flight.patch !== first && flight.swaps === 1);
    assert.ok(Math.abs(flight.value('simulation/sim-time-sec') - time - 1) < 1e-9);
    assert.equal(flight.stepsOutside, 0);
    console.log(`  ${variant}: rolled ${(Math.hypot(here.north, here.east) / FT).toFixed(0)} ft, waited ${postsInside(first, here.north, here.east).toFixed(2)} posts inside the edge of the first patch at ${(flight.value('velocities/vg-fps') / 1.6878).toFixed(0)} kt, and carried on when the ground arrived`);
    flight.dispose();
  });
}

test('the cost of cutting a patch and giving it to JSBSim (reported, no pass or fail)', async () => {
  const t = testTerrain();
  const flight = Flight.start(await moduleWith(C172X.files, 'weh'), C172X, { terrain: t, settleSeconds: 0 });
  assert.equal(PATCH_MARGIN, 32);
  const before = performance.now(), times = 200;
  for (let i = 0; i < times; i++) flight.fdm.setGround(cutPatch(t, 6000 + 37 * i, 2000 + 53 * i).grid);
  const each = (performance.now() - before) / times;
  console.log(`  one swap (cut ${PATCH_POSTS} x ${PATCH_POSTS} posts from the test terrain and give them to JSBSim): ${(each * 1000).toFixed(0)} microseconds in Node, about ${(each / (DT * 1000) * 100).toFixed(1)}% of one step's 8.3 ms`);
  flight.dispose();
});
