// The checkride's circuit: each aircraft's numbers for the pilot (pilot.js), and one circuit flown and
// measured. New in FSG, milestone 1 (pull request 10).
//
// From parked on the numbers: take off, a left-hand pattern, land, stop, brakes on. The crash override is off.
import { C172X } from '../../src/sim/aircraft/c172x.js';
import { F16 } from '../../src/sim/aircraft/f16.js';
import { F4C } from '../../src/sim/aircraft/f4c.js';
import { F4C_SIMPLE } from '../../src/sim/aircraft/f4c-simple.js';
import { DT, Flight } from '../../src/sim/game.js';
import { FIELD } from '../../src/sim/world.js';
import { circuitPilot, readout } from './pilot.js';

/**
 * The pilot's numbers. Speeds in knots, heights and distances in feet, angles in degrees.
 * The F-16's flaps move by themselves at 250 knots, so no speed the pilot holds is within 15 knots of it.
 */
export const CIRCUIT = new Map([
  [C172X, {
    patternFt: 1000, downwindKt: 90, baseKt: 70, finalKt: 65,
    rotateKt: 55, climbPitch: 8, climbPower: 1, takeoffFlaps: false, turnAfterFt: 6000, turnBank: 30, baseBank: 25, baseFt: 6000, aimFt: 300, lineUp: 0.08,
    flareFt: 20, wheelsFt: 4.3, flare: { fpmPerFt: 20, leastFpm: 60, mostFpm: 500, gain: 0.01, mostChange: 3, leastPitch: -2, mostPitch: 8, idleFt: 12 },
    pitch: { p: 0.08, i: 0.04, d: 0.03 }, power: { p: 0.03, i: 0.006 }, roll: { p: 0.03, i: 0.01, d: 0.012 }, steer: { heading: 0.5, across: 0.05, most: 0.3, slowKt: 35 }, cruisePower: 0.6,
  }],
  [F16, {
    patternFt: 1500, downwindKt: 300, baseKt: 200, finalKt: 160,
    rotateKt: 150, climbPitch: 12, climbPower: 0.6, takeoffFlaps: true, turnAfterFt: 20000, turnBank: 45, baseBank: 35, baseFt: 30000, aimFt: 500, lineUp: 0.08,
    flareFt: 60, wheelsFt: 5.5, flare: { fpmPerFt: 15, leastFpm: 180, mostFpm: 900, gain: 0.006, mostChange: 2, leastPitch: 2, mostPitch: 12, idleFt: 8 },
    pitch: { p: 0.06, i: 0.03, d: 0.025 }, power: { p: 0.02, i: 0.004 }, roll: { p: 0.03, i: 0.01, d: 0.012 }, steer: { heading: 0.1, across: 0.005, most: 0.3, slowKt: 0 }, cruisePower: 0.3, mostPower: 0.75,
  }],
  // The F-4C's pattern (milestone 3, pull request 7: docs/milestones/3.md, "The circuit"). The plan's: takeoff on
  // 1/2 flaps (the flight manual's) in full afterburner, a 1,500 ft pattern, downwind at 250 knots, the gear and
  // full flaps abeam the landing end, final at the approach speed: 147 knots, 11.7 degrees of angle of attack
  // at this weight (tests/f4c-low.test.js). The flight manual's: fly it off at 10 degrees nose up ("pitch
  // attitude must be controlled to maintain a 10 to 12 nose high attitude for aircraft fly-off"). The rest is
  // the pilot's: the climb and the pattern at MIL (the stick's 0.8: no afterburner after the takeoff), a base
  // leg at 150 knots, the aim point 1,000 ft down the runway, and a flare from 40 ft that takes the sink from
  // about 800 ft/min to 200 to 400 at the wheels, which are about 7 ft below the centre of gravity at the
  // landing attitude. Stopped on the brakes alone. The stick is a pull in pounds through the feel system;
  // the pilot's loops close on the attitude as they do for the F-16, with the same numbers (found by trying).
  [F4C, {
    patternFt: 1500, downwindKt: 250, baseKt: 150, finalKt: 147,
    rotateKt: 145, climbPitch: 10, climbPower: 0.8, takeoffFlaps: 0.5, turnAfterFt: 20000, turnBank: 45, baseBank: 30, baseFt: 30000, aimFt: 1000, lineUp: 0.08,
    flareFt: 40, wheelsFt: 7, flare: { fpmPerFt: 15, leastFpm: 200, mostFpm: 800, gain: 0.006, mostChange: 2, leastPitch: 4, mostPitch: 12, idleFt: 10 },
    pitch: { p: 0.06, i: 0.03, d: 0.025 }, power: { p: 0.02, i: 0.004 }, roll: { p: 0.03, i: 0.01, d: 0.012 }, steer: { heading: 0.1, across: 0.005, most: 0.3, slowKt: 0 }, cruisePower: 0.5, mostPower: 0.8,
  }],
  // The simple F-4C's pattern (milestone 3 re-planned, pull request 4: docs/milestones/3-replan.md, PR 4, "the
  // circuit"). The plan's: a 1,500 ft pattern at 250 knots, final at 150. The owner's takeoff: 1/2 flaps, full
  // afterburner, full back tilt from 80 knots (Wings' test pilot's speed) until the wheels leave, then eased to
  // hold the nose 10 degrees up. The rest is the pilot's, and the data-built F-4C's numbers above but for three,
  // found in throwaway runs before this was written: the turn to downwind at 35 degrees of bank (at 45 this
  // pilot let it climb 95 ft in the turn, 5 ft inside the line); the flare from 50 ft, slower and a little
  // firmer on the stick (from 40 ft it arrived at 490 ft/min, inside the line but firm; so it arrives at about
  // 250); and the nose never above 12 degrees in the flare (at 14 the stabilator's tips touched the runway).
  // On the ground the pilot's steering is the same stick as before; on this airplane it is the pedals.
  [F4C_SIMPLE, {
    patternFt: 1500, downwindKt: 250, baseKt: 150, finalKt: 150,
    rotateKt: 145, fullBackFromKt: 80, climbPitch: 10, climbPower: 0.8, takeoffFlaps: 0.5, turnAfterFt: 20000, turnBank: 35, baseBank: 30, baseFt: 30000, aimFt: 1000, lineUp: 0.08,
    flareFt: 50, wheelsFt: 7, flare: { fpmPerFt: 12, leastFpm: 150, mostFpm: 800, gain: 0.008, mostChange: 2, leastPitch: 4, mostPitch: 12, idleFt: 10 },
    pitch: { p: 0.06, i: 0.03, d: 0.025 }, power: { p: 0.02, i: 0.004 }, roll: { p: 0.03, i: 0.01, d: 0.012 }, steer: { heading: 0.1, across: 0.005, most: 0.3, slowKt: 0 }, cruisePower: 0.5, mostPower: 0.8,
  }],
]);

const SEVEN = ['pitch', 'roll', 'throttle', 'gear', 'flaps', 'speedbrake', 'brake'];

/**
 * Flies one circuit. Returns what was seen: the downwind leg's heights and speeds, every touch, where it
 * touched down and stopped, the fuel, and (with `record`) the tape. `watch(flight)`, if given, is called after
 * every step, for a test that reads something more all the way round (milestone 3 re-planned, pull request 4).
 */
export function flyCircuit(module, aircraft, { record = false, field = FIELD, mostSeconds = 900, watch = null } = {}) {
  const how = CIRCUIT.get(aircraft);
  const flight = Flight.start(module, aircraft, { crashOverride: false, record });
  const pilot = circuitPilot(how, { field });
  const fuel = flight.value('propulsion/total-fuel-lbs');
  const out = { how, events: [], downwind: { low: Infinity, high: -Infinity, slow: Infinity, fast: -Infinity, seconds: 0 }, final: { slow: Infinity, fast: -Infinity, seconds: 0 }, highest: 0, controls: new Set(), stoppedFor: 0 };
  for (let step = 0; step < mostSeconds / DT && !flight.ended && out.stoppedFor < 2; step++) {
    const seen = readout(flight, field);
    const controls = pilot(seen);
    for (const control of Object.keys(controls)) out.controls.add(control);
    // The downwind leg: from the first moment on the downwind heading (within 10 degrees) to abeam the landing threshold.
    if (pilot.events.downwind && !pilot.events.abeam) {
      const d = out.downwind;
      d.low = Math.min(d.low, seen.feet); d.high = Math.max(d.high, seen.feet); d.slow = Math.min(d.slow, seen.knots); d.fast = Math.max(d.fast, seen.knots); d.seconds += DT;
    }
    // Final (milestone 3, pull request 7): from the first moment on the runway's heading (within 10 degrees) after the base turn, to the flare.
    if (pilot.phase === 'final' && (out.final.seconds > 0 || Math.abs(seen.heading) < 10)) {
      const f = out.final;
      f.slow = Math.min(f.slow, seen.knots); f.fast = Math.max(f.fast, seen.knots); f.seconds += DT;
    }
    out.highest = Math.max(out.highest, seen.feet);
    if (pilot.events.stopped) out.stoppedFor += DT;   // two seconds more with the brakes on
    flight.fly(controls);
    flight.step(1);
    out.events.push(...flight.rules.takeEvents());
    if (watch) watch(flight);
  }
  const end = readout(flight, field);
  Object.assign(out, {
    ended: flight.ended, phase: pilot.phase, marks: pilot.events, end, brakeOn: flight.controls.brake, seconds: end.t,
    fuelChange: flight.value('propulsion/total-fuel-lbs') - fuel, onlyTheSeven: [...out.controls].every((control) => SEVEN.includes(control)),
    touches: out.events.filter((e) => e.type === 'touch'), touchdowns: out.events.filter((e) => e.type === 'touchdown'),
    tape: record ? flight.tape() : null,
  });
  flight.dispose();
  return out;
}
