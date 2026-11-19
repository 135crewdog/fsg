// Host layer (not physics): a ground callback that reads terrain height from a grid we supply.
//
// The grid holds heights in feet above the reference ellipsoid on a regular grid in geodetic latitude and
// longitude. Inside the grid the height is bilinear; outside it the edge value is used.
//
// What JSBSim expects from FGGroundCallback::GetAGLevel (JSBSim v1.3.3: FGLGear.cpp, FGInertial.cpp,
// FGPropagate.cpp):
//   return value  height of `location` above the ground, measured along the local vertical, in feet
//   contact       the ground point directly below `location` (same latitude and longitude), ellipse set
//   normal        unit vector normal to the ground surface, pointing up, in the ECEF frame
//   v, w          linear and angular velocity of the ground in ECEF (zero here)
#pragma once
#include <cstdint>
#include <memory>
#include <vector>

#include "FGJSBBase.h"  // defines JSBSIM_API, which the next header needs
#include "input_output/FGGroundCallback.h"

namespace fdmhost {

struct HeightGrid {
  double lat0 = 0.0;   // geodetic latitude of row 0, rad
  double lon0 = 0.0;   // longitude of column 0, rad
  double dlat = 0.0;   // row spacing, rad (> 0)
  double dlon = 0.0;   // column spacing, rad (> 0)
  int nlat = 0;        // number of rows (>= 2)
  int nlon = 0;        // number of columns (>= 2)
  std::vector<double> h;  // nlat * nlon heights, ft above the ellipsoid; h[row * nlon + column]
  bool Valid() const;
};

struct GroundStats {
  uint64_t calls = 0;                     // GetAGLevel calls on our callback
  uint64_t terrainElevationIgnored = 0;   // SetTerrainElevation calls we ignored
};

class GridGround : public JSBSim::FGGroundCallback {
 public:
  GridGround(std::shared_ptr<const HeightGrid> grid, double semiMajor, double semiMinor,
             std::shared_ptr<GroundStats> stats)
      : grid_(std::move(grid)), a_(semiMajor), b_(semiMinor), stats_(std::move(stats)) {}

  using JSBSim::FGGroundCallback::GetAGLevel;
  double GetAGLevel(double t, const JSBSim::FGLocation& location, JSBSim::FGLocation& contact,
                    JSBSim::FGColumnVector3& normal, JSBSim::FGColumnVector3& v,
                    JSBSim::FGColumnVector3& w) const override;

  // The grid is the terrain; a single elevation number from an initial-condition file or a property is ignored.
  void SetTerrainElevation(double) override { ++stats_->terrainElevationIgnored; }
  void SetEllipse(double semimajor, double semiminor) override { a_ = semimajor; b_ = semiminor; }

 private:
  std::shared_ptr<const HeightGrid> grid_;
  double a_, b_;
  std::shared_ptr<GroundStats> stats_;
};

}  // namespace fdmhost
