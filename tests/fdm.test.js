// JSBSim as the app starts it: through the Worker's own message handler, with
// only the seven files the app sends, in both builds. (The app's page side,
// src/fdm.js, needs a browser; tests/browser/app.chromium.mjs runs that.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BUILDS, DATA, DT } from '../src/fdm.js';
import { C172X_FILES } from '../src/sim/c172x-files.js';
import { buildPack } from '../src/sim/files.js';
import { WorkerClient, createHandler } from '../src/sim/worker-handler.js';

const inSrc = (path) => new URL(path, new URL('../src/', import.meta.url));
const bytes = (file) => readFileSync(fileURLToPath(inSrc(DATA + file)));

// The handler, spoken to as the page speaks to the Worker, with no thread in between
// (jsbsim/tests/loop.test.js shows the same handler behaves the same inside a worker thread).
function client() {
  let handle;
  const c = new WorkerClient((message) => void handle(message));
  handle = createHandler((message) => queueMicrotask(() => c.receive(message)));
  return c;
}
const init = (c, build, files) => c.request({
  type: 'init', moduleUrl: inSrc(BUILDS[build].module).href, packs: [['/data', buildPack(new Map(files.map((file) => [file, bytes(file)])))]],
});

for (const build of Object.keys(BUILDS)) {
  test(`${BUILDS[build].name}: c172x loads from the app's seven files, and the step is timed`, async () => {
    const c = client();
    const started = await init(c, build, C172X_FILES);
    assert.match(started.version, /^JSBSim 1\.3\.3/);
    assert.equal(started.memoryBytes, 16 * 1024 * 1024, 'the fixed 16 MiB');

    const created = await c.request({ type: 'create', model: 'c172x', ic: 'reset01', dt: DT, outputs: ['position/h-sl-ft', 'velocities/vtrue-kts'] });
    assert.equal(created.dt, DT);
    // Read back that the start is what its name says: in the air at 4,000 ft and 100 knots.
    assert.ok(Math.abs(created.curr[0] - 4000) < 0.1, `start altitude ${created.curr[0]} ft`);
    assert.ok(Math.abs(created.curr[1] - 100) < 0.5, `start airspeed ${created.curr[1]} kt`);
    await c.request({ type: 'dispose' });

    // The benchmark the overlay shows: five fresh instances, 3,000 timed steps each, the middle one reported.
    const { result } = await c.request({ type: 'bench', options: { dt: DT, forces: 0, fixtureAircraftPath: '' } });
    assert.equal(result.batchSteps, 3000);
    assert.equal(result.all.length, 5);
    assert.ok(Number.isFinite(result.usPerStep) && result.usPerStep > 0, `${result.usPerStep} µs per step`);
    // Still flying after 3,300 steps (27.5 s) hands-off: it has not hit the ground or left the atmosphere.
    assert.ok(result.endAltitudeFt > 2000 && result.endAltitudeFt < 6000, `end altitude ${result.endAltitudeFt} ft`);
    assert.ok(result.endAirspeedKt > 50 && result.endAirspeedKt < 200, `end airspeed ${result.endAirspeedKt} kt`);
    console.log(`  ${started.version.slice(0, 12)}, ${BUILDS[build].name}: ${result.usPerStep.toFixed(1)} µs per step in Node; after 27.5 s, ${Math.round(result.endAltitudeFt)} ft and ${Math.round(result.endAirspeedKt)} kt`);
  });

  test(`${BUILDS[build].name}: every one of the seven files is needed`, async () => {
    for (const missing of C172X_FILES) {
      const c = client();
      await init(c, build, C172X_FILES.filter((file) => file !== missing));
      await assert.rejects(
        c.request({ type: 'create', model: 'c172x', ic: 'reset01', dt: DT, outputs: ['position/h-sl-ft'] }),
        (error) => error instanceof Error && error.message.length > 0,
        `c172x loaded without ${missing}`,
      );
    }
  });
}
