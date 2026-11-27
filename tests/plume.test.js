// The F-4C's afterburner plumes (milestone 3, pull request 9), headless. New in FSG; the "done" lines are in
// docs/milestones/3.md, PR 9, written before this was built: "the plumes sit on the model's engine exits within
// 1 in; their size follows the afterburner the engines give, read from JSBSim, not the throttle's position."
// The plumes are Wings' (src/render/plume.js), built here as the app builds them (src/render/aircraft.js, from
// the F-4C's settings), with Three.js as the page has it (tests/three.js) and nothing drawn. The model's exits
// are measured from the model itself, as tests/model.test.js measures them (models/measure.mjs). The browser's
// lines (no plume at dry power, both at full afterburner, gone within 1 s of idle) are tests/browser/app.chromium.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readGlb } from '../models/glb.mjs';
import { engineExits } from '../models/measure.mjs';
import { F4C } from '../src/sim/aircraft/f4c.js';
import { DT, Flight } from '../src/sim/game.js';
import { VARIANTS } from '../jsbsim/tests/lib/node.js';
import { moduleWith } from './checkride/files.js';
import { three } from './three.js';

const THREE = await three();
const { createAircraft } = await import('../src/render/aircraft.js');
const FT = 0.3048, IN = 1 / 12;
const { flame } = F4C.plumes;

/** The F-4C as the app builds it, before its model has loaded (in Node it cannot: there is no page to fetch it from). The plumes do not wait for it. */
function airplane() {
  const built = createAircraft(F4C);
  built.ready.catch(() => {});
  return built;
}
/** A point in the model's axes (metres right, up, aft) in body axes (feet forward, right, down). */
const body = ([x, y, z]) => [-z / FT, x / FT, -y / FT];
/** What each plume shows, as short text. */
const told = (plumes) => plumes.map((p) => (p.lit ? `lit, ${p.lengthM.toFixed(2)} m` : 'out')).join(' and ');

test('f4c plumes: "the plumes sit on the model\'s engine exits within 1 in", each the exit\'s size, and the flame goes aft', () => {
  const exits = engineExits(readGlb('models/f4c.glb'));
  const shown = airplane();
  assert.equal(shown.plumes.length, 2, 'one plume for each engine');
  assert.equal(exits.length, 2, 'the model has two engine exits');
  shown.burner([1, 1], 0);
  shown.updateMatrixWorld(true);
  shown.plumes.forEach((plume, k) => {
    const exit = exits[k], start = body(plume.shown().at), off = start.map((feet, i) => feet - exit.at[i]);
    const [sheath] = plume.mesh.children, radius = sheath.geometry.parameters.radiusBottom / FT;
    console.log(`  ${k ? 'right' : 'left'} plume starts at [${start.map((f) => f.toFixed(3)).join(', ')}] ft forward, right and down; the model's exit is at [${exit.at.map((f) => f.toFixed(3)).join(', ')}]: ${(Math.hypot(...off) * 12).toFixed(2)} in apart; its radius ${radius.toFixed(3)} ft, the exit's ${exit.radius.toFixed(3)}`);
    assert.ok(Math.hypot(...off) < IN, `the ${k ? 'right' : 'left'} plume starts within 1 in of the ${k ? 'right' : 'left'} exit's middle (${(Math.hypot(...off) * 12).toFixed(2)} in)`);
    assert.ok(Math.abs(radius - exit.radius) < IN, `and is the exit's size within 1 in (${radius.toFixed(3)} ft against ${exit.radius.toFixed(3)})`);
    // The flame's cone, in the model's axes: from the exit's plane straight back.
    const box = new THREE.Box3().setFromObject(sheath), from = plume.mesh.position;
    assert.ok(Math.abs(box.min.z - from.z) < 0.01 && Math.abs(box.max.z - (from.z + flame.maxLength)) < 0.01, `the flame runs aft from the exit, ${(box.max.z - box.min.z).toFixed(2)} m at full afterburner`);
    assert.ok(Math.abs((box.min.x + box.max.x) / 2 - from.x) < 0.01 && Math.abs((box.min.y + box.max.y) / 2 - from.y) < 0.01, 'on the exit\'s axis');
  });
  assert.equal(F4C.engines.afterburner.length, shown.plumes.length, 'a plume for each engine whose afterburner is sent');
});

test('f4c plumes: each plume follows its own engine\'s number: none at 0, Wings\' length between, one engine\'s number alone lights one plume', () => {
  const shown = airplane(), plumes = () => shown.plumes.map((plume) => plume.shown());
  for (const [given, lit] of [[[0, 0], [false, false]], [[0.5, 0], [true, false]], [[0, 0.5], [false, true]], [[1, 1], [true, true]], [[0, 0], [false, false]]]) {
    shown.burner(given, 1 / 60);
    const now = plumes();
    assert.deepEqual(now.map((p) => p.lit), lit, `afterburners ${given.join(' and ')}: ${told(now)}`);
    now.forEach((p, k) => { if (p.lit) assert.ok(Math.abs(p.lengthM - (flame.minLength + (flame.maxLength - flame.minLength) * given[k])) < 1e-9, `length ${p.lengthM} m at ${given[k]}`); });
  }
  shown.burner(undefined, 1 / 60);
  assert.deepEqual(plumes().map((p) => p.lit), [false, false], 'with no engines\' numbers (an airplane without them), none');
});

for (const variant of VARIANTS) {
  test(`${variant}, f4c plumes: "their size follows the afterburner the engines give, read from JSBSim, not the throttle's position"`, async () => {
    // Parked and held down, engines idling. Each step the engines' afterburner numbers are read as the Worker reads them (src/sim/flight-run.js) and handed to the plumes as the page hands them (src/flight.js).
    const module = await moduleWith(F4C, variant);
    const watch = (flight, seconds, each) => {
      const shown = airplane();
      for (let k = 0; k < Math.round(seconds / DT); k++) {
        assert.equal(flight.step(1), 0, 'JSBSim stepped');
        const afterburner = F4C.engines.afterburner.map((name) => flight.get(name));
        shown.burner(afterburner, DT);
        each((k + 1) * DT, afterburner, shown.plumes.map((plume) => plume.shown()));
      }
    };
    const flight = Flight.start(module, F4C, { sets: [['forces/hold-down', 1]] });
    assert.ok(flight.get('fcs/throttle-pos-norm') === 0 && F4C.engines.afterburner.every((name) => flight.get(name) === 0), 'idling, no afterburner');
    // The throttle slammed from idle to full: the throttle is at full from the first step; the plumes wait for the engines.
    flight.fly({ throttle: 1 });
    let lit = null, full = null;
    watch(flight, 10, (t, afterburner, plumes) => {
      plumes.forEach((p, k) => {
        assert.equal(p.lit, afterburner[k] > 0, `at ${t.toFixed(3)} s, engine ${k}'s afterburner ${afterburner[k]}: its plume ${p.lit ? 'lit' : 'out'}`);
        if (p.lit) assert.ok(Math.abs(p.lengthM - (flame.minLength + (flame.maxLength - flame.minLength) * afterburner[k])) < 1e-9, 'as long as the afterburner it gives');
      });
      if (lit === null && plumes.some((p) => p.lit)) lit = t;
      if (full === null && plumes.every((p) => p.lit && p.lengthM === flame.maxLength)) full = t;
    });
    assert.ok(lit !== null && lit > 0.5, `throttle full from idle: no plume until the engines are at MIL speed (the first lit at ${lit?.toFixed(2)} s)`);
    assert.ok(full !== null, `both full length in full afterburner (by ${full?.toFixed(2)} s)`);
    // Chopped to idle: out as the afterburner goes.
    flight.fly({ throttle: 0 });
    let out = null;
    watch(flight, 2, (t, afterburner, plumes) => {
      plumes.forEach((p, k) => assert.equal(p.lit, afterburner[k] > 0, `chopped, at ${t.toFixed(3)} s: engine ${k} ${afterburner[k]}, plume ${p.lit ? 'lit' : 'out'}`));
      if (out === null && plumes.every((p) => !p.lit)) out = t;
    });
    assert.ok(out !== null, 'both out after the chop');
    // At MIL, full dry power: none.
    flight.fly({ throttle: F4C.mil });
    watch(flight, 10, (t, afterburner, plumes) => assert.ok(plumes.every((p) => !p.lit), `at MIL, ${t.toFixed(2)} s on: ${told(plumes)}`));
    flight.dispose();

    // One engine alone: the game's one throttle works both, so for this test it is wired to the left engine only, and the right one idles.
    const left = { ...F4C, controls: { ...F4C.controls, throttle: { to: ['fcs/throttle-cmd-norm'] } } };
    const one = Flight.start(await moduleWith(F4C, variant), left, { sets: [['forces/hold-down', 1]] });
    one.fly({ throttle: 1 });
    let last = null;
    watch(one, 10, (t, afterburner, plumes) => { last = { afterburner, plumes }; });
    assert.ok(last.afterburner[0] === 1 && last.afterburner[1] === 0, `JSBSim: the left engine in full afterburner, the right idling (${last.afterburner.join(', ')})`);
    assert.deepEqual(last.plumes.map((p) => p.lit), [true, false], `the left plume lit, the right out: ${told(last.plumes)}`);
    one.dispose();
    console.log(`  ${variant}: throttle slammed full from idle at 0 s: the first plume lit at ${lit.toFixed(2)} s, both full length at ${full.toFixed(2)} s; chopped to idle, both out ${(out * 1000).toFixed(0)} ms later; none at MIL; the left engine alone lights the left plume alone`);
  });
}
