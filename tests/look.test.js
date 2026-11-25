// The look-around (src/input/look.js). After 135crewdog/wings, tests/controls.test.js, commit 557a8d0: its
// look-around test (Rage's own), as it is. Wings' tilt and throttle tests come with the controls.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ---- look-around (src/input/look.js), with Rage's own test ----
test('look-around: a drag swings the view, dragging the world; it eases back when released', async () => {
  const { createLook, DEG_PER_PX, YAW_MAX, PITCH_MAX } = await import('../src/input/look.js');
  const look = createLook();
  look.drag(100, 0);
  assert.equal(look.yaw, 0, 'nothing moves until a finger is down');
  look.begin();
  look.drag(100, 40);
  assert.ok(Math.abs(look.yaw - 100 * DEG_PER_PX) < 1e-9, 'drag right looks left');
  assert.ok(Math.abs(look.pitch - 40 * DEG_PER_PX) < 1e-9, 'drag down looks up');
  look.drag(5000, 5000);
  assert.equal(look.yaw, YAW_MAX); assert.equal(look.pitch, PITCH_MAX);
  look.update(1);
  assert.equal(look.yaw, YAW_MAX, 'held: no return while the finger is down');
  look.release();
  for (let i = 0; i < 60; i++) look.update(1 / 60);
  assert.ok(Math.abs(look.yaw) < 5 && Math.abs(look.pitch) < 3, `mostly back within a second: ${look.yaw} ${look.pitch}`);
  for (let i = 0; i < 120; i++) look.update(1 / 60);
  assert.equal(look.yaw, 0); assert.equal(look.pitch, 0); assert.equal(look.active, false);
});
