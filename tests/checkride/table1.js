// AFWAL's Table 1 worked out in JavaScript from the record of its data, and JSBSim's own six coefficients
// read from a flight: the two sides of the checkride's wiring tests. New in FSG, milestone 3 (pull request
// 5: written inside tests/f4c-aero.test.js for the first half, moved here when the second half's test,
// tests/f4c-conditions.test.js, needed it too).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { F4C } from '../../src/sim/aircraft/f4c.js';
import { Flight } from '../../src/sim/game.js';
import { AFWAL_REFERENCE_HEIGHT, WING_AREA, WING_CHORD, WING_SPAN } from './f4c-reference.js';

const DEG = 180 / Math.PI;
const S = WING_AREA.value, SPAN = WING_SPAN.value, CHORD = WING_CHORD.value;

/** The record of the data: AFWAL's tables and equations as read from the scan. */
export const DATA = JSON.parse(readFileSync(new URL('../../aircraft/f4c/data/afwal-f4j.json', import.meta.url)));
export const LISTING = DATA.table_9.functions;
/** AFWAL's Table 3 and Table 5, by symbol. */
export const constant = (symbol) => DATA.table_3.rows.find((row) => row.symbol === symbol).value;
export const dimension = (symbol) => DATA.table_5.rows.find((row) => row.symbol === symbol).value;

// ---- Table 1, worked out in JavaScript from the record ----

/** Straight lines between a table's points, its end values held beyond them: how AFWAL's tables are read (Table 1), and JSBSim's. */
export function along(xs, ys, x) {
  if (x <= xs[0]) return ys[0];
  if (x >= xs.at(-1)) return ys.at(-1);
  let i = 1;
  while (xs[i] < x) i++;
  return ys[i - 1] + ((x - xs[i - 1]) / (xs[i] - xs[i - 1])) * (ys[i] - ys[i - 1]);
}
/** One of the listing's functions at an angle of attack, degrees, taken without its sign by the caller. */
export const read = (name, alpha) => along(LISTING[name].alpha_deg, LISTING[name].values, alpha);
/** The pitching-moment increment: in angle of attack along each sideslip's row, then between the rows. */
function readIncrement(alpha, beta) {
  const rows = LISTING.DCM1.values_by_beta;
  return along(rows.map((row) => row.beta_deg), rows.map((row) => along(row.alpha_deg, row.values, alpha)), beta);
}

/**
 * AFWAL's Table 1: the six coefficients at a state, with the centre of gravity at `cg` percent of the chord.
 * Angles and deflections in degrees, rates in radians a second, the speed in feet a second. `stores` adds
 * AFWAL's stores drag, which the F-4C's file leaves out.
 *
 * `mach` is what Mach changes (pull request 5, second half; tools/f4c-mach.mjs): { factor(term), increment(name) },
 * the value of each of the aircraft file's factors and increments at the state's Mach number and height.
 * Left out, every factor is 1 and every increment 0: Table 1 as AFWAL prints it.
 */
export function table1({ alpha, beta, vt, p, q, r, alphaDot, stabilator, aileron, spoiler, rudder }, cg, { stores = false, mach = null } = {}) {
  const f = (term) => (mach ? mach.factor(term) : 1), plus = (name) => (mach ? mach.increment(name) : 0);
  const a = Math.abs(alpha), sign = alpha >= 0 ? 1 : -1, slip = Math.abs(beta), slipHeld = Math.min(slip, 30);
  const b2v = SPAN / (2 * vt), c2v = CHORD / (2 * vt);
  const lift = f('lift-basic') * (alpha >= 0 ? read('CLBAS', a) : 2 * read('CLBAS', 0) - read('CLBAS', a)) + f('lift-stabilator') * read('CLSTAB', a) * stabilator + plus('lift');
  const drag = f('drag-basic') * read('CDBAS', a) + (stores ? constant('Delta_CD_STORES') : 0) + plus('drag');
  const side = f('side-sideslip') * read('CYB', a) * beta + f('side-aileron') * constant('Cy_delta_a') * aileron + f('side-spoiler') * constant('Cy_delta_sp') * spoiler + f('side-rudder') * read('CYDR', a) * rudder;
  const roll = f('roll-sideslip') * read('CRB1', a) * beta + b2v * (f('roll-roll-rate') * read('CRP1', a) * p + f('roll-yaw-rate') * read('CRR', a) * r)
    + f('roll-aileron') * read('CRDA', a) * aileron + f('roll-spoiler') * read('CRDSP', a) * spoiler + f('roll-rudder') * read('CRDR', a) * rudder;
  const pitchAtReference = f('pitch-basic') * read('CMBAS', a) * sign + f('pitch-sideslip') * readIncrement(a, slipHeld)
    + c2v * (f('pitch-pitch-rate') * read('CMQ', a) * q + f('pitch-alpha-rate') * read('CMAD', a) * alphaDot)
    + f('pitch-stabilator') * (read('CMSTAB', a) + constant('K_beta^(Cm_delta_stab)') * slip) * stabilator
    + f('pitch-aileron') * read('CMDA', a) * Math.abs(aileron) + f('pitch-spoiler') * read('CMDSP', a) * Math.abs(spoiler) + plus('pitch');
  const yawAtReference = f('yaw-sideslip') * read('CNB1', a) * beta + b2v * ((f('yaw-roll-rate') * read('CNP', a) + plus('yaw-roll-rate')) * p + f('yaw-yaw-rate') * read('CNR', a) * r)
    + (f('yaw-aileron') * read('CNDA', a) + plus('yaw-aileron')) * aileron + f('yaw-spoiler') * read('CNDSP', a) * spoiler + f('yaw-rudder') * read('CNDR', a) * rudder;
  // The last lines of the pitch and yaw blocks: from the reference centre to the centre of gravity.
  const shift = (cg - dimension('Xref')) / 100;
  const pitchShift = shift * (lift * Math.cos(alpha / DEG) + drag * Math.sin(alpha / DEG)), yawShift = shift * (CHORD / SPAN) * side;
  return { lift, drag, side, roll, pitch: pitchAtReference + pitchShift, yaw: yawAtReference + yawShift, pitchAtReference, yawAtReference, pitchShift, yawShift };
}
export const SIX = ['lift', 'drag', 'side', 'roll', 'pitch', 'yaw'];

// ---- JSBSim's side ----

/**
 * The speed of the wiring flights that hold the file to AFWAL's Table 1 alone, ft/s: Mach 0.28 at 15,000 ft,
 * under the Mach number (0.3) below which nothing of what Mach changes is in the airplane.
 */
export const SLOW_FPS = 300;

/**
 * A flight started at a state and not yet stepped: the airplane level, at 15,000 ft and 300 ft/s unless told
 * otherwise, with the air meeting it at an angle of attack and a sideslip (AFWAL's equation 9: U = V cos alpha
 * cos beta, V sin beta, V sin alpha cos beta), turning at p, q and r, the stick and the rudder where asked.
 * No copilot, so the stick alone moves the stabilator. Everything is part of the start; nothing is set afterwards.
 */
export function startAt(module, { alpha, beta, vt = SLOW_FPS, heightFt = AFWAL_REFERENCE_HEIGHT.value, p = 0, q = 0, r = 0, pitch = 0, roll = 0, rudder = 0 }) {
  const a = alpha / DEG, b = beta / DEG;
  return Flight.start(module, F4C, {
    assists: null, settleSeconds: 0, controls: { gear: false, brake: false, throttle: 0, pitch, roll },
    sets: [['ic/h-sl-ft', heightFt], ['ic/u-fps', vt * Math.cos(a) * Math.cos(b)], ['ic/v-fps', vt * Math.sin(b)], ['ic/w-fps', vt * Math.sin(a) * Math.cos(b)],
      ['ic/p-rad_sec', p], ['ic/q-rad_sec', q], ['ic/r-rad_sec', r], ['fcs/rudder-cmd-norm', rudder]],
  });
}

/**
 * What JSBSim has at this moment: the state Table 1 needs, read back, and the six coefficients it has worked
 * out, taken from its aerodynamic force in the airplane's own axes and its aerodynamic moment about the
 * centre of gravity. Lift, drag and side force are AFWAL's (PDF p.22): drag along the velocity's shadow on the
 * plane of symmetry, lift at right angles to it in that plane, side force along the airplane's y axis.
 */
export function snapshot(flight) {
  const get = (name) => flight.get(name);
  const [u, v, w] = ['u', 'v', 'w'].map((axis) => get(`velocities/${axis}-aero-fps`));
  const state = {
    alpha: get('aero/alpha-deg'), beta: get('aero/beta-deg'), vt: get('velocities/vt-fps'),
    p: get('velocities/p-rad_sec'), q: get('velocities/q-rad_sec'), r: get('velocities/r-rad_sec'), alphaDot: get('aero/alphadot-rad_sec'),
    stabilator: get('fcs/elevator-pos-deg'), rudder: get('fcs/rudder-pos-deg'),
    // AFWAL's two lateral deflections (its Table 6): left aileron down less right aileron down; right spoiler up less left spoiler up.
    aileron: get('fcs/left-aileron-pos-deg') - get('fcs/right-aileron-pos-deg'),
    spoiler: get('fcs/right-spoiler-pos-deg') - get('fcs/left-spoiler-pos-deg'),
  };
  // The angles are AFWAL's own (its equation 9), from the airplane's speed through the air along its three axes.
  assert.ok(Math.abs(state.alpha - Math.atan2(w, u) * DEG) < 1e-9 && Math.abs(state.beta - Math.asin(v / state.vt) * DEG) < 1e-9, 'JSBSim\'s angle of attack and sideslip are AFWAL\'s');
  const qbar = get('aero/qbar-psf'), [fx, fy, fz] = ['x', 'y', 'z'].map((axis) => get(`forces/fb${axis}-aero-lbs`));
  const ca = Math.cos(state.alpha / DEG), sa = Math.sin(state.alpha / DEG);
  const measured = {
    lift: (fx * sa - fz * ca) / (qbar * S), drag: -(fx * ca + fz * sa) / (qbar * S), side: fy / (qbar * S),
    roll: get('moments/l-aero-lbsft') / (qbar * S * SPAN), pitch: get('moments/m-aero-lbsft') / (qbar * S * CHORD), yaw: get('moments/n-aero-lbsft') / (qbar * S * SPAN),
  };
  return { state, measured, qbar, force: [fx, fy, fz], mach: get('velocities/mach'), heightFt: get('position/h-sl-ft') };
}
