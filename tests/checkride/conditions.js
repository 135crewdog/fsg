// The F-4C at one of NASA CR-2144's flight conditions: started trimmed at its Mach number and height, and
// given a pulse or a step of one control while its response is recorded. New in FSG, milestone 3
// (docs/milestones/3.md, pull request 5: "started trimmed and level at its speed and height").
import { F4C } from '../../src/sim/aircraft/f4c.js';
import { DT, Flight } from '../../src/sim/game.js';
import { flatSource } from '../../src/sim/ground.js';

const DEG = 180 / Math.PI;

/**
 * The ground for these flights: level, 1,000 ft below sea level. CR-2144's two sea-level conditions are
 * flown at sea level itself, and the test field's ground is at sea level too: an airplane started there is
 * lying on it (its belly is 3.4 ft below its centre of gravity), which is why JSBSim's trim fails at a height
 * of zero. Found by trying: the trim fails at 0.1 and 3 ft, and works at 10 ft, and at 0 ft over this ground.
 */
export const GROUND = flatSource(-30000);

/**
 * A flight trimmed by JSBSim's own trim at a Mach number and a height, gear up, on a flight path `gammaDeg`
 * above the horizon (0 is level). Throws if JSBSim cannot trim it: the engines cannot hold the speed.
 */
export function trimmed(module, { mach, heightFt }, gammaDeg = 0, options = {}) {
  // The speed goes in last, and as a Mach number; `knots` is only what Flight.start asks for, and is replaced.
  return Flight.start(module, F4C, { airborne: { heightFt, knots: 300 }, terrain: GROUND, ...options, sets: [['ic/gamma-deg', gammaDeg], ['ic/mach', mach], ...(options.sets ?? [])] });
}

/**
 * The F-4C at a condition, by the plan's rule: level if the engines can hold the speed, and if they cannot
 * "it is flown in the shallow dive that does". The dive is the shallowest, to a tenth of a degree, at which
 * JSBSim's trim finds a throttle that holds the speed. Returns { flight, diveDeg } (diveDeg 0 when level).
 */
export function atCondition(module, condition, options = {}) {
  try {
    return { flight: trimmed(module, condition, 0, options), diveDeg: 0 };
  } catch {
    // Not level. Steepen the dive two degrees at a time until JSBSim can trim it (too steep and it cannot
    // either: the airplane speeds up at idle), then halve the last two degrees down to a tenth.
    let can = 2;
    const works = (dive) => { try { trimmed(module, condition, -dive, options).dispose(); return true; } catch { return false; } };
    while (!works(can)) { can += 2; if (can > 60) throw new Error(`Mach ${condition.mach} at ${condition.heightFt} ft cannot be trimmed in any dive`); }
    let cannot = can - 2;
    while (can - cannot > 0.1) {
      const middle = (can + cannot) / 2;
      if (works(middle)) can = middle; else cannot = middle;
    }
    return { flight: trimmed(module, condition, -can, options), diveDeg: can };
  }
}

/** The stabilator now, degrees, trailing edge down positive. */
export const stabilatorOf = (flight) => flight.get('fcs/elevator-pos-deg');

/**
 * The pitch stick (the game's: back is positive) that puts the stabilator at an angle, for a flight whose
 * copilot holds a pitch trim. The aircraft file adds stick and trim and takes the sum to 21 degrees up or
 * 9 degrees down (aircraft/f4c/f4c.xml, "Pitch").
 */
export function stickFor(flight, stabilatorDeg) {
  const sum = stabilatorDeg >= 0 ? stabilatorDeg / 9 : stabilatorDeg / 21;
  const held = flight.startSets.find(([name]) => name === 'fcs/pitch-trim-cmd-norm')?.[1] ?? 0;
  return -(sum - held);
}

/**
 * Flies a trimmed flight for `seconds` with one control moved from where the trim left it, and records.
 * `move(t)` gives the control's move at time t, in degrees of its surface: of the stabilator (trailing edge
 * down positive), of the aileron (AFWAL's and CR-2144's: positive rolls right, the spoiler going with it), or
 * of the rudder (trailing edge left positive). `read(flight)` is what to record; its value at the start is
 * taken off, so the record starts at zero. Returns { t, x } for every step, x read at the step's start.
 *
 * The game has no rudder control, so a flight whose rudder is to be moved is started with `rudderFeet()` as
 * its copilot's feet (below), and the move goes in through the input array like everything else.
 */
export function respond(flight, control, move, read, seconds) {
  const hold = { ...flight.trimmed }, stabilator = stabilatorOf(flight), rudder = flight.get('fcs/rudder-pos-deg'), from = read(flight), out = [];
  for (let k = 0; k <= Math.round(seconds / DT); k++) {
    const t = k * DT, by = move(t);
    out.push({ t, x: read(flight) - from });
    if (control === 'stabilator') flight.fly({ pitch: stickFor(flight, stabilator + by) });
    else if (control === 'aileron') flight.fly({ roll: hold.roll + by / 30 });
    else if (control === 'rudder') flight.rudderDeg = rudder + by;   // from where JSBSim's trim left it (within a hundredth of a degree of the middle)
    else throw new Error(`no control ${control}`);
    if (flight.step(1) !== 0 || flight.ended) throw new Error(`the flight ended: ${JSON.stringify(flight.ended)}`);
  }
  return out;
}

/**
 * A copilot's "feet" for a test: the rudder where the test puts it (flight.rudderDeg, set by `respond`), and
 * nothing else. Give `assists: rudderFeet(holder)` to the start, and set holder.flight to the flight.
 */
export function rudderFeet(holder) {
  return { ...F4C.assists, feet: { to: 'fcs/rudder-cmd-norm', sign: 1, law: () => (holder.flight?.rudderDeg ?? 0) / 30 } };
}

export const pitchRate = (flight) => flight.value('velocities/q-rad_sec') * DEG;
export const rollRate = (flight) => flight.value('velocities/p-rad_sec') * DEG;
export const yawRate = (flight) => flight.value('velocities/r-rad_sec') * DEG;

// ---- a steady pull ----

/** Where a trimmed flight is, as a start can be made again from values alone (no trim): its speed along its own axes, its attitude, its engines and its controls. */
export function stateOf(flight) {
  return {
    heightFt: flight.value('position/h-sl-ft'), theta: flight.get('attitude/theta-deg'), u: flight.get('velocities/u-fps'), w: flight.get('velocities/w-fps'),
    turning: flight.get('propulsion/engine[0]/n2'), throttle: flight.trimmed.throttle, pitch: flight.trimmed.pitch, roll: flight.trimmed.roll,
    stabilator: stabilatorOf(flight), g: flight.value('accelerations/Nz'),
  };
}

/**
 * A flight started (and not stepped) at a trimmed flight's state with its angle of attack changed by
 * `alphaDeg` at the same speed, its stabilator by `stabilatorDeg`, and pitching at `q` rad/s: for reading
 * what the airplane would do there. The caller disposes of it.
 */
export function startNear(module, base, { alphaDeg = 0, stabilatorDeg = 0, q = 0 } = {}) {
  const speed = Math.hypot(base.u, base.w), alpha = Math.atan2(base.w, base.u) + alphaDeg / DEG;
  const probe = { startSets: [['fcs/pitch-trim-cmd-norm', F4C.assists.trim.sets[0][1]]] };
  return Flight.start(module, F4C, {
    terrain: GROUND, settleSeconds: 0, controls: { gear: false, flaps: false, brake: false, throttle: base.throttle, pitch: stickFor(probe, base.stabilator + stabilatorDeg), roll: base.roll },
    sets: [['ic/h-sl-ft', base.heightFt], ['ic/theta-deg', base.theta], ['ic/u-fps', speed * Math.cos(alpha)], ['ic/w-fps', speed * Math.sin(alpha)], ['ic/q-rad_sec', q],
      ['propulsion/engine[0]/n2', base.turning], ['propulsion/engine[1]/n2', base.turning]],
  });
}

/**
 * A steady pull of `dg` more g than the trimmed flight's, at its speed: the angle of attack, the stabilator
 * and the pitch rate at which the airplane holds that g with its pitch rate and its angle of attack both
 * steady. Found by trying: three unknowns and three things to make zero, by Newton's method on flights
 * started at each try. Returns { alphaDeg, stabilatorDeg, q, left } as changes from the trim; `left` is what
 * is still not zero (g, rad/s2, ft/s2).
 */
export function steadyPull(module, base, dg) {
  const read = (x) => {
    const flight = startNear(module, base, { alphaDeg: x[0], stabilatorDeg: x[1], q: x[2] });
    const out = [flight.value('accelerations/Nz') - base.g - dg, flight.get('accelerations/qdot-rad_sec2'), flight.get('accelerations/wdot-ft_sec2')];
    flight.dispose();
    return out;
  };
  let x = [0, 0, 0], f = read(x);
  const steps = [0.05, 0.05, 0.001];
  for (let pass = 0; pass < 6; pass++) {
    // The slope of each of the three with each unknown, then the three equations solved (Cramer's rule).
    const J = steps.map((h, j) => { const there = read(x.map((v, i) => (i === j ? v + h : v))); return there.map((v, i) => (v - f[i]) / h); });   // J[j][i] = d f_i / d x_j
    const det3 = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const A = [0, 1, 2].map((i) => [0, 1, 2].map((j) => J[j][i])), d = det3(A);
    const dx = [0, 1, 2].map((j) => det3(A.map((row, i) => row.map((v, k) => (k === j ? -f[i] : v)))) / d);
    x = x.map((v, i) => v + dx[i]);
    f = read(x);
    if (Math.abs(f[0]) < 1e-7 && Math.abs(f[1]) < 1e-8 && Math.abs(f[2]) < 1e-6) break;
  }
  return { alphaDeg: x[0], stabilatorDeg: x[1], q: x[2], left: f };
}
