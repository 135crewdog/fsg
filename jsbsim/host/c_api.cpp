// Plain C exports of the host layer. These are the only functions JavaScript calls.
// No C++ exception leaves any of them (FdmHost catches inside; the few direct calls here are guarded).
#include <cstdint>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

#include <malloc.h>
#include <unistd.h>

#include "FGJSBBase.h"
#include "fdm_host.h"
#include "scenario_runner.h"

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#include <emscripten/stack.h>
#define FDM_EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define FDM_EXPORT
#endif

using fdmhost::FdmHost;

namespace {
std::string g_error;       // error of a call that has no instance (fdm_new)
std::string g_text;        // backing store for returned strings
fdmhost::ScenarioResult g_scn;
std::string g_scnMeta;
}  // namespace

extern "C" {

// --- module level ------------------------------------------------------------------------------------------

FDM_EXPORT const char* fdm_version() {
  g_text = "JSBSim " + JSBSim::FGJSBBase::GetVersion();
  return g_text.c_str();
}

FDM_EXPORT const char* fdm_global_error() { return g_error.c_str(); }

// Returns all pending log records and removes them. Records are separated by 0x1E; the fields
// level, file, line, text are separated by 0x1F. Empty string when nothing is pending.
FDM_EXPORT const char* fdm_log_take() {
  auto logger = fdmhost::HostLogger::Install();
  g_text.clear();
  fdmhost::LogRecord r;
  while (logger->Take(r)) {
    g_text += std::to_string(r.level);
    g_text += '\x1f';
    g_text += r.file;
    g_text += '\x1f';
    g_text += std::to_string(r.line);
    g_text += '\x1f';
    g_text += r.text;
    g_text += '\x1e';
  }
  return g_text.c_str();
}

FDM_EXPORT double fdm_log_dropped() { return static_cast<double>(fdmhost::HostLogger::Install()->Dropped()); }

// Bytes in use on the C heap, and the top of the heap (grows only; shows the peak).
FDM_EXPORT double fdm_heap_in_use() {
#ifdef __EMSCRIPTEN__
  struct mallinfo mi = mallinfo();
  return static_cast<double>(static_cast<unsigned int>(mi.uordblks));
#else
  struct mallinfo2 mi = mallinfo2();
  return static_cast<double>(mi.uordblks);
#endif
}
FDM_EXPORT double fdm_heap_top() { return static_cast<double>(reinterpret_cast<uintptr_t>(sbrk(0))); }
FDM_EXPORT double fdm_stack_free() {
#ifdef __EMSCRIPTEN__
  return static_cast<double>(emscripten_stack_get_free());
#else
  return -1.0;
#endif
}

// --- instance ----------------------------------------------------------------------------------------------

FDM_EXPORT FdmHost* fdm_new(double dt, const char* root, const char* outdir) {
  try {
    auto host = std::make_unique<FdmHost>(dt, root ? root : "", outdir ? outdir : ".");
    if (host->State() != FDM_NEW) {
      g_error = host->LastError();
      return nullptr;
    }
    return host.release();
  } catch (...) {
    g_error = "fdm_new: out of memory or unexpected exception";
    return nullptr;
  }
}

FDM_EXPORT void fdm_delete(FdmHost* h) { delete h; }

FDM_EXPORT const char* fdm_last_error(FdmHost* h) { return h->LastError().c_str(); }
FDM_EXPORT int fdm_state(FdmHost* h) { return h->State(); }
FDM_EXPORT double fdm_dt(FdmHost* h) { return h->Dt(); }
FDM_EXPORT double fdm_sim_time(FdmHost* h) { return h->SimTime(); }
FDM_EXPORT double fdm_counter(FdmHost* h, int which) { return static_cast<double>(h->Counter(which)); }

FDM_EXPORT int fdm_set_paths(FdmHost* h, const char* aircraft, const char* engine, const char* systems) {
  return h->SetPaths(aircraft, engine, systems) ? 0 : -1;
}
FDM_EXPORT int fdm_set_integrators(FdmHost* h, int rr, int tr, int rp, int tp) {
  return h->SetIntegrators(rr, tr, rp, tp) ? 0 : -1;
}
// heights: nlat * nlon doubles, row by row (row = constant latitude). The grid is copied.
FDM_EXPORT int fdm_set_ground_grid(FdmHost* h, double lat0, double lon0, double dlat, double dlon, int nlat,
                                   int nlon, const double* heights) {
  if (nlat < 2 || nlon < 2 || !heights) return -1;
  auto grid = std::make_shared<fdmhost::HeightGrid>();
  grid->lat0 = lat0; grid->lon0 = lon0; grid->dlat = dlat; grid->dlon = dlon;
  grid->nlat = nlat; grid->nlon = nlon;
  grid->h.assign(heights, heights + static_cast<size_t>(nlat) * static_cast<size_t>(nlon));
  return h->SetGroundGrid(grid) ? 0 : -1;
}

FDM_EXPORT int fdm_load_model(FdmHost* h, const char* name) { return h->LoadModel(name) ? 0 : -1; }
FDM_EXPORT int fdm_load_script(FdmHost* h, const char* path, const char* initfile) {
  return h->LoadScript(path, initfile ? initfile : "") ? 0 : -1;
}
FDM_EXPORT int fdm_load_ic(FdmHost* h, const char* file) { return h->LoadIC(file) ? 0 : -1; }
FDM_EXPORT int fdm_run_ic(FdmHost* h) { return h->RunIC() ? 0 : -1; }

FDM_EXPORT int fdm_prop(FdmHost* h, const char* name) { return h->Prop(name); }
FDM_EXPORT int fdm_prop_flags(FdmHost* h, int handle) { return h->PropFlags(handle); }
FDM_EXPORT double fdm_get(FdmHost* h, int handle) { return h->Get(handle); }
FDM_EXPORT int fdm_set(FdmHost* h, int handle, double value) { return h->Set(handle, value); }
FDM_EXPORT double fdm_set_readback(FdmHost* h) { return h->SetReadback(); }

FDM_EXPORT int fdm_bind_inputs(FdmHost* h, const int* handles, int n) { return h->BindInputs(handles, n) ? 0 : -1; }
FDM_EXPORT int fdm_bind_outputs(FdmHost* h, const int* handles, int n) { return h->BindOutputs(handles, n) ? 0 : -1; }
FDM_EXPORT double* fdm_in(FdmHost* h) { return h->In(); }
FDM_EXPORT double* fdm_prev(FdmHost* h) { return h->Prev(); }
FDM_EXPORT double* fdm_curr(FdmHost* h) { return h->Curr(); }

FDM_EXPORT int fdm_step(FdmHost* h, int n) { return h->Step(n); }
FDM_EXPORT int fdm_steps_in_last_call(FdmHost* h) { return h->StepsInLastCall(); }

// out7: height (ft), normal x y z, contact x y z (ECEF ft).
FDM_EXPORT int fdm_ground_probe(FdmHost* h, double x, double y, double z, double* out7) {
  return h->GroundProbe(x, y, z, out7) ? 0 : -1;
}

// --- scenario runner (tests) ------------------------------------------------------------------------------

// Runs the scenario in the given file. Returns 0 when it ran to the end ("done"), else 1.
FDM_EXPORT int fdm_scn_run(const char* scenarioPath) {
  std::string text;
  if (!fdmhost::ReadFile(scenarioPath, text)) {
    g_scn = fdmhost::ScenarioResult();
    g_scn.stage = "parse";
    g_scn.message = std::string("cannot read scenario file ") + scenarioPath;
  } else {
    g_scn = fdmhost::RunScenario(text);
  }
  g_scnMeta = g_scn.MetaJson();
  return g_scn.stage == "done" ? 0 : 1;
}
FDM_EXPORT const char* fdm_scn_meta() { return g_scnMeta.c_str(); }
FDM_EXPORT double* fdm_scn_data() { return g_scn.data.data(); }
FDM_EXPORT void fdm_scn_free() {
  g_scn = fdmhost::ScenarioResult();
  g_scnMeta.clear();
}

}  // extern "C"

#ifdef __EMSCRIPTEN__
// The module has no program to run; main exists only so the runtime initialises normally.
int main() { return 0; }
#endif
