#include "grid_ground.h"

#include <cmath>

#include "math/FGColumnVector3.h"
#include "math/FGLocation.h"

namespace fdmhost {

bool HeightGrid::Valid() const {
  if (nlat < 2 || nlon < 2) return false;
  if (!(dlat > 0.0) || !(dlon > 0.0) || !std::isfinite(lat0) || !std::isfinite(lon0)) return false;
  if (h.size() != static_cast<size_t>(nlat) * static_cast<size_t>(nlon)) return false;
  for (double v : h) if (!std::isfinite(v)) return false;
  return true;
}

double GridGround::GetAGLevel(double, const JSBSim::FGLocation& location, JSBSim::FGLocation& contact,
                              JSBSim::FGColumnVector3& normal, JSBSim::FGColumnVector3& v,
                              JSBSim::FGColumnVector3& w) const {
  ++stats_->calls;
  v.InitMatrix();
  w.InitMatrix();

  // The location handed in may have no ellipse set (FGLGear passes a plain vector): set ours on a copy.
  JSBSim::FGLocation l = location;
  l.SetEllipse(a_, b_);
  const double lat = l.GetGeodLatitudeRad();
  const double lon = l.GetLongitude();

  // Position in grid units, clamped to the grid. A clamped axis has zero slope.
  const HeightGrid& g = *grid_;
  double fi = (lat - g.lat0) / g.dlat;
  double fj = (lon - g.lon0) / g.dlon;
  bool clampLat = false, clampLon = false;
  if (!(fi >= 0.0)) { fi = 0.0; clampLat = true; }
  if (fi > g.nlat - 1) { fi = g.nlat - 1; clampLat = true; }
  if (!(fj >= 0.0)) { fj = 0.0; clampLon = true; }
  if (fj > g.nlon - 1) { fj = g.nlon - 1; clampLon = true; }
  int i0 = static_cast<int>(fi);
  int j0 = static_cast<int>(fj);
  if (i0 > g.nlat - 2) i0 = g.nlat - 2;
  if (j0 > g.nlon - 2) j0 = g.nlon - 2;
  const double u = fi - i0;  // 0..1 along latitude
  const double s = fj - j0;  // 0..1 along longitude

  const double h00 = g.h[static_cast<size_t>(i0) * g.nlon + j0];
  const double h01 = g.h[static_cast<size_t>(i0) * g.nlon + j0 + 1];
  const double h10 = g.h[static_cast<size_t>(i0 + 1) * g.nlon + j0];
  const double h11 = g.h[static_cast<size_t>(i0 + 1) * g.nlon + j0 + 1];

  // Bilinear height in "start + fraction * difference" form: a constant grid gives exactly that constant
  // and exactly zero slope.
  const double dLat0 = h10 - h00;      // change along latitude at column j0
  const double dLat1 = h11 - h01;      // change along latitude at column j0 + 1
  const double hA = h00 + u * dLat0;   // height at (lat, column j0)
  const double hB = h01 + u * dLat1;   // height at (lat, column j0 + 1)
  const double h = hA + s * (hB - hA);
  const double dh_dlat = clampLat ? 0.0 : (dLat0 + s * (dLat1 - dLat0)) / g.dlat;  // ft per rad
  const double dh_dlon = clampLon ? 0.0 : (hB - hA) / g.dlon;                      // ft per rad

  const double sinLat = std::sin(lat), cosLat = std::cos(lat);
  const double sinLon = std::sin(lon), cosLon = std::cos(lon);
  if (dh_dlat == 0.0 && dh_dlon == 0.0) {
    // Level ground: the same expression as JSBSim's FGDefaultGroundCallback.
    normal = JSBSim::FGColumnVector3(cosLat * cosLon, cosLat * sinLon, sinLat);
  } else {
    // Sloping ground. With N and M the prime-vertical and meridian radii of curvature, the surface
    // point is P(lat, lon) = ellipsoid point + h * up, so
    //   dP/dlat = (M + h) * north + dh/dlat * up
    //   dP/dlon = (N + h) * cos(lat) * east + dh/dlon * up
    // and the upward normal is  up - slopeNorth * north - slopeEast * east  (then made unit length).
    const double e2 = 1.0 - (b_ * b_) / (a_ * a_);
    const double W = std::sqrt(1.0 - e2 * sinLat * sinLat);
    const double N = a_ / W;
    const double M = a_ * (1.0 - e2) / (W * W * W);
    const double slopeNorth = dh_dlat / (M + h);
    const double slopeEast = dh_dlon / ((N + h) * cosLat);
    const JSBSim::FGColumnVector3 up(cosLat * cosLon, cosLat * sinLon, sinLat);
    const JSBSim::FGColumnVector3 north(-sinLat * cosLon, -sinLat * sinLon, cosLat);
    const JSBSim::FGColumnVector3 east(-sinLon, cosLon, 0.0);
    normal = up - slopeNorth * north - slopeEast * east;
    normal.Normalize();
  }

  contact.SetEllipse(a_, b_);
  contact.SetPositionGeodetic(lon, lat, h);
  return l.GetGeodAltitude() - h;
}

}  // namespace fdmhost
