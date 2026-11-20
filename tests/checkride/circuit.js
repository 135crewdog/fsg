// The checkride's circuit: each aircraft's numbers for the pilot (pilot.js), and one circuit flown and
// measured. New in FSG, milestone 1 (pull request 10).
//
// From parked on the numbers: take off, a left-hand pattern, land, stop, brakes on. The crash override is off.
import { C172X } from '../../src/sim/aircraft/c172x.js';
import { F16 } from '../../src/sim/aircraft/f16.js';
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
]);

const SEVEN = ['pitch', 'roll', 'throttle', 'gear', 'flaps', 'speedbrake', 'brake'];

/**
 * Flies one circuit. Returns what was seen: the downwind leg's heights and speeds, every touch, where it
 * touched down and stopped, the fuel, and (with `record`) the tape.
 */
export function flyCircuit(module, aircraft, { record = false, field = FIELD, mostSeconds = 900 } = {}) {
  const how = CIRCUIT.get(aircraft);
  const flight = Flight.start(module, aircraft, { crashOverride: false, record });
  const pilot = circuitPilot(how, { field });
  const fuel = flight.value('propulsion/total-fuel-lbs');
  const out = { how, events: [], downwind: { low: Infinity, high: -Infinity, slow: Infinity, fast: -Infinity, seconds: 0 }, highest: 0, controls: new Set(), stoppedFor: 0 };
  for (let step = 0; step < mostSeconds / DT && !flight.ended && out.stoppedFor < 2; step++) {
    const seen = readout(flight, field);
    const controls = pilot(seen);
    for (const control of Object.keys(controls)) out.controls.add(control);
    // The downwind leg: from the first moment on the downwind heading (within 10 degrees) to abeam the landing threshold.
    if (pilot.events.downwind && !pilot.events.abeam) {
      const d = out.downwind;
      d.low = Math.min(d.low, seen.feet); d.high = Math.max(d.high, seen.feet); d.slow = Math.min(d.slow, seen.knots); d.fast = Math.max(d.fast, seen.knots); d.seconds += DT;
    }
    out.highest = Math.max(out.highest, seen.feet);
    if (pilot.events.stopped) out.stoppedFor += DT;   // two seconds more with the brakes on
    flight.fly(controls);
    flight.step(1);
    out.events.push(...flight.rules.takeEvents());
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
