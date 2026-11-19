// Native answer key: the same host C++ as the WebAssembly build, compiled with the system compiler.
//
//   fdm_native <scenario file> <output prefix> [<scenario file> <output prefix> ...]
//       writes <prefix>.bin (rows of doubles) and <prefix>.json (meta) for each scenario
//   fdm_native --ground-probe <grid file> <points file> <output file>
//       points: x y z (ECEF ft) per point; output: 7 doubles per point from the installed ground callback,
//       then 7 doubles per point from the independent calculation in tests/native/ground_oracle.cpp
//   fdm_native --selftest <jsbsim-data dir> <fixtures dir> <scratch dir>
//       wrapper self-test (tests/native/host_selftest.cpp)
//   fdm_native --version
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <string>
#include <vector>

#include "FGJSBBase.h"
#include "fdm_host.h"
#include "scenario_runner.h"

namespace fdmtest {
// tests/native/ground_oracle.cpp: shares no code with host/grid_ground.cpp.
void GroundOracle(const fdmhost::HeightGrid& grid, double a, double b, double x, double y, double z, double* out7);
// tests/native/host_selftest.cpp
int HostSelfTest(const std::string& data, const std::string& fix, const std::string& out);
}

namespace {

bool WriteFile(const std::string& path, const void* data, size_t bytes) {
  std::ofstream f(path, std::ios::binary);
  if (!f) return false;
  f.write(static_cast<const char*>(data), static_cast<std::streamsize>(bytes));
  return static_cast<bool>(f);
}

bool ReadDoubles(const std::string& path, std::vector<double>& out) {
  std::string raw;
  if (!fdmhost::ReadFile(path, raw) || raw.size() % sizeof(double) != 0) return false;
  out.resize(raw.size() / sizeof(double));
  std::memcpy(out.data(), raw.data(), raw.size());
  return true;
}

int GroundProbe(const char* gridFile, const char* pointsFile, const char* outFile) {
  std::vector<double> raw, pts;
  if (!ReadDoubles(gridFile, raw) || raw.size() < 6 || !ReadDoubles(pointsFile, pts) || pts.size() % 3 != 0) {
    std::fprintf(stderr, "cannot read grid or points\n");
    return 2;
  }
  auto grid = std::make_shared<fdmhost::HeightGrid>();
  grid->lat0 = raw[0]; grid->lon0 = raw[1]; grid->dlat = raw[2]; grid->dlon = raw[3];
  grid->nlat = static_cast<int>(raw[4]); grid->nlon = static_cast<int>(raw[5]);
  grid->h.assign(raw.begin() + 6, raw.end());
  fdmhost::FdmHost host(1.0 / 120.0, ".", ".");
  if (!host.SetGroundGrid(grid)) {
    std::fprintf(stderr, "%s\n", host.LastError().c_str());
    return 2;
  }
  // The ellipse the callback was installed with: JSBSim's default (WGS84), in feet.
  const double a = 20925646.32546, b = 20855486.5951;
  const size_t n = pts.size() / 3;
  std::vector<double> out(n * 14);
  for (size_t i = 0; i < n; ++i) {
    if (!host.GroundProbe(pts[3 * i], pts[3 * i + 1], pts[3 * i + 2], &out[7 * i])) {
      std::fprintf(stderr, "%s\n", host.LastError().c_str());
      return 2;
    }
    fdmtest::GroundOracle(*grid, a, b, pts[3 * i], pts[3 * i + 1], pts[3 * i + 2], &out[7 * (n + i)]);
  }
  return WriteFile(outFile, out.data(), out.size() * sizeof(double)) ? 0 : 2;
}

}  // namespace

int main(int argc, char** argv) {
  // JSBSim reads these two environment variables; the answer key must not depend on the caller's shell.
  unsetenv("JSBSIM_DEBUG");
  unsetenv("JSBSIM_DISPERSE");
  if (argc == 2 && std::strcmp(argv[1], "--version") == 0) {
    std::printf("JSBSim %s\n", JSBSim::FGJSBBase::GetVersion().c_str());
    return 0;
  }
  if (argc == 5 && std::strcmp(argv[1], "--ground-probe") == 0) return GroundProbe(argv[2], argv[3], argv[4]);
  if (argc == 5 && std::strcmp(argv[1], "--selftest") == 0) return fdmtest::HostSelfTest(argv[2], argv[3], argv[4]);
  if (argc < 3 || (argc - 1) % 2 != 0) {
    std::fprintf(stderr, "usage: fdm_native <scenario> <out prefix> [...] | --ground-probe <grid> <points> <out>\n");
    return 2;
  }
  int notDone = 0;
  for (int i = 1; i + 1 < argc; i += 2) {
    std::string text;
    fdmhost::ScenarioResult r;
    if (!fdmhost::ReadFile(argv[i], text)) {
      r.stage = "parse";
      r.message = std::string("cannot read scenario file ") + argv[i];
    } else {
      r = fdmhost::RunScenario(text);
    }
    const std::string prefix = argv[i + 1];
    const std::string meta = r.MetaJson();
    if (!WriteFile(prefix + ".bin", r.data.data(), r.data.size() * sizeof(double)) ||
        !WriteFile(prefix + ".json", meta.data(), meta.size())) {
      std::fprintf(stderr, "cannot write %s.*\n", prefix.c_str());
      return 2;
    }
    if (r.stage != "done") ++notDone;
  }
  // Exit code 0 even when a scenario did not finish: that is a result (recorded in the .json), not a tool failure.
  (void)notDone;
  return 0;
}
