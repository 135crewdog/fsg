// The game's assists (src/sim/assists.js): neutral trim, automatic feet and steering on the ground.
// New in FSG, milestone 1 (pull request 8). The "done" lines are in docs/milestones/1.md, written before
// any of this was flown.
//
// One of those lines was wrong, and is kept here on record. It said the complete list of what the assists
// write is "stick, rudder, pitch trim, roll trim and steering commands". Upstream's Cessna gives a pilot no
// nosewheel steering (c172x.js says why), and with the rudder alone the takeoff roll goes 48 ft off the
// centreline, against the 25 ft of another line. So the Cessna's steering also works its two wheel brakes.
// The new line: the assists write pitch trim, roll trim, the rudder, the nosewheel steering and the left and
// right wheel brakes, and nothing else. Every one is a control in the cockpit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { C172X } from '../src/sim/aircraft/c172x.js';
import { F16 } from '../src/sim/aircraft/f16.js';
import { assistWrites, wingsFeet } from '../src/sim/assists.js';
import { DT, Flight } from '../src/sim/game.js';
import { FT, toWorld } from '../src/sim/world.js';
import { VARIANTS, loadVariant } from '../jsbsim/tests/lib/node.js';

const data = (file) => readFileSync(new URL(`../jsbsim/jsbsim-data/${file}`, import.meta.url));
const DEG = 180 / Math.PI;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// The Cessna with its elevator's free play removed: a test copy, made here in memory as FDM made its test
// aircraft, never in JSBSim's data or the app. Upstream's file gives the elevator actuator about 3 degrees
// of free play (hysteresis_width 0.05 rad); the copy differs by that one line.
const TIGHT = { ...C172X, model: 'c172x-tight' };
function tightCessna() {
  const shipped = data('aircraft/c172x/c172x.xml').toString();
  const line = /(<actuator name="fcs\/elevator-actuator">[\s\S]*?)[ \t]*<hysteresis_width> 0\.05 <\/hysteresis_width>\n/;
  assert.ok(line.test(shipped), 'upstream\'s file has the free play where it is expected');
  const tight = shipped.replace(line, '$1');
  assert.equal(shipped.split('\n').length - tight.split('\n').length, 1, 'the copy differs by one line');
  return tight;
}
async function moduleWith(variant) {
  const module = await loadVariant(variant);
  for (const file of new Set([...C172X.files, ...F16.files])) module.writeFile(`/data/${file}`, data(file));
  module.writeFile('/data/aircraft/c172x-tight/c172x-tight.xml', Buffer.from(tightCessna()));
  module.writeFile('/data/aircraft/c172x-tight/c172ap.xml', data('aircraft/c172x/c172ap.xml'));
  return module;
}

const knots = (flight) => flight.value('velocities/vc-kts');
const feet = (flight) => flight.value('position/h-sl-ft');
const bank = (flight) => flight.value('attitude/phi-rad') * DEG;
const pitch = (flight) => flight.value('attitude/theta-rad') * DEG;
const slip = (flight) => flight.value('aero/beta-rad') * DEG;
/** Runs a flight for some seconds, calling `each(t)` before every step. */
function run(flight, seconds, each) {
  const steps = Math.round(seconds / DT);
  for (let k = 0; k < steps; k++) {
    if (each && each(k * DT) === false) return;
    assert.equal(flight.step(1), 0, 'JSBSim stepped');
  }
}
/** In the air by JSBSim's own trim, read back: level, steady, at that speed. */
function inTheAir(module, aircraft, at, options = {}) {
  const flight = Flight.start(module, aircraft, { airborne: at, ...options });
  assert.ok(Math.abs(knots(flight) - at.knots) < 0.5 && Math.abs(feet(flight) - at.heightFt) < 1, `${knots(flight)} kt at ${feet(flight)} ft`);
  assert.ok(Math.abs(flight.value('accelerations/Nz') - 1) < 0.02 && Math.abs(flight.value('velocities/v-down-fps')) < 0.5 && Math.abs(bank(flight)) < 0.5,
    `level and steady: ${flight.value('accelerations/Nz')} g, sinking ${flight.value('velocities/v-down-fps')} ft/s, bank ${bank(flight)} deg`);
  return flight;
}
/** The pilot's roll stick that holds the wings level, and nothing else. */
const wingsLevel = (flight) => clamp(-2 * flight.value('attitude/phi-rad') - 0.5 * flight.value('velocities/p-rad_sec'), -1, 1);

// What a cockpit control's command looks like in JSBSim, and what is not one.
const A_CONTROL = /^(fcs\/[a-z-]+-cmd-norm|gear\/gear-cmd-norm)$/;
const NOT_A_CONTROL = /^(forces|moments|aero|inertia|propulsion|accelerations|velocities|position|attitude)\//;
const WRITES = new Map([
  [C172X, ['fcs/pitch-trim-cmd-norm', 'fcs/roll-trim-cmd-norm', 'fcs/rudder-cmd-norm', 'fcs/left-brake-cmd-norm', 'fcs/right-brake-cmd-norm']],
  [F16, ['fcs/pitch-trim-cmd-norm', 'fcs/steer-cmd-norm']],
]);
const ROTATE_KT = new Map([[C172X, 55], [F16, 140]]);

/**
 * The plan's rolls: from level flight the pilot goes for 30 degrees of bank with full stick, easing off as
 * he gets there, holds the turn, and at 16 s goes for 30 degrees the other way. This is the pilot the line
 * was written from (the planning run of 20 November). `harsh` is a rougher one, reported beside it: the stick
 * held full until 30 degrees, then full the other way with no pause.
 */
function rolls(module, aircraft, at, assists, { harsh = false, holdHeight = false } = {}) {
  const flight = inTheAir(module, aircraft, at, { assists });
  const hold = { ...flight.trimmed }, height = feet(flight);
  const out = { peak: 0, steady: 0, ball: 0, stick: 0 };
  let phase = 0;
  run(flight, 30, (t) => {
    const p = flight.value('velocities/p-rad_sec');
    let roll;
    if (harsh) {
      if (phase === 0 && t >= 2) phase = 1;
      if (phase === 1 && bank(flight) >= 30) phase = 2;
      if (phase === 2 && bank(flight) <= -30) phase = 3;
      roll = phase === 0 ? hold.roll : phase === 1 ? 1 : phase === 2 ? -1 : clamp(hold.roll + 4 * (-30 - bank(flight)) / DEG - 0.8 * p, -1, 1);
    } else {
      const target = t < 2 ? 0 : t < 16 ? 30 : -30;
      roll = clamp(hold.roll + 4 * (target - bank(flight)) / DEG - 0.8 * p, -1, 1);
    }
    // A little back stick in the turn: the plan's fixed amount, or for the F-16 enough to hold its height.
    const back = holdHeight ? clamp(0.002 * (height - feet(flight)) + 0.01 * flight.value('velocities/v-down-fps'), -0.3, 0.3) : (1 / Math.cos(bank(flight) / DEG) - 1) * 0.35;
    flight.fly({ roll, pitch: hold.pitch + back });
    if (t > 2) { out.peak = Math.max(out.peak, Math.abs(slip(flight))); out.stick = Math.max(out.stick, Math.abs(roll)); }
    if (!harsh && t > 10 && t < 16) { out.steady = Math.max(out.steady, Math.abs(slip(flight))); out.ball = Math.max(out.ball, Math.abs(flight.value('accelerations/Ny'))); }
  });
  flight.dispose();
  return out;
}

/** The takeoff roll: full power, the pilot steering for the centreline with the roll stick alone. */
function takeoffRoll(module, aircraft, assists = aircraft.assists) {
  const flight = Flight.start(module, aircraft, { assists });
  const wheels = flight.stateNames.map((name, i) => (/^gear\/unit\[\d+\]\/WOW$/.test(name) ? i : -1)).filter((i) => i >= 0);
  assert.equal(wheels.length, 3);
  const out = { off: 0, heading: 0, liftoff: null };
  run(flight, 60, (t) => {
    const { north, east } = toWorld(flight.value('position/lat-geod-rad'), flight.value('position/long-gc-rad'));
    const off = north / FT, heading = flight.value('attitude/psi-rad') * DEG - 90;
    out.off = Math.max(out.off, Math.abs(off));
    out.heading = Math.max(out.heading, Math.abs(heading));
    if (t > 1 && wheels.every((i) => flight.state[i] === 0)) { out.liftoff = { seconds: t, knots: knots(flight), rollFt: east / FT }; return false; }
    flight.fly({ brake: false, throttle: 1, roll: clamp(-0.5 * heading + 0.05 * off, -1, 1), pitch: knots(flight) > ROTATE_KT.get(aircraft) ? 0.5 : 0 });
    return true;
  });
  flight.dispose();
  return out;
}

/**
 * Fixed trim: started `off` knots from the neutral speed by JSBSim's own trim, then phone neutral, throttle
 * where level flight at the neutral speed has it, the pilot holding the wings level with roll stick only.
 */
function offSpeed(module, aircraft, assists, heightFt, off, seconds, band) {
  const neutral = assists.trim.knots;
  const level = inTheAir(module, aircraft, { heightFt, knots: neutral }, { assists });
  const throttle = level.trimmed.throttle;
  level.dispose();
  const flight = inTheAir(module, aircraft, { heightFt, knots: neutral + off }, { assists });
  const pitch0 = pitch(flight);
  const out = { moved: null, lastOutside: 0, peaks: [], low: Infinity, high: -Infinity };
  let before = knots(flight), going = 0;
  run(flight, seconds, (t) => {
    flight.fly({ pitch: 0, throttle, roll: wingsLevel(flight) });
    const k = knots(flight);
    if (out.moved === null && Math.sign(off) * (pitch(flight) - pitch0) > 0.5) out.moved = t;   // half a degree the right way
    if (Math.abs(k - neutral) > band) out.lastOutside = t;
    const now = Math.sign(k - before);
    if (now !== 0 && going !== 0 && now !== going) out.peaks.push({ seconds: t, off: Math.abs(before - neutral) });
    if (now !== 0) going = now;
    before = k;
    out.low = Math.min(out.low, feet(flight));
    out.high = Math.max(out.high, feet(flight));
  });
  out.ends = knots(flight);
  flight.dispose();
  return out;
}

for (const variant of VARIANTS) {
  for (const aircraft of [C172X, F16]) {
    const name = `${variant}, ${aircraft.model}`;
    const { trim } = aircraft.assists;

    test(`${name}: the assists write only cockpit controls: trim, the rudder, the nosewheel steering and the two wheel brakes`, async () => {
      assert.deepEqual(assistWrites(aircraft.assists), WRITES.get(aircraft));
      const flight = Flight.start(await moduleWith(variant), aircraft);
      for (const input of flight.inputNames) assert.ok(A_CONTROL.test(input) && !NOT_A_CONTROL.test(input), `${input} is a control's command, not a force, an aerodynamic number or a mass`);
      for (const write of WRITES.get(aircraft)) assert.ok(flight.inputNames.includes(write));
      console.log(`  ${name}: the assists write ${WRITES.get(aircraft).join(', ')}`);
      flight.dispose();
    });

    test(`${name}: neutral trim is JSBSim's own for ${trim.knots} knots, JSBSim has it from the start and at every step, and hands off the airplane holds that speed`, async () => {
      const module = await moduleWith(variant);
      // On the ground, from before the first step.
      const parked = Flight.start(module, aircraft, { settleSeconds: 0 });
      for (const [command, value] of trim.sets) {
        assert.ok(parked.startSets.some(([n, v]) => n === command && v === value), `${command} is in the start`);
        assert.equal(parked.get(command), value);
      }
      parked.dispose();
      // The stored trim against JSBSim's own trim at the neutral speed.
      const flight = inTheAir(module, aircraft, { heightFt: trim.heightFt, knots: trim.knots });
      const stored = new Map(trim.sets), own = flight.trimmed.jsbsim;
      assert.ok(Math.abs(own.pitchTrim - stored.get('fcs/pitch-trim-cmd-norm')) <= 0.002, `pitch trim: JSBSim's ${own.pitchTrim}, stored ${stored.get('fcs/pitch-trim-cmd-norm')}`);
      assert.ok(Math.abs(own.rollStick - (stored.get('fcs/roll-trim-cmd-norm') ?? 0)) <= 0.002, `roll trim: JSBSim's ${own.rollStick}, stored ${stored.get('fcs/roll-trim-cmd-norm') ?? 0}`);
      // Stick neutral for a minute, the throttle where JSBSim's trim put it.
      flight.fly({ pitch: 0, roll: 0 });
      const seen = { slow: Infinity, fast: -Infinity, low: Infinity, high: -Infinity, bank: 0 };
      run(flight, 60, (t) => {
        if (t > 0) for (const [command, value] of trim.sets) assert.equal(flight.get(command), value, `${command} at ${t} s`);
        seen.slow = Math.min(seen.slow, knots(flight)); seen.fast = Math.max(seen.fast, knots(flight));
        seen.low = Math.min(seen.low, feet(flight)); seen.high = Math.max(seen.high, feet(flight));
        seen.bank = Math.max(seen.bank, Math.abs(bank(flight)));
      });
      console.log(`  ${name}: JSBSim's own trim at ${trim.knots} kt and ${trim.heightFt} ft: pitch ${own.pitchTrim.toFixed(4)}, roll ${own.rollStick.toFixed(4)}; stored ${trim.sets.map(([, value]) => value).join(', ')}.` +
        ` Stick neutral for 60 s: ${seen.slow.toFixed(1)} to ${seen.fast.toFixed(1)} kt, ${seen.low.toFixed(0)} to ${seen.high.toFixed(0)} ft, bank up to ${seen.bank.toFixed(1)} deg`);
      assert.ok(seen.slow >= trim.knots - 3 && seen.fast <= trim.knots + 3, 'speed within 3 kt');
      assert.ok(seen.low >= trim.heightFt - 50 && seen.high <= trim.heightFt + 50, 'altitude within 50 ft');
      assert.ok(seen.bank <= 5, 'bank within 5 deg');
      flight.dispose();
    });

    test(`${name}: away from the neutral speed, the stick an airborne start gives holds JSBSim's trimmed flight`, async () => {
      // This is what lets every airborne test start from JSBSim's own trim with the game's trim in place: the
      // trim adds to the stick one for one, so the difference is held on the stick.
      const module = await moduleWith(variant);
      for (const speed of aircraft === C172X ? [70, 120] : [250, 550]) {
        const flight = inTheAir(module, aircraft, { heightFt: trim.heightFt, knots: speed });
        let speedOff = 0, heightOff = 0;
        run(flight, 20, () => {
          flight.fly({ roll: flight.trimmed.roll + 0.3 * wingsLevel(flight) });
          speedOff = Math.max(speedOff, Math.abs(knots(flight) - speed));
          heightOff = Math.max(heightOff, Math.abs(feet(flight) - trim.heightFt));
        });
        console.log(`  ${name}: at ${speed} kt the stick is ${(flight.trimmed.pitch * 100).toFixed(1)}% ${flight.trimmed.pitch >= 0 ? 'back' : 'forward'}; held for 20 s the speed stays within ${speedOff.toFixed(2)} kt and the height within ${heightOff.toFixed(1)} ft`);
        assert.ok(speedOff < 1 && heightOff < 20);
        flight.dispose();
      }
    });

    test(`${name}: the takeoff roll at full power, steered with the roll stick alone, stays within 25 ft of the centreline until liftoff`, async () => {
      const r = takeoffRoll(await moduleWith(variant), aircraft);
      assert.ok(r.liftoff, 'it lifted off');
      console.log(`  ${name}: liftoff after ${r.liftoff.seconds.toFixed(1)} s at ${r.liftoff.knots.toFixed(0)} kt, ${r.liftoff.rollFt.toFixed(0)} ft down the runway; furthest from the centreline ${r.off.toFixed(1)} ft; heading off by ${r.heading.toFixed(1)} deg at most`);
      assert.ok(r.off <= 25, `${r.off} ft from the centreline`);
    });

    // Not a line of the plan: the F-16 keeps the centreline with no steering at all, so the line above does
    // not show that its steering works, or which way.
    test(`${name}: on the ground the airplane turns the way the stick is tilted`, async () => {
      const module = await moduleWith(variant);
      for (const stick of [1, -1]) {
        const flight = Flight.start(module, aircraft);
        let from = 0;
        run(flight, 20, (t) => {
          const kt = flight.value('velocities/vg-fps') / 1.6878;
          flight.fly({ brake: false, throttle: clamp(0.3 + 0.3 * (10 - kt), 0, 1), roll: t >= 15 ? stick : 0 });
          if (Math.abs(t - 15) < DT / 2) from = flight.value('attitude/psi-rad') * DEG;
        });
        const turned = flight.value('attitude/psi-rad') * DEG - from;
        assert.ok(stick * turned > 10 && stick * turned < 180, `stick ${stick > 0 ? 'right' : 'left'} for 5 s at a taxi: the heading went from ${from.toFixed(1)} by ${turned.toFixed(1)} deg`);
        flight.dispose();
      }
    });
  }

  test(`${variant}, f16 as shipped: fixed trim. Started 50 knots slow the nose drops, 50 fast it rises, within 6 s; the speed is within 10 knots of neutral for good inside 240 s`, async () => {
    const module = await moduleWith(variant);
    for (const off of [-50, 50]) {
      const r = offSpeed(module, F16, F16.assists, 5000, off, 400, 10);
      console.log(`  ${variant}, f16 started ${Math.abs(off)} kt ${off < 0 ? 'slow' : 'fast'}: the nose is half a degree ${off < 0 ? 'down' : 'up'} after ${r.moved?.toFixed(1)} s; last more than 10 kt from 350 at ${r.lastOutside.toFixed(0)} s; ` +
        `350 +/- ${r.peaks.slice(0, 6).map((p) => p.off.toFixed(0)).join(', ')} kt at ${r.peaks.slice(0, 6).map((p) => p.seconds.toFixed(0)).join(', ')} s; between ${r.low.toFixed(0)} and ${r.high.toFixed(0)} ft; ${r.ends.toFixed(1)} kt after 400 s`);
      assert.ok(r.moved !== null && r.moved <= 6, `the nose moved the right way at ${r.moved} s`);
      assert.ok(r.lastOutside < 240, `last outside 10 kt at ${r.lastOutside} s`);
    }
  });

  test(`${variant}, the Cessna with its elevator's free play removed (a test copy): fixed trim. Started 20 knots slow or fast the nose moves the right way within 3 s, each speed swing is smaller than the last, and the speed is within 5 knots of neutral for good inside 150 s`, async () => {
    const module = await moduleWith(variant);
    // The copy's own neutral trim, by JSBSim's trim, as the game's is for the shipped file.
    const probe = inTheAir(module, TIGHT, { heightFt: 2000, knots: 100 });
    const assists = { ...C172X.assists, trim: { ...C172X.assists.trim, sets: [['fcs/pitch-trim-cmd-norm', probe.trimmed.jsbsim.pitchTrim], ['fcs/roll-trim-cmd-norm', probe.trimmed.jsbsim.rollStick]] } };
    probe.dispose();
    for (const off of [-20, 20]) {
      const r = offSpeed(module, TIGHT, assists, 3000, off, 300, 5);
      console.log(`  ${variant}, test copy started ${Math.abs(off)} kt ${off < 0 ? 'slow' : 'fast'}: the nose is half a degree ${off < 0 ? 'down' : 'up'} after ${r.moved?.toFixed(1)} s; last more than 5 kt from 100 at ${r.lastOutside.toFixed(0)} s; ` +
        `100 +/- ${r.peaks.slice(0, 8).map((p) => p.off.toFixed(1)).join(', ')} kt at ${r.peaks.slice(0, 8).map((p) => p.seconds.toFixed(0)).join(', ')} s; ${r.ends.toFixed(1)} kt after 300 s`);
      assert.ok(r.moved !== null && r.moved <= 3, `the nose moved the right way at ${r.moved} s`);
      const swings = r.peaks.filter((p) => p.off > 0.5);   // below half a knot the swings are too small to tell apart
      assert.ok(swings.length >= 4, 'it swings');
      swings.forEach((p, i) => assert.ok(i === 0 || p.off < swings[i - 1].off, `swing ${i + 1} (${p.off} kt) is smaller than the one before (${swings[i - 1]?.off} kt)`));
      assert.ok(r.lastOutside < 150, `last outside 5 kt at ${r.lastOutside} s`);
    }
  });

  test(`${variant}, c172x: automatic feet. Full stick into a 30 degree bank and back the other way: sideslip 3 degrees at most; in the steady turn 1 degree and the ball within 0.02 g`, async () => {
    const module = await moduleWith(variant);
    for (const speed of [70, 100]) {
      const r = rolls(module, C172X, { heightFt: 3000, knots: speed }, C172X.assists);
      console.log(`  ${variant}, c172x at ${speed} kt: sideslip ${r.peak.toFixed(2)} deg at most in the rolls (stick up to ${(r.stick * 100).toFixed(0)}%); in the steady 30 degree turn ${r.steady.toFixed(2)} deg and the ball ${r.ball.toFixed(4)} g at most`);
      assert.equal(r.stick, 1, 'the stick reached full');
      assert.ok(r.peak <= 3, `peak sideslip ${r.peak} deg`);
      assert.ok(r.steady <= 1, `steady sideslip ${r.steady} deg`);
      assert.ok(r.ball <= 0.02, `ball ${r.ball} g`);
    }
  });
}

// Reported for feel, as Wings did: no pass or fail. One build is enough; the two fly the same.
test('reported for feel (no pass or fail)', async () => {
  const module = await moduleWith('weh');
  const say = (line) => console.log(`  ${line}`);

  say('The Cessna as upstream ships it, with its elevator\'s free play, started 20 kt off its neutral 100 and left for two minutes:');
  for (const off of [-20, 20]) {
    const r = offSpeed(module, C172X, C172X.assists, 3000, off, 120, 5);
    say(`  started at ${100 + off} kt: ${r.ends.toFixed(0)} kt after two minutes, between ${r.low.toFixed(0)} and ${r.high.toFixed(0)} ft (started at 3,000)`);
  }

  say('The slow speed swing, hands off (how long one takes, and how much of it is left a swing later):');
  for (const [label, aircraft, assists, height, off] of [['f16', F16, F16.assists, 5000, 50], ['Cessna test copy', TIGHT, C172X.assists, 3000, 20]]) {
    const r = offSpeed(module, aircraft, assists, height, off, 400, 5);
    const swings = r.peaks.filter((p) => p.off > 1).slice(0, 5);
    const period = (2 * (swings.at(-1).seconds - swings[0].seconds)) / (swings.length - 1);
    const left = (swings.at(-1).off / swings[0].off) ** (2 / (swings.length - 1));
    say(`  ${label}: one swing takes ${period.toFixed(0)} s, and ${(left * 100).toFixed(0)}% of it is left one swing later`);
  }

  say('The lean: the stick for level flight at each speed, and the most g from full back stick there (Wings\' F-4C: 16% forward at 450 kt, 36% at 600):');
  for (const [aircraft, speeds] of [[C172X, [60, 70, 80, 100, 120]], [F16, [200, 250, 350, 450, 600]]]) {
    for (const speed of speeds) {
      const flight = inTheAir(module, aircraft, { heightFt: aircraft.assists.trim.heightFt, knots: speed });
      const stick = flight.trimmed.pitch;
      let most = 0;
      run(flight, 4, () => { flight.fly({ pitch: 1, roll: flight.trimmed.roll + 0.3 * wingsLevel(flight) }); most = Math.max(most, flight.value('accelerations/Nz')); });
      say(`  ${aircraft.model} at ${speed} kt: ${(Math.abs(stick) * 100).toFixed(1)}% ${stick >= 0.0005 ? 'back' : stick <= -0.0005 ? 'forward' : '(neutral)'}; full back stick ${most.toFixed(1)} g`);
      flight.dispose();
    }
  }

  say('The Cessna\'s rolls with four kinds of feet (sideslip at most, degrees): the plan\'s rolls, then a rougher pilot who holds the stick full to 30 degrees and reverses with no pause:');
  const laws = [
    ['no feet', () => 0],
    ['FlightGear\'s (rudder is half the aileron)', (air) => 0.5 * air.roll],
    ['opengeo-sim\'s (rudder against sideslip)', (air) => clamp(air.beta / ((12 * Math.PI) / 180), -1, 1)],
    ['Wings\', the game\'s (sideslip, a second ahead)', wingsFeet],
  ];
  for (const [label, law] of laws) {
    const cells = [];
    for (const speed of [70, 100]) {
      const assists = { ...C172X.assists, feet: { ...C172X.assists.feet, law } };
      cells.push(`${speed} kt: ${rolls(module, C172X, { heightFt: 3000, knots: speed }, assists).peak.toFixed(1)} and ${rolls(module, C172X, { heightFt: 3000, knots: speed }, assists, { harsh: true }).peak.toFixed(1)}`);
    }
    say(`  ${label.padEnd(46)} ${cells.join('; ')}`);
  }
  say('The F-16\'s own feet in the same rolls (the game writes it no rudder):');
  for (const speed of [200, 350, 500]) {
    const r = rolls(module, F16, { heightFt: 5000, knots: speed }, F16.assists, { holdHeight: true });
    say(`  f16 at ${speed} kt: sideslip ${r.peak.toFixed(1)} deg at most in the rolls; in the steady turn ${r.steady.toFixed(1)} deg, ball ${r.ball.toFixed(2)} g`);
  }

  say('The Cessna\'s takeoff roll, by what steers it (furthest from the centreline):');
  say(`  nothing: ${takeoffRoll(module, C172X, null).off.toFixed(0)} ft; the rudder alone: ${takeoffRoll(module, C172X, { ...C172X.assists, steer: { rudder: C172X.assists.steer.rudder } }).off.toFixed(0)} ft; the rudder and the wheel brakes (the game's): ${takeoffRoll(module, C172X).off.toFixed(1)} ft`);

  say('Taxi: the turn at about 10 kt with the stick held full over:');
  for (const aircraft of [C172X, F16]) {
    const flight = Flight.start(module, aircraft);
    let turned = 0, time = 0, speedSum = 0;
    run(flight, 40, (t) => {
      const kt = flight.value('velocities/vg-fps') / 1.6878;
      flight.fly({ brake: false, throttle: clamp(0.3 + 0.3 * (10 - kt), 0, 1), roll: t > 15 ? 1 : 0 });
      if (t > 25) { turned += flight.value('velocities/r-rad_sec') * DT; time += DT; speedSum += kt * DT; }
    });
    const speed = speedSum / time, rate = turned / time;
    say(`  ${aircraft.model}: at ${speed.toFixed(0)} kt it turns ${(rate * DEG).toFixed(1)} deg a second, a circle ${Math.abs(rate) > 1e-4 ? ((2 * speed * 1.6878) / Math.abs(rate)).toFixed(0) : 'without end'} ft across`);
    flight.dispose();
  }

  say('Hands off from level flight at the neutral speed: how long the wings stay within 10 degrees of level:');
  for (const aircraft of [C172X, F16]) {
    const { trim } = aircraft.assists;
    const flight = inTheAir(module, aircraft, { heightFt: trim.heightFt, knots: trim.knots });
    flight.fly({ pitch: 0, roll: 0 });
    let left = null;
    run(flight, 600, (t) => { if (Math.abs(bank(flight)) > 10) { left = t; return false; } return true; });
    say(`  ${aircraft.model}: ${left === null ? 'all of ten minutes' : `${left.toFixed(0)} s`}`);
    flight.dispose();
  }
});
