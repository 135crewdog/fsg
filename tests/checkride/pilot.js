// A pilot for one circuit of the test field, flown through the same seven controls the game gives the
// player: stick, throttle, and the gear, flaps, speedbrake and brake toggles. No rudder: the game's assists
// have the feet and the steering. Take off, turn onto downwind, come round onto final, land and stop.
// New in FSG, milestone 1 (pull request 10).
//
// After Wings' checkride pilot (135crewdog/wings, tests/circuit.js, commit 557a8d0): the same simple loops
// (the elevator for a pitch attitude, the throttle for a speed, the aileron for a bank or a heading) and the
// same legs. What is new here: feet instead of metres, a flare that holds a sink rate down to the runway
// instead of a fixed attitude, and numbers for each aircraft instead of the F-4C's.
//
// The pilot thinks in the runway's own terms: "along" is feet down the runway from the numbers, "right" is
// feet to the right of the centreline. A left-hand circuit is flown as the mirror image of a right-hand one.
//
// Milestone 3 re-planned, pull request 4: the pilot learns a simple airplane. Two things, both by the aircraft's
// numbers, so the other aircraft are flown exactly as before:
//   the takeoff the owner's way (`fullBackFromKt`): full back tilt from that speed until the wheels leave, then
//     eased to hold the climb attitude (docs/milestones/3-replan.md, "The owner's answers", 2; Wings' own test
//     pilot pulls full back from 80 knots and then holds 10 degrees);
//   on the ground the tilt steers, and on a simple airplane that is the rudder and the nosewheel with the
//     ailerons neutral (aircraft/simple/controls.xml). The pilot's steering is the same as it was.
import { FIELD, FT, toWorld } from '../../src/sim/world.js';

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const DEG = 180 / Math.PI, KT = 1.6878;
const turn = (to, from) => ((to - from + 540) % 360) - 180;   // degrees to turn, the short way

/** What the pilot sees, from a flight's state: a pilot's units, in the field's terms. */
export function readout(flight, field = FIELD) {
  const v = (name) => flight.value(name);
  const { north, east } = toWorld(v('position/lat-geod-rad'), v('position/long-gc-rad'));
  const n = (north - field.start.north) / FT, e = (east - field.start.east) / FT, way = field.runway.headingDeg / DEG;
  let wheels = 0;
  flight.stateNames.forEach((name, i) => { if (/^gear\/unit\[\d+\]\/WOW$/.test(name) && flight.state[i] === 1) wheels++; });
  return {
    t: v('simulation/sim-time-sec'), knots: v('velocities/vc-kts'), groundKt: v('velocities/vg-fps') / KT, feet: v('position/h-sl-ft') - field.heightFt, aboveGround: v('position/h-agl-ft'),
    fpm: -v('velocities/v-down-fps') * 60, pitch: v('attitude/theta-rad') * DEG, pitchRate: v('velocities/q-rad_sec') * DEG, alpha: v('aero/alpha-rad') * DEG,
    bank: v('attitude/phi-rad') * DEG, rollRate: v('velocities/p-rad_sec') * DEG, heading: turn(v('attitude/psi-rad') * DEG, field.runway.headingDeg),
    along: n * Math.cos(way) + e * Math.sin(way), right: -n * Math.sin(way) + e * Math.cos(way), onGround: wheels > 0,
  };
}

/**
 * Returns pilot(readout) giving the controls for the next step; `.phase` says where in the circuit it is and
 * `.events` what happened when. `how` is the aircraft's numbers (tests/checkride/circuit.js has them).
 */
export function circuitPilot(how, { field = FIELD, hand = -1 } = {}) {   // hand: 1 turns right, -1 left
  const { runway } = field;
  let phase = 'roll', idle = false, trim = 0, hold = 0, power = how.cruisePower ?? 0.5, last = null, alpha = how.alpha ?? 3;
  const events = {};
  const mark = (name, r) => { if (!(name in events)) events[name] = { t: r.t, knots: r.knots, feet: r.feet, along: r.along, right: hand * r.right }; };

  // The elevator for a pitch attitude; the throttle for a speed; the aileron for a bank or a heading.
  const pitchTo = (r, deg, dt) => {
    const err = deg - r.pitch;
    trim = clamp(trim + how.pitch.i * err * dt, -0.8, 0.9);
    return clamp(trim + how.pitch.p * err - how.pitch.d * r.pitchRate, -1, 1);
  };
  // To hold a height: aim the flight path, and add the angle of attack (as it has been lately) for the nose.
  // `slope` is the path's own angle (degrees, negative going down).
  const climbTo = (r, feet, dt, limit = 10, slope = 0) => {
    alpha += (r.alpha - alpha) * Math.min(1, dt / 4);
    const fpm = r.groundKt * 101.27 * Math.tan(slope / DEG);   // the climb rate of the path itself
    return pitchTo(r, alpha + slope + clamp((feet - r.feet) * 0.02 - (r.fpm - fpm) * 0.002, -limit, limit), dt);
  };
  const speedTo = (r, kt, dt, max = how.mostPower ?? 1) => {
    const err = kt - r.knots;
    power = clamp(power + how.power.i * err * dt, 0, max);
    return clamp(power + how.power.p * err, 0, max);
  };
  // The stick held against whatever rolls the airplane off the bank asked for (the engine's torque, say) is found the same way as the trim.
  const bankTo = (r, deg, dt = 0) => {
    const err = deg - r.bank;
    hold = clamp(hold + how.roll.i * err * dt, -0.3, 0.3);
    return clamp(hold + how.roll.p * err - how.roll.d * r.rollRate, -1, 1);
  };
  const headTo = (r, deg, dt, most = 30) => bankTo(r, clamp(turn(deg, r.heading) * 1.5, -most, most), dt);
  // On the ground the stick steers: toward the centreline, then along it. Gently once there is speed: on the
  // ground the stick still moves the ailerons, and a big push at speed rocks the airplane onto a wingtip.
  const steer = (r) => { const most = r.groundKt < how.steer.slowKt ? 1 : how.steer.most; return clamp(-how.steer.heading * r.heading - how.steer.across * r.right, -most, most); };
  // The owner's takeoff, for an aircraft with `fullBackFromKt`: full back tilt from that speed while any wheel is on the runway.
  const fullBack = (r) => how.fullBackFromKt !== undefined && r.onGround && r.knots > how.fullBackFromKt;

  const fly = (seen) => {
    // For a left-hand circuit the pilot flies its mirror image: left is right, and the stick goes the other way.
    const r = { ...seen, right: hand * seen.right, heading: hand * seen.heading, bank: hand * seen.bank, rollRate: hand * seen.rollRate };
    const dt = last === null ? 0 : r.t - last;
    last = r.t;
    const pattern = how.patternFt, past = r.along < 0;   // past: beyond the landing threshold, going downwind
    switch (phase) {
      case 'roll':      // brakes off, full power, keep straight, rotate
        if (r.knots > how.rotateKt) phase = 'rotate';
        return { throttle: 1, gear: true, flaps: how.takeoffFlaps, speedbrake: false, brake: false, pitch: fullBack(r) ? 1 : 0, roll: steer(r) };
      case 'rotate':
        if (!r.onGround) mark('liftoff', r);
        if (r.aboveGround > 200) phase = 'climb';
        return { throttle: 1, gear: true, flaps: how.takeoffFlaps, brake: false, pitch: fullBack(r) ? 1 : pitchTo(r, how.climbPitch, dt), roll: r.onGround ? steer(r) : headTo(r, 0, dt, 10) };
      case 'climb':     // clean up, climb straight ahead to pattern altitude
        if (r.feet > pattern - 200 && r.along > how.turnAfterFt) phase = 'crosswind';
        return { throttle: r.feet < pattern - 300 ? how.climbPower : speedTo(r, how.downwindKt, dt), gear: false, flaps: false, pitch: r.feet < pattern - 300 ? pitchTo(r, how.climbPitch, dt) : climbTo(r, pattern, dt), roll: headTo(r, 0, dt) };
      case 'crosswind': // a turn to downwind
        if (Math.abs(turn(180, r.heading)) < 30) phase = 'downwind';
        return { throttle: speedTo(r, how.downwindKt, dt), gear: false, flaps: false, pitch: climbTo(r, pattern, dt), roll: bankTo(r, how.turnBank, dt) };
      case 'downwind':  // abeam the landing end: slow down, gear and flaps down
        if (Math.abs(turn(180, r.heading)) < 10) mark('downwind', r);
        if (past) mark('abeam', r);
        if (r.along < -how.baseFt) { mark('base', r); phase = 'base'; }
        return { throttle: speedTo(r, past ? how.baseKt : how.downwindKt, dt), gear: past, flaps: past, pitch: climbTo(r, pattern, dt), roll: headTo(r, 180, dt) };
      case 'base':      // a turn onto final
        if (Math.abs(turn(0, r.heading)) < 60) phase = 'final';
        return { throttle: speedTo(r, how.baseKt, dt), gear: true, flaps: true, pitch: climbTo(r, pattern, dt), roll: bankTo(r, how.baseBank, dt) };
      case 'final': {   // line up on the centreline, three degrees down to the aim point
        const toGo = how.aimFt - r.along;
        const onPath = toGo * Math.tan(3 / DEG) < pattern, path = onPath ? toGo * Math.tan(3 / DEG) : pattern;
        if (r.aboveGround < how.flareFt) { mark('flare', r); phase = 'flare'; }
        const heading = clamp(-r.right * how.lineUp, -35, 35);
        return { throttle: speedTo(r, how.finalKt, dt), gear: true, flaps: true, pitch: climbTo(r, path, dt, 6, onPath ? -3 : 0), roll: headTo(r, heading, dt, 30) };
      }
      case 'flare': {   // power off, and let the sink die away with the height: slower the lower
        if (r.onGround) { mark('touchdown', r); phase = 'stop'; }
        const sink = clamp(how.flare.fpmPerFt * (r.aboveGround - how.wheelsFt), how.flare.leastFpm, how.flare.mostFpm);
        const want = r.pitch + clamp((r.fpm + sink) * -how.flare.gain, -how.flare.mostChange, how.flare.mostChange);
        idle ||= r.aboveGround <= how.flare.idleFt;   // once the power is off it stays off
        return { throttle: idle ? 0 : speedTo(r, how.finalKt, dt), gear: true, flaps: true, pitch: pitchTo(r, clamp(want, how.flare.leastPitch, how.flare.mostPitch), dt), roll: headTo(r, clamp(-r.right * how.lineUp, -10, 10), dt, 10) };
      }
      default:          // on the runway: nose down, brakes on, keep straight
        if (r.groundKt < 1) mark('stopped', r);
        return { throttle: 0, gear: true, flaps: true, speedbrake: how.speedbrakeOnRunway ?? false, brake: true, pitch: 0, roll: steer(r) };
    }
  };
  const pilot = (r) => { const c = fly(r); return hand === 1 ? c : { ...c, roll: -c.roll }; };
  Object.defineProperty(pilot, 'phase', { get: () => phase });
  pilot.events = events;
  return pilot;
}
