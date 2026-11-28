// The airplane picker's one list (src/sim/aircraft/list.js): its names, and which airplane a saved name gives.
// New in FSG, milestone 3 re-planned, pull request 2 (docs/milestones/3-replan.md). That the page, the Worker and
// sw.js all take their airplanes from this list is tests/app.test.js's.
//
// Pull request 4 changed the list, as the plan says ("F-4C" goes to the top of the picker ... and is what a new
// install gets. A saved choice stays): it was the two airplanes 'F-4C (NASA data)' and "Cessna 172 (JSBSim's)",
// models f4c and c172p. The simple F-4C is now the first, named "F-4C".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BY_MODEL, LIST, aircraftFor } from '../src/sim/aircraft/list.js';
import { F4C_SIMPLE } from '../src/sim/aircraft/f4c-simple.js';
import { F4C } from '../src/sim/aircraft/f4c.js';
import { C172P } from '../src/sim/aircraft/c172p.js';

test('the list is the plan\'s three airplanes, in its order, with its names: the simple F-4C first, as "F-4C"', () => {
  assert.deepEqual(LIST.map(({ name }) => name), ['F-4C', 'F-4C (NASA data)', "Cessna 172 (JSBSim's)"]);
  assert.deepEqual(LIST.map(({ aircraft }) => aircraft), [F4C_SIMPLE, F4C, C172P]);
  assert.deepEqual(LIST.map(({ aircraft }) => aircraft.model), ['f4c-simple', 'f4c', 'c172p'], 'kept as the airplane\'s JSBSim name');
  assert.deepEqual(Object.keys(BY_MODEL), ['f4c-simple', 'f4c', 'c172p']);
  assert.ok(Object.isFrozen(LIST) && LIST.every(Object.isFrozen) && Object.isFrozen(BY_MODEL), 'nothing can change it');
  for (const { aircraft } of LIST) assert.ok(aircraft.glb && aircraft.files.length > 0, `${aircraft.model} has a model and its files`);
});

test('each saved name gives its airplane: a choice saved before the simple F-4C arrived stays', () => {
  for (const { aircraft } of LIST) assert.equal(aircraftFor(aircraft.model), aircraft, aircraft.model);
  assert.equal(aircraftFor('f4c'), F4C, 'a saved "f4c" is still the data-built F-4C');
  assert.equal(aircraftFor('c172p'), C172P, 'a saved "c172p" is still JSBSim\'s Cessna');
});

test('nothing saved, or a saved name that is not in the list, gives the first in the list: the simple F-4C, what a new install gets', () => {
  for (const saved of [null, undefined, '', 'f-16', 'F4C', 'c172x', 'constructor', '__proto__', 'toString', 42]) {
    assert.equal(aircraftFor(saved), LIST[0].aircraft, String(saved));
  }
  assert.equal(LIST[0].aircraft, F4C_SIMPLE);
});
