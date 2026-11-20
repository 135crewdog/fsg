// One flight: a fresh JSBSim, one aircraft, standing where the game put it. New in FSG, milestone 1.
// This file grows through the milestone (assists, rules); so far it starts a flight parked on the runway,
// takes the seven controls in, gives the state out, and keeps a patch of ground under the airplane.
//
// A flight is a start and a tape (docs/milestones/1.md): the start is a list of values set before JSBSim's
// first step; after that, everything the game does to JSBSim goes through one array of inputs, every step.
// That is what lets native JSBSim replay a flight, and it is the fast path (one array, no names).
import { Fdm, FdmError } from './core.js';
import { PATCH_MARGIN, PATCH_POSTS, cutPatch, flatSource, postsInside } from './ground.js';
import { FIELD, toLatLon, toWorld } from './world.js';

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

/**
 * The state: what a flight gives out after every step, as one array of numbers in this order, each straight
 * from JSBSim in JSBSim's own units. After these come one number for each wheel and airframe contact point
 * the aircraft file has, 1 while it touches the ground and 0 otherwise (flight.stateNames has them all).
 * src/sim/world.js turns the latitude and longitude into the game's north and east.
 */
export const STATE = [
  ['simulation/sim-time-sec', 's', 'time since the flight was started'],
  ['position/lat-geod-rad', 'rad', 'latitude (geodetic)'],
  ['position/long-gc-rad', 'rad', 'longitude'],
  ['position/h-sl-ft', 'ft', 'height above sea level'],
  ['position/h-agl-ft', 'ft', 'height above the ground under it'],
  ['attitude/phi-rad', 'rad', 'bank, right wing down positive'],
  ['attitude/theta-rad', 'rad', 'pitch, nose up positive'],
  ['attitude/psi-rad', 'rad', 'heading, true, 0 to 2 pi'],
  ['velocities/v-north-fps', 'ft/s', 'speed over the ground, northward'],
  ['velocities/v-east-fps', 'ft/s', 'speed over the ground, eastward'],
  ['velocities/v-down-fps', 'ft/s', 'sink rate, down positive'],
  ['velocities/vc-kts', 'kt', 'calibrated airspeed'],
  ['velocities/vtrue-kts', 'kt', 'true airspeed'],
  ['velocities/vg-fps', 'ft/s', 'ground speed'],
  ['velocities/mach', '', 'Mach number'],
  ['velocities/p-rad_sec', 'rad/s', 'roll rate'],
  ['velocities/q-rad_sec', 'rad/s', 'pitch rate'],
  ['velocities/r-rad_sec', 'rad/s', 'yaw rate'],
  ['aero/alpha-rad', 'rad', 'angle of attack'],
  ['aero/beta-rad', 'rad', 'sideslip'],
  ['accelerations/Nz', 'g', 'g, 1 in level flight'],
  ['accelerations/Ny', 'g', 'sideways g at the centre of gravity: the ball'],
  ['fcs/elevator-pos-rad', 'rad', 'elevator'],
  ['fcs/left-aileron-pos-rad', 'rad', 'left aileron'],
  ['fcs/right-aileron-pos-rad', 'rad', 'right aileron'],
  ['fcs/rudder-pos-rad', 'rad', 'rudder'],
  ['fcs/flap-pos-norm', '0 to 1', 'flaps, 1 fully down'],
  ['fcs/speedbrake-pos-norm', '0 to 1', 'speedbrake, 1 fully out'],
  ['gear/gear-pos-norm', '0 to 1', 'gear, 1 down'],
  ['fcs/steer-pos-deg', 'deg', 'nosewheel steering angle'],
  ['fcs/throttle-pos-norm', '0 to 1, 2 in afterburner', 'engine power lever as the engine has it'],
  ['propulsion/engine[0]/thrust-lbs', 'lb', 'thrust'],
  ['inertia/weight-lbs', 'lb', 'weight'],
  ['propulsion/total-fuel-lbs', 'lb', 'fuel on board'],
];

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
  /** The names of the numbers in the state, and the state after the last step (a view: it changes with every step). */
  stateNames;
  state;
  /** The seven controls as last given to fly(). */
  controls;
  /** Set by an airborne start: the throttle and stick that hold the trimmed flight (the checkride starts from these). */
  trimmed = null;
  /** The terrain the flight is over (src/sim/ground.js), and the patch of it JSBSim has now. */
  terrain;
  patch;
  /** Posts along a side of a patch, and how near its edge the airplane may come before a new one is cut. */
  patchPosts;
  patchMargin;
  /** True while the flight is held still because the ground ahead has not loaded. */
  waiting = false;
  /** How many patches have been cut after the first, and how many steps ended outside the patch they were run on (0, or the patch logic is wrong). */
  swaps = 0;
  stepsOutside = 0;
  /** The grid the flight was started on. */
  ground;
  /** With `record`: the inputs given to every step and the state after it, from the first step on. */
  recorded = null;
  #at = new Map();   // where each name is in the state

  /**
   * Starts a flight: `aircraft` (src/sim/aircraft/) parked at `at` (metres north and east, heading in degrees
   * true), on its wheels, engine running at idle, brakes on, gear and flaps down, and settled.
   * `terrain` is the ground it is over, a terrain source (src/sim/ground.js; the flat test field if left out);
   * `module` is a loaded FdmModule holding the aircraft's files. Returns null if the ground at the start has
   * not loaded: a flight never starts over ground that is not there.
   *
   * For the checkride only, `airborne: { heightFt, knots }` starts it in the air instead: clean, level and
   * steady at that height and speed by JSBSim's own trim. The game never does: every flight starts parked.
   *
   * `record: true` keeps the tape: every step's inputs and the state after it (tape()). The start and the tape
   * are the whole flight, so native JSBSim can fly it again. A flight trimmed into the air is not one: JSBSim's
   * trim is not something the tape holds.
   */
  static start(module, aircraft, { at = FIELD.start, terrain = flatSource(FIELD.heightFt), patchPosts = PATCH_POSTS, patchMargin = PATCH_MARGIN,
    settleSeconds = SETTLE_SECONDS, airborne = null, record = false, nudge = 0, onEvent } = {}) {
    if (record && airborne) throw new Error('an airborne start cannot be recorded: its trim is not part of the tape');
    const patch = cutPatch(terrain, at.north, at.east, patchPosts);
    if (!patch) return null;
    const ground = patch.grid;
    const flight = new Flight();
    flight.aircraft = aircraft;
    Object.assign(flight, { terrain, patch, patchPosts, patchMargin, ground });
    const fdm = flight.fdm = Fdm.create(module, { dt: DT, ground, onEvent });
    try {
      fdm.loadModel(aircraft.model);
      const { lat, lon } = toLatLon(at.north, at.east);
      flight.controls = airborne ? { ...PARKED, gear: false, flaps: false, brake: false } : { ...PARKED };
      const commands = commandsFor(aircraft, flight.controls);
      flight.startSets = [
        // Geodetic latitude: JSBSim's plain "latitude" is geocentric, 10 nm away at this latitude.
        ['ic/lat-geod-deg', lat * DEG], ['ic/long-gc-deg', lon * DEG], ['ic/psi-true-deg', at.headingDeg],
        // The speed goes in last: JSBSim holds it while the height is set, not the other way round.
        ...(airborne ? [['ic/h-sl-ft', airborne.heightFt], ['ic/vc-kts', airborne.knots]] : [['ic/h-agl-ft', aircraft.standingFt]]),
        ['propulsion/set-running', -1],   // every engine running
        ['propulsion/fuel_freeze', 1],    // constant weight: fuel never burns
        ...commands,
        ...(airborne ? aircraft.controls.gear.to.map(() => ['gear/gear-pos-norm', 0]) : []),   // in the air the gear is already up
      ];
      for (const [name, value] of flight.startSets) fdm.setByName(name, value);
      // For tests that measure how far a flight differs from itself: the start height moved by `nudge` last
      // digits (2^-28 ft, one unit in the last place of an Earth-sized number, as FDM's tests do).
      if (nudge) fdm.setByName('ic/h-sl-ft', fdm.getByName('ic/h-sl-ft') + nudge * 2 ** -28);

      flight.stateNames = STATE.map(([name]) => name);
      // Every wheel and airframe contact point the aircraft file has: wheels are gear/unit[k], the rest contact/unit[k].
      const units = fdm.getByName('gear/num-units');
      for (let k = 0; k < units; k++) flight.stateNames.push(fdm.has(`gear/unit[${k}]/WOW`) ? `gear/unit[${k}]/WOW` : `contact/unit[${k}]/WOW`);
      flight.stateNames.forEach((name, i) => flight.#at.set(name, i));
      flight.#lat = flight.#at.get('position/lat-geod-rad');
      flight.#lon = flight.#at.get('position/long-gc-rad');
      fdm.bindOutputs(flight.stateNames);
      flight.inputNames = commands.map(([name]) => name);
      flight.inputs = fdm.bindInputs(flight.inputNames);
      fdm.runIC();
      flight.state = fdm.curr;
      if (record) flight.recorded = { inputs: [], states: [Float64Array.from(flight.state)] };

      if (airborne) {
        // JSBSim's own trim: level and steady at this speed. It sets the throttle and the stick it needs, and
        // the pitch trim (which no control of ours drives, so it stays where the trim put it).
        fdm.setByName('simulation/do_simple_trim', 1);
        const read = (control) => { const { to, sign = 1 } = aircraft.controls[control]; return sign * fdm.getByName(to[0]); };
        flight.trimmed = { throttle: read('throttle'), pitch: read('pitch'), roll: read('roll') };
        Object.assign(flight.controls, flight.trimmed);
        // The state was read at the start, before the trim changed it: read it again, without a step.
        fdm.bindOutputs(flight.stateNames);
        flight.state = fdm.curr;
      }
      // From here on the flight is a tape: nothing is set in JSBSim but through the input array.
      fdm.set = () => { throw new FdmError('a flight is a start and a tape: after the start, JSBSim is given values only through the input array'); };
      flight.fly(flight.controls);
      if (!airborne) flight.step(Math.round(settleSeconds / DT));
    } catch (e) {
      flight.dispose();
      throw e;
    }
    return flight;
  }

  /** Gives the seven controls: they hold until the next call. Any left out stay as they were. */
  fly(controls) {
    Object.assign(this.controls, controls);
    this.inputs.set(commandsFor(this.aircraft, this.controls).map(([, value]) => value));
  }

  /** One number of the state by JSBSim's name, as of the last step. */
  value(name) {
    const i = this.#at.get(name);
    if (i === undefined) throw new Error(`${name} is not in the state`);
    return this.state[i];
  }

  /**
   * Runs up to n steps; returns JSBSim's result code (0 is ok; see codes.js). Before every step the patch of
   * ground is looked at: if the airplane has come near its edge a new one is cut round it, and if the ground
   * there has not loaded and the airplane is at the edge, the flight waits: no step is run (stepsRun says how
   * many were), and `waiting` is true until a later call finds the ground.
   */
  step(n = 1) {
    this.stepsRun = 0;
    for (let k = 0; k < n; k++) {
      if (!this.#groundReady()) return 0;
      const inputs = this.recorded ? Float64Array.from(this.inputs) : null;
      const result = this.fdm.step(1);
      if (this.fdm.stepsInLastCall === 1) {
        this.stepsRun++;
        if (this.#inside() < 0) this.stepsOutside++;   // measured after the step, against the patch it was run on
        if (this.recorded) {
          this.recorded.inputs.push(inputs);
          this.recorded.states.push(Float64Array.from(this.state));
        }
      }
      if (result !== 0) return result;
    }
    return 0;
  }
  /** Steps run by the last step() call. */
  stepsRun = 0;

  /** Keeps the patch round the airplane. False if the flight must wait for ground that has not loaded. */
  #groundReady() {
    const { north, east } = toWorld(this.state[this.#lat], this.state[this.#lon]);
    const inside = postsInside(this.patch, north, east);
    if (inside < this.patchMargin) {
      const next = cutPatch(this.terrain, north, east, this.patchPosts);
      if (next) {
        this.fdm.setGround(next.grid);
        this.patch = next;
        this.swaps++;
        this.waiting = false;
        return true;
      }
      // The ground ahead is not there yet. Carry on while the airplane is well inside what JSBSim has; stop
      // at the last post but one, so that no step is ever run outside the patch.
      if (inside < 1) { this.waiting = true; return false; }
    }
    this.waiting = false;
    return true;
  }
  /** How many posts the airplane is inside the patch JSBSim has (negative: outside it). */
  #inside() {
    const { north, east } = toWorld(this.state[this.#lat], this.state[this.#lon]);
    return postsInside(this.patch, north, east);
  }
  #lat = 0;
  #lon = 0;

  /**
   * The recorded flight: its start (aircraft, step, ground, the values set before the first step) and its tape
   * (the names of the inputs, and one row of them for every step), with the states it went through.
   */
  tape() {
    if (!this.recorded) throw new Error('this flight was not started with record: true');
    const pack = (rows, width) => { const all = new Float64Array(rows.length * width); rows.forEach((row, i) => all.set(row, i * width)); return all; };
    return {
      model: this.aircraft.model, dt: DT, ground: this.ground, sets: this.startSets,
      ins: this.inputNames, inputs: pack(this.recorded.inputs, this.inputNames.length), steps: this.recorded.inputs.length,
      states: { columns: this.stateNames, rows: this.recorded.states.length, data: pack(this.recorded.states, this.stateNames.length) },
    };
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
