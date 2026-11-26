// After 135crewdog/wings, models/measure.mjs, commit 6d689b7. Changed for FSG (milestone 3, pull request 4):
// FSG has no airplane "card", so the numbers go to the author of the airplane's JSBSim file (aircraft/);
// nothing is rounded until it is printed; and the engines' exits are found here (Wings measured them by hand).
//
// Where a model has the things its JSBSim file must agree with: its three wheels, the middle of each engine's
// exit, the middle of its open speedbrake panels, the points of its airframe that reach the ground first with
// the gear up, and whatever else hangs lowest with the gear down, at any attitude it might arrive in. In feet
// from the model's origin (the centre of gravity), in body axes: [forward, right, down].
// tests/model.test.js checks an aircraft file's wheels and thrust points against these.

import { readGlb, worldMatrices, verticesUnder, bounds, poseOf } from './glb.mjs';

const FT = 0.3048;
// Model axes are nose -Z, right +X, up +Y, in metres; body axes are x forward, y right, z down, in feet.
const body = ([x, y, z]) => [-z / FT, x / FT, -y / FT];
const roots = (json) => json.scenes[json.scene ?? 0].nodes;

export function contactPoints(glb) {
  const { json } = glb;
  const named = (name) => {
    const index = json.nodes.findIndex((n) => n.name === name);
    if (index < 0) throw new Error(`the model has no part named ${name}`);
    return index;
  };
  const all = (world) => roots(json).flatMap((root) => verticesUnder(glb, root, world));
  // Controls centred and flaps up, with the gear down and then up. (A fixed-gear model has no gear motion: the two are the same.)
  const down = worldMatrices(json, poseOf(glb, { gear: 1 })), up = worldMatrices(json, poseOf(glb, { gear: 0 }));
  // A wheel touches along the bottom of its tyre: under its middle, and as
  // wide as the tyre (or the pair of tyres) is.
  const wheel = (name) => {
    const box = bounds(verticesUnder(glb, named(name), down));
    return { at: [(box.min[0] + box.max[0]) / 2, box.min[1], (box.min[2] + box.max[2]) / 2], width: box.max[0] - box.min[0] };
  };
  const measured = { nose: wheel('wheel_nose'), left: wheel('wheel_left'), right: wheel('wheel_right') };
  const wheels = {}, tyres = {}, corners = [];
  for (const [name, w] of Object.entries(measured)) {
    wheels[name] = body(w.at);
    tyres[name] = w.width / FT;
    for (const side of [-1, 1]) corners.push([-w.at[2], w.at[0] + (side * w.width) / 2, -w.at[1]]);
  }
  const airframe = firstToTouch(all(up));
  // With the gear down, legs and doors hang below the airframe too: whatever
  // touches first then, that the tyres and the airframe points don't already cover.
  const known = [...airframe, ...corners];
  const gear = firstToTouch(all(down), known).filter((p) => !known.includes(p));
  return { wheels, tyres, exits: engineExits(glb), speedbrake: speedbrakeAt(glb), airframe: airframe.map(feet), gear: gear.map(feet) };
}

/**
 * Where the speedbrakes' drag acts: the middle of every part the
 * `speedbrake` motion moves, with them fully open, on the centreline (the
 * panels come in pairs, so their side forces cancel). Feet from the centre
 * of gravity, body axes. Null for a model with no speedbrakes.
 */
export function speedbrakeAt(glb) {
  const { json } = glb;
  const motion = json.animations?.find((a) => a.name === 'speedbrake');
  if (!motion) return null;
  const open = worldMatrices(json, poseOf(glb, { speedbrake: 1 }));
  const parts = [...new Set(motion.channels.map((c) => c.target.node))];
  const points = parts.flatMap((part) => verticesUnder(glb, part, open));
  const mean = [0, 1, 2].map((k) => points.reduce((sum, p) => sum + p[k], 0) / points.length);
  const [x, , z] = body(mean);
  return [x, 0, z];
}

/**
 * The engines' exits, left to right: for each, the middle of the opening ({ at }, feet from the centre of
 * gravity, body axes) and the opening's radius ({ radius }, feet). New in FSG. docs/models.md asks for nothing
 * named: an exit is found by its shape, as the rear end of an open pipe:
 *   - a round rim: at least 12 points of the skin at one station, all within 6 cm of one circle (a nozzle's
 *     lip has an inner and an outer edge), the opening at least 15 cm in radius;
 *   - open at the back: nothing of the airplane inside the opening for the first metre behind it (Wings'
 *     rule for its plumes: the flame comes out into open air);
 *   - a pipe, not a cap or a cone: nothing inside the opening for the half metre ahead of it either.
 * An airplane with no jet engine has none.
 */
const STATION = 0.01, LINK = 0.2, LIP = 0.06, SMALLEST = 0.15;   // m
export function engineExits(glb) {
  const { json } = glb;
  const world = worldMatrices(json, poseOf(glb));
  const skin = roots(json).flatMap((root) => verticesUnder(glb, root, world));
  const stations = new Map();
  for (const p of skin) { const k = Math.round(p[2] / STATION); (stations.get(k) ?? stations.set(k, []).get(k)).push(p); }
  const exits = [];
  for (const points of stations.values()) {
    if (points.length < 12) continue;
    // The rims at this station: points joined to their neighbours (within 20 cm of one another).
    const left = [...points];
    while (left.length) {
      const rim = [left.pop()];
      for (let i = 0; i < rim.length; i++) for (let j = left.length - 1; j >= 0; j--) if (Math.hypot(left[j][0] - rim[i][0], left[j][1] - rim[i][1]) < LINK) rim.push(...left.splice(j, 1));
      if (rim.length < 12) continue;
      const box = bounds(rim), cx = (box.min[0] + box.max[0]) / 2, cy = (box.min[1] + box.max[1]) / 2, cz = (box.min[2] + box.max[2]) / 2;
      const out = rim.map((p) => Math.hypot(p[0] - cx, p[1] - cy)), radius = Math.min(...out);
      if (radius < SMALLEST || Math.max(...out) - radius > LIP) continue;
      const inside = (from, to) => skin.some((p) => p[2] > cz + from && p[2] < cz + to && Math.hypot(p[0] - cx, p[1] - cy) < radius * 0.8);
      if (inside(0.05, 1) || inside(-0.5, -0.05)) continue;
      exits.push({ at: body([cx, cy, cz]), radius: radius / FT });
    }
  }
  return exits.sort((a, b) => a.at[1] - b.at[1]);
}

const feet = (p) => p.map((v) => v / FT);
const DEG = Math.PI / 180;

/** How far below the centre of gravity a body-axes point hangs with the airplane pitched and rolled (radians). */
export const depth = ([x, y, z], pitch, roll) => -Math.sin(pitch) * x + Math.cos(pitch) * (Math.sin(roll) * y + Math.cos(roll) * z);

// The attitudes an airplane might meet the ground in: nose 10 degrees down to
// 20 up, 30 degrees of bank either way.
export const ARRIVALS = [];
for (let pitch = -10; pitch <= 20; pitch += 2.5) for (let roll = -30; roll <= 30; roll += 5) ARRIVALS.push([pitch * DEG, roll * DEG]);

/**
 * The airframe's contact points, in metres in body axes: for each arrival
 * attitude, the point of the skin that hangs lowest. Points within 30 cm
 * of one already chosen (or already `known`) are the same corner; the set is
 * the same both sides.
 */
const RADIUS = 0.3;   // m: points closer together than this are the same corner

export function firstToTouch(skin, known = []) {
  const points = skin.map(([x, y, z]) => [-z, x, -y]);   // model axes to body axes
  const chosen = [...known];
  const near = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < RADIUS;
  for (const [pitch, roll] of ARRIVALS) {
    const low = points.reduce((a, p) => (depth(p, pitch, roll) > depth(a, pitch, roll) ? p : a));
    const p = Math.abs(low[1]) < 0.05 ? [low[0], 0, low[2]] : low;
    if (chosen.some((q) => near(p, q))) continue;
    // A point off the centreline always brings its mirror image, even when
    // the two are close together: the airplane banks both ways.
    chosen.push(p);
    if (p[1] !== 0) chosen.push([p[0], -p[1], p[2]]);
  }
  return chosen.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
}

// Run as a tool, it prints what it measured, to the hundredth of a foot, for the aircraft file's author:
//   node models/measure.mjs models/f4c.glb
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const round = (value) => (typeof value === 'number' ? Math.round(value * 100) / 100 : value);
  console.log('feet from the model\'s origin (the centre of gravity), [forward, right, down]:');
  console.log(JSON.stringify(contactPoints(readGlb(process.argv[2])), (key, value) => round(value), 1).replace(/\[\s+([-\d.]+),\s+([-\d.]+),\s+([-\d.]+)\s+\]/g, '[$1, $2, $3]'));
}
