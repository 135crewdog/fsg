// The flight on screen: the field, the sky and the airplane, drawn on a canvas from the states the Worker
// sends. New in FSG, milestone 2, after 135crewdog/wings, src/flight.js, commit 557a8d0: the renderer, the
// fit to the screen, the look-around and the rule "draw only while something is moving" are Wings' (Rage's
// before it). Wings flew its own simulation here, on the page, and drew between its last two steps. FSG's
// flies in a Worker (src/fdm.js), so the picture is drawn between the states that arrive, by its own clock
// (src/render/between.js).

import * as THREE from 'three';
import { C172P } from './sim/aircraft/c172p.js';
import { FIELD, FT, toWorld } from './sim/world.js';
import { focalLength } from './hud.js';
import { createVsi, instrumentReader } from './instruments.js';
import { attachLook, createLook } from './input/look.js';
import { createAircraft } from './render/aircraft.js';
import { createBetween } from './render/between.js';
import { createChaseCamera } from './render/camera.js';
import { attitude, blend, poseReader, toPicture } from './render/frames.js';
import { surfaceReader } from './render/surfaces.js';
import { FAR, createWorld } from './render/world.js';

const DEG = Math.PI / 180, KT = 1.6878;
const WHEELS = ['wheel_nose', 'wheel_left', 'wheel_right'];
const MOST_MS = 250;   // the picture's delay is counted in whole milliseconds up to this

/**
 * Puts the flight on a canvas: `aircraft` (src/sim/aircraft/) on `field`. Until a flight has begun the
 * airplane stands parked on the numbers, from the aircraft's settings.
 * Returns {
 *   ready             resolves when the airplane's model has loaded
 *   began(start)      a new flight: `start` is the Worker's reply to "fly". It is shown standing still
 *   state(message)    a state from the Worker; one of an earlier flight is dropped
 *   fly()             time runs: the picture moves, and every frame is drawn
 *   hold()            time stands still (the pause screen): the picture stays as it is
 *   redraw()          something outside the flight changed what is drawn (the HUD's switch): draw again
 *   status()          what is on screen and how it is running, for the debug overlay and the browser checks
 * }
 * `onReadout(reading, project, view)` is called every frame drawn once a flight has begun, for the HUD (as in
 * Wings): the newest state's readings (src/instruments.js, with `vsi`, the smoothed climb rate, and `jet`);
 * `project`, which puts a north, east, down direction on the screen as the camera sees it; and the view:
 * { looking, yaw, pitch, focal }, how far it is swung and the camera's focal length in px.
 */
export function startFlight(canvas, aircraft = C172P, field = FIELD, { onReadout } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  const scene = new THREE.Scene();
  const world = createWorld(scene, renderer, field);
  const airplane = createAircraft(aircraft.glb);
  scene.add(airplane);
  const chase = createChaseCamera(FAR);
  const look = createLook();   // a finger dragged across the view looks around; let go and the view comes back
  const between = createBetween();
  const groundY = field.heightFt * FT;

  // Before any flight: parked on the numbers, on the runway's heading, its centre of gravity as high and its
  // nose as far up as JSBSim stands it (tests/c172p.test.js holds the settings to JSBSim's own figures).
  const { north, east, headingDeg } = field.start;
  airplane.position.set(...toPicture([north, east, -(field.heightFt + aircraft.standingFt) * FT]));
  airplane.quaternion.set(...attitude(headingDeg * DEG, aircraft.standingPitchDeg * DEG, 0));

  // ---- the flight being shown ----
  let flight = 0, read = null, surfaces = null, at = null, newest = null, flying = false, loaded = false;
  let instruments = null, reading = null;
  const vsi = createVsi();
  // How it is running, over the whole flight: for the debug overlay. The worst of each number is kept
  // from Fly until a new flight begins, across any pause, so a slow stretch cannot be lost from a screenshot.
  // `warm` counts the half seconds since time was last let go: the first second after that is not counted.
  const fresh = () => ({ states: 0, missing: 0, outOfOrder: 0, lastN: 0, steps: 0, seconds: 0, lastSeconds: null, dropped: 0,
    fps: 0, leastFps: Infinity, frameCount: 0, frameSince: null, warm: 0, behind: new Uint32Array(MOST_MS + 1), behindCount: 0, behindNow: 0, behindMost: 0 });
  let run = fresh();

  const began = (start) => {
    flight = start.flight;
    read = poseReader(start.stateNames);
    surfaces = surfaceReader(aircraft.surfaces, start.stateNames);
    instruments = instrumentReader(start.stateNames, aircraft.standingFt);
    vsi.set(instruments(start.state).climb);
    const index = (name) => start.stateNames.indexOf(name);
    at = { time: index('simulation/sim-time-sec'), lat: index('position/lat-geod-rad'), lon: index('position/long-gc-rad'), agl: index('position/h-agl-ft'),
      heading: index('attitude/psi-rad'), knots: index('velocities/vc-kts'), vn: index('velocities/v-north-fps'), ve: index('velocities/v-east-fps'),
      wheels: start.stateNames.map((name, i) => (/^gear\/unit\[\d+\]\/WOW$/.test(name) ? i : -1)).filter((i) => i >= 0) };
    newest = { state: start.state, propellerRpm: start.propellerRpm, ended: null, totalSteps: 0 };
    between.reset();
    between.push(start.state[at.time], start.state);
    between.hold(true);
    flying = false;
    run = fresh();
    chase.reset();
    look.reset();
    wake();
  };
  const state = (message) => {
    if (message.flight !== flight) return;   // a state of the flight before a restart
    if (message.n === run.lastN + 1 || run.lastN === 0) run.states++;
    else if (message.n > run.lastN) { run.states++; run.missing += message.n - run.lastN - 1; } else run.outOfOrder++;
    run.lastN = Math.max(run.lastN, message.n);
    // Steps a second, by the Worker's own clock, over the time it was running: the gap that spans a hold is left out.
    if (run.lastSeconds !== null) { run.steps += message.steps; run.seconds += message.seconds - run.lastSeconds; }
    run.lastSeconds = message.seconds;
    run.dropped = message.droppedSeconds;
    newest = message;
    between.push(message.state[at.time], message.state);
  };

  // Where a north, east, down direction falls on the screen, as the camera sees it: for the HUD's conformal
  // symbols (Wings' way).
  const projected = new THREE.Vector3();
  const project = (ned) => {
    const [x, y, z] = toPicture(ned), from = chase.camera.position;
    projected.set(from.x + x * 10000, from.y + y * 10000, from.z + z * 10000).project(chase.camera);
    return { x: ((projected.x + 1) / 2) * canvas.clientWidth, y: ((1 - projected.y) / 2) * canvas.clientHeight, visible: projected.z < 1 };
  };

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

  // Draw only while the app is on screen, and only while something is moving: in flight, every frame;
  // otherwise a few frames after anything changes, then rest, so a paused game costs the battery nothing.
  // One loop at most: a frame still waiting when the app is hidden is cancelled, so coming back never starts
  // a second loop beside it.
  const SETTLE = 30;   // frames drawn after a change: the camera eases in, and iOS can report a new size late
  let last = null, waiting = null, settle = SETTLE, frames = 0, withModel = 0;
  const pose = { position: [0, 0, 0], quaternion: [0, 0, 0, 1] };
  const draw = (time) => {
    const elapsed = last === null ? 0 : Math.min((time - last) / 1000, 0.25);
    last = time;
    if (read) {
      // The picture's clock says which moment to draw; the airplane is put between the two states either side of it.
      const pictureTime = between.advance(flying ? elapsed : 0), sample = between.sample();
      const shown = sample.before === sample.after ? read(sample.after) : blend(read(sample.before), read(sample.after), sample.fraction);
      pose.position = shown.position; pose.quaternion = shown.quaternion;
      airplane.position.set(...shown.position);
      airplane.quaternion.set(...shown.quaternion);
      // Its moving parts and its propeller are the newest state's: they are not blended.
      airplane.set(surfaces(newest.state));
      airplane.propeller(newest.propellerRpm ?? 0, flying ? elapsed : 0);
      if (flying) {
        // For the overlay: frames a second by the half second, and how far the picture is behind the newest state.
        run.frameSince ??= time;
        run.frameCount++;
        if (time - run.frameSince >= 500) {
          run.fps = (run.frameCount * 1000) / (time - run.frameSince);
          if (run.warm++ >= 2) run.leastFps = Math.min(run.leastFps, run.fps);   // after the first second: the start is not the running
          run.frameCount = 0; run.frameSince = time;
        }
        const behind = Math.max(0, (newest.state[at.time] - pictureTime) * 1000);
        run.behindNow = behind;
        if (run.warm >= 2) { run.behind[Math.min(MOST_MS, Math.round(behind))]++; run.behindCount++; run.behindMost = Math.max(run.behindMost, behind); }
      }
    }
    fit();   // every frame: iOS can report the new size late after a rotation
    look.update(elapsed);
    chase.update(airplane.position, airplane.quaternion, elapsed, groundY, 0, look);
    world.follow(chase.camera);
    renderer.render(scene, chase.camera);
    if (instruments) {
      // The HUD reads the newest state, like the moving parts; its symbols are laid on the view just drawn.
      reading = instruments(newest.state);
      reading.vsi = vsi.toward(reading.climb, flying ? elapsed : 0);
      reading.jet = aircraft.jet === true;
      onReadout?.(reading, project, { looking: look.active, yaw: look.yaw, pitch: look.pitch, focal: focalLength(chase.camera.fov, canvas.clientHeight) });
    }
    frames++;
    if (loaded) withModel++;
    settle = flying ? SETTLE : settle - 1;
    waiting = settle > 0 ? requestAnimationFrame(draw) : null;
    if (waiting === null) last = null;   // resting: the next frame starts the clock afresh
  };
  // Something changed: draw again for a moment, even at rest.
  function wake() {
    settle = SETTLE;
    if (waiting === null && !document.hidden) waiting = requestAnimationFrame(draw);
  }
  const restart = () => {
    if (waiting !== null) cancelAnimationFrame(waiting);
    waiting = null;
    last = null;
    wake();
  };
  document.addEventListener('visibilitychange', restart);
  // A new size, a turned phone, or the model arriving all change the picture.
  new ResizeObserver(wake).observe(canvas);
  for (const type of ['resize', 'orientationchange']) window.addEventListener(type, wake);
  attachLook(canvas, look, () => flying);
  const ready = airplane.ready.then(() => {
    chase.frame(airplane.size);
    loaded = true;
    wake();
  });
  restart();

  const box = new THREE.Box3(), nose = new THREE.Vector3();
  return {
    ready, began, state,
    redraw: wake,
    fly() {
      flying = true;
      between.hold(false);
      // The flight's numbers carry on. Only the clocks start afresh: the gap in the Worker's clock across the
      // hold is not time it was running, and the first second after letting go is not counted.
      Object.assign(run, { lastSeconds: null, frameSince: null, frameCount: 0, warm: 0 });
      look.reset();
      wake();
    },
    hold() {
      flying = false;
      between.hold(true);
      look.release();
      wake();
    },
    /** For the debug overlay and the browser checks. Angles in degrees, distances in feet. */
    status() {
      // `frames` counts every frame drawn; `withModel`, those drawn since the airplane's model arrived.
      const out = { loaded, frames, withModel, resting: waiting === null, flying, flight, draws: renderer.info.render.calls, triangles: renderer.info.render.triangles };
      if (loaded) {
        airplane.updateMatrixWorld(true);
        // How far each tyre's lowest point is above the runway, inches; and which way the nose points (x east, y up, z south).
        out.wheelsIn = WHEELS.map((name) => (box.setFromObject(airplane.getObjectByName(name)).min.y - groundY) / 0.0254);
        out.nose = nose.set(0, 0, -1).applyQuaternion(airplane.quaternion).toArray();
        out.sizeM = airplane.size;
        out.camera = chase.camera.position.toArray();
        out.propellerTurn = airplane.getObjectByName('propeller')?.rotation.z ?? null;
        out.discShown = airplane.getObjectByName('propeller_disc')?.visible ?? null;
      }
      if (newest) {
        const s = newest.state, place = toWorld(s[at.lat], s[at.lon]);
        let count = 0, within = 0;   // 99 frames in 100 are no further behind than this
        for (; within <= MOST_MS; within++) { count += run.behind[within]; if (count >= run.behindCount * 0.99) break; }
        Object.assign(out, {
          time: s[at.time], pictureTime: between.time, northFt: place.north / FT, eastFt: place.east / FT, aboveGroundFt: s[at.agl], headingDeg: s[at.heading] / DEG, knots: s[at.knots],
          groundKt: Math.hypot(s[at.vn], s[at.ve]) / KT, wheelsDown: at.wheels.filter((i) => s[i] === 1).length, propellerRpm: newest.propellerRpm, surfaces: surfaces(s), ended: newest.ended,
          states: run.states, missing: run.missing, outOfOrder: run.outOfOrder, steps: run.steps, seconds: run.seconds, stepsPerSecond: run.seconds > 0 ? run.steps / run.seconds : 0, droppedSeconds: run.dropped,
          fps: run.fps, leastFps: Number.isFinite(run.leastFps) ? run.leastFps : 0, behindMs: run.behindNow, behindWithinMs: run.behindCount ? within : 0, behindMostMs: run.behindMost,
          look: { yaw: look.yaw, pitch: look.pitch },
          reading,
        });
      }
      return out;
    },
  };
}
