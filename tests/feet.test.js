// The copilot's feet on the ground: milestone 3, pull request 2 (docs/milestones/3.md). Two jobs, three
// controls: the ailerons are always the pilot's tilt; the nosewheel turns the airplane as the tilt asks, less
// with speed; the rudder is the copilot's alone and holds the nose against any swing nobody asked for.
// Flown on JSBSim's `c172p`, whose engine pulls it left at full power. The "done" lines were written before
// any of this was built. Two were wrong as written and are in the pull request: one measured the rudder at a single
// moment (replaced here by taking each control out in turn), the other is reported, not asserted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { C172P } from '../src/sim/aircraft/c172p.js';
import { askedTurn, wheelShare } from '../src/sim/assists.js';
import { DT, Flight } from '../src/sim/game.js';
import { gentle } from '../src/input/pilot.js';
import { FT, toWorld } from '../src/sim/world.js';
import { loadVariant } from '../jsbsim/tests/lib/node.js';

const DEG = 180 / Math.PI, clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const module = await loadVariant('weh');
for (const file of C172P.files) module.writeFile(`/data/${file}`, readFileSync(new URL(`../jsbsim/jsbsim-data/${file}`, import.meta.url)));
const { wheel, hold } = C172P.assists.steer;
/** A 10 degree right tilt, as it is sent: the stick between its dead spot and full throw (src/input/tilt.js), its middle made gentler. */
const TEN_DEGREES = gentle((10 - 1.5) / (30 - 1.5));
/** The Cessna without the copilot's rudder: only its trim and the nosewheel. To see what the rudder adds. */
const NO_RUDDER = { trim: C172P.assists.trim, steer: { wheel } };

/**
 * A takeoff roll from the numbers: full throttle, flaps down, `pilot(c)` giving the roll stick from
 * c = { t, kt, heading (degrees off the runway's), off (ft left of the centreline), steer, level }.
 * Returns what happened while a wheel was on the ground, and what `pilot` noted in `c`.
 */
function roll(pilot, { pitch = 0, throttle = 1, seconds = 80, until = null, assists = C172P.assists } = {}) {
  const f = Flight.start(module, roll.aircraft, { assists }), wheels = [0, 1, 2].map((k) => f.stateNames.indexOf(`gear/unit[${k}]/WOW`));
  const c = {}, box = { w: Infinity, e: -Infinity, s: Infinity, n: -Infinity };
  let off = 0, bank = 0;
  for (let k = 0; k < seconds / DT; k++) {
    const t = k * DT, at = toWorld(f.value('position/lat-geod-rad'), f.value('position/long-gc-rad')), phi = f.value('attitude/phi-rad');
    Object.assign(c, {
      t, kt: f.value('velocities/vc-kts'), heading: f.value('attitude/psi-rad') * DEG - 90, off: at.north / FT, bank: phi * DEG,
      wheelDeg: f.value('fcs/steer-pos-deg'), rudderRightDeg: -f.value('fcs/rudder-pos-rad') * DEG, aileronDeg: f.value('fcs/left-aileron-pos-rad') * DEG,
    });
    c.steer = clamp(-0.5 * c.heading + 0.05 * c.off, -1, 1);                       // a pilot keeping the centreline
    c.level = clamp(-2 * phi - 0.5 * f.value('velocities/p-rad_sec'), -1, 1);      // a pilot holding the wings level
    f.fly({ brake: false, throttle, flaps: true, pitch: c.kt > 50 ? pitch : 0, roll: clamp(pilot(c), -1, 1) });
    assert.equal(f.step(1), 0, 'JSBSim stepped');
    if (t > 30) { box.w = Math.min(box.w, at.east); box.e = Math.max(box.e, at.east); box.s = Math.min(box.s, at.north); box.n = Math.max(box.n, at.north); }
    const onGround = wheels.some((i) => f.state[i] === 1);
    if (t > 1 && onGround) { off = Math.max(off, Math.abs(c.off)); bank = Math.max(bank, Math.abs(c.bank)); }
    if (until && until(c)) break;
    if (throttle === 1 && t > 1 && !onGround) break;
  }
  f.dispose();
  return { ...c, offMost: off, bankMost: bank, circleFt: ((box.e - box.w) + (box.n - box.s)) / 2 / FT };
}
roll.aircraft = C172P;   // one test flies a copy whose roll stick drives no aileron
/** A pilot who keeps the centreline until `kt`, then holds `stick` for `seconds`, then lets go. Notes in `c` where the hold began and how it went. */
const holds = (kt, stick, seconds) => (c) => {
  if (c.began === undefined && c.kt >= kt) Object.assign(c, { began: c.t, heading0: c.heading, wheel0: null, bankHeld: 0 });
  if (c.began === undefined) return c.steer;
  if (c.wheel0 === null && c.t > c.began) c.wheel0 = c.wheelDeg;                    // the nosewheel as the hold begins
  if (c.t < c.began + seconds) { c.bankHeld = Math.max(c.bankHeld, Math.abs(c.bank)); if (c.t >= c.began + seconds / 2 && c.mid === undefined) c.mid = { rudder: c.rudderRightDeg, aileron: c.aileronDeg }; return stick; }
  return 0;
};
const after = (seconds) => (c) => c.began !== undefined && c.t >= c.began + seconds;
const swing = (r) => r.heading - r.heading0;

test('the nosewheel\'s share of the tilt falls smoothly with speed: never rises, and no step larger than 3% of full between one knot and the next', () => {
  let most = 0;
  for (let kt = 0; kt < 120; kt++) {
    const step = wheelShare(kt, wheel) - wheelShare(kt + 1, wheel);
    assert.ok(step >= 0, `it rose between ${kt} and ${kt + 1} knots`);
    most = Math.max(most, step);
  }
  console.log(`  largest step ${(most * 100).toFixed(2)}% of full; the share is ${(wheelShare(10, wheel) * 100).toFixed(0)}% at 10 knots, ${(wheelShare(28, wheel) * 100).toFixed(0)}% at 28, ${(wheelShare(60, wheel) * 100).toFixed(0)}% at 60`);
  assert.ok(most <= 0.03, `${most}`);
  assert.equal(wheelShare(0, wheel), 1);
  assert.ok(wheelShare(10, wheel) >= 0.9 && wheelShare(60, wheel) <= 0.2, 'the nosewheel has 90% or more at 10 knots and 20% or less at 60');
});

test('a 10 degree right tilt held for 3 s at 10 knots: the nose comes right 5 degrees or more, and the nosewheel is doing it', () => {
  const still = TEN_DEGREES * 10;   // the nosewheel's angle for that tilt standing still: this file's nosewheel turns 10 degrees
  const r = roll(holds(10, TEN_DEGREES, 3), { until: after(3) }), bare = roll(holds(10, TEN_DEGREES, 3), { until: after(3), assists: NO_RUDDER });
  console.log(`  the nose comes right ${swing(r).toFixed(1)} degrees (${swing(bare).toFixed(1)} with the rudder left out); the nosewheel is at ${(r.wheel0 / still * 100).toFixed(0)}% of its standing-still angle; bank ${r.bankHeld.toFixed(1)}`);
  assert.ok(swing(r) >= 5, `${swing(r)} degrees`);
  assert.ok(r.wheel0 / still >= 0.9, `the nosewheel at ${r.wheel0} of ${still} degrees`);
  assert.ok(Math.abs(swing(r) - swing(bare)) / swing(bare) < 0.1, `the rudder changes the turn by less than a tenth (${swing(r)} against ${swing(bare)})`);
  assert.ok(r.bankHeld < 3, `bank ${r.bankHeld}`);
});

test('the same tilt at 60 knots: the nose eases right between 1 and 4 degrees, the nosewheel at 20% or less, the ailerons as at 10 knots, bank under 3 degrees', () => {
  const still = TEN_DEGREES * 10;
  const slow = roll(holds(10, TEN_DEGREES, 3), { until: after(3) }), r = roll(holds(60, TEN_DEGREES, 3), { until: after(3) }), none = roll(holds(60, 0, 3), { until: after(3) });
  console.log(`  the nose eases right ${swing(r).toFixed(1)} degrees; the nosewheel is at ${(r.wheel0 / still * 100).toFixed(0)}%; bank ${r.bankHeld.toFixed(1)}; left aileron ${r.mid.aileron.toFixed(2)} degrees down (${slow.mid.aileron.toFixed(2)} at 10 knots)`);
  // The plan's line here read "the rudder is doing it: the rudder is deflected right". Read at one moment in mid-turn it is not:
  // the rudder goes right to start the turn and then eases back, to hold the turn at what the tilt asked. Who does the turning
  // is measured properly in the next test, by taking each control out in turn.
  console.log(`  reported: in mid-turn the rudder is ${r.mid.rudder.toFixed(1)} degrees right, and ${none.mid.rudder.toFixed(1)} with no tilt at all`);
  assert.ok(swing(r) >= 1 && swing(r) <= 4, `${swing(r)} degrees`);
  assert.ok(r.wheel0 / still <= 0.2, `the nosewheel at ${r.wheel0} of ${still} degrees`);
  assert.ok(Math.abs(r.mid.aileron - slow.mid.aileron) < 0.05, 'the ailerons follow the tilt the same at any speed');
  assert.ok(r.bankHeld < 3, `bank ${r.bankHeld}`);
});

test('who turns it: at 60 knots the rudder (with the nosewheel held straight and the ailerons left out, the tilt still brings the nose right 1 degree or more); at 10 knots the nosewheel (held straight, the nose comes right less than a tenth as far)', () => {
  // The tilt reaching only the copilot's feet: the roll stick drives no aileron, and the nosewheel is held straight (sign 0).
  const straight = { ...C172P.assists, steer: { ...C172P.assists.steer, wheel: { ...wheel, sign: 0 } } };
  const FEET_ONLY = { ...C172P, controls: { ...C172P.controls, roll: { to: [] } } };
  const feetOnly = (kt) => {
    const f = (stick) => { const saved = roll.aircraft; roll.aircraft = FEET_ONLY; try { return roll(holds(kt, stick, 3), { until: after(3), assists: straight }); } finally { roll.aircraft = saved; } };
    return swing(f(TEN_DEGREES)) - swing(f(0));
  };
  const all = (kt) => swing(roll(holds(kt, TEN_DEGREES, 3), { until: after(3) })) - swing(roll(holds(kt, 0, 3), { until: after(3) }));
  const noWheel = (kt) => swing(roll(holds(kt, TEN_DEGREES, 3), { until: after(3), assists: straight })) - swing(roll(holds(kt, 0, 3), { until: after(3), assists: straight }));
  const fast = { all: all(60), rudderAlone: feetOnly(60) }, slow = { all: all(10), noWheel: noWheel(10) };
  console.log(`  at 60 knots: all three controls ${fast.all.toFixed(1)} degrees, the rudder alone ${fast.rudderAlone.toFixed(1)}; at 10 knots: all three ${slow.all.toFixed(1)}, with the nosewheel held straight ${slow.noWheel.toFixed(1)}`);
  assert.ok(fast.rudderAlone >= 1, `the rudder alone brings the nose right ${fast.rudderAlone} degrees at 60 knots`);
  assert.ok(Math.abs(slow.noWheel) < 0.1 * slow.all, `with the nosewheel straight at 10 knots: ${slow.noWheel} of ${slow.all} degrees`);
});

test('picking up a wing at 60 knots, 30% right stick for one second: the nose swings 1.5 degrees or less (2.6 before)', () => {
  const r = roll(holds(60, 0.3, 1), { until: after(2) });
  console.log(`  ${swing(r).toFixed(1)} degrees, two seconds after the stick went in`);
  assert.ok(Math.abs(swing(r)) <= 1.5, `${swing(r)} degrees`);
});

test('taxi with the stick full over at a quarter throttle: a circle 84 ft across or less (67 before)', () => {
  const r = roll(() => 1, { throttle: 0.25, seconds: 90 });
  console.log(`  ${r.circleFt.toFixed(0)} ft across`);
  assert.ok(r.circleFt <= 84, `${r.circleFt} ft`);
});

test('held straight against the engine: a takeoff with a 10 degree back tilt, the pilot only holding the wings level, stays within 25 ft of the centreline (49 before); holding the wings and steering a little, within 10 ft and 3 degrees of bank', () => {
  const back = gentle((10 - 2) / (25 - 2));   // a 10 degree back tilt, as it is sent
  const hands = roll((c) => c.level, { pitch: back }), both = roll((c) => c.level + 0.25 * c.steer, { pitch: back });
  console.log(`  hands only: ${hands.offMost.toFixed(1)} ft off the centreline at most, ${hands.bankMost.toFixed(1)} degrees of bank; hands and a quarter of the steering: ${both.offMost.toFixed(1)} ft, ${both.bankMost.toFixed(1)} degrees`);
  assert.ok(hands.offMost <= 25, `${hands.offMost} ft`);
  assert.ok(both.offMost <= 10 && both.bankMost <= 3, `${both.offMost} ft, ${both.bankMost} degrees`);
});

test('reported: the rudder the tilt asks of the copilot, by speed (the plan\'s line that it "never falls until the wheels leave" was wrong)', () => {
  // With no swing at all, the hold's rudder for a given tilt is its weight times its rate times the turn asked for.
  const rows = [];
  for (const kt of [10, 20, 30, 40, 50, 60]) {
    const share = wheelShare(kt, wheel), asked = askedTurn(hold, share, TEN_DEGREES, (TEN_DEGREES * share * 10) / DEG, kt * 1.6878);
    rows.push(`${kt} kt ${((1 - share) ** 2 * hold.rate * asked * 100).toFixed(1)}%`);
  }
  console.log(`  rudder asked for by a 10 degree tilt, of full: ${rows.join(', ')}`);
});
