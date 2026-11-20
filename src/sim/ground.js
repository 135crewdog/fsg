// The ground the game gives JSBSim: terrain sources, and the patch of one that follows the airplane.
// New in FSG, milestone 1 (docs/milestones/1.md, "The ground: a height patch that follows the airplane").
//
// The method is FlightGear's: its flight model asks a small "ground cache" kept round the airplane, refilled
// as the airplane moves, and does not start until the scenery near the start has loaded. Here the cache is
// FDM's height grid (jsbsim/host/grid_ground.cpp), and the game replaces it with a new patch cut from the
// same posts the picture is drawn from, so what is seen is what is hit.
//
// A terrain source is the world's ground as square-posted heights: post (row, column) stands `post` metres
// times row north and times column east of the world's origin, the same posts whatever patch they are cut
// into. That is what makes a swap invisible: the ground under a wheel is the same numbers before and after.
//   source.post                               metres between posts
//   source.heights(row0, column0, rows, columns)   Float64Array of rows * columns heights in feet above sea
//                                             level, row by row; or null if that ground has not loaded yet
//   source.water(row, column)                 true if the post is sea or lake
import { groundGrid } from './world.js';

/** Posts along each side of a patch, and how near its edge (in posts) the airplane may come before a new one is cut. */
export const PATCH_POSTS = 129;
export const PATCH_MARGIN = 32;

/** A terrain source from a height function of (north, east) in metres, feet above sea level; always loaded. */
export function sourceFrom(heightFt, { post = 10, water = () => false } = {}) {
  return {
    post,
    heights(row0, column0, rows, columns) {
      const out = new Float64Array(rows * columns);
      for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) out[r * columns + c] = heightFt((row0 + r) * post, (column0 + c) * post);
      return out;
    },
    water: (row, column) => water(row * post, column * post),
  };
}

/** Level ground at one height: the test field. */
export const flatSource = (heightFt = 0) => sourceFrom(() => heightFt);

const FT = 0.3048;
/**
 * The test terrain, on 10 m posts like Hawaii's: the flat field round the origin, and things to hit.
 *   the sea        everything more than 3 km south of the runway: water at sea level
 *   a lake         400 m across, 2 km north and 1 km east of the numbers: water at sea level
 *   a slope        from 5 km east of the numbers the ground rises to the east at 5 degrees, for 4 km
 *   a hill         1,000 ft high and 3 km across at its foot, 6 km north and 2 km east of the numbers
 *   a face         from 10 km north the ground rises to the north at 30 degrees, to 5,000 ft
 */
export const TEST_TERRAIN = {
  slope: { fromEast: 5000, toEast: 9000, degrees: 5 },
  hill: { north: 6000, east: 2000, radius: 1500, heightFt: 1000 },
  face: { fromNorth: 10000, degrees: 30, topFt: 5000 },
  lake: { north: 2000, east: 1000, radius: 200 },
  sea: { southOf: -3000 },
};
export function testTerrain() {
  const { slope, hill, face, lake, sea } = TEST_TERRAIN;
  const tan = (degrees) => Math.tan((degrees * Math.PI) / 180);
  const height = (north, east) => {
    const onSlope = (Math.min(Math.max(east, slope.fromEast), slope.toEast) - slope.fromEast) * tan(slope.degrees) / FT;
    const fromHill = Math.hypot(north - hill.north, east - hill.east);
    const onHill = fromHill < hill.radius ? hill.heightFt * (1 - fromHill / hill.radius) : 0;
    const onFace = Math.min(Math.max(north - face.fromNorth, 0) * tan(face.degrees) / FT, face.topFt);
    return Math.max(onSlope, onHill, onFace);
  };
  const water = (north, east) => north < sea.southOf || Math.hypot(north - lake.north, east - lake.east) < lake.radius;
  return sourceFrom(height, { water });
}

/**
 * A patch of a source round a place: `posts` posts square, centred on the post nearest the place.
 * Returns null if the source has not loaded that ground.
 */
export function cutPatch(source, north, east, posts = PATCH_POSTS) {
  const half = (posts - 1) / 2;
  const row0 = Math.round(north / source.post) - half, column0 = Math.round(east / source.post) - half;
  const heights = source.heights(row0, column0, posts, posts);
  if (!heights) return null;
  return { source, row0, column0, posts, heights, grid: groundGrid(row0 * source.post, column0 * source.post, source.post, posts, posts, heights) };
}

/** How many posts a place is inside a patch: the distance to its nearest edge, negative if outside. */
export function postsInside(patch, north, east) {
  const r = north / patch.source.post - patch.row0, c = east / patch.source.post - patch.column0, last = patch.posts - 1;
  return Math.min(r, last - r, c, last - c);
}

/** The source's own ground height at a place, feet: the straight-line blend of the four posts round it, as JSBSim's grid has it. */
export function heightAt(source, north, east) {
  const r = north / source.post, c = east / source.post, r0 = Math.floor(r), c0 = Math.floor(c), u = r - r0, s = c - c0;
  const [h00, h01, h10, h11] = source.heights(r0, c0, 2, 2);
  const a = h00 + u * (h10 - h00), b = h01 + u * (h11 - h01);
  return a + s * (b - a);
}

/** True if the post nearest a place is water. */
export function waterAt(source, north, east) {
  return source.water(Math.round(north / source.post), Math.round(east / source.post));
}
