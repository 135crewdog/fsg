// One flight: a fresh JSBSim, one aircraft, standing where the game put it. New in FSG, milestone 1.
// It starts a flight parked on the runway, takes the seven controls in, flies them with the game's assists,
// gives the state out, keeps a patch of ground under the airplane and judges what happens by the game's
// rules. Each step: controls, then assists, then JSBSim, then rules.
//
// A flight is a start and a tape (docs/milestones/1.md): the start is a list of values set before JSBSim's
// first step; after that, everything the game does to JSBSim goes through one array of inputs, every step.
// That is what lets native JSBSim replay a flight, and it is the fast path (one array, no names).
import { Assists, assistWrites } from './assists.js';
import { StepResult } from './codes.js';
import { Fdm, FdmError } from './core.js';
import { PATCH_MARGIN, PATCH_POSTS, cutPatch, flatSource, postsInside } from './ground.js';
import { Rules } from './rules.js';
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
  /**
   * Set by an airborne start: the throttle and stick that hold the trimmed flight (the checkride starts from
   * these), and what JSBSim's own trim found: its pitch trim, and the roll stick with no roll trim at all.
   */
  trimmed = null;
  /** The game's assists (src/sim/assists.js), or null for a flight started without them (tests only). */
  assists = null;
  /** The game's rules (src/sim/rules.js): the crash override switch, the events, the limits being exceeded. */
  rules;
  /**
   * Null while the flight goes on. Once it has ended: { reason, time, ... } with reason 'hard impact', 'water'
   * or 'broken state'. An ended flight runs no more steps, and its state stays the last good one.
   */
  ended = null;
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
   * `assists` replaces the aircraft's own assist settings, and `assists: null` flies with none: for tests that
   * compare. The game always flies with the aircraft's own.
   *
   * `crashOverride` is the pause screen's switch, on unless told otherwise: with it on no touch ends the
   * flight. For tests, `controls` changes the controls it starts with and `sets` adds values set before
   * JSBSim's first step (an arrival just above the ground, say); they are part of the start, so of the tape.
   *
   * `record: true` keeps the tape: every step's inputs and the state after it (tape()). The start and the tape
   * are the whole flight, so native JSBSim can fly it again. A flight trimmed into the air is not one: JSBSim's
   * trim is not something the tape holds.
   */
  static start(module, aircraft, { at = FIELD.start, terrain = flatSource(FIELD.heightFt), patchPosts = PATCH_POSTS, patchMargin = PATCH_MARGIN,
    settleSeconds = SETTLE_SECONDS, airborne = null, assists = aircraft.assists, crashOverride = true, controls = null, sets = [],
    record = false, nudge = 0, onEvent } = {}) {
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
      flight.controls = { ...PARKED, ...(airborne ? { gear: false, flaps: false, brake: false } : null), ...controls };
      const commands = commandsFor(aircraft, flight.controls);
      // The inputs: the commands the seven controls drive, then any the assists alone write.
      flight.inputNames = [...new Set([...commands.map(([name]) => name), ...(assists ? assistWrites(assists) : [])])];
      const inputAt = (name) => flight.inputNames.indexOf(name);
      for (const [control, { to, sign = 1 }] of Object.entries(aircraft.controls)) for (const name of to) flight.#drives.push([inputAt(name), control, sign]);
      flight.stateNames = STATE.map(([name]) => name);
      // Every wheel and airframe contact point the aircraft file has: wheels are gear/unit[k], the rest contact/unit[k].
      const units = fdm.getByName('gear/num-units'), wheels = [];
      for (let k = 0; k < units; k++) {
        const wheel = fdm.has(`gear/unit[${k}]/WOW`);
        if (wheel) wheels.push(flight.stateNames.length);
        flight.stateNames.push(wheel ? `gear/unit[${k}]/WOW` : `contact/unit[${k}]/WOW`);
      }
      flight.stateNames.forEach((name, i) => flight.#at.set(name, i));
      flight.#lat = flight.#at.get('position/lat-geod-rad');
      flight.#lon = flight.#at.get('position/long-gc-rad');
      if (assists) flight.assists = new Assists(assists, (name) => flight.#at.get(name), inputAt, wheels);
      flight.rules = new Rules(aircraft, (name) => flight.#at.get(name), flight.stateNames, DT);
      flight.rules.crashOverride = crashOverride;
      flight.startSets = [
        // Geodetic latitude: JSBSim's plain "latitude" is geocentric, 10 nm away at this latitude.
        ['ic/lat-geod-deg', lat * DEG], ['ic/long-gc-deg', lon * DEG], ['ic/psi-true-deg', at.headingDeg],
        // The speed goes in last: JSBSim holds it while the height is set, not the other way round.
        ...(airborne ? [['ic/h-sl-ft', airborne.heightFt], ['ic/vc-kts', airborne.knots]] : [['ic/h-agl-ft', aircraft.standingFt]]),
        ['propulsion/set-running', -1],   // every engine running
        ['propulsion/fuel_freeze', 1],    // constant weight: fuel never burns
        ...commands,
        ...(flight.assists ? flight.assists.startSets : []),   // the trim is there from before the first step
        ...(flight.controls.gear ? [] : aircraft.controls.gear.to.map(() => ['gear/gear-pos-norm', 0])),   // gear up means already up
        ...sets,
      ];
      for (const [name, value] of flight.startSets) fdm.setByName(name, value);
      // For tests that measure how far a flight differs from itself: the start height moved by `nudge` last
      // digits (2^-28 ft, one unit in the last place of an Earth-sized number, as FDM's tests do).
      if (nudge) fdm.setByName('ic/h-sl-ft', fdm.getByName('ic/h-sl-ft') + nudge * 2 ** -28);

      fdm.bindOutputs(flight.stateNames);
      flight.inputs = fdm.bindInputs(flight.inputNames);
      fdm.runIC();
      flight.state = fdm.curr;
      if (record) flight.recorded = { inputs: [], states: [Float64Array.from(flight.state)] };

      if (airborne) {
        // JSBSim's own trim: level and steady at this speed. It sets the throttle, the roll stick and the
        // pitch trim it needs. The game's roll trim was there before it, so the roll stick it finds is the
        // one that goes with that. Its pitch trim is replaced by the game's at the first step, and the stick
        // that then holds the same flight is the difference: in both aircraft files the trim adds to the
        // stick, one for one (tests/assists.test.js flies it to show it).
        const held = new Map(flight.assists ? flight.assists.startSets : []);
        const [pitchTo, rollTo] = [aircraft.controls.pitch, aircraft.controls.roll];
        const [pitchTrimName, rollTrimName] = ['fcs/pitch-trim-cmd-norm', 'fcs/roll-trim-cmd-norm'];
        for (const name of held.keys()) if (name !== pitchTrimName && name !== rollTrimName) throw new Error(`an airborne start does not know the trim ${name}`);
        fdm.setByName('simulation/do_simple_trim', 1);
        const pitchTrim = fdm.getByName(pitchTrimName), rollStick = fdm.getByName(rollTo.to[0]);
        flight.trimmed = {
          throttle: fdm.getByName(aircraft.controls.throttle.to[0]),
          pitch: (pitchTo.sign ?? 1) * (fdm.getByName(pitchTo.to[0]) + pitchTrim - (held.get(pitchTrimName) ?? pitchTrim)),
          roll: (rollTo.sign ?? 1) * rollStick,
          jsbsim: { pitchTrim, rollStick: rollStick + (held.get(rollTrimName) ?? 0) },
        };
        Object.assign(flight.controls, { throttle: flight.trimmed.throttle, pitch: flight.trimmed.pitch, roll: flight.trimmed.roll });
        // The state was read at the start, before the trim changed it: read it again, without a step.
        fdm.bindOutputs(flight.stateNames);
        flight.state = fdm.curr;
      }
      // From here on the flight is a tape: nothing is set in JSBSim but through the input array.
      fdm.set = () => { throw new FdmError('a flight is a start and a tape: after the start, JSBSim is given values only through the input array'); };
      flight.#good = Float64Array.from(flight.state);
      flight.fly(flight.controls);
      if (!airborne) flight.step(Math.round(settleSeconds / DT));
      flight.rules.reset();   // standing on its wheels at the start is not a touchdown
    } catch (e) {
      flight.dispose();
      throw e;
    }
    return flight;
  }

  /** Gives the seven controls: they hold until the next call. Any left out stay as they were. */
  fly(controls) {
    Object.assign(this.controls, controls);
    this.#write();
  }

  /** Writes the inputs for the next step: what the controls drive, then what the assists make of the state. */
  #write() {
    const { controls, inputs } = this;
    for (const [i, control, sign] of this.#drives) {
      const value = controls[control];
      inputs[i] = typeof value === 'boolean' ? (value ? 1 : 0) : sign * value;
    }
    if (this.assists) this.assists.apply(this.state, controls, inputs);
  }
  #drives = [];   // [where in the inputs, which control, sign] for every command a control drives

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
      if (this.ended || !this.#groundReady()) return 0;
      this.#write();
      const inputs = this.recorded ? Float64Array.from(this.inputs) : null;
      const result = this.fdm.step(1);
      // A broken state ends the flight, crash override or not, on the last good state: no number that is not
      // a number is ever given out. (The host layer checks JSBSim's own state; this checks what we give out.)
      if (result !== StepResult.OK || !this.state.every(Number.isFinite)) {
        this.state = this.#good;
        this.#end({ reason: 'broken state', time: this.state[0], detail: result === StepResult.OK ? 'a number in the state is not finite' : this.fdm.lastError() });
        return result === StepResult.OK ? StepResult.NONFINITE : result;
      }
      this.stepsRun++;
      const place = toWorld(this.state[this.#lat], this.state[this.#lon]);
      if (postsInside(this.patch, place.north, place.east) < 0) this.stepsOutside++;   // measured after the step, against the patch it was run on
      if (this.recorded) {
        this.recorded.inputs.push(inputs);
        this.recorded.states.push(Float64Array.from(this.state));
      }
      const verdict = this.rules.judge(this.#good, this.state, place, this.patch, this.terrain);
      this.#good.set(this.state);
      if (verdict && !this.rules.crashOverride) {
        this.state = this.#good;
        this.#end(verdict);
        return 0;
      }
    }
    return 0;
  }
  #good = null;   // the state after the last good step: what an ended flight keeps

  #end(ended) {
    this.ended = ended;
    this.rules.end(ended);
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
