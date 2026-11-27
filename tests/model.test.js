// Every model in models/ against docs/models.md, and against the JSBSim airplane it is the picture of.
// After 135crewdog/wings, tests/model.test.js, commit 6d689b7, which checked Wings' F-4C against its card.
// Changed for FSG: there is no card, so a model's wheels and engine exits are checked against its JSBSim
// aircraft file, stood in JSBSim (milestone 2, pull request 2, for the Cessna); and every model is checked
// by the rules for its kind, its particulars in the one table below (milestone 3, pull request 4, when the
// owner's F-4C arrived). The "done" lines are in docs/milestones/2.md and 3.md, written before each model
// was brought in.
//
// One of those lines failed, and is kept here on record. It said the Cessna's wing span would be within 2% of a
// real 172P's 36 ft 1 in. FlightGear's wing is 11.32 m across its wingtip lights: 13 inches (2.9%) too wide. The
// length is right within 0.3%. The new line, in the table: the Cessna's span is within 3%.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { bounds, poseAt, poseOf, readAccessor, readGlb, verticesUnder, worldMatrices } from '../models/glb.mjs';
import { engineExits, speedbrakeAt } from '../models/measure.mjs';
import { C172P } from '../src/sim/aircraft/c172p.js';
import { F4C } from '../src/sim/aircraft/f4c.js';
import { Flight } from '../src/sim/game.js';
import { sha256 } from '../tools/from-fdm.mjs';
import { SPEEDBRAKE_PANELS, THRUST_LINE_ABOVE_CG, THRUST_TILT } from './checkride/f4c-reference.js';
import { bytesOf, moduleWith } from './checkride/files.js';

const here = (path) => new URL(`../${path}`, import.meta.url);
const IN = 0.0254, FT = 0.3048, DEG = 180 / Math.PI;

// ---- the models, and what is particular to each ----
// file      the model.
// aircraft  the game's settings for the JSBSim airplane it is the picture of.
// kind      'built' for the game in a model chat, or a 'borrowed' stand-in made for another simulator: the budget differs (below).
// from      if it was copied from an older project: where, as provenance.json has it. The copy must be byte for byte.
// real      the real airplane's length and span, metres, and how close the model must be to each.
// textures  the names of the pictures packed into it.
// keys      how many keys each motion has: 3 is 0, 0.5 and 1 s; 25 is one for every frame at 24 frames a second.
// motions   every motion it must have, and the parts each moves. For each part, where it is at 0 s and at 1 s:
//           [way, degrees]. `degrees` is how far it has turned from where it rests (the real airplane's travel,
//           within 0.5), and `way` is where its moving edge has gone: +1 up (a rudder: right), -1 down (left),
//           0 nowhere. The gear is many parts with no one travel: a list of them.
// leading   the parts whose moving edge is the front one (leading-edge flaps). Every other part's is its trailing edge.
// hinged    the motions whose parts turn about their own leading edge.
// slides    the parts that also slide back as they lower (Fowler flaps).
// leftOut   what a borrowed model must not have brought with it.
// script    the script that made a borrowed model, which holds the numbers it was sat to.
// engines   how many jet engines: the model has that many exits and the aircraft file that many thrust points.
// thrust    the thrust line's reference numbers.
// speedbrake  the reference number for the middle of the open panels.
const MODELS = [
  {
    file: 'models/c172p.glb', aircraft: C172P, kind: 'borrowed',
    real: { name: 'a 172P\'s', lengthM: (26 * 12 + 11) * IN, spanM: (36 * 12 + 1) * IN, lengthWithin: 0.02, spanWithin: 0.03 },   // 26 ft 11 in and 36 ft 1 in; FlightGear's wing is 2.9% wide
    textures: ['fuselage', 'prop', 'tail', 'wing'], keys: 3,
    // The degrees are FlightGear's own travel (Models/c172p.xml).
    motions: {
      flaps: { flaps: [[0, 0], [-1, 30]] },
      elevator: { elevator_left: [[-1, 23], [1, 28]], elevator_right: [[-1, 23], [1, 28]] },
      aileron: { aileron_left: [[1, 20], [-1, 15]], aileron_right: [[-1, 15], [1, 20]] },
      rudder: { rudder: [[-1, 13], [1, 13]] },
    },
    hinged: ['elevator', 'aileron', 'rudder'], slides: ['flaps'], propeller: true,
    leftOut: /interior|panel|seat|tie|plug|fairing|hotspot|ski|float/i, script: 'models/convert-c172p.py',
  },
  {
    file: 'models/f4c.glb', aircraft: F4C, kind: 'built', from: 'wings:models/f4c.glb',
    real: { name: 'an F-4C\'s', lengthM: 17.7, spanM: 11.7, lengthWithin: 0.02, spanWithin: 0.02 },
    textures: ['f4c_skin', 'f4c_skin_orm'], keys: 25,
    // The degrees are docs/models.md's, the real jet's. It rolls with an aileron that only goes down and the other wing's spoiler.
    motions: {
      gear: ['door_main_in_L', 'door_main_in_R', 'door_nose_aft', 'gear_main_L', 'gear_main_R', 'gear_nose', 'wheel_left', 'wheel_right'],
      flaps: {
        flap_L: [[0, 0], [-1, 60]], flap_R: [[0, 0], [-1, 60]],
        leflap_in_L: [[0, 0], [-1, 30]], leflap_in_R: [[0, 0], [-1, 30]], leflap_out_L: [[0, 0], [-1, 30]], leflap_out_R: [[0, 0], [-1, 30]],
      },
      elevator: { stabilator: [[-1, 9], [1, 21]] },
      aileron: { aileron_L: [[0, 0], [-1, 30]], aileron_R: [[-1, 30], [0, 0]], spoiler_L: [[1, 45], [0, 0]], spoiler_R: [[0, 0], [1, 45]] },
      rudder: { rudder: [[-1, 30], [1, 30]] },
      speedbrake: { speedbrake_L: [[0, 0], [-1, 60]], speedbrake_R: [[0, 0], [-1, 60]] },
    },
    leading: ['leflap_in_L', 'leflap_in_R', 'leflap_out_L', 'leflap_out_R'], hinged: ['aileron', 'rudder'],   // the stabilator is all one piece, turning about its middle
    engines: 2, thrust: { tilt: THRUST_TILT, aboveCg: THRUST_LINE_ABOVE_CG }, speedbrake: SPEEDBRAKE_PANELS,
  },
];

// docs/models.md's budget. Every model: under 2 MB and 50,000 triangles, its textures 1,024 pixels at most.
const BUDGET = {
  built: { materials: 1, textures: 2 },            // one material; colour, and roughness with metalness
  borrowed: { materials: Infinity, textures: 4 },  // its own materials, and up to four textures
};
// Where each motion rests: gear down, flaps up, speedbrakes in, controls centred.
const REST = { gear: 1, flaps: 0, speedbrake: 0, elevator: 0.5, aileron: 0.5, rudder: 0.5 };

test('every model in models/ is in the table above, and models/CREDITS.md says whose it is', () => {
  const found = readdirSync(here('models/')).filter((name) => name.endsWith('.glb')).map((name) => `models/${name}`).sort();
  assert.deepEqual(MODELS.map((m) => m.file).sort(), found);
  const credits = readFileSync(here('models/CREDITS.md'), 'utf8');
  for (const file of found) assert.ok(credits.includes(`## \`${file.slice('models/'.length)}\``), `${file} has its heading in models/CREDITS.md`);
  console.log(`  ${found.join(', ')}`);
});

for (const model of MODELS) {
  const { file, aircraft, real, motions } = model, path = here(file);
  const glb = readGlb(path), { json } = glb;
  const named = (name) => {
    const index = json.nodes.findIndex((n) => n.name === name);
    assert.ok(index >= 0, `the model has a part named ${name}`);
    return index;
  };
  // The whole airplane posed: every motion at its position in `positions`, or else at rest (glb.mjs, poseOf). A
  // file's own resting pose is never used: an exporter may leave it at every motion's 0 s end.
  const world = (positions) => worldMatrices(json, poseOf(glb, positions));
  /** Every vertex of one part (and the parts it carries), where it is in the model's axes (x right, y up, z aft), in a pose. */
  const points = (name, positions) => verticesUnder(glb, named(name), world(positions));
  const everyPoint = (positions) => json.scenes[json.scene ?? 0].nodes.flatMap((root) => verticesUnder(glb, root, world(positions)));
  const span = (list, axis) => Math.max(...list.map((p) => p[axis])) - Math.min(...list.map((p) => p[axis]));
  const middle = (list, axis) => (Math.max(...list.map((p) => p[axis])) + Math.min(...list.map((p) => p[axis]))) / 2;
  const partsOf = (motion) => (Array.isArray(motions[motion]) ? motions[motion] : Object.keys(motions[motion]));
  const say = (line) => console.log(`  ${file}: ${line}`);
  const it = (name, ...rest) => test(`${file}: ${name}`, ...rest);

  if (model.from) {
    it('"The file is Wings\' byte for byte, locked in provenance.json"', () => {
      const record = JSON.parse(readFileSync(here('provenance.json'), 'utf8')).files[file], is = sha256(readFileSync(path));
      assert.ok(record, 'it is in provenance.json');
      assert.equal(record.from, model.from);
      assert.equal(record.how, 'byte for byte');
      assert.match(record.commit, /^[0-9a-f]{40}$/, 'the commit it was copied from is on record');
      say(`sha256 ${is}; the original at ${record.from}, commit ${record.commit.slice(0, 7)}: ${record.original}`);
      assert.equal(is, record.original, 'the file is the original, bit for bit');
      assert.equal(record.copy, record.original);
    });
  }

  it(`the budget: under 2 MB and 50,000 triangles; ${model.kind === 'built' ? 'one material and two textures at most' : 'a borrowed stand-in\'s four textures'}, of 1,024 pixels at most`, () => {
    const budget = BUDGET[model.kind], bytes = statSync(path).size;
    assert.ok(bytes < 2e6, `${bytes} bytes`);
    const triangles = json.meshes.reduce((sum, m) => sum + m.primitives.reduce((s, p) => s + json.accessors[p.indices ?? p.attributes.POSITION].count / 3, 0), 0);
    assert.ok(triangles < 50000, `${triangles} triangles`);
    assert.ok(json.images.length <= budget.textures, `${json.images.length} textures`);
    assert.ok(json.materials.length <= budget.materials, `${json.materials.length} materials`);
    const sizes = [];
    for (const image of json.images) {
      const view = json.bufferViews[image.bufferView], data = glb.bin.subarray(view.byteOffset, view.byteOffset + view.byteLength);
      let size;
      if (image.mimeType === 'image/png') size = [data.readUInt32BE(16), data.readUInt32BE(20)];
      else {
        let i = 2;   // JPEG: walk the segments to the frame header, which holds the size
        while (!(data[i] === 0xff && data[i + 1] >= 0xc0 && data[i + 1] <= 0xc2)) i += 2 + data.readUInt16BE(i + 2);
        size = [data.readUInt16BE(i + 7), data.readUInt16BE(i + 5)];
      }
      assert.ok(Math.max(...size) <= 1024, `${image.name} is ${size.join(' x ')}`);
      sizes.push(`${image.name} ${size.join(' x ')}`);
    }
    assert.deepEqual(json.images.map((i) => i.name).sort(), model.textures);
    if (model.kind === 'built') {
      // Built for the game: single-sided, colour and roughness with metalness only, and nothing left over from modelling.
      for (const material of json.materials) assert.ok(!material.doubleSided && !material.normalTexture && !material.emissiveTexture && !material.occlusionTexture, `${material.name}: single-sided, no normal or emission map`);
      assert.ok(!json.cameras && !json.extensions?.KHR_lights_punctual, 'no cameras or lights');
      assert.deepEqual(json.nodes.filter((n) => n.mesh === undefined).map((n) => n.name), [], 'no empties');
    }
    say(`${bytes} bytes, ${triangles} triangles, ${json.images.length} textures, ${json.materials.length} material${json.materials.length === 1 ? '' : 's'} (${sizes.join(', ')})`);
  });

  if (model.leftOut) {
    it('only the outside of FlightGear\'s model is in it: its paint, and none of its cabin', () => {
      for (const name of [...json.nodes, ...json.meshes, ...json.materials].map((x) => x.name)) assert.doesNotMatch(name, model.leftOut);
    });
  }

  it(`real size: the length within ${real.lengthWithin * 100}% of ${real.name} ${real.lengthM.toFixed(2)} m, the wing span within ${real.spanWithin * 100}% of its ${real.spanM.toFixed(2)} m; nose along -Z, up +Y, the origin inside it`, () => {
    const all = everyPoint(motions.gear ? { gear: 0 } : {}), box = bounds(all), length = span(all, 2), wide = span(all, 0);
    say(`length ${length.toFixed(2)} m against ${real.lengthM} m (${((length / real.lengthM - 1) * 100).toFixed(2)}%); span ${wide.toFixed(2)} m against ${real.spanM.toFixed(2)} m (${((wide / real.spanM - 1) * 100).toFixed(2)}%)`);
    assert.ok(Math.abs(length / real.lengthM - 1) < real.lengthWithin, `length ${length}`);
    assert.ok(Math.abs(wide / real.spanM - 1) < real.spanWithin, `span ${wide}`);
    // Nose along -Z, right wing along +X, up along +Y: the nose wheel is ahead of the main wheels, the rudder at
    // the back and above the wheels, and it is the same either side.
    const back = (name) => (middle(points(name), 2) - box.min[2]) / length;
    assert.ok(back('wheel_nose') < back('wheel_left') && back('rudder') > 0.8, 'nose to -Z: the rudder is in the last fifth of its length');
    assert.ok(middle(points('rudder'), 1) > middle(points('wheel_nose'), 1) + 1, 'up along +Y: the rudder is above the wheels');
    assert.ok(Math.abs(middle(all, 0)) < 0.05 && Math.abs(middle(points('airframe'), 0)) < 0.05, 'the centreline is x = 0');
    assert.ok(box.min[1] < 0 && box.max[1] > 0 && box.min[2] < 0 && box.max[2] > 0, 'the origin is inside the airplane');
  });

  it(`the ${Object.keys(motions).length} motions (${Object.keys(motions).join(', ')}), each exactly one second, each part in one motion only`, () => {
    assert.deepEqual(json.animations.map((a) => a.name).sort(), Object.keys(motions).sort());   // a fixed-gear airplane has no `gear`
    const moved = new Map();
    for (const animation of json.animations) {
      for (const channel of animation.channels) {
        const times = readAccessor(glb, animation.samplers[channel.sampler].input).map((v) => v[0]);
        assert.ok(times[0] === 0 && times.at(-1) === 1 && times.includes(0.5), `${animation.name}: keys from 0 to 1 s, with one at 0.5 (${times[0]} to ${times.at(-1)})`);
        assert.equal(times.length, model.keys, `${animation.name}: ${model.keys} keys`);
        assert.ok(times.every((t, k) => k === 0 || t > times[k - 1]), `${animation.name}: its keys are in order`);
        const node = json.nodes[channel.target.node].name;
        assert.ok(!moved.has(node) || moved.get(node) === animation.name, `${node} is moved by one motion only`);
        moved.set(node, animation.name);
      }
      assert.deepEqual([...new Set(animation.channels.map((c) => json.nodes[c.target.node].name))].sort(), [...partsOf(animation.name)].sort());
    }
    say(Object.keys(motions).map((motion) => `${motion}: ${partsOf(motion).length} part${partsOf(motion).length === 1 ? '' : 's'}`).join(', '));
  });

  it('each motion moves the right way, about its hinge, to the real airplane\'s travel within 0.5 degrees', () => {
    // How far a part has turned between two moments of its motion (after Wings' test).
    const turned = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a.reduce((sum, x, k) => sum + x * b[k], 0)))) * DEG;
    for (const [motion, parts] of Object.entries(motions)) {
      if (Array.isArray(parts)) continue;   // the gear: below
      const travels = [];
      for (const [part, ends] of Object.entries(parts)) {
        const index = named(part), rest = points(part, { [motion]: REST[motion] }), axis = motion === 'rudder' ? 0 : 1;
        const rear = rest.reduce((best, p, k) => (p[2] > rest[best][2] ? k : best), 0), front = rest.reduce((best, p, k) => (p[2] < rest[best][2] ? k : best), 0);
        const edge = model.leading?.includes(part) ? front : rear;   // the edge that moves: the trailing edge, but for a leading-edge flap
        const at = (t) => poseAt(glb, motion, t)[index].rotation;
        ends.forEach(([way, degrees], t) => {
          const angle = turned(at(REST[motion]), at(t)), now = points(part, { [motion]: t });
          assert.ok(Math.abs(angle - degrees) <= 0.5, `${part} at ${t} s is turned ${angle.toFixed(2)} degrees, not ${degrees}`);
          if (way) assert.ok((now[edge][axis] - rest[edge][axis]) * way > 0.01, `${part} at ${t} s: its ${edge === rear ? 'trailing' : 'leading'} edge goes ${way > 0 ? (axis ? 'up' : 'right') : (axis ? 'down' : 'left')}`);
          else assert.ok(Math.hypot(...now[edge].map((x, k) => x - rest[edge][k])) < 0.001, `${part} at ${t} s has not moved`);
          // A hinge: the points on the hinge line do not move. The part's foremost point stays within 8 cm.
          if (model.hinged.includes(motion)) assert.ok(Math.hypot(...now[front].map((x, k) => x - rest[front][k])) < 0.08, `${part} turns about its leading edge`);
          travels.push(`${part} ${angle.toFixed(1)}${way ? (way > 0 ? (axis ? ' up' : ' right') : (axis ? ' down' : ' left')) : ''} at ${t} s`);
        });
      }
      say(`${motion}: ${travels.join(', ')}`);
    }
    // At rest it is the same either side, and every control is centred.
    const resting = everyPoint();
    assert.ok(Math.abs(Math.max(...resting.map((p) => p[0])) + Math.min(...resting.map((p) => p[0]))) < 0.02, 'the same either side at rest');
    assert.ok(Math.abs(middle(points('rudder'), 0)) < 0.02, 'the rudder sits on the centreline');
    for (const part of model.slides ?? []) {
      const up = points(part, { flaps: 0 }), down = points(part, { flaps: 1 });
      assert.ok(middle(down, 2) > middle(up, 2) && middle(down, 1) < middle(up, 1), `the ${part} slide back and down as they lower`);
    }
    if (motions.gear) {
      // Gear up, nothing hangs below the belly: the airplane is at least half a metre shallower. Down, the tyres are the lowest things on it.
      const up = bounds(everyPoint({ gear: 0 })), down = bounds(everyPoint({ gear: 1 }));
      const tyres = Math.min(...['wheel_nose', 'wheel_left', 'wheel_right'].map((name) => bounds(points(name, { gear: 1 })).min[1]));
      say(`gear: down, the tyres are ${((up.min[1] - down.min[1]) / FT).toFixed(2)} ft below the belly`);
      assert.ok(up.min[1] > down.min[1] + 0.5, 'gear up, the airplane is at least half a metre shallower');
      assert.ok(Math.abs(tyres - down.min[1]) < 0.001, 'gear down, the tyres are the lowest things on it');
    }
    if (motions.speedbrake) {
      // One panel each side, so they slow it without turning it; open, they hang well below where they sit shut.
      const sides = partsOf('speedbrake').map((part) => Math.sign(middle(points(part), 0)));
      assert.ok(sides.includes(-1) && sides.includes(1), 'a speedbrake panel each side');
      const lowest = (t) => Math.min(...partsOf('speedbrake').map((part) => bounds(points(part, { speedbrake: t })).min[1]));
      say(`speedbrake: open, the panels hang ${((lowest(0) - lowest(1)) / FT).toFixed(2)} ft lower than shut`);
      assert.ok(lowest(1) < lowest(0) - 0.2, 'open, the panels hang well below where they sit shut');
    }
  });

  if (model.propeller) {
    it('the propeller: a part named `propeller` on the thrust line, at the front, holding the blades and a see-through disc', () => {
      const propeller = json.nodes[named('propeller')];
      assert.deepEqual(propeller.children.map((c) => json.nodes[c].name), ['propeller_blades', 'propeller_disc']);
      const local = (name) => json.meshes[json.nodes[named(name)].mesh].primitives.flatMap((p) => readAccessor(glb, p.attributes.POSITION));
      const disc = local('propeller_disc'), blades = local('propeller_blades');
      // About the hub's own Z axis: the disc is flat across it and centred on it, and so are the blades.
      assert.ok(span(disc, 2) < 0.2 && Math.abs(middle(disc, 0)) < 0.02 && Math.abs(middle(disc, 1)) < 0.02, 'the disc is square to the thrust line and centred on it');
      assert.ok(Math.abs(middle(blades, 0)) < 0.03 && Math.abs(middle(blades, 1)) < 0.03, 'the blades are centred on the hub');
      assert.ok(span(disc, 0) > 1.7 && span(disc, 0) < 2.1, 'a propeller about 75 inches across');
      const material = json.materials[json.meshes[json.nodes[named('propeller_disc')].mesh].primitives[0].material];
      assert.equal(material.alphaMode, 'BLEND');
      assert.ok(middle(points('propeller_blades'), 2) < -1.5, 'the propeller is at the front');
    });
  }

  // JSBSim's own answer: the airplane stood on its wheels on level ground as the game parks it (engines idling,
  // brakes on, flaps down or at its takeoff setting) for ten seconds, with none of the copilot's trim. Read back.
  let stood;
  const standing = () => (stood ??= (async () => {
    const flight = Flight.start(await moduleWith(aircraft, 'weh'), aircraft, { assists: null });
    for (let k = 0; k < 3; k++) assert.equal(flight.get(`gear/unit[${k}]/WOW`), 1, `wheel ${k} is on the ground`);
    for (const name of aircraft.controls.brake.to) assert.equal(flight.get(name), 1, `${name}: brakes on`);
    if (aircraft.controls.gear.to.length) assert.equal(flight.get('gear/gear-pos-norm'), 1, 'gear down');
    const cg = ['x', 'y', 'z'].map((axis) => flight.get(`inertia/cg-${axis}-in`));   // station (aft), buttline (right) and waterline (up), inches
    const wheels = [0, 1, 2].map((k) => ({ at: ['x', 'y', 'z'].map((axis) => flight.get(`gear/unit[${k}]/${axis}-position`)), givenIn: flight.get(`gear/unit[${k}]/compression-ft`) * 12 }));
    const answer = { cg, wheels, heightFt: flight.get('position/h-agl-ft'), pitch: flight.get('attitude/theta-rad') };
    flight.dispose();
    return answer;
  })());

  it(`the wheels are where JSBSim's ${aircraft.model} has them: standing in JSBSim, every tyre within 1 in of its wheel fore and aft, sideways and in height`, async () => {
    const { cg, wheels, heightFt, pitch } = await standing();
    if (model.script) {
      // The numbers the script sat the model to are these, read back.
      const script = readFileSync(here(model.script), 'utf8'), written = (name) => Number(script.match(new RegExp(`^${name} = ([-\\d.]+)`, 'm'))[1]);
      assert.ok(Math.abs(written('CG_X_IN') - cg[0]) < 0.05, `the centre of gravity is at station ${cg[0]}`);
      assert.ok(Math.abs(written('STANDING_CG_FT') - heightFt) < 0.01, `it stands with its centre of gravity ${heightFt} ft up`);
      assert.ok(Math.abs(written('STANDING_PITCH_DEG') - pitch * DEG) < 0.1, `it stands ${pitch * DEG} degrees nose up`);
    } else {
      // Built to the handoff: its origin is the centre of gravity as loaded, and it stands at the height and pitch the game's settings give.
      assert.ok(cg.every((inches) => Math.abs(inches) <= 0.1), `the centre of gravity as loaded is at the model's origin (${cg.join(', ')} in)`);
      assert.ok(Math.abs(heightFt - aircraft.standingFt) < 0.01, `it stands with its centre of gravity ${heightFt} ft up; the settings say ${aircraft.standingFt}`);
      assert.ok(Math.abs(pitch * DEG - aircraft.standingPitchDeg) < 0.05, `it stands ${pitch * DEG} degrees nose up; the settings say ${aircraft.standingPitchDeg}`);
    }
    say(`JSBSim stands it with its centre of gravity ${heightFt.toFixed(4)} ft up, ${(pitch * DEG).toFixed(3)} degrees nose up`);
    // Each wheel in the aircraft file: fore and aft from the centre of gravity as loaded, sideways from the
    // centreline. In height its contact point is the ground the airplane stands on.
    const above = (p) => heightFt * FT - p[2] * Math.sin(pitch) + p[1] * Math.cos(pitch);   // of a point of the model, standing
    ['wheel_nose', 'wheel_left', 'wheel_right'].forEach((name, k) => {
      const tyre = points(name), ahead = -middle(tyre, 2) / IN, right = middle(tyre, 0) / IN, lowest = Math.min(...tyre.map(above)) / IN;
      say(`${name}: ${(ahead - (cg[0] - wheels[k].at[0])).toFixed(2)} in ahead of JSBSim's, ${(right - wheels[k].at[1]).toFixed(2)} in right of it, ${lowest.toFixed(2)} in above the ground (its leg has given ${wheels[k].givenIn.toFixed(2)} in)`);
      assert.ok(Math.abs(ahead - (cg[0] - wheels[k].at[0])) <= 1, `${name} fore and aft`);
      assert.ok(Math.abs(right - wheels[k].at[1]) <= 1, `${name} sideways`);
      assert.ok(Math.abs(lowest) <= 1, `${name} on the ground`);
    });
    // Nothing of the airplane is below the ground it stands on.
    assert.ok(Math.min(...everyPoint().map(above)) / IN > -1, 'nothing reaches below the tyres');
  });

  if (model.engines) {
    it('"The file\'s two thrust points are within 1 in of the model\'s engine exits fore and aft and sideways ... In height the thrust line is CR-2144\'s; how far that is from the model\'s exits is reported"', async () => {
      const { cg } = await standing(), { tilt, aboveCg } = model.thrust;
      // The model: each exit's middle and its opening (models/measure.mjs finds them by their shape), in feet forward, right and down.
      const exits = engineExits(glb);
      assert.equal(exits.length, model.engines, `the model has ${model.engines} engine exits`);
      // The aircraft file: each engine's thrust point (station aft, buttline right, waterline up, inches) and its tilt.
      const xml = bytesOf(aircraft, aircraft.files[0]).toString();
      const thrusters = [...xml.matchAll(/<thruster file="[^"]+">\s*<location unit="IN">\s*<x>\s*([-\d.]+)\s*<\/x>\s*<y>\s*([-\d.]+)\s*<\/y>\s*<z>\s*([-\d.]+)\s*<\/z>\s*<\/location>\s*<orient unit="DEG">\s*<roll>\s*([-\d.]+)\s*<\/roll>\s*<pitch>\s*([-\d.]+)\s*<\/pitch>/g)]
        .map((m) => m.slice(1).map(Number)).sort((a, b) => a[1] - b[1]);
      assert.equal(thrusters.length, model.engines, `the aircraft file has ${model.engines} thrust points`);
      thrusters.forEach(([x, y, z, , pitch], k) => {
        const exit = exits[k], behind = (x - cg[0]) - -exit.at[0] * 12, right = y - exit.at[1] * 12, below = -(z - cg[2]) - exit.at[2] * 12;
        // The thrust line: through the thrust point, rising forward at the tilt. How far above the centre of gravity it passes, and how far below the exit's middle.
        const rad = pitch / DEG, passes = ((x - cg[0]) * Math.sin(rad) + (z - cg[2]) * Math.cos(rad)) / 12;
        say(`${k ? 'right' : 'left'} engine: the exit's middle is [${exit.at.map((feet) => feet.toFixed(3)).join(', ')}] ft forward, right and down, its opening ${(2 * exit.radius).toFixed(2)} ft across`);
        say(`  the thrust point is ${behind.toFixed(2)} in behind it and ${right.toFixed(2)} in right of it; within 1 in`);
        say(`  in height the thrust point is ${below.toFixed(2)} in below it (the thrust line passes ${(below * Math.cos(rad)).toFixed(2)} in from the exit's middle): the line is tilted ${pitch} degrees and passes ${passes.toFixed(3)} ft above the centre of gravity; CR-2144's is ${tilt.value} and ${aboveCg.value}`);
        assert.ok(Math.abs(behind) <= 1, 'fore and aft');
        assert.ok(Math.abs(right) <= 1, 'sideways');
        assert.equal(pitch, tilt.value, 'the thrust line\'s tilt');
        assert.ok(Math.abs(passes - aboveCg.value) < 0.005, 'the thrust line passes above the centre of gravity by CR-2144\'s figure');
      });
      assert.ok(Math.abs(exits[0].at[0] - exits[1].at[0]) < 0.01 && Math.abs(exits[0].at[1] + exits[1].at[1]) < 0.01 && Math.abs(exits[0].at[2] - exits[1].at[2]) < 0.01, 'the two exits are side by side, the same either side of the centreline');
    });
  }

  if (model.speedbrake) {
    const reference = model.speedbrake;
    it('the reference number for the speedbrake panels is the model\'s: the middle of the two open panels, on the centreline', () => {
      const at = speedbrakeAt(glb);
      say(`the open panels' middle is [${at.map((feet) => feet.toFixed(3)).join(', ')}] ft forward, right and down; the reference has [${reference.value.join(', ')}] (${reference.source}, ${reference.where})`);
      at.forEach((feet, k) => assert.ok(Math.abs(feet - reference.value[k]) <= 0.005, 'the reference is the model\'s, to the hundredth of a foot'));
    });

    it('"its speedbrake point within 1 in of the model\'s panels"', async () => {
      // The aircraft file's speedbrakes (pull request 7): their drag is an external force, acting at a point in
      // the structural frame (inches, x aft, y right, z up), here from the centre of gravity as loaded.
      const { cg } = await standing();
      const xml = bytesOf(aircraft, aircraft.files[0]).toString().replace(/<!--[^]*?-->/g, '');
      const force = xml.match(/<force name="speedbrake"[^>]*>([^]*?)<\/force>/);
      assert.ok(force, `${aircraft.files[0]} has a speedbrake force`);
      const [x, y, z] = ['x', 'y', 'z'].map((axis) => Number(force[1].match(new RegExp(`<location unit="IN">[^]*?<${axis}>\\s*([-\\d.]+)\\s*</${axis}>`))[1]));
      const inFile = [-(x - cg[0]) / 12, (y - cg[1]) / 12, -(z - cg[2]) / 12], model = speedbrakeAt(glb);   // feet forward, right and down
      const off = inFile.map((feet, k) => (feet - model[k]) * 12);
      say(`the aircraft file's speedbrake point is [${inFile.map((feet) => feet.toFixed(3)).join(', ')}] ft forward, right and down; the model's open panels' middle [${model.map((feet) => feet.toFixed(3)).join(', ')}]: ${off.map((inches) => inches.toFixed(2)).join(', ')} in off`);
      off.forEach((inches) => assert.ok(Math.abs(inches) <= 1, `${inches} in`));
    });
  }
}
