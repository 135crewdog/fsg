// The airplane picker's one list (src/sim/aircraft/list.js): its names, and which airplane a saved name gives.
// New in FSG, milestone 3 re-planned, pull request 2 (docs/milestones/3-replan.md). That the page, the Worker and
// sw.js all take their airplanes from this list is tests/app.test.js's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BY_MODEL, LIST, aircraftFor } from '../src/sim/aircraft/list.js';
import { F4C } from '../src/sim/aircraft/f4c.js';
import { C172P } from '../src/sim/aircraft/c172p.js';

test('the list is the plan\'s two airplanes, in its order, with its names', () => {
  assert.deepEqual(LIST.map(({ name }) => name), ['F-4C (NASA data)', "Cessna 172 (JSBSim's)"]);
  assert.deepEqual(LIST.map(({ aircraft }) => aircraft), [F4C, C172P]);
  assert.deepEqual(LIST.map(({ aircraft }) => aircraft.model), ['f4c', 'c172p'], 'kept as the airplane\'s JSBSim name');
  assert.deepEqual(Object.keys(BY_MODEL), ['f4c', 'c172p']);
  assert.ok(Object.isFrozen(LIST) && LIST.every(Object.isFrozen) && Object.isFrozen(BY_MODEL), 'nothing can change it');
  for (const { aircraft } of LIST) assert.ok(aircraft.glb && aircraft.files.length > 0, `${aircraft.model} has a model and its files`);
});

test('each saved name gives its airplane', () => {
  for (const { aircraft } of LIST) assert.equal(aircraftFor(aircraft.model), aircraft, aircraft.model);
});

test('nothing saved, or a saved name that is not in the list, gives the first in the list', () => {
  for (const saved of [null, undefined, '', 'f-16', 'F4C', 'c172x', 'constructor', '__proto__', 'toString', 42]) {
    assert.equal(aircraftFor(saved), LIST[0].aircraft, String(saved));
  }
});
