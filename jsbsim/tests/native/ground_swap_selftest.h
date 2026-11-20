// Native self-test of replacing the ground grid after load and between steps (FdmHost::SetGroundGrid).
// New in FSG, milestone 1; called from host_selftest.cpp, so it runs with `fdm_native --selftest`.
// The same checks run against the WebAssembly builds from tests/ground-swap.test.js.
#pragma once
#include <cmath>
#include <cstring>
#include <functional>
#include <memory>
#include <string>
#include <vector>

#include "FGFDMExec.h"
#include "fdm_host.h"
#include "math/FGLocation.h"
#include "models/FGInertial.h"

namespace fdmtest {

using CheckFn = std::function<void(bool ok, const std::string& name, const std::string& detail)>;

inline void GroundSwapSelfTest(const std::string& data, const std::string& out, const CheckFn& Check) {
  using fdmhost::FdmHost;
  using fdmhost::HeightGrid;
  const double dt120 = 1.0 / 120.0;
  const double kRad = 3.14159265358979323846 / 180.0;
  const double lat = 21.3, lon = -157.9, d = 0.0005;  // posts about 180 ft apart
  // A patch of one sloping field: post (i, j) of the whole field is 0.5 i + 0.2 j ft high, wherever the
  // patch's corner is. The airplane stands on post (16, 16).
  auto patch = [&](int row0, int col0, int n) {
    auto g = std::make_shared<HeightGrid>();
    g->lat0 = (lat + (row0 - 16) * d) * kRad;
    g->lon0 = (lon + (col0 - 16) * d) * kRad;
    g->dlat = d * kRad;
    g->dlon = d * kRad;
    g->nlat = n;
    g->nlon = n;
    for (int i = 0; i < n; ++i)
      for (int j = 0; j < n; ++j) g->h.push_back(0.5 * (row0 + i) + 0.2 * (col0 + j));
    return g;
  };
  const char* const outs[] = {"position/ecef-x-ft", "position/ecef-y-ft", "position/ecef-z-ft", "position/h-agl-ft",
                              "velocities/u-fps", "velocities/v-fps", "velocities/w-fps", "velocities/p-rad_sec",
                              "velocities/q-rad_sec", "velocities/r-rad_sec", "attitude/phi-rad", "attitude/theta-rad",
                              "attitude/psi-rad", "forces/fbx-gear-lbs", "forces/fbz-gear-lbs", "velocities/vg-fps",
                              "gear/unit[1]/WOW"};
  const int nOut = static_cast<int>(sizeof(outs) / sizeof(outs[0]));
  // A Cessna on that field, engine running, a little power: a ground roll.
  auto start = [&](FdmHost& h, bool gridAfterLoad) {
    if (!gridAfterLoad) h.SetGroundGrid(patch(0, 0, 33));
    h.LoadModel("c172x");
    bool ok = true;
    if (gridAfterLoad) ok = h.SetGroundGrid(patch(0, 0, 33));
    h.Set(h.Prop("ic/lat-geod-deg"), lat);
    h.Set(h.Prop("ic/long-gc-deg"), lon);
    h.Set(h.Prop("ic/psi-true-deg"), 90.0);
    h.Set(h.Prop("ic/h-agl-ft"), 4.3);
    h.Set(h.Prop("propulsion/set-running"), -1.0);
    std::vector<int> handles;
    for (const char* name : outs) handles.push_back(h.Prop(name));
    h.BindOutputs(handles.data(), nOut);
    const int in[1] = {h.Prop("fcs/throttle-cmd-norm")};
    h.BindInputs(in, 1);
    ok = h.RunIC() && ok;
    h.In()[0] = 0.4;
    return ok;
  };
  FdmHost a(dt120, data, out), b(dt120, data, out);
  start(a, false);
  Check(start(b, true) && b.State() == FDM_RUNNING, "a grid given after load is accepted", b.LastError());
  bool accepted = true, same = true;
  long firstDifferent = -1;
  for (long k = 0; k < 3600 && same; ++k) {
    accepted = b.SetGroundGrid(patch(0, 0, 33)) && accepted;  // the same ground, a new grid, before every step
    a.Step(1);
    b.Step(1);
    if (std::memcmp(a.Curr(), b.Curr(), nOut * sizeof(double)) != 0) {
      same = false;
      firstDifferent = k;
    }
  }
  Check(accepted && b.State() == FDM_RUNNING, "a grid given between steps is accepted", b.LastError());
  Check(a.Curr()[15] > 5.0 && a.Curr()[16] == 1.0 && a.SimTime() > 29.9,
        "the run is a ground roll: 30 s, moving, wheels on the ground", "ground speed " + std::to_string(a.Curr()[15]) + " ft/s");
  Check(same, "the same grid replaced before each of 3600 steps: every output identical, bit for bit",
        same ? "" : "first difference at step " + std::to_string(firstDifferent));
  // The same field cut as a patch with another corner: the ground is where it was.
  auto inertial = a.Exec()->GetInertial();
  auto probeAll = [&](FdmHost& h) {
    std::vector<double> heights;
    for (int k = 0; k < 20; ++k) {
      JSBSim::FGLocation l;
      l.SetEllipse(inertial->GetSemimajor(), inertial->GetSemiminor());
      l.SetPositionGeodetic((lon + (k % 5 - 2.3) * 0.37 * d) * kRad, (lat + (k / 5 - 1.6) * 0.41 * d) * kRad, 50.0);
      double o[7];
      h.GroundProbe(l(1), l(2), l(3), o);
      heights.push_back(o[0]);
    }
    return heights;
  };
  const std::vector<double> before = probeAll(a);
  const bool swapped = a.SetGroundGrid(patch(8, 5, 20));
  const std::vector<double> after = probeAll(a);
  double worst = 0.0;
  for (int k = 0; k < 20; ++k) worst = std::fmax(worst, std::fabs(after[k] - before[k]));
  Check(swapped && worst <= 1e-6 && std::fabs(before[0] - before[19]) > 0.1,
        "a patch of the same field with another corner: 20 heights within 1e-6 ft",
        "largest difference " + std::to_string(worst * 1e9) + "e-9 ft");
  auto broken = std::make_shared<HeightGrid>(*patch(0, 0, 33));
  broken->h[5] = std::nan("");
  const bool refused = !a.SetGroundGrid(broken);
  Check(refused && probeAll(a) == after && a.State() == FDM_RUNNING && a.Step(1) == FDM_STEP_OK,
        "a grid with a NaN is refused between steps; the ground in place stays", a.LastError());
  FdmHost dead(dt120, data, out);
  dead.LoadModel("does_not_exist");
  Check(dead.State() == FDM_DEAD && !dead.SetGroundGrid(patch(0, 0, 33)), "a dead instance takes no grid", dead.LastError());
}

}  // namespace fdmtest
