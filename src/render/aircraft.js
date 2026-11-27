// The airplane on screen. Any model built to docs/models.md works: the app knows no airplane's hinges, only
// the named motions a model carries, each one second long, where the time is the position.
// After 135crewdog/wings, src/render/aircraft.js, commits 557a8d0 and, for its afterburner plumes, commit 6d689b7
// (itself after Rage's). Changed for FSG: the aircraft's settings are handed in (src/sim/aircraft/), with its
// model's file and its plumes; each plume is lit by its own engine's afterburner, as JSBSim gives it, where
// Wings lit all of them from one number; Wings' map silhouette is left out until Hawaii needs it; and a
// propeller is turned, as docs/models.md has it.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createPlume } from './plume.js';

const FT = 0.3048;

/**
 * Returns the airplane's group at once, empty until the model at `aircraft.glb` has loaded; `ready` resolves with the
 * group when it has, and `size` is then the larger of the model's length and span, in metres (the chase
 * camera stands off by it).
 * `set({ flaps, elevator, aileron, rudder, gear })` puts each motion the model has at a position from 0 to 1:
 * gear and flaps from up to down; the controls from full forward or left, through neutral at 0.5, to full
 * back or right. Motions left out stay where they are; one the model lacks (a fixed gear) is passed over.
 * `shown()` reads the motions back from the model: where each one it has stands, 0 to 1 (for the browser checks).
 * `propeller(rpm, dt)` turns the propeller, if it has one, for a frame `dt` seconds long.
 * `burner(afterburners, dt)` lights the plume at each engine's exit (the settings' `plumes`) from what that
 * engine's afterburner gives, in the engines' order: 0 at dry power, up to 1 at full afterburner. `plumes` is
 * the plumes themselves (src/render/plume.js), for what they show. An airplane with no plumes has none.
 */
export function createAircraft(aircraft) {
  const airplane = new THREE.Group();
  // Feet in body axes (forward, right, down) to metres in the model's (right, up, aft), as Wings has it.
  const model = ([x, y, z]) => [y * FT, -z * FT, -x * FT];
  const { exits = [], radiusFt = 0, flame = null } = aircraft.plumes ?? {};
  const plumes = exits.map((at) => createPlume(model(at), radiusFt * FT, flame));
  for (const plume of plumes) airplane.add(plume.mesh);
  airplane.plumes = plumes;
  airplane.burner = (afterburners, dt) => { plumes.forEach((plume, k) => plume.update(afterburners?.[k] ?? 0, dt)); };
  const actions = {};
  let mixer = null, hub = null, blades = null, disc = null;
  airplane.size = 0;
  airplane.ready = new GLTFLoader().loadAsync(aircraft.glb).then((gltf) => {
    mixer = new THREE.AnimationMixer(gltf.scene);
    for (const clip of gltf.animations) {
      const action = mixer.clipAction(clip);
      action.play();
      action.paused = true;   // the app sets the time; nothing plays by itself
      actions[clip.name] = action;
    }
    // Drawn after the runway, which lies in the ground's own plane and is drawn in order, not by depth. The
    // order is set on every part: a model is groups within groups, and each group would start the order afresh.
    gltf.scene.traverse((part) => { part.renderOrder = 2; });
    hub = gltf.scene.getObjectByName('propeller') ?? null;
    blades = gltf.scene.getObjectByName('propeller_blades') ?? null;
    disc = gltf.scene.getObjectByName('propeller_disc') ?? null;
    if (disc) disc.traverse((part) => { if (part.material) { part.material.transparent = true; part.material.depthWrite = false; part.renderOrder = 3; } });
    // Measured before it joins the airplane's group, which may already be turned: nose to tail is the model's
    // own z, wingtip to wingtip its x.
    const box = new THREE.Box3().setFromObject(gltf.scene);
    airplane.size = Math.max(box.max.z - box.min.z, box.max.x - box.min.x);
    airplane.add(gltf.scene);
    airplane.set({ gear: 1, flaps: 0, elevator: 0.5, aileron: 0.5, rudder: 0.5 });
    airplane.propeller(0, 0);
    return airplane;
  });
  airplane.set = (positions) => {
    if (!mixer) return;
    for (const [name, position] of Object.entries(positions)) {
      const action = actions[name];
      // Just short of the end: at exactly its duration a clip wraps round to its start.
      if (action) action.time = Math.min(Math.max(position, 0), 1) * action.getClip().duration * 0.999999;
    }
    mixer.update(0);
  };
  airplane.shown = () => Object.fromEntries(Object.entries(actions).map(([name, action]) => [name, action.time / action.getClip().duration]));
  // The propeller, as FlightGear draws its Cessna's (c172p-team, Models/c172p.xml): the solid blades below
  // 500 RPM, turning at the engine's speed; the blurred disc above 400, more see-through the faster it
  // turns (up to half), and drifting round slowly, a thousandth of the real speed, so it does not strobe.
  // Clockwise seen from the cockpit: backwards about the hub's own Z axis, which points aft.
  airplane.propeller = (rpm, dt) => {
    if (!hub) return;
    const fast = rpm > 400, solid = rpm < 500;
    if (blades) blades.visible = solid;
    if (disc) {
      disc.visible = fast;
      disc.traverse((part) => { if (part.material) part.material.opacity = 1 - Math.min(0.5, rpm * 0.0004); });
    }
    hub.rotation.z -= (rpm / 60) * 2 * Math.PI * dt * (solid ? 1 : 0.001);
  };
  return airplane;
}
