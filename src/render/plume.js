// An afterburner plume, one per engine: a short flame behind the nozzle, drawn additively, growing with how
// much of the afterburner the engine gives (never the throttle's position, so the light-off lag shows), hidden
// at dry power. After 135crewdog/wings, src/render/plume.js, commit 6d689b7 (itself after Rage's
// src/render/plume.js: two nested cones with shock diamonds along them). Changed for FSG: the flame's look
// is the airplane's setting (the F-4C's J79, Wings' own numbers, is in src/sim/aircraft/f4c.js) and is always
// handed in, so this file knows no airplane; and `shown()` reads back what is drawn, for the tests.
// Model axes: x right, y up, z aft (the nose is along -z).

import * as THREE from 'three';

const vertexShader = `
  varying vec2 vUv;
  varying vec3 vNormalV, vPosV;
  void main() {
    vUv = uv;
    vec4 p = modelViewMatrix * vec4(position, 1.0);
    vPosV = p.xyz;
    vNormalV = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * p;
  }`;

// t runs from the nozzle (0) to the tip (1): the flame fades along it, and
// the diamonds are a standing wave in brightness that fades out with it.
const fragmentShader = `
  uniform vec3 colour;
  uniform float burner, time, core, diamonds, count;
  varying vec2 vUv;
  varying vec3 vNormalV, vPosV;
  void main() {
    float t = vUv.y;
    float fade = pow(1.0 - t, 1.6);
    float wave = 1.0 - diamonds + diamonds * pow(abs(sin(t * count * 3.14159)), 6.0) * (1.0 - t);
    float flicker = 0.92 + 0.08 * sin(time * 71.0 + t * 20.0) * sin(time * 53.0);
    // brighter where the cone is seen through its thickness (near its silhouette)
    float rim = 1.0 - abs(dot(normalize(vNormalV), normalize(-vPosV)));
    float body = mix(0.35, 1.0, rim);
    float a = fade * wave * flicker * mix(body, 1.0, core) * (0.55 + 0.45 * burner);
    gl_FragColor = vec4(colour * a, a);
  }`;

const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide };

// A cone along +z, wide end (the nozzle) at z 0 and narrow end at z 1: scaled to length later.
function cone(radius, material) {
  const geo = new THREE.CylinderGeometry(radius * 0.45, radius, 1, 18, 24, true);
  geo.rotateX(Math.PI / 2);   // the axis from y to z: the narrow top goes to +z
  geo.translate(0, 0, 0.5);   // the wide end at the nozzle
  return new THREE.Mesh(geo, material);
}

/**
 * One plume at a nozzle: `at` its exit's middle and `radius` the opening's, in model axes (metres); `look` the
 * engine's flame (an aircraft's `plumes.flame`, src/sim/aircraft/).
 * Returns { mesh, update(burner, dt), shown() }, burner 0 at dry power, 0..1 through the afterburner;
 * `shown()` is what is drawn: { lit, at, lengthM }, where the flame starts (model axes, metres) and how long it is.
 */
export function createPlume(at, radius, look) {
  const make = (colour, core) => new THREE.ShaderMaterial({
    uniforms: {
      colour: { value: new THREE.Color(colour) }, burner: { value: 0 }, time: { value: 0 },
      core: { value: core }, diamonds: { value: look.diamonds }, count: { value: 3 },
    },
    vertexShader, fragmentShader, ...additive,
  });
  const sheath = cone(radius, make(look.sheath, look.body));
  const inner = cone(radius * 0.6, make(look.core, 1));
  // The nozzle's glowing inside: a disc just inside the exit, facing aft.
  const glow = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.95, 24), new THREE.MeshBasicMaterial({ color: look.glow, ...additive, side: THREE.FrontSide }));
  glow.position.z = -0.05;
  const group = new THREE.Group();
  group.position.set(...at);
  group.add(sheath, inner, glow);
  group.visible = false;
  for (const part of [sheath, inner, glow]) part.renderOrder = 3;   // after the airplane, whose parts are drawn second
  let t = 0;
  return {
    mesh: group,
    update(burner, dt) {
      t += dt;
      group.visible = burner > 0;
      if (!group.visible) return;
      const length = look.minLength + (look.maxLength - look.minLength) * burner;
      sheath.scale.set(1, 1, length);
      inner.scale.set(1, 1, length * look.coreLength);
      glow.material.opacity = 0.5 + 0.5 * burner;
      for (const m of [sheath.material, inner.material]) {
        m.uniforms.burner.value = burner;
        m.uniforms.time.value = t;
        m.uniforms.count.value = 1 + length;   // about one diamond a metre, as on Rage's
      }
    },
    shown: () => ({ lit: group.visible, at: group.position.toArray(), lengthM: group.visible ? sheath.scale.z : 0 }),
  };
}
