// The game's flat world on JSBSim's round Earth (src/sim/world.js), checked against JSBSim's own Earth:
// an airplane is started at places in the world and JSBSim is asked where on the globe it is.
// docs/milestones/1.md, pull request 4.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { C172X } from '../src/sim/aircraft/c172x.js';
import { Flight } from '../src/sim/game.js';
import { FIELD, FT, METRES_PER_RAD_LAT, ORIGIN, TRUE_SCALE_LAT_DEG, groundGrid, toLatLon, toWorld } from '../src/sim/world.js';
import { loadVariant } from '../jsbsim/tests/lib/node.js';

const RAD = Math.PI / 180;
const data = (file) => readFileSync(new URL(`../jsbsim/jsbsim-data/${file}`, import.meta.url));
async function moduleWith(files, variant = 'weh') {
  const module = await loadVariant(variant);
  for (const file of files) module.writeFile(`/data/${file}`, data(file));
  return module;
}

test('the origin is the Honolulu 8R threshold, where Wings\' map puts it', () => {
  // Wings' Oahu sheet (terrain/hawaii/index.json, groups.oahu, commit 557a8d0) is flat about this point,
  // which it places this far from the threshold; metres per degree as terrain/make-hawaii.py works them out.
  const sheet = { lat0: 21.485, lon0: -157.965, north: 19730.8, east: -1969.1 };
  const p = sheet.lat0 * RAD;
  const perDegLat = 111132.954 - 559.822 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p);
  const perDegLon = 111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p) + 0.118 * Math.cos(5 * p);
  assert.ok(Math.abs(ORIGIN.latDeg - (sheet.lat0 - sheet.north / perDegLat)) < 1e-6, `latitude ${ORIGIN.latDeg}`);
  assert.ok(Math.abs(ORIGIN.lonDeg - (sheet.lon0 - sheet.east / perDegLon)) < 1e-6, `longitude ${ORIGIN.lonDeg}`);
});

test('world to latitude and longitude and back: the same place', () => {
  for (const [north, east] of [[0, 0], [10000, 10000], [66000, -96000], [-230000, 257000]]) {
    const { lat, lon } = toLatLon(north, east);
    const back = toWorld(lat, lon);
    assert.ok(Math.abs(back.north - north) < 0.003 && Math.abs(back.east - east) < 0.003, `${north}, ${east} came back as ${back.north}, ${back.east}`);   // 0.01 ft
  }
  assert.deepEqual(toLatLon(0, 0), { lat: ORIGIN.latDeg * RAD, lon: ORIGIN.lonDeg * RAD });
});

test('a ground grid has its rows to the north and its columns to the east', () => {
  const grid = groundGrid(-500, 2000, 10, 3, 5, new Float64Array(15));
  const corner = toWorld(grid.lat0, grid.lon0), far = toWorld(grid.lat0 + 2 * grid.dlat, grid.lon0 + 4 * grid.dlon);
  assert.ok(Math.abs(corner.north + 500) < 1e-6 && Math.abs(corner.east - 2000) < 1e-6);
  assert.ok(Math.abs(far.north + 480) < 1e-6 && Math.abs(far.east - 2040) < 1e-6);
  assert.equal(grid.nlat, 3);
  assert.equal(grid.nlon, 5);
});

test('the world against JSBSim\'s own Earth: north is true at Honolulu, east at the middle of the map; the drift elsewhere is measured', async () => {
  const module = await moduleWith(C172X.files);
  // Where JSBSim itself says an airplane started at a place in the world is: its own Earth-centred position, feet.
  const place = (north, east) => {
    const flight = Flight.start(module, C172X, { at: { north, east, headingDeg: 90 }, settleSeconds: 0 });
    const at = ['x', 'y', 'z'].map((axis) => flight.get(`position/ecef-${axis}-ft`));
    // Read back that it is where it was put, by JSBSim's own latitude (geodetic: the geocentric one is 10 nm off).
    assert.ok(Math.abs(flight.get('position/lat-geod-rad') - toLatLon(north, east).lat) < 1e-6 * RAD, 'latitude within 0.000001 degrees');
    flight.dispose();
    return at;
  };
  const feetBetween = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const TEN_KM = 10000 / FT;   // 32,808.4 ft

  const north = feetBetween(place(0, 0), place(10000, 0));
  assert.ok(Math.abs(north - TEN_KM) < 1, `10 km north of the origin is ${north.toFixed(2)} ft by JSBSim, ${TEN_KM.toFixed(2)} on the map`);

  const middle = (TRUE_SCALE_LAT_DEG - ORIGIN.latDeg) * RAD * METRES_PER_RAD_LAT;   // metres north of the origin
  const east = feetBetween(place(middle, 0), place(middle, 10000));
  assert.ok(Math.abs(east - TEN_KM) < 1, `10 km east along the map's middle latitude is ${east.toFixed(2)} ft by JSBSim`);

  // The east-west drift: how far 10 km east on the map is from 10 km east on JSBSim's Earth.
  const drift = (northMetres) => feetBetween(place(northMetres, 0), place(northMetres, 10000)) / TEN_KM - 1;
  const honolulu = drift(0), northEnd = drift(66000), southEnd = drift(-230000);
  // North-south at the far end of the map, for the record.
  const northSouth = feetBetween(place(-230000, 0), place(-220000, 0)) / TEN_KM - 1;
  console.log(`  10 km north of the origin: ${north.toFixed(2)} ft by JSBSim (${TEN_KM.toFixed(2)} on the map); 10 km east along ${TRUE_SCALE_LAT_DEG} N: ${east.toFixed(2)} ft`);
  console.log(`  east-west drift: ${(100 * honolulu).toFixed(2)}% at Honolulu, ${(100 * northEnd).toFixed(2)}% at the north end (66 km north), ${(100 * southEnd).toFixed(2)}% at the south end (230 km south)`);
  console.log(`  north-south at the south end: ${(100 * northSouth).toFixed(3)}%`);
  assert.ok(Math.abs(honolulu) <= 0.006, `drift at Honolulu ${(100 * honolulu).toFixed(2)}%`);
  assert.ok(Math.abs(northEnd) <= 0.01 && Math.abs(southEnd) <= 0.01, `drift at the ends ${(100 * northEnd).toFixed(2)}% and ${(100 * southEnd).toFixed(2)}%`);
  assert.equal(FIELD.start.north, 0);
});
