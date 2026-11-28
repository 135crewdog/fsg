// Test pilots for a simple airplane's checkride (tests/simple-f4c.test.js): each manoeuvre of the plan's
// lines, flown headless through the same seven controls the game gives the player, and measured in knots,
// feet, degrees and g. New in FSG, milestone 3 re-planned (docs/milestones/3-replan.md, pull request 3).
// Written for any airplane on the shared simple physics (aircraft/simple/): the simple Cessna flies them too.
//
// The plan's words, as these pilots measure them (docs/milestones/3-replan.md, "Words used in the lines"):
//   stalled        the angle of attack is beyond the file's stall angle (simple/stall-angle-rad, read back
//                  from JSBSim), nose up or down
//   flying again   back below the stall angle, and staying there for 2 s: the moment it came back below
//   upright        banked less than 90 degrees
//   over the top   the nose passes straight up and comes on down to wings-level inverted (the nose back on
//                  the horizon, the airplane on its back), never stalled, never slower than the clean stall speed
//   let go         the stick to neutral in pitch and roll; the throttle stays where it was
import { DT, Flight } from '../../src/sim/game.js';
import { flatSource } from '../../src/sim/ground.js';
import { FT } from '../../src/sim/world.js';

const DEG = 180 / Math.PI;
export const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
/** Flat ground at sea level everywhere: the airborne manoeuvres are flown high above it. */
export const SEA = flatSource(0);

/** What the pilot sees, in a pilot's units. */
export function seen(flight) {
  const v = (name) => flight.value(name);
  const touching = [];
  flight.stateNames.forEach((name, i) => { if (name.endsWith('/WOW') && flight.state[i] === 1) touching.push(flight.aircraft.contacts[i - (flight.stateNames.length - flight.aircraft.contacts.length)]); });
  return {
    t: v('simulation/sim-time-sec'), kt: v('velocities/vc-kts'), ft: v('position/h-sl-ft'), agl: v('position/h-agl-ft'), mach: v('velocities/mach'),
    pitch: v('attitude/theta-rad') * DEG, bank: v('attitude/phi-rad') * DEG, heading: v('attitude/psi-rad') * DEG, alpha: v('aero/alpha-rad') * DEG, slip: v('aero/beta-rad') * DEG,
    g: v('accelerations/Nz'), fpm: -v('velocities/v-down-fps') * 60, pitchRate: v('velocities/q-rad_sec') * DEG, rollRate: v('velocities/p-rad_sec') * DEG,
    stabilator: v('fcs/elevator-pos-rad') * DEG, touching, onWheels: touching.some((name) => /wheel/.test(name)),
  };
}

/**
 * Flies for `seconds`: before every step `pilot(r, t)` sees the flight (r, as `seen`; t, seconds since this
 * call) and gives controls, or nothing to leave them, or false to stop. Returns every step's `seen`, the
 * first before any step and the last after the last one.
 */
export function fly(flight, seconds, pilot = () => null) {
  const rows = [];
  for (let k = 0; k < Math.round(seconds / DT); k++) {
    const r = seen(flight);
    rows.push(r);
    const controls = pilot(r, k * DT);
    if (controls === false) return rows;
    if (controls) flight.fly(controls);
    if (flight.step(1) !== 0) throw new Error(`JSBSim stopped: ${flight.fdm.lastError()}`);
    if (flight.ended) throw new Error(`the flight ended: ${JSON.stringify(flight.ended)}`);
  }
  rows.push(seen(flight));
  return rows;
}

/** A flight started in the air, level and steady at a height and a calibrated speed by JSBSim's own trim (src/sim/game.js), over the sea. */
export const inTheAir = (module, aircraft, heightFt, knots, options = {}) => Flight.start(module, aircraft, { airborne: { heightFt, knots }, terrain: SEA, ...options });

/** The file's stall angle, degrees, read back from JSBSim. */
export const stallAngle = (flight) => flight.get('simple/stall-angle-rad') * DEG;

// ---- hands ----

/** The roll stick that holds a bank (degrees). */
export const bankTo = (r, deg) => clamp(0.03 * (deg - r.bank) - 0.008 * r.rollRate, -1, 1);
export const wingsLevel = (r) => bankTo(r, 0);

/**
 * A pilot who flies g: the stick eases toward the g wanted and is steadied by the pitch rate. Steady at any
 * speed and height the checkride flies. (A pilot who moved the stick straight from the height error went
 * unstable high up, in the throwaway runs before this was written.)
 */
export function gPilot(stick = 0) {
  let held = stick;
  return (r, g) => {
    held = clamp(held + 0.25 * DT * (g - r.g), -1, 1);
    return clamp(held - 0.002 * r.pitchRate, -1, 1);
  };
}
/** A pilot who holds a height with the stick, through the g pilot: the g for the climb rate that closes on the height, more in a bank. */
export function levelPilot(feet, stick = 0) {
  const hands = gPilot(stick);
  return (r) => {
    const climb = clamp((feet - r.ft) * 4, -3000, 3000);   // ft/min wanted
    return hands(r, clamp(1 + (climb - r.fpm) / 4000, 0.3, 1.7) / Math.max(Math.cos(r.bank / DEG), 0.3));
  };
}

// ---- the takeoff ----

/** Wings' test pilot (135crewdog/wings, tests/fly.js, commit 6d689b7): full back tilt from 80 knots, then the nose held 10 degrees up once airborne. */
export const wingsTakeoffPilot = (r) => (r.onWheels ? (r.kt > 80 ? 1 : 0) : clamp(0.08 * (10 - r.pitch) - 0.03 * r.pitchRate, -1, 1));
/** A tilt simply held from 80 knots. */
export const heldFrom80 = (stick) => (r) => (r.kt > 80 ? stick : 0);

/**
 * A takeoff from the numbers: brakes off, full throttle, the flaps where asked, `stick(r)` the pitch stick,
 * the roll stick left alone. Returns where the nosewheel left and where the last wheel did (the liftoff: no
 * wheel touches again for a second), what else touched the runway up to 10 s after the liftoff, and `after(s)`:
 * what the pilot saw that many seconds after the liftoff.
 */
export function takeoff(module, aircraft, stick, { flaps, seconds = 60 } = {}) {
  const flight = Flight.start(module, aircraft, { controls: { flaps } }), from = flight.where(), out = { nose: null, off: null, touched: new Set(), angle: stallAngle(flight) };
  let clear = 0, candidate = null, done = null;
  const rows = fly(flight, seconds, (r) => {
    if (done !== null && r.t > done + 10) return false;
    if (!out.nose && r.kt > 30 && !r.touching.includes('nose wheel')) out.nose = { ...r };
    if (!out.off) {
      if (r.onWheels) { clear = 0; candidate = null; } else {
        if (clear === 0) { const at = flight.where(); candidate = { ...r, rollFt: Math.hypot(at.north - from.north, at.east - from.east) / FT }; }
        if (++clear >= 1 / DT) { out.off = candidate; done = candidate.t; }
      }
    }
    for (const name of r.touching) if (!/wheel/.test(name)) out.touched.add(name);
    return { throttle: 1, brake: false, flaps, pitch: stick(r), roll: 0 };
  });
  flight.dispose();
  out.touched = [...out.touched];
  out.after = (s) => (out.off ? rows.find((r) => r.t >= out.off.t + s) ?? null : null);
  return out;
}

// ---- stalls ----

/**
 * The approach to a stall the plan's lines fly: from level flight, the throttle to idle, and the speed taken
 * off a knot a second with the nose (the pilot's stick follows a speed that falls a knot a second), wings held
 * level. At idle the airplane cannot hold its height and lose only a knot a second, so it descends as it must.
 * `until(r, stick)` ends it. Returns the flight, still flying, and what was seen.
 */
function slowDown(module, aircraft, { gear = false, flaps = 0, fromKt, heightFt, until }) {
  const flight = inTheAir(module, aircraft, heightFt, fromKt, { controls: { gear, flaps } }), angle = stallAngle(flight);
  const level = levelPilot(heightFt, flight.trimmed.pitch), power = flight.trimmed.throttle;
  // Level and steady for 5 s first, so the trim's start is flown, not assumed.
  fly(flight, 5, (r) => ({ throttle: power, pitch: level(r), roll: wingsLevel(r) }));
  const from = seen(flight);
  // The speed with the nose: too fast, the nose a little higher (half a degree a knot, and a slow lean on top);
  // the stick holds that attitude (the loops of tests/checkride/pilot.js, pitchTo).
  let trim = flight.controls.pitch, lean = 0, stick = trim;
  const rows = fly(flight, 240, (r, t) => {
    if (until(r, stick, angle)) return false;
    const fast = r.kt - (from.kt - t);   // knots faster than the speed that falls a knot a second
    lean = clamp(lean + 0.05 * DT * fast, -20, 20);
    const nose = from.pitch + lean + clamp(0.5 * fast, -10, 10), off = nose - r.pitch;
    trim = clamp(trim + 0.03 * DT * off, -1, 1);
    stick = clamp(trim + 0.06 * off - 0.025 * r.pitchRate, -1, 1);
    return { throttle: 0, pitch: stick, roll: wingsLevel(r) };
  });
  return { flight, rows, from, angle };
}

/** The stall speed: slowing a knot a second at idle, the speed when the angle of attack first passes the stall angle. */
export function stallSpeed(module, aircraft, { gear = false, flaps = 0, fromKt, heightFt = 12000 }) {
  const { flight, rows, from, angle } = slowDown(module, aircraft, { gear, flaps, fromKt, heightFt, until: (r, stick, stall) => r.alpha > stall });
  const last = seen(flight), lastTen = rows.filter((r) => r.t >= last.t - 10);
  flight.dispose();
  return {
    kt: last.kt, alpha: last.alpha, g: last.g, pitch: last.pitch, fpm: last.fpm, ft: last.ft, angle, seconds: last.t - from.t, fromKt: from.kt,
    /** How fast the speed really fell over the last 10 s, knots a second. */
    knotsASecond: (lastTen[0].kt - last.kt) / (last.t - lastTen[0].t),
  };
}

/**
 * After the controls were let go at `t0`: when the airplane was flying again (the moment it came back below
 * the stall angle to stay for 2 s), seconds after t0, or null; whether it was upright at that moment; and the
 * first moment from then on that it was below the stall angle and upright.
 */
export function recovery(rows, t0, angle) {
  const after = rows.filter((r) => r.t >= t0), below = (r) => Math.abs(r.alpha) < angle;
  let flying = null, since = null;
  for (const r of after) {
    if (!below(r)) { since = null; continue; }
    since ??= r.t;
    if (r.t - since >= 2) { flying = since; break; }
  }
  const upright = flying === null ? null : after.find((r) => r.t >= flying && below(r) && Math.abs(r.bank) < 90)?.t ?? null;
  return { flying: flying === null ? null : flying - t0, uprightThen: flying !== null && upright === flying, upright: upright === null ? null : upright - t0 };
}

/** What a held stall looked like, from the rows it was held over. */
function heldStall(rows, angle) {
  const last = rows.at(-1);
  return {
    stalledAtTheEnd: Math.abs(last.alpha) > angle, stalledShare: rows.filter((r) => Math.abs(r.alpha) > angle).length / rows.length,
    alpha: [Math.min(...rows.map((r) => r.alpha)), Math.max(...rows.map((r) => r.alpha))], kt: [Math.min(...rows.map((r) => r.kt)), Math.max(...rows.map((r) => r.kt))],
    nose: [Math.min(...rows.map((r) => r.pitch)), Math.max(...rows.map((r) => r.pitch))], fpm: [Math.min(...rows.map((r) => r.fpm)), Math.max(...rows.map((r) => r.fpm))], mostBank: Math.max(...rows.map((r) => Math.abs(r.bank))),
    end: last,
  };
}
/** After letting go: the recovery, and what it cost up to 5 s after it was flying again and upright (or to the end). */
function afterLettingGo(rows, t0, angle) {
  const rec = recovery(rows, t0, angle), until = t0 + (rec.upright ?? Infinity) + 5, part = rows.filter((r) => r.t >= t0 && r.t <= until);
  return { ...rec, lostFt: part[0].ft - Math.min(...part.map((r) => r.ft)), mostBank: Math.max(...part.map((r) => Math.abs(r.bank))), lowestNose: Math.min(...part.map((r) => r.pitch)), end: part.at(-1) };
}

/**
 * A power-off stall, the plan's: from level flight at idle, slowing a knot a second to full back tilt; held
 * `hold` s; with `sloppy`, full right tilt as well for that many seconds more; then let go, and watched for
 * `watch` s. Returns the held stall, the sloppy part if there was one, and the recovery.
 */
export function powerOffStall(module, aircraft, { gear = false, flaps = 0, fromKt, heightFt = 15000, hold = 5, sloppy = 0, watch = 20 }) {
  const { flight, angle } = slowDown(module, aircraft, { gear, flaps, fromKt, heightFt, until: (r, stick) => stick >= 1 });
  const fullBackAt = seen(flight);
  const held = fly(flight, hold, (r) => ({ throttle: 0, pitch: 1, roll: wingsLevel(r) }));
  const slop = sloppy ? fly(flight, sloppy, () => ({ throttle: 0, pitch: 1, roll: 1 })) : null;
  const t0 = seen(flight).t, after = fly(flight, watch, () => ({ throttle: 0, pitch: 0, roll: 0 }));
  flight.dispose();
  return { angle, fullBackAt, held: heldStall(held, angle), sloppy: slop && heldStall(slop, angle), after: afterLettingGo(after, t0, angle), rows: [...held, ...(slop ?? []), ...after], t0 };
}

/** A power-on stall, the plan's: from level flight at a speed, the throttle to `throttle` and full back tilt over 2 s, held `hold` s, then let go. */
export function powerOnStall(module, aircraft, { knots, throttle, heightFt = 15000, hold = 10, watch = 20 }) {
  const flight = inTheAir(module, aircraft, heightFt, knots), stick0 = flight.trimmed.pitch, angle = stallAngle(flight), from = seen(flight);
  fly(flight, 2, (r, t) => ({ throttle, pitch: stick0 + (1 - stick0) * (t / 2), roll: wingsLevel(r) }));
  const held = fly(flight, hold, (r) => ({ throttle, pitch: 1, roll: wingsLevel(r) }));
  const t0 = seen(flight).t, after = fly(flight, watch, () => ({ throttle, pitch: 0, roll: 0 }));
  flight.dispose();
  return { angle, from, held: heldStall(held, angle), after: afterLettingGo(after, t0, angle), rows: [...held, ...after], t0 };
}

// ---- speed and energy ----

/**
 * Level flight at full throttle from a start at `knots`, until the speed changes less than 0.02 knots a second
 * over 10 s (or `seconds` run out). Returns the speed and Mach number then, and how well the height was held.
 */
export function topSpeed(module, aircraft, { heightFt, knots, throttle = 1, seconds = 400 }) {
  const flight = inTheAir(module, aircraft, heightFt, knots), level = levelPilot(heightFt, flight.trimmed.pitch), marks = [];
  let low = Infinity, high = -Infinity;
  const rows = fly(flight, seconds, (r, t) => {
    low = Math.min(low, r.ft); high = Math.max(high, r.ft);
    if (Math.abs(t - Math.round(t)) < DT / 2 && Math.round(t) % 10 === 0) { marks.push(r.kt); if (marks.length > 3 && Math.abs(r.kt - marks.at(-2)) < 0.2) return false; }
    return { throttle, pitch: level(r), roll: wingsLevel(r) };
  });
  const last = seen(flight);
  flight.dispose();
  return { kt: last.kt, mach: last.mach, ft: last.ft, seconds: last.t - rows[0].t, low, high, knotsASecond: marks.length > 1 ? (marks.at(-1) - marks.at(-2)) / 10 : null };
}

/** From level flight at a speed, the stick held at `stick` and the wings level for `seconds`: the g, and whether and when it stalled. */
export function pull(module, aircraft, { heightFt, knots, stick, throttle, seconds = 4 }) {
  const flight = inTheAir(module, aircraft, heightFt, knots), angle = stallAngle(flight);
  const rows = fly(flight, seconds, (r) => ({ throttle: throttle ?? flight.trimmed.throttle, pitch: stick, roll: wingsLevel(r) }));
  flight.dispose();
  const t0 = rows[0].t, stalled = rows.find((r) => r.alpha > angle) ?? null, upTo = stalled ? rows.filter((r) => r.t <= stalled.t) : rows;
  const between = (a, b) => rows.filter((r) => r.t - t0 >= a && r.t - t0 <= b), mean = (list) => list.reduce((sum, r) => sum + r.g, 0) / list.length;
  return { mostG: Math.max(...rows.map((r) => r.g)), mostGBeforeStall: Math.max(...upTo.map((r) => r.g)), heldG: mean(between(1, 2)), stalledAfter: stalled ? stalled.t - t0 : null, stalledG: stalled?.g ?? null, ktAfter: rows.at(-1).kt, mostAlpha: Math.max(...rows.map((r) => r.alpha)) };
}

/** The stick that gives `g` in a wings-level pull from level flight at a speed (the g held from 1 to 2 s in), by halving. */
export function stickForG(module, aircraft, { g, heightFt, knots, throttle }) {
  let lo = 0, hi = 1;
  for (let k = 0; k < 14; k++) {
    const mid = (lo + hi) / 2;
    if (pull(module, aircraft, { heightFt, knots, stick: mid, throttle, seconds: 2.1 }).heldG > g) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

/**
 * A level turn with the pitch stick held: from level flight at a speed, the throttle set and the stick put at
 * `stick`, the pilot's hands only rolling, to the bank that keeps the height (more bank if it climbs, less if it
 * sinks). Through `degrees` of heading. Returns the speed coming out, the g, and how well the height was held.
 */
export function levelTurn(module, aircraft, { heightFt, knots, throttle, stick, degrees = 180, seconds = 90 }) {
  const flight = inTheAir(module, aircraft, heightFt, knots), angle = stallAngle(flight), from = seen(flight);
  let turned = 0, last = from.heading, low = Infinity, high = -Infinity, mostG = 0, stalledFor = 0, out = null;
  fly(flight, seconds, (r) => {
    turned += ((r.heading - last + 540) % 360) - 180; last = r.heading;
    low = Math.min(low, r.ft); high = Math.max(high, r.ft); mostG = Math.max(mostG, r.g);
    if (Math.abs(r.alpha) > angle) stalledFor += DT;
    if (Math.abs(turned) >= degrees) { out = { ...r }; return false; }
    // The share of the lift that must point up: 1 g's worth, more to climb back, less to come down.
    const up = 1 + clamp((heightFt - r.ft) * 0.004, -0.6, 0.6) - clamp(r.fpm / 2500, -1.2, 1.2);
    const bank = Math.acos(clamp(up / Math.max(r.g, 0.5), -0.3, 1)) * DEG;
    return { throttle, pitch: stick, roll: bankTo(r, bank) };
  });
  flight.dispose();
  return { out, from, turned, low, high, mostG, stalledFor, seconds: out ? out.t - from.t : null };
}

/**
 * A loop with the pitch stick held: from level flight at a speed, the throttle set, the stick put at `stick`
 * and not moved, the roll stick left alone. Over the top is the plan's: the nose passes straight up and comes on
 * down to the horizon with the airplane on its back, never stalled, never slower than `slowestKt`.
 */
export function loop(module, aircraft, { heightFt, knots, throttle, stick, slowestKt, seconds = 60 }) {
  const flight = inTheAir(module, aircraft, heightFt, knots), angle = stallAngle(flight), from = seen(flight);
  let onItsBack = false, top = null, stalled = null, slowest = Infinity, highest = -Infinity, mostG = 0, noseHighest = -Infinity;
  fly(flight, seconds, (r, t) => {
    if (stalled === null && Math.abs(r.alpha) > angle) stalled = { ...r };
    slowest = Math.min(slowest, r.kt); highest = Math.max(highest, r.ft); mostG = Math.max(mostG, r.g);
    if (!onItsBack) noseHighest = Math.max(noseHighest, r.pitch);
    if (Math.abs(r.bank) > 90 && r.pitch > 45) onItsBack = true;   // past straight up: the horizon comes round upside down
    if (onItsBack && r.pitch <= 0) { top = { ...r }; return false; }
    // Given up: the nose has fallen back below the horizon the right way up without ever passing straight up.
    if (!onItsBack && t > 3 && r.pitch < -5) return false;
    return { throttle, pitch: stick, roll: 0 };
  });
  flight.dispose();
  const wingsLevelInverted = top !== null && Math.abs(top.bank) > 150;
  return {
    from, top, stalled, slowest, mostG, noseHighest, gainedFt: highest - from.ft, wingsLevelInverted,
    overTheTop: top !== null && wingsLevelInverted && stalled === null && slowest >= slowestKt,
    seconds: top ? top.t - from.t : null,
  };
}

/**
 * Phone level: from level flight at a speed, clean (JSBSim's own trim), the stick let go to neutral for
 * `seconds`, the roll stick too. The throttle stays where level flight had it unless one is given; `controls`
 * are set as the stick is let go (the gear and the flaps coming down, say). `last(s)` is the last s seconds.
 */
export function handsOff(module, aircraft, { heightFt, knots, seconds, throttle = null, controls = {} }) {
  const flight = inTheAir(module, aircraft, heightFt, knots), power = throttle ?? flight.trimmed.throttle, trimmedStick = flight.trimmed.pitch, start = seen(flight);
  const rows = fly(flight, seconds, () => ({ ...controls, throttle: power, pitch: 0, roll: 0 }));
  flight.dispose();
  const speeds = (list) => ({ slow: Math.min(...list.map((r) => r.kt)), fast: Math.max(...list.map((r) => r.kt)), fpm: list.reduce((sum, r) => sum + r.fpm, 0) / list.length });
  return { start, end: rows.at(-1), rows, ...speeds(rows), throttle: power, trimmedStick, last: (s) => speeds(rows.filter((r) => r.t >= rows.at(-1).t - s)) };
}

/**
 * A step of the stick from level flight: `more` added to the stick that holds level flight, held `seconds`,
 * the wings level. Returns the g it settles at (the mean from 2 to 3 s), the most g, and the overshoot: how far
 * the most is beyond the settled, as a share of the change.
 */
export function stickStep(module, aircraft, { heightFt, knots, more, seconds = 4, controls = {} }) {
  const flight = inTheAir(module, aircraft, heightFt, knots, { controls }), stick0 = flight.trimmed.pitch, power = flight.trimmed.throttle;
  const rows = fly(flight, seconds, (r) => ({ throttle: power, pitch: stick0 + more, roll: wingsLevel(r) }));
  flight.dispose();
  const t0 = rows[0].t, settled = rows.filter((r) => r.t - t0 >= 2 && r.t - t0 <= 3), g = settled.reduce((sum, r) => sum + r.g, 0) / settled.length;
  const most = Math.max(...rows.filter((r) => r.t - t0 <= 2).map((r) => r.g)), g0 = rows[0].g;
  return { stick0, g0, g, most, overshoot: Math.max(0, (most - g) / (g - g0)), mach: rows[0].mach, pitchRateMost: Math.max(...rows.map((r) => r.pitchRate)), pitchRateSettled: settled.reduce((sum, r) => sum + r.pitchRate, 0) / settled.length };
}

/** Full roll stick from level flight at a speed, the pitch stick held where level flight had it: the steady roll rate, degrees a second (the mean from 1.5 to 3 s, as Wings' card.js measures it), and the most sideslip. */
export function rollRate(module, aircraft, { heightFt, knots }) {
  const flight = inTheAir(module, aircraft, heightFt, knots), stick0 = flight.trimmed.pitch, power = flight.trimmed.throttle;
  const rows = fly(flight, 3, () => ({ throttle: power, pitch: stick0, roll: 1 }));
  flight.dispose();
  const t0 = rows[0].t, part = rows.filter((r) => r.t - t0 >= 1.5);
  return { dps: part.reduce((sum, r) => sum + r.rollRate, 0) / part.length, mostSlip: Math.max(...rows.map((r) => Math.abs(r.slip))), secondsTo90: (rows.find((r) => Math.abs(r.bank) >= 90)?.t ?? NaN) - t0 };
}

/**
 * Level flight from a start at `knots`, the pilot holding the height and the wings level, with the throttle and
 * any other controls as given, until `until(r)` or `seconds`. Returns what was seen at every step.
 */
export function flyLevel(module, aircraft, { heightFt, knots, throttle, controls = {}, until = () => false, seconds }) {
  const flight = inTheAir(module, aircraft, heightFt, knots), level = levelPilot(heightFt, flight.trimmed.pitch);
  const rows = fly(flight, seconds, (r) => (until(r) ? false : { ...controls, throttle, pitch: level(r), roll: wingsLevel(r) }));
  flight.dispose();
  return rows;
}
/** The seconds a level run takes from one speed to another (either way), or null if it never gets there. */
export function secondsBetween(rows, fromKt, toKt) {
  const up = toKt > fromKt, a = rows.find((r) => (up ? r.kt >= fromKt : r.kt <= fromKt)), b = rows.find((r) => (up ? r.kt >= toKt : r.kt <= toKt));
  return a && b ? b.t - a.t : null;
}

/**
 * The stall the way Wings' checkride flies it (135crewdog/wings, tests/checkride.test.js, "Stall, clean, slowing
 * in level flight ... then stick held where it was"): level at idle, the pilot holding the height, until the
 * angle of attack passes the stall angle; then the stick held where it was for 5 s.
 */
export function levelStall(module, aircraft, { gear = false, flaps = 0, fromKt, heightFt = 10000 }) {
  const flight = inTheAir(module, aircraft, heightFt, fromKt, { controls: { gear, flaps } }), angle = stallAngle(flight), level = levelPilot(heightFt, flight.trimmed.pitch);
  let stick = flight.trimmed.pitch;
  const entry = fly(flight, 120, (r) => { if (r.alpha > angle) return false; stick = level(r); return { throttle: 0, pitch: stick, roll: wingsLevel(r) }; });
  const at = seen(flight), tenBefore = entry.find((r) => r.t >= at.t - 10) ?? entry[0];
  const held = fly(flight, 5, (r) => ({ throttle: 0, pitch: stick, roll: wingsLevel(r) })), after = held.at(-1);
  flight.dispose();
  return { at, stick, knotsASecond: (tenBefore.kt - at.kt) / (at.t - tenBefore.t), low: Math.min(...entry.map((r) => r.ft)), high: Math.max(...entry.map((r) => r.ft)), after, nose: [Math.min(...held.map((r) => r.pitch)), Math.max(...held.map((r) => r.pitch))] };
}

/**
 * Final: gear and flaps as asked, down a slope (degrees) at a speed, the stick holding the path and the throttle
 * the speed (after the loops of tests/checkride/pilot.js). Flown for `seconds`; the last 10 s are what it settled to.
 */
export function onFinal(module, aircraft, { knots, slopeDeg = 3, gear = true, flaps = 1, heightFt = 6000, seconds = 60 }) {
  const flight = inTheAir(module, aircraft, heightFt, knots, { controls: { gear, flaps } }), angle = stallAngle(flight);
  const path = (r) => Math.atan2(r.fpm / 60, flight.value('velocities/vg-fps')) * DEG;   // the flight path's angle, degrees, down negative
  let trim = flight.trimmed.pitch, power = flight.trimmed.throttle, nose = seen(flight).pitch - slopeDeg;
  const rows = fly(flight, seconds, (r) => {
    const high = -slopeDeg - path(r);   // degrees the path must still come down (negative) or up
    nose = clamp(nose + 0.5 * DT * high, -15, 25);
    const off = nose + high - r.pitch;
    trim = clamp(trim + 0.03 * DT * off, -1, 1);
    power = clamp(power + 0.006 * DT * (knots - r.kt), 0, 1);
    return { throttle: clamp(power + 0.03 * (knots - r.kt), 0, 1), pitch: clamp(trim + 0.06 * off - 0.025 * r.pitchRate, -1, 1), roll: wingsLevel(r) };
  });
  const last = rows.filter((r) => r.t >= rows.at(-1).t - 10), mean = (f) => last.reduce((sum, r) => sum + f(r), 0) / last.length;
  const out = { kt: mean((r) => r.kt), fpm: mean((r) => r.fpm), alpha: mean((r) => r.alpha), nose: mean((r) => r.pitch), stick: flight.controls.pitch, throttle: flight.controls.throttle, angle, slopeDeg: -path(seen(flight)) };
  flight.dispose();
  return out;
}

/**
 * The g it sustains in a level turn at a speed and a throttle: the held stick whose turn through a full circle
 * neither gains nor loses speed, found by halving. Returns that stick and the turn it gives.
 */
export function sustainedTurn(module, aircraft, { heightFt, knots, throttle }) {
  let lo = 0, hi = 1;
  const turn = (stick) => levelTurn(module, aircraft, { heightFt, knots, throttle, stick, degrees: 360 });
  for (let k = 0; k < 12; k++) {
    const mid = (lo + hi) / 2, t = turn(mid);
    if (!t.out || t.out.kt < t.from.kt) hi = mid; else lo = mid;
  }
  const stick = (lo + hi) / 2;
  return { stick, ...turn(stick) };
}

/** A zoom: from level flight at a speed, the throttle set and full back tilt held for `seconds`, the roll stick left alone. Where it got to, and when it stalled. */
export function fullBackClimb(module, aircraft, { heightFt, knots, throttle, seconds = 15 }) {
  const flight = inTheAir(module, aircraft, heightFt, knots), angle = stallAngle(flight), from = seen(flight);
  const rows = fly(flight, seconds, () => ({ throttle, pitch: 1, roll: 0 }));
  flight.dispose();
  const stalled = rows.find((r) => r.alpha > angle) ?? null, at = (s) => rows.find((r) => r.t >= from.t + s) ?? rows.at(-1);
  return { from, stalledAfter: stalled ? stalled.t - from.t : null, stalledAt: stalled, mostG: Math.max(...rows.map((r) => r.g)), noseHighest: Math.max(...rows.map((r) => r.pitch)), gainedFt: Math.max(...rows.map((r) => r.ft)) - from.ft, slowest: Math.min(...rows.map((r) => r.kt)), at };
}
