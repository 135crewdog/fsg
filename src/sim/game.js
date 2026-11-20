// One flight: a fresh JSBSim, one aircraft, standing where the game put it. New in FSG, milestone 1.
// This file grows through the milestone (controls and state, ground patches, assists, rules); so far it
// starts a flight parked on the runway.
//
// A flight is a start and a tape (docs/milestones/1.md): the start is a list of values set before JSBSim's
// first step; after that, everything the game does to JSBSim goes through one array of inputs, every step.
// That is what lets native JSBSim replay a flight, and it is the fast path (one array, no names).
import { Fdm } from './core.js';
import { FIELD, fieldGround, toLatLon, toWorld } from './world.js';

/** The physics step, seconds: 120 steps a second. */
export const DT = 1 / 120;
const DEG = 180 / Math.PI;

/** The controls of a parked airplane: every flight starts with these (after Wings' PARKED, src/field.js). */
export const PARKED = { pitch: 0, roll: 0, throttle: 0, gear: true, flaps: true, speedbrake: false, brake: true };

/**
 * How long a new flight is run before it is handed over, seconds of its own time (a few thousandths of a
 * second of ours). JSBSim starts a running engine at full power: the Cessna's takes 8 seconds to come down
 * to idle and dips the nose 1.7 degrees on the way (measured, docs/milestones/1.md). Flaps travel in this time too.
 */
export const SETTLE_SECONDS = 10;

/** The value JSBSim gets for each command the seven controls drive, as [name, value] pairs, in a fixed order. */
export function commandsFor(aircraft, controls) {
  const out = [];
  for (const [control, { to, sign = 1 }] of Object.entries(aircraft.controls)) {
    const value = typeof controls[control] === 'boolean' ? (controls[control] ? 1 : 0) : sign * controls[control];
    for (const name of to) out.push([name, value]);
  }
  return out;
}

export class Flight {
  /** The Fdm instance (src/sim/core.js). */
  fdm;
  aircraft;
  /** What was set before JSBSim's first step, as [name, value] pairs: the start of the tape. */
  startSets;
  /** The names of the inputs written every step, and the array they are written from. */
  inputNames;
  inputs;

  /**
   * Starts a flight: `aircraft` (src/sim/aircraft/) parked at `at` (metres north and east, heading in degrees
   * true), on its wheels, engine running at idle, brakes on, gear and flaps down, and settled.
   * `ground` is the grid under it; `module` is a loaded FdmModule holding the aircraft's files.
   */
  static start(module, aircraft, { at = FIELD.start, ground = fieldGround(), settleSeconds = SETTLE_SECONDS, onEvent } = {}) {
    const flight = new Flight();
    flight.aircraft = aircraft;
    const fdm = flight.fdm = Fdm.create(module, { dt: DT, ground, onEvent });
    try {
      fdm.loadModel(aircraft.model);
      const { lat, lon } = toLatLon(at.north, at.east);
      const parked = commandsFor(aircraft, PARKED);
      flight.startSets = [
        // Geodetic latitude: JSBSim's plain "latitude" is geocentric, 10 nm away at this latitude.
        ['ic/lat-geod-deg', lat * DEG], ['ic/long-gc-deg', lon * DEG], ['ic/psi-true-deg', at.headingDeg], ['ic/h-agl-ft', aircraft.standingFt],
        ['propulsion/set-running', -1],   // every engine running
        ...parked,
      ];
      for (const [name, value] of flight.startSets) fdm.setByName(name, value);
      flight.inputNames = parked.map(([name]) => name);
      flight.inputs = fdm.bindInputs(flight.inputNames);
      fdm.runIC();
      flight.inputs.set(parked.map(([, value]) => value));
      flight.step(Math.round(settleSeconds / DT));
    } catch (e) {
      flight.dispose();
      throw e;
    }
    return flight;
  }

  /** Runs n steps; returns JSBSim's result code (0 is ok; see codes.js). */
  step(n = 1) {
    return this.fdm.step(n);
  }

  /** One of JSBSim's numbers, by name. For tests and the start; too slow for every step. */
  get(name) {
    return this.fdm.getByName(name);
  }

  /** Where the airplane is in the world: metres north and east, feet above sea level and above the ground, heading in degrees true. */
  where() {
    const { north, east } = toWorld(this.get('position/lat-geod-rad'), this.get('position/long-gc-rad'));
    return { north, east, heightFt: this.get('position/h-sl-ft'), aboveGroundFt: this.get('position/h-agl-ft'), headingDeg: this.get('attitude/psi-deg') };
  }

  dispose() {
    if (this.fdm) this.fdm.dispose();
  }
}
