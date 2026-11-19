// From 135crewdog/FDM, tests/lib/grids.ts, commit e478825. Made by tools/from-fdm.mjs: the types are removed
// (a line that was only types is kept as a comment), ".ts" in file names becomes ".js", and import paths
// follow FSG's folders. Nothing else is changed.
// In the comments below, host/, dist-wasm/, jsbsim-data/, build/ and tests/ are folders of jsbsim/; REPORT.md
// and RESEARCH.md are FDM's, at that commit; and "TypeScript" means this file, which is now JavaScript.
// Test height grids for the ground hook.

// WGS84 in feet, as JSBSim's FGInertial has it by default.
export const WGS84_A = 20925646.32546;
export const WGS84_B = 20855486.5951;
const RAD = Math.PI / 180;

/** Meridian (M) and prime-vertical (N) radii of curvature at a geodetic latitude, feet. */
export function radii(latRad) {
  const e2 = 1 - (WGS84_B * WGS84_B) / (WGS84_A * WGS84_A);
  const W = Math.sqrt(1 - e2 * Math.sin(latRad) ** 2);
  return { M: (WGS84_A * (1 - e2)) / W ** 3, N: WGS84_A / W };
}

/** A grid of constant height, centred on a point. */
export function flatGrid(latDeg, lonDeg, heightFt, halfSpanDeg = 0.5, nlat = 3, nlon = 4) {
  return {
    lat0: (latDeg - halfSpanDeg) * RAD,
    lon0: (lonDeg - halfSpanDeg) * RAD,
    dlat: (2 * halfSpanDeg * RAD) / (nlat - 1),
    dlon: (2 * halfSpanDeg * RAD) / (nlon - 1),
    nlat,
    nlon,
    heights: new Float64Array(nlat * nlon).fill(heightFt),
  };
}

/**
 * A plane-like slope: height is 0 at (zeroLatDeg, zeroLonDeg) and rises towards the north or the east
 * at about `slopeDeg`. Rows and columns are deliberately different in number and spacing.
 */
export function slopeGrid(zeroLatDeg, zeroLonDeg, rising, slopeDeg, nlat = 5, nlon = 9, dlatDeg = 0.001, dlonDeg = 0.0015) {
  const lat0 = (zeroLatDeg - (dlatDeg * (nlat - 1)) / 2) * RAD;
  const lon0 = (zeroLonDeg - (dlonDeg * (nlon - 1)) / 2) * RAD;
  const dlat = dlatDeg * RAD, dlon = dlonDeg * RAD;
  const { M, N } = radii(zeroLatDeg * RAD);
  const tan = Math.tan(slopeDeg * RAD);
  const heights = new Float64Array(nlat * nlon);
  for (let i = 0; i < nlat; i++) {
    for (let j = 0; j < nlon; j++) {
      const north = (lat0 + i * dlat - zeroLatDeg * RAD) * M;
      const east = (lon0 + j * dlon - zeroLonDeg * RAD) * N * Math.cos(zeroLatDeg * RAD);
      heights[i * nlon + j] = tan * (rising === "north" ? north : east);
    }
  }
  return { lat0, lon0, dlat, dlon, nlat, nlon, heights };
}

/** ECEF position (ft) of a geodetic point on WGS84. */
export function geodeticToEcef(latRad, lonRad, altFt) {
  const e2 = 1 - (WGS84_B * WGS84_B) / (WGS84_A * WGS84_A);
  const { N } = radii(latRad);
  return [
    (N + altFt) * Math.cos(latRad) * Math.cos(lonRad),
    (N + altFt) * Math.cos(latRad) * Math.sin(lonRad),
    (N * (1 - e2) + altFt) * Math.sin(latRad),
  ];
}

/** Bytes of a grid in the layout host/scenario_runner.cpp reads. */
export function gridFileBytes(g) {
  const a = new Float64Array(6 + g.heights.length);
  a.set([g.lat0, g.lon0, g.dlat, g.dlon, g.nlat, g.nlon]);
  a.set(g.heights, 6);
  return new Uint8Array(a.buffer);
}
