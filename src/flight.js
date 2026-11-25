// The picture: the field, the sky and the airplane, drawn on a canvas. New in FSG, milestone 2 (pull request 4),
// after 135crewdog/wings, src/flight.js, commit 557a8d0: the renderer, the fit to the screen and the rule
// "draw only while something is moving" are Wings' (Rage's before it). Wings flew its own simulation here, on
// the page; FSG's flies in a Worker, and joins this file in the next pull request. Until then the airplane
// stands where JSBSim parks it, from the aircraft's settings, and the picture is still.

import * as THREE from 'three';
import { C172P } from './sim/aircraft/c172p.js';
import { FIELD, FT } from './sim/world.js';
import { createAircraft } from './render/aircraft.js';
import { createChaseCamera } from './render/camera.js';
import { attitude, toPicture } from './render/frames.js';
import { FAR, createWorld } from './render/world.js';

const DEG = Math.PI / 180;
const WHEELS = ['wheel_nose', 'wheel_left', 'wheel_right'];

/**
 * Puts the picture on a canvas: `aircraft` (src/sim/aircraft/) parked on the field's numbers.
 * Returns { ready, status() }: `ready` resolves when the model has loaded; `status()` says what was drawn,
 * for the developer's checks (tests/browser/app.chromium.mjs).
 */
export function startPicture(canvas, aircraft = C172P, field = FIELD) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  const scene = new THREE.Scene();
  const world = createWorld(scene, renderer, field);
  const airplane = createAircraft(aircraft.glb);
  scene.add(airplane);
  const chase = createChaseCamera(FAR);
  const groundY = field.heightFt * FT;

  // Parked: on the numbers, on the runway's heading, its centre of gravity as high and its nose as far up as
  // JSBSim stands it (tests/c172p.test.js holds the settings to JSBSim's own figures).
  const { north, east, headingDeg } = field.start;
  airplane.position.set(...toPicture([north, east, -(field.heightFt + aircraft.standingFt) * FT]));
  airplane.quaternion.set(...attitude(headingDeg * DEG, aircraft.standingPitchDeg * DEG, 0));

  const fit = () => {
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (!width || !height) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width === Math.round(width * ratio) && canvas.height === Math.round(height * ratio)) return;
    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height, false);
    chase.camera.aspect = width / height;
    chase.camera.updateProjectionMatrix();
  };

  // Draw only while the app is on screen, and only while something is moving: for now, a few frames after
  // anything changes, then rest, so an app left open costs the battery nothing. One loop at most: a frame
  // still waiting when the app is hidden is cancelled, so coming back never starts a second loop beside it.
  const SETTLE = 30;   // frames drawn after a change: the camera eases in, and iOS can report a new size late
  let last = null, waiting = null, settle = SETTLE, frames = 0, loaded = false, withModel = 0;
  const draw = (time) => {
    const elapsed = last === null ? 0 : Math.min((time - last) / 1000, 0.25);
    last = time;
    fit();   // every frame: iOS can report the new size late after a rotation
    chase.update(airplane.position, airplane.quaternion, elapsed, groundY);
    world.follow(chase.camera);
    renderer.render(scene, chase.camera);
    frames++;
    if (loaded) withModel++;
    settle--;
    waiting = settle > 0 ? requestAnimationFrame(draw) : null;
    if (waiting === null) last = null;   // resting: the next frame starts the clock afresh
  };
  // Something changed: draw again for a moment.
  const wake = () => {
    settle = SETTLE;
    if (waiting === null && !document.hidden) waiting = requestAnimationFrame(draw);
  };
  const run = () => {
    if (waiting !== null) cancelAnimationFrame(waiting);
    waiting = null;
    last = null;
    wake();
  };
  document.addEventListener('visibilitychange', run);
  // A new size, a turned phone, or the model arriving all change the picture.
  new ResizeObserver(wake).observe(canvas);
  for (const type of ['resize', 'orientationchange']) window.addEventListener(type, wake);
  const ready = airplane.ready.then(() => {
    chase.frame(airplane.size);
    loaded = true;
    wake();
  });
  run();

  const box = new THREE.Box3(), nose = new THREE.Vector3();
  return {
    ready,
    status() {
      // `frames` counts every frame drawn; `withModel`, those drawn since the airplane's model arrived.
      const out = { loaded, frames, withModel, resting: waiting === null, draws: renderer.info.render.calls, triangles: renderer.info.render.triangles };
      if (loaded) {
        airplane.updateMatrixWorld(true);
        // How far each tyre's lowest point is above the runway, inches; and which way the nose points (x east, y up, z south).
        out.wheelsIn = WHEELS.map((name) => (box.setFromObject(airplane.getObjectByName(name)).min.y - groundY) / 0.0254);
        out.nose = nose.set(0, 0, -1).applyQuaternion(airplane.quaternion).toArray();
        out.sizeM = airplane.size;
        out.camera = chase.camera.position.toArray();
      }
      return out;
    },
  };
}
