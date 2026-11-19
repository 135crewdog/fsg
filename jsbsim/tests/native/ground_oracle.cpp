// Independent calculation of what the ground callback should return, for the ground-hook tests.
// It shares no code with host/grid_ground.cpp:
//  - the grid height uses the weighted-sum form of bilinear interpolation;
//  - surface points are placed with JSBSim's FGLocation::SetPositionGeodetic;
//  - the normal is the cross product of two tangents taken by central differences of surface points.
#include <cmath>

#include "grid_ground.h"
#include "math/FGColumnVector3.h"
#include "math/FGLocation.h"

namespace fdmtest {

namespace {
double GridHeight(const fdmhost::HeightGrid& g, double lat, double lon) {
  double fi = (lat - g.lat0) / g.dlat, fj = (lon - g.lon0) / g.dlon;
  if (fi < 0) fi = 0;
  if (fi > g.nlat - 1) fi = g.nlat - 1;
  if (fj < 0) fj = 0;
  if (fj > g.nlon - 1) fj = g.nlon - 1;
  int i = static_cast<int>(std::floor(fi)), j = static_cast<int>(std::floor(fj));
  if (i > g.nlat - 2) i = g.nlat - 2;
  if (j > g.nlon - 2) j = g.nlon - 2;
  const double u = fi - i, s = fj - j;
  auto at = [&](int r, int c) { return g.h[static_cast<size_t>(r) * g.nlon + c]; };
  return (1 - u) * (1 - s) * at(i, j) + (1 - u) * s * at(i, j + 1) + u * (1 - s) * at(i + 1, j) +
         u * s * at(i + 1, j + 1);
}

JSBSim::FGColumnVector3 SurfacePoint(const fdmhost::HeightGrid& g, double a, double b, double lat, double lon) {
  JSBSim::FGLocation p;
  p.SetEllipse(a, b);
  p.SetPositionGeodetic(lon, lat, GridHeight(g, lat, lon));
  return JSBSim::FGColumnVector3(p(1), p(2), p(3));
}
}  // namespace

void GroundOracle(const fdmhost::HeightGrid& grid, double a, double b, double x, double y, double z, double* out7) {
  JSBSim::FGLocation loc(JSBSim::FGColumnVector3(x, y, z));
  loc.SetEllipse(a, b);
  const double lat = loc.GetGeodLatitudeRad();
  const double lon = loc.GetLongitude();
  const double h = GridHeight(grid, lat, lon);
  // Central differences over about 2 ft on the ground (1e-7 rad): small against a grid cell.
  const double d = 1e-7;
  const JSBSim::FGColumnVector3 tNorth = SurfacePoint(grid, a, b, lat + d, lon) - SurfacePoint(grid, a, b, lat - d, lon);
  const JSBSim::FGColumnVector3 tEast = SurfacePoint(grid, a, b, lat, lon + d) - SurfacePoint(grid, a, b, lat, lon - d);
  JSBSim::FGColumnVector3 n = tEast * tNorth;  // FGColumnVector3 operator* is the cross product
  n.Normalize();
  const JSBSim::FGColumnVector3 c = SurfacePoint(grid, a, b, lat, lon);
  out7[0] = loc.GetGeodAltitude() - h;
  out7[1] = n(1); out7[2] = n(2); out7[3] = n(3);
  out7[4] = c(1); out7[5] = c(2); out7[6] = c(3);
}

}  // namespace fdmtest
