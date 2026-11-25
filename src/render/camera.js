// The chase camera: behind and a little above the airplane, turning with it
// a beat late, so the airplane stays upright on screen and the horizon tilts.
// A look-around (src/input/look.js) swings it around the airplane.
// After 135crewdog/wings, src/render/camera.js, commit 557a8d0 (itself after Rage's). Changed for FSG: the
// distances are in airplane sizes, not metres, so one rule frames a Cessna and a Phantom alike. They are
// Wings' own view of its 17.7 m F-4C (21 m behind, 4.2 above, looking 18 m ahead and 3.2 above), divided out.
// An airplane's size is the larger of its length and its span: the F-4C is longer than it is wide, the
// Cessna wider than it is long, and framed by its length alone its tail fell off the bottom of the screen.

import * as THREE from 'three';

const F4C = 17.7;                                   // m: the airplane Wings' distances were set for
const BEHIND = 21 / F4C, ABOVE = 4.2 / F4C;         // airplane sizes from the airplane's centre of gravity
const AHEAD = 18 / F4C, AIM_ABOVE = 3.2 / F4C;      // where it looks: ahead of the airplane, so the airplane sits low on screen
const LAG = 0.12;                  // s: how late the camera follows a change of attitude
const CLEAR = 1.2;                 // m: the camera never goes lower than this above the ground
const NEAR = 0.5;                  // m: the nearest thing it draws (Wings had 1 m, behind a jet twice as far off)

const DEG = Math.PI / 180;
const SHAKE = 0.14;                // m: how far buffet moves the camera at its worst

/**
 * Returns { camera, reset(), update(position, quaternion, dt, groundY, buffet, look) }.
 * `buffet` (0 none to 1 stalled) shakes the camera, as the airframe shakes
 * near the stall. The shake is after Rage's: a few fast sine waves, so it
 * looks rough but is the same on every phone. `look` is the look-around:
 * { yaw, pitch } in degrees, positive left and up, in the airplane's frame.
 * `far` is how far it sees (metres): as far as the haze lets it. `size` is the airplane's, in metres (the
 * larger of its length and span), and can be set again when the model has loaded.
 */
export function createChaseCamera(far, size = F4C) {
  const camera = new THREE.PerspectiveCamera(55, 1, NEAR, far);
  const q = new THREE.Quaternion(), offset = new THREE.Vector3(), aim = new THREE.Vector3(), shake = new THREE.Vector3();
  const turned = new THREE.Quaternion(), swing = new THREE.Quaternion(), euler = new THREE.Euler();
  let first = true, t = 0;
  return {
    camera,
    /** The airplane's size, metres: the camera stands off in proportion. */
    frame(metres) { size = metres; first = true; },
    /** The next update snaps to the airplane instead of easing: for a new flight. */
    reset() { first = true; },
    update(position, quaternion, dt, groundY, buffet = 0, look = { yaw: 0, pitch: 0 }) {
      q.slerp(quaternion, first ? 1 : 1 - Math.exp(-dt / LAG));
      first = false;
      turned.copy(q).multiply(swing.setFromEuler(euler.set(look.pitch * DEG, look.yaw * DEG, 0, 'YXZ')));
      camera.position.copy(position).add(offset.set(0, ABOVE * size, BEHIND * size).applyQuaternion(turned));
      t += dt;
      if (buffet > 0) {
        shake.set(Math.sin(t * 61.3) + 0.5 * Math.sin(t * 97.1), Math.sin(t * 73.7 + 1.3) + 0.5 * Math.sin(t * 113.9), Math.sin(t * 53.1 + 2.1));
        camera.position.add(shake.multiplyScalar(SHAKE * buffet * buffet).applyQuaternion(q));
      }
      camera.position.y = Math.max(camera.position.y, groundY + CLEAR);
      camera.up.set(0, 1, 0).applyQuaternion(turned);
      camera.lookAt(aim.set(0, AIM_ABOVE * size, -AHEAD * size).applyQuaternion(turned).add(position));
    },
  };
}
