// The airplanes the app can fly, in the order the pause screen's Airplane picker lists them. New in FSG,
// milestone 3 re-planned, pull request 2 (docs/milestones/3-replan.md; issue #44). One list: the page builds the
// picker from it and flies the pilot's choice (src/main.js), the Worker knows the same airplanes by it
// (src/sim/flight-run.js), and the service worker's test works out from it what the app downloads
// (tests/app.test.js). No DOM code: the Worker imports it too.
//
// The pilot's choice is kept between visits as the airplane's `model` (its JSBSim name: `f4c`, `c172p`). A
// saved name that is not in the list (an airplane since taken out, or nothing saved) gives the first.
import { F4C } from './f4c.js';
import { C172P } from './c172p.js';

/** The picker's list, first to last: each airplane's settings (src/sim/aircraft/) and the name the pilot reads. */
export const LIST = Object.freeze([
  Object.freeze({ aircraft: F4C, name: 'F-4C (NASA data)' }),
  Object.freeze({ aircraft: C172P, name: "Cessna 172 (JSBSim's)" }),
]);

/** The same airplanes by their model name, as the Worker is asked for them ("fly", { aircraft: model }). */
export const BY_MODEL = Object.freeze(Object.fromEntries(LIST.map(({ aircraft }) => [aircraft.model, aircraft])));

/** The airplane for a saved model name: that one if it is in the list, and otherwise the first. */
export const aircraftFor = (model) => (typeof model === 'string' && Object.hasOwn(BY_MODEL, model) ? BY_MODEL[model] : LIST[0].aircraft);
