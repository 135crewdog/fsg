// Where the airplane is and how it sits, from JSBSim's state, in the picture's axes. New in FSG, milestone 2,
// after 135crewdog/wings, src/render/frames.js, commit 557a8d0 (the same swap of axes), with JSBSim's
// latitude, longitude, height and three angles where Wings had its own position and quaternion.
//
// JSBSim and the game's world count north, east and down; the picture (Three.js) counts x east, y up and
// z south. A model built to docs/models.md has its nose along -z, its right wing along +x and its top along
// +y, so the same swap serves the airplane's own axes: the quaternion here turns the model as JSBSim has it.
//
// No DOM and no Three.js: positions are [x, y, z] in metres and quaternions [x, y, z, w], as Three.js takes them.
import { FT, toWorld } from '../sim/world.js';

/** North, east, down (metres) to the picture's x, y, z. */
export const toPicture = ([north, east, down]) => [east, -down, -north];

/** Heading, pitch and bank (radians, JSBSim's psi, theta, phi) to the picture's quaternion. */
export function attitude(heading, pitch, bank) {
  const [cy, sy, cp, sp, cr, sr] = [Math.cos(heading / 2), Math.sin(heading / 2), Math.cos(pitch / 2), Math.sin(pitch / 2), Math.cos(bank / 2), Math.sin(bank / 2)];
  // Body to north-east-down: yaw, then pitch, then roll.
  const w = cy * cp * cr + sy * sp * sr, x = cy * cp * sr - sy * sp * cr, y = cy * sp * cr + sy * cp * sr, z = sy * cp * cr - cy * sp * sr;
  return [y, -z, -x, w];   // the same swap of axes as toPicture, on the quaternion's axis
}

/** A vector turned by a quaternion: where a point of the model is in the picture, about the airplane's own position. */
export function turned([qx, qy, qz, qw], [x, y, z]) {
  const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  return [x + qw * tx + qy * tz - qz * ty, y + qw * ty + qz * tx - qx * tz, z + qw * tz + qx * ty - qy * tx];
}

/**
 * Returns a function that reads a pose from a state: { position, quaternion }. `stateNames` is the flight's
 * (the "fly" reply). The position is the airplane's centre of gravity, which is a model's origin.
 */
export function poseReader(stateNames) {
  const at = (name) => {
    const i = stateNames.indexOf(name);
    if (i < 0) throw new Error(`${name} is not in the state`);
    return i;
  };
  const [lat, lon, height, heading, pitch, bank] = ['position/lat-geod-rad', 'position/long-gc-rad', 'position/h-sl-ft', 'attitude/psi-rad', 'attitude/theta-rad', 'attitude/phi-rad'].map(at);
  return (state) => {
    const { north, east } = toWorld(state[lat], state[lon]);
    return { position: toPicture([north, east, -state[height] * FT]), quaternion: attitude(state[heading], state[pitch], state[bank]) };
  };
}

/**
 * The pose a share of the way from one to another: position in a straight line, attitude the short way round
 * the sphere at an even rate (slerp), as Fiedler has it and as Wings drew between its steps.
 */
export function blend(a, b, fraction) {
  const position = a.position.map((x, k) => x + (b.position[k] - x) * fraction);
  let q = b.quaternion, dot = a.quaternion.reduce((sum, x, k) => sum + x * q[k], 0);
  if (dot < 0) { q = q.map((x) => -x); dot = -dot; }   // the same attitude, the near way round
  let wa = 1 - fraction, wb = fraction;
  if (dot < 0.9995) {
    const angle = Math.acos(dot), s = Math.sin(angle);
    wa = Math.sin(wa * angle) / s;
    wb = Math.sin(wb * angle) / s;
  }
  const quaternion = a.quaternion.map((x, k) => wa * x + wb * q[k]), n = Math.hypot(...quaternion);
  return { position, quaternion: quaternion.map((x) => x / n) };
}
