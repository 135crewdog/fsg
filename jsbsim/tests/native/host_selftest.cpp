// Native self-test of the host wrapper (criterion 3, "natively where it applies").
// The same checks run against the WebAssembly builds from tests/wrapper.test.ts.
//   fdm_native --selftest <jsbsim-data dir> <fixtures dir> <scratch dir>
#include <cmath>
#include <cstdio>
#include <functional>
#include <limits>
#include <memory>
#include <string>

#include "FGFDMExec.h"
#include "fdm_host.h"
#include "input_output/FGPropertyManager.h"

namespace fdmtest {

namespace {
int g_failed = 0;
void Check(bool ok, const std::string& name, const std::string& detail = std::string()) {
  std::printf("%s %s%s%s\n", ok ? "ok  " : "FAIL", name.c_str(), detail.empty() ? "" : ": ", detail.c_str());
  if (!ok) ++g_failed;
}
const char* const kInteg[4] = {"simulation/integrator/rate/rotational", "simulation/integrator/rate/translational",
                               "simulation/integrator/position/rotational",
                               "simulation/integrator/position/translational"};
std::string IntegString(fdmhost::FdmHost& h) {
  std::string s;
  for (const char* n : kInteg) s += std::to_string(static_cast<int>(h.Get(h.Prop(n)))) + " ";
  return s;
}
}  // namespace

int HostSelfTest(const std::string& data, const std::string& fix, const std::string& out) {
  using fdmhost::FdmHost;
  const double dt120 = 1.0 / 120.0, dt240 = 1.0 / 240.0;
  auto logger = fdmhost::HostLogger::Install();

  {  // one load per instance
    FdmHost h(dt120, data, out);
    Check(h.LoadModel("c172x"), "load c172x", h.LastError());
    Check(!h.LoadModel("c172x") && h.LastError().find("already loaded") != std::string::npos,
          "second LoadModel refused", h.LastError());
    Check(!h.LoadScript("scripts/c1723.xml", "") && h.LastError().find("already loaded") != std::string::npos,
          "LoadScript after LoadModel refused", h.LastError());
    Check(h.State() == FDM_LOADED, "instance still usable after the refused load");
  }
  {  // dt set before load is in force after load and RunIC
    FdmHost h(dt240, data, out);
    h.LoadModel("c172x");
    Check(h.Dt() == dt240 && h.Exec()->GetDeltaT() == dt240, "dt after LoadModel");
    h.LoadIC("reset01");
    Check(h.RunIC(), "RunIC", h.LastError());
    Check(h.Exec()->GetDeltaT() == dt240 && h.Get(h.Prop("simulation/dt")) == dt240, "dt after RunIC");
    Check(IntegString(h) == "1 3 1 4 ", "integrators after load and RunIC are the configured defaults", IntegString(h));
    Check(h.Step(10) == FDM_STEP_OK && std::fabs(h.SimTime() - 10 * dt240) < 1e-12, "10 steps advance time by 10 dt");
  }
  {  // a script's own dt is overridden by the host dt, or taken when the host dt is 0
    FdmHost a(dt120, data, out);
    Check(a.LoadScript(fix + "/scripts/t_short.xml", ""), "load t_short (host dt 1/120)", a.LastError());
    Check(a.Exec()->GetDeltaT() == dt120, "script loaded with a host dt runs at the host dt");
    FdmHost b(0.0, data, out);
    b.LoadScript(fix + "/scripts/t_short.xml", "");
    Check(b.Dt() == 0.02 && b.Exec()->GetDeltaT() == 0.02, "host dt 0 takes the script's dt (0.02)");
    FdmHost c(0.0, data, out);
    Check(!c.LoadModel("c172x"), "LoadModel with dt 0 refused");
  }
  {  // integrator settings changed by a script
    FdmHost a(dt120, data, out);
    a.LoadScript(fix + "/scripts/t_integrators.xml", "");
    Check(IntegString(a) == "1 3 1 4 " && a.Counter(FDM_CNT_INTEGRATORS_RESTORED) == 1,
          "script set rate/rotational = 4 at load: put back to 1 and counted", IntegString(a));
    a.RunIC();
    Check(IntegString(a) == "1 3 1 4 ", "integrators after RunIC", IntegString(a));
    a.Step(30);
    Check(IntegString(a) == "1 3 2 4 " && a.Counter(FDM_CNT_INTEGRATORS_CHANGED) == 1,
          "script event changed position/rotational while stepping: reported, not undone", IntegString(a));
    FdmHost b(dt120, data, out);
    b.SetIntegrators(-1, -1, -1, -1);
    b.LoadScript(fix + "/scripts/t_integrators.xml", "");
    Check(IntegString(b) == "4 3 1 4 " && b.Counter(FDM_CNT_INTEGRATORS_RESTORED) == 0,
          "with 'keep' (-1) the script's setting stays", IntegString(b));
  }
  {  // validated writes
    FdmHost h(dt120, data, out);
    h.LoadModel("c172x");
    const int ro = h.Prop("simulation/sim-time-sec");
    const int thr = h.Prop("fcs/throttle-cmd-norm");
    const int integ = h.Prop(kInteg[0]);
    const double t0 = h.Get(ro);
    Check(h.Set(ro, 5.0) == FDM_SET_READ_ONLY && h.Get(ro) == t0, "read-only write refused, value kept");
    Check(h.Set(thr, 0.25) == FDM_SET_OK && h.Get(thr) == 0.25 && h.SetReadback() == 0.25, "normal write and readback");
    Check(h.Set(thr, std::nan("")) == FDM_SET_NAN && h.Get(thr) == 0.25, "NaN refused, value kept");
    Check(h.Set(thr, std::numeric_limits<double>::infinity()) == FDM_SET_NAN && h.Get(thr) == 0.25,
          "infinity refused, value kept");
    Check(h.Set(integ, 1.5) == FDM_SET_NOT_INTEGER && h.Get(integ) == 1.0, "non-integer to an int property refused");
    Check(h.Set(999, 1.0) == FDM_SET_BAD_HANDLE, "bad handle refused");
    Check(h.Prop("no/such/property") == -1 && h.LastError().find("unknown property") != std::string::npos,
          "unknown property is an error", h.LastError());
    Check(h.Exec()->GetPropertyManager()->GetNode("no/such/property", false) == nullptr,
          "the unknown property was not created");
    Check(h.Prop("fcs/[bad") == -1, "invalid property path is an error", h.LastError());
    Check(h.Prop("fcs") == -1 && h.LastError().find("folder") != std::string::npos, "a folder is not a value", h.LastError());
    const int roH[1] = {ro};
    Check(!h.BindInputs(roH, 1), "binding a read-only property as input refused", h.LastError());
    // A NaN in the bulk inputs: the step is refused and nothing moves.
    const int in[1] = {thr};
    h.BindInputs(in, 1);
    h.LoadIC("reset01");
    h.RunIC();
    h.In()[0] = std::nan("");
    const double tBefore = h.SimTime();
    Check(h.Step(1) == FDM_STEP_BAD_INPUT && h.SimTime() == tBefore && h.State() == FDM_RUNNING,
          "NaN bulk input: step refused, time not advanced", h.LastError());
    h.In()[0] = 0.5;
    Check(h.Step(1) == FDM_STEP_OK && h.Get(thr) == 0.5, "bulk input written on the next good step");
  }
  {  // malformed aircraft: JSBSim's message, and a log record
    const uint64_t mark = logger->NextSeq();
    FdmHost h(dt120, data, out);
    h.SetPaths(fix + "/aircraft", "engine", "systems");
    const bool ok = h.LoadModel("broken_xml");
    Check(!ok && h.State() == FDM_DEAD, "malformed aircraft does not load; instance dead");
    Check(h.LastError().find("XML parse error") != std::string::npos &&
              h.LastError().find("broken_xml.xml") != std::string::npos,
          "error text carries JSBSim's message", h.LastError());
    Check(logger->NextSeq() > mark, "a JSBSim log record was captured during the load");
    FdmHost m(dt120, data, out);
    Check(!m.LoadModel("does_not_exist") && m.LastError().find("does_not_exist") != std::string::npos,
          "missing aircraft: message names the file", m.LastError());
  }
  {  // events
    FdmHost a(0.0, data, out);
    a.LoadScript(fix + "/scripts/t_short.xml", "");
    a.RunIC();
    const int r = a.Step(1000);
    Check(r == FDM_STEP_SCRIPT_END && a.State() == FDM_ENDED && a.StepsInLastCall() < 1000,
          "script end reported", "steps " + std::to_string(a.StepsInLastCall()));
    Check(a.Step(1) == FDM_STEP_SCRIPT_END && a.StepsInLastCall() == 0, "no steps after the end");
    FdmHost b(0.0, data, out);
    b.LoadScript(fix + "/scripts/t_terminate.xml", "");
    b.RunIC();
    const int rb = b.Step(1000);
    Check(rb == FDM_STEP_TERMINATE && b.State() == FDM_ENDED && b.SimTime() > 0.24 && b.SimTime() < 0.3,
          "simulation/terminate reported", "t " + std::to_string(b.SimTime()));
    FdmHost c(dt120, data, out);
    c.SetPaths(fix + "/aircraft", "engine", "systems");
    Check(c.LoadModel("c172x_ext20"), "load c172x_ext20", c.LastError());
    c.LoadIC("reset01");
    c.RunIC();
    const int mag = c.Prop("external_reactions/f00/magnitude");
    Check(mag >= 0 && c.Set(mag, 1e300) == FDM_SET_OK, "set a force no state can survive", c.LastError());
    const int rc = c.Step(1000);
    Check(rc == FDM_STEP_NONFINITE && c.State() == FDM_DEAD, "non-finite state reported",
          "result " + std::to_string(rc) + " after " + std::to_string(c.StepsInLastCall()) + " steps");
    Check(c.Step(1) == FDM_STEP_NOT_RUNNING, "a dead instance does not step");
  }
  std::printf("%s: %d failed\n", g_failed ? "FAILED" : "all ok", g_failed);
  return g_failed ? 1 : 0;
}

}  // namespace fdmtest
