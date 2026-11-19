// Test support compiled into BOTH the native answer key and the WebAssembly binary: runs one scenario
// through FdmHost and records a trace. Because the same runner is in both builds, a native/wasm
// difference comes from the compiler and maths library, not from two different test drivers.
//
// Scenario text: one directive per line, "key value...". Lines starting with # are ignored.
//   root <dir>                 JSBSim root folder
//   outdir <dir>               folder JSBSim may write to
//   paths <aircraft> <engine> <systems>   optional; relative to root or absolute
//   dt <seconds>               0 = take the script's own dt
//   integrators <rr> <tr> <rp> <tp>       optional; -1 = keep what the load produced
//   ground <grid file>         optional; binary: lat0 lon0 dlat dlon nlat nlon, then nlat*nlon heights (doubles)
//   model <name>               or:  script <path> [<initfile>]
//   ic <file>                  optional, with model
//   set <property> <value>     optional, repeated; applied after load, before RunIC
//   add <property> <delta>     optional, repeated; property += delta, after load, before RunIC
//   out <property>             repeated: recorded columns
//   outgear                    record WOW of every gear / contact unit
//   in <property>              repeated: bulk inputs
//   inputs <file>              binary doubles, one row of inputs per step
//   steps <n>                  maximum number of steps
//   duration <seconds>         alternative to steps: floor(duration / dt + 1e-9) steps
#pragma once
#include <string>
#include <vector>

namespace fdmhost {

struct ScenarioResult {
  bool loaded = false;        // LoadModel / LoadScript succeeded
  bool icOk = false;          // RunIC succeeded
  std::string stage;          // where it stopped: "parse", "create", "load", "setup", "runic", "step", "done"
  std::string message;        // error text when stage != "done"
  int endCode = 0;            // last FdmStepResult
  long stepsDone = 0;
  double dt = 0.0;
  std::vector<std::string> columns;
  long rows = 0;              // rows recorded; row 0 is the state after RunIC
  std::vector<double> data;   // rows * columns.size()
  long long counters[8] = {0};
  std::string MetaJson() const;
};

// scenarioText: the directives. Never throws.
ScenarioResult RunScenario(const std::string& scenarioText);

// Reads a whole file; false if it cannot be read.
bool ReadFile(const std::string& path, std::string& out);

}  // namespace fdmhost
