// The game's flat world on JSBSim's round Earth. New in FSG, milestone 1 (docs/milestones/1.md, "Where the
// game's world sits on JSBSim's Earth").
//
// The game is flat: north and east in metres from the numbers of runway 8R at Honolulu, heights in feet above
// sea level, as in Wings. JSBSim is a globe inside and thinks in latitude, longitude and height. This file is
// the translator between the two, and nothing else knows there are two.
//
// The world is laid on the Earth as a plain grid of latitude and longitude (the way Wings' terrain/make-hawaii.py
// lays each island group flat, and the layout FDM's ground grid reads): so many metres north is so much
// latitude, so many metres east is so much longitude, the same everywhere. North is north and up is up at
// every point of the map, and a square of the game's height posts is exactly a ground grid, nothing resampled.
// The price: a flat map of a globe is off somewhere. North-south distances are true at Honolulu and within
// 0.03% anywhere on the map. East-west distances are true at one latitude, the middle of the map (the owner's
// choice, 20 November 2026), and drift by 0.65% for each degree of latitude away from it: 0.5% at Honolulu,
// 0.9% at the map's north and south ends. tests/world.test.js measures it against JSBSim's own Earth.

/** WGS84, as JSBSim has it (FGInertial.cpp, in feet there). */
const A = 6378137, F = 1 / 298.257223563, E2 = F * (2 - F);
const RAD = Math.PI / 180;
export const FT = 0.3048;   // metres in a foot, exactly

/**
 * Where the world's origin is on the Earth: the threshold of runway 8R at Honolulu, geodetic latitude and
 * longitude in degrees. Worked out from Wings' map (135crewdog/wings, terrain/hawaii/index.json, commit 557a8d0):
 * its Oahu sheet is flat about 21.485 N, 157.965 W, and puts that point 19,730.8 m north and 1,969.1 m west
 * of the threshold. tests/world.test.js does the sum again.
 */
export const ORIGIN = { latDeg: 21.306801, lonDeg: -157.945999 };

/** The latitude at which east-west distances are true: the middle of Wings' map, which reaches from 19.24 N to 21.91 N. */
export const TRUE_SCALE_LAT_DEG = 20.6;

/** Metres along a meridian for one radian of latitude (M), and across it at the equator's rate (N), at a latitude. */
function radii(latDeg) {
  const s = Math.sin(latDeg * RAD), w = Math.sqrt(1 - E2 * s * s);
  return { M: (A * (1 - E2)) / (w * w * w), N: A / w };
}
/** Metres north for one radian of latitude, and metres east for one radian of longitude: the two numbers of the map. */
export const METRES_PER_RAD_LAT = radii(ORIGIN.latDeg).M;
export const METRES_PER_RAD_LON = radii(TRUE_SCALE_LAT_DEG).N * Math.cos(TRUE_SCALE_LAT_DEG * RAD);

/** A place in the world (metres north and east of the origin) as JSBSim's geodetic latitude and longitude, radians. */
export function toLatLon(north, east) {
  return { lat: ORIGIN.latDeg * RAD + north / METRES_PER_RAD_LAT, lon: ORIGIN.lonDeg * RAD + east / METRES_PER_RAD_LON };
}
/** JSBSim's geodetic latitude and longitude (radians) as a place in the world, metres north and east. */
export function toWorld(lat, lon) {
  return { north: (lat - ORIGIN.latDeg * RAD) * METRES_PER_RAD_LAT, east: (lon - ORIGIN.lonDeg * RAD) * METRES_PER_RAD_LON };
}

/**
 * A square-posted patch of the world's ground as the grid JSBSim's ground callback reads (src/sim/core.js,
 * GroundGrid). `heights` is rows * columns heights in feet above sea level: row r, column c is the post
 * `north0 + r * post` metres north and `east0 + c * post` metres east.
 */
export function groundGrid(north0, east0, post, rows, columns, heights) {
  const corner = toLatLon(north0, east0);
  return { lat0: corner.lat, lon0: corner.lon, dlat: post / METRES_PER_RAD_LAT, dlon: post / METRES_PER_RAD_LON, nlat: rows, nlon: columns, heights };
}

/**
 * The test field: a flat runway at sea level, laid like Honolulu's 8R. After Wings' FIELD (135crewdog/wings,
 * src/field.js, commit 557a8d0): 10,000 ft by 150 ft, the start 200 ft in from the end. Here the start, "the
 * numbers", is the world's origin, and the runway points 090 true.
 */
export const FIELD = {
  heightFt: 0,
  runway: { headingDeg: 90, lengthFt: 10000, widthFt: 150, startBackFt: 200 },
  start: { north: 0, east: 0, headingDeg: 90 },
};
