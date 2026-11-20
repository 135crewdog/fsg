// The game's rules: what the touches and limits JSBSim reports mean. New in FSG, milestone 1
// (docs/milestones/1.md, "Contact points and crashes"). JSBSim reports; the game decides. Nothing here
// writes to JSBSim.
//
// The crash rule is Wings' (135crewdog/wings, src/sim/contact.js `crashCheck` and `closingSpeed`, commit
// 557a8d0): when a wheel or airframe point first touches, what counts is how fast the airplane as a whole was
// closing with the ground under it, in the last state before the touch. On the level that is its sink rate;
// into a hillside it is most of its speed. Over the aircraft's line it is a hard impact and ends the flight;
// under it, it is a landing or a scrape and the flight carries on. Water is the exception: any touch of the
// sea or a lake ends the flight. With the crash override on (the default), nothing ends a flight but a broken
// state; every touch is still reported.
import { slopeIn, waterAt } from './ground.js';

const KT = 1.6878;   // ft/s in a knot
const SLOPE_STEP = 5;   // m: the ground's slope is measured this far either side of the airplane (Wings')
const TOUCHDOWN_SECONDS = 0.5;   // a touchdown's g is the most read in this long after the wheels touch
const MOST_EVENTS = 256;

/** Wings' crash line, 8 m/s, in feet a minute: the test aircraft use it (the F-4C's own is a pilot question for milestone 3). */
export const WINGS_CRASH_FPM = (8 / 0.3048) * 60;

export class Rules {
  /** True (the default): no touch ends the flight. The pause screen's switch. */
  crashOverride = true;
  /** What has happened since they were last taken (takeEvents), oldest first. */
  events = [];
  /** The limits being exceeded now. Reported, not enforced: nothing else changes. */
  over = { g: false, speed: false };
  #aircraft;
  #s;
  #points;
  #dt;
  #touchdown = null;

  /**
   * `aircraft` has `contacts` (a name for each wheel and airframe point, in the aircraft file's order),
   * `crash.closingFpm` and `limits` ({ g, knots }). `stateAt` gives where a JSBSim name is in the state.
   */
  constructor(aircraft, stateAt, stateNames, dt) {
    this.#aircraft = aircraft;
    this.#dt = dt;
    this.#s = {
      time: stateAt('simulation/sim-time-sec'), vn: stateAt('velocities/v-north-fps'), ve: stateAt('velocities/v-east-fps'), vd: stateAt('velocities/v-down-fps'),
      vg: stateAt('velocities/vg-fps'), vc: stateAt('velocities/vc-kts'), g: stateAt('accelerations/Nz'),
    };
    this.#points = [];
    stateNames.forEach((name, i) => {
      const unit = /^(gear|contact)\/unit\[(\d+)\]\/WOW$/.exec(name);
      if (unit) this.#points.push({ at: i, wheel: unit[1] === 'gear', name: aircraft.contacts[Number(unit[2])] });
    });
    if (this.#points.length !== aircraft.contacts.length) throw new Error(`${aircraft.model}: the aircraft file has ${this.#points.length} wheels and contact points, its settings name ${aircraft.contacts.length}`);
  }

  /** Forgets what has been seen so far: a start is not a touchdown. */
  reset() {
    this.events = [];
    this.#touchdown = null;
  }

  /** The events since the last call, oldest first. */
  takeEvents() {
    const taken = this.events;
    this.events = [];
    return taken;
  }

  #report(event) {
    this.events.push(event);
    if (this.events.length > MOST_EVENTS) this.events.shift();
  }

  /**
   * Judges one step: `before` and `after` are the state either side of it, `place` where the airplane is now
   * (metres north and east), `patch` the ground JSBSim has and `terrain` its source. Returns null, or what
   * ends the flight: { reason: 'hard impact' or 'water', point, closingFpm, knots }. It is the caller's to
   * honour (the flight does, unless the crash override is on).
   */
  judge(before, after, place, patch, terrain) {
    const s = this.#s, time = after[s.time];
    let verdict = null, anyBefore = false, wheelTouched = false, water = null, closing = null;
    for (const point of this.#points) if (before[point.at] === 1) { anyBefore = true; break; }
    for (const point of this.#points) {
      if (after[point.at] !== 1) continue;
      water ??= waterAt(terrain, place.north, place.east);
      const fresh = before[point.at] !== 1;
      if (fresh) {
        // How fast the airplane was closing with the ground here, before the touch: its velocity into the surface.
        if (closing === null) {
          const { north, east } = slopeIn(patch, place.north, place.east, SLOPE_STEP);
          closing = ((before[s.vn] * north + before[s.ve] * east + before[s.vd]) / Math.hypot(north, east, 1)) * 60;
        }
        const hard = closing > this.#aircraft.crash.closingFpm;
        this.#report({ type: 'touch', time, point: point.name, wheel: point.wheel, closingFpm: closing, knots: before[s.vg] / KT, hard, water });
        if (hard && !verdict) verdict = { reason: 'hard impact', point: point.name, closingFpm: closing, knots: before[s.vg] / KT, time };
        if (point.wheel) wheelTouched = true;
      }
      if (water && !verdict) verdict = { reason: 'water', point: point.name, closingFpm: closing ?? 0, knots: before[s.vg] / KT, time };
    }
    // A touchdown: a wheel touches when nothing was touching. Reported half a second later, with the most g of
    // that time. A bounce that comes down again inside the half second is part of the same touchdown: the
    // first touch's sink and speed are the ones reported.
    if (wheelTouched && !anyBefore && !this.#touchdown) this.#touchdown = { type: 'touchdown', time, sinkFpm: before[s.vd] * 60, knots: before[s.vg] / KT, g: after[s.g], until: time + TOUCHDOWN_SECONDS };
    if (this.#touchdown) {
      this.#touchdown.g = Math.max(this.#touchdown.g, after[s.g]);
      if (time >= this.#touchdown.until - this.#dt / 2 || (verdict && !this.crashOverride)) {
        const { until, ...event } = this.#touchdown;
        this.#report(event);
        this.#touchdown = null;
      }
    }
    // Limits: reported when first exceeded, and for as long as they are.
    const { limits } = this.#aircraft;
    const overG = after[s.g] > limits.g, overSpeed = after[s.vc] > limits.knots;
    if (overG && !this.over.g) this.#report({ type: 'over g', time, g: after[s.g], limit: limits.g });
    if (overSpeed && !this.over.speed) this.#report({ type: 'overspeed', time, knots: after[s.vc], limit: limits.knots });
    this.over.g = overG;
    this.over.speed = overSpeed;
    return verdict;
  }

  /** Reports the end of the flight. */
  end(ended) {
    this.#report({ type: 'ended', ...ended });
  }
}
