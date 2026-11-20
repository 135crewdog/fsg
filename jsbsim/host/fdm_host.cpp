// From 135crewdog/FDM, host/fdm_host.cpp, commit e478825. Changed for FSG (milestone 1): SetGroundGrid is also
// allowed after load and between steps. Nothing else is changed; tools/from-fdm.mjs lists the change.
#include "fdm_host.h"

#include <climits>
#include <cmath>
#include <cstring>
#include <exception>
#include <limits>

#include "FGFDMExec.h"
#include "FGJSBBase.h"
#include "initialization/FGInitialCondition.h"
#include "input_output/FGPropertyManager.h"
#include "math/FGColumnVector3.h"
#include "math/FGLocation.h"
#include "models/FGInertial.h"
#include "models/FGInput.h"
#include "models/FGPropagate.h"
#include "simgear/misc/sg_path.hxx"
#include "simgear/props/props.hxx"

namespace fdmhost {

namespace {
const char* const kIntegratorProps[4] = {
    "simulation/integrator/rate/rotational",
    "simulation/integrator/rate/translational",
    "simulation/integrator/position/rotational",
    "simulation/integrator/position/translational",
};
std::string Trim(const std::string& s) {
  const char* ws = " \t\r\n";
  const size_t b = s.find_first_not_of(ws);
  if (b == std::string::npos) return std::string();
  return s.substr(b, s.find_last_not_of(ws) - b + 1);
}
const int kLevelWarn = static_cast<int>(JSBSim::LogLevel::WARN);
const int kLevelError = static_cast<int>(JSBSim::LogLevel::ERROR);
}  // namespace

// Runs `body`, which returns bool. Any C++ exception is caught here, so none leaves the host layer.
// On failure the message is JSBSim's exception text plus the ERROR/FATAL log records of this call
// (many JSBSim load failures only log and return false; XML errors carry the file and line in the log).
template <class F>
bool FdmHost::Guard(const char* what, F&& body) {
  const uint64_t mark = logger_->NextSeq();
  bool ok = false;
  bool threw = false;
  std::string text;
  try {
    ok = body();
  } catch (const std::exception& e) {  // JSBSim::BaseException, LogException, TrimFailureException, ...
    threw = true;
    text = e.what();                   // copy now: the buffer belongs to the exception object
  } catch (const std::string& s) {     // simgear's property code throws std::string
    threw = true;
    text = s;
  } catch (const char* s) {
    threw = true;
    text = s ? s : "";
  } catch (...) {
    threw = true;
    text = "unknown C++ exception";
  }
  if (ok && !threw) return true;
  // The exception object is gone now; a LogException has replayed its record into the logger.
  std::string logged = Trim(logger_->TextSince(mark, kLevelError));
  text = Trim(text);
  std::string message = std::string(what) + (threw ? " threw: " : " failed");
  if (threw) message += text;
  // Add the logged errors unless they only repeat the exception text (a LogException replays itself).
  if (!logged.empty() && logged.find(text) == std::string::npos) message += (threw ? "\n" : ": ") + logged;
  else if (!logged.empty() && logged.size() > text.size()) message = std::string(what) + (threw ? " threw: " : " failed: ") + logged;
  lastError_ = message;
  return false;
}

bool FdmHost::Fail(const std::string& message) {
  lastError_ = message;
  return false;
}

FdmHost::FdmHost(double dt, const std::string& root, const std::string& outDir)
    : logger_(HostLogger::Install()), groundStats_(std::make_shared<GroundStats>()) {
  if (!(std::isfinite(dt) && dt >= 0.0 && dt <= 1.0)) {
    state_ = FDM_DEAD;
    lastError_ = "dt must be 0 (take the script's dt) or between 0 and 1 s";
    return;
  }
  dt_ = dt;
  const bool ok = Guard("creating FGFDMExec", [&] {
    JSBSim::FGJSBBase::debug_lvl = 0;  // JSBSim's console chatter off (a static shared by all instances)
    fdm_ = std::make_unique<JSBSim::FGFDMExec>();
    fdm_->SetDebugLevel(0);
    if (dt_ > 0.0) fdm_->Setdt(dt_);  // before any load: filters bake dt in when they are built
    fdm_->SetRootDir(SGPath(root));
    fdm_->SetAircraftPath(SGPath("aircraft"));
    fdm_->SetEnginePath(SGPath("engine"));
    fdm_->SetSystemsPath(SGPath("systems"));
    fdm_->SetOutputPath(SGPath(outDir));  // before load: output file names are fixed when they are parsed
    fdm_->GetInput()->Disable();          // no socket input (I/O, not physics)
    return true;
  });
  if (!ok) state_ = FDM_DEAD;
}

FdmHost::~FdmHost() {
  // Destroying FGFDMExec must not throw into the caller either.
  try {
    fdm_.reset();
  } catch (...) {
  }
}

bool FdmHost::SetPaths(const std::string& aircraft, const std::string& engine, const std::string& systems) {
  if (state_ != FDM_NEW) return Fail("SetPaths: only before load");
  return Guard("SetPaths", [&] {
    fdm_->SetAircraftPath(SGPath(aircraft));
    fdm_->SetEnginePath(SGPath(engine));
    fdm_->SetSystemsPath(SGPath(systems));
    return true;
  });
}

bool FdmHost::SetIntegrators(int rateRot, int rateTrans, int posRot, int posTrans) {
  if (state_ != FDM_NEW) return Fail("SetIntegrators: only before load");
  const int v[4] = {rateRot, rateTrans, posRot, posTrans};
  for (int x : v)
    if (x < -1 || x > 9) return Fail("SetIntegrators: values must be -1 (keep) or 0..9");
  for (int i = 0; i < 4; ++i) integConfigured_[i] = v[i];
  return true;
}

void FdmHost::InstallGround() {
  if (!grid_) return;
  auto inertial = fdm_->GetInertial();
  // FGInertial takes ownership and deletes the previous callback.
  inertial->SetGroundCallback(
      new GridGround(grid_, inertial->GetSemimajor(), inertial->GetSemiminor(), groundStats_));
}

bool FdmHost::SetGroundGrid(std::shared_ptr<const HeightGrid> grid) {
  // FSG: also after load and between steps, so the game can replace the patch of ground under the
  // airplane as it flies (FlightGear keeps a ground cache behind its callback the same way). A refused
  // grid leaves the one in place.
  if (state_ != FDM_NEW && state_ != FDM_LOADED && state_ != FDM_RUNNING)
    return Fail("SetGroundGrid: this instance has ended or is dead");
  if (!grid || !grid->Valid()) return Fail("SetGroundGrid: invalid grid");
  grid_ = std::move(grid);
  // Installed before load: the initial-condition maths and FGPropagate::InitModel already ask the ground.
  return Guard("SetGroundGrid", [&] {
    InstallGround();
    return true;
  });
}

void FdmHost::ReadIntegrators(int out[4]) const {
  for (int i = 0; i < 4; ++i) out[i] = integNode_[i] ? integNode_[i]->getIntValue() : -1;
}

// After load and after RunIC: put dt and the integrator settings back if they are not what was configured.
void FdmHost::EnforceSettings(bool afterLoad) {
  if (fdm_->GetDeltaT() != dt_) {
    fdm_->Setdt(dt_);
    ++counters_[FDM_CNT_DT_RESTORED];
    logger_->HostMessage(kLevelWarn, "host: dt was changed by JSBSim; put back to the configured value");
  }
  int now[4];
  ReadIntegrators(now);
  bool restored = false;
  for (int i = 0; i < 4; ++i) {
    // After load the target is the configured value (or what the load produced, for -1).
    // After RunIC the target is what was in force after load.
    const int want = afterLoad ? (integConfigured_[i] >= 0 ? integConfigured_[i] : now[i]) : integExpected_[i];
    if (now[i] != want) {
      integNode_[i]->setIntValue(want);
      restored = true;
    }
    integExpected_[i] = want;
  }
  if (restored) {
    ++counters_[FDM_CNT_INTEGRATORS_RESTORED];
    logger_->HostMessage(kLevelWarn, "host: integrator settings were not the configured ones; put back");
  }
}

bool FdmHost::AfterLoad(const char* what) {
  return Guard(what, [&] {
    auto pm = fdm_->GetPropertyManager();
    for (int i = 0; i < 4; ++i) {
      integNode_[i] = pm->GetNode(kIntegratorProps[i], false);
      if (!integNode_[i]) throw std::string("integrator property missing: ") + kIntegratorProps[i];
    }
    terminateNode_ = pm->GetNode("simulation/terminate", false);
    if (dt_ == 0.0) dt_ = fdm_->GetDeltaT();  // script mode: lock the script's own dt
    if (!(dt_ > 0.0)) throw std::string("dt is not positive after load");
    InstallGround();          // again after load, with the loaded model's ellipse (a <planet> may change it)
    fdm_->DisableOutput();    // no CSV / socket output while stepping (I/O, not physics)
    EnforceSettings(true);
    state_ = FDM_LOADED;
    return true;
  });
}

bool FdmHost::LoadModel(const std::string& name) {
  if (state_ != FDM_NEW) return Fail("LoadModel: this instance has already loaded; create a new instance");
  if (!(dt_ > 0.0)) return Fail("LoadModel: dt must be set (> 0) when creating the instance");
  state_ = FDM_DEAD;  // stays dead unless everything below succeeds
  if (!Guard("LoadModel", [&] { return fdm_->LoadModel(name); })) return false;
  return AfterLoad("after LoadModel");
}

bool FdmHost::LoadScript(const std::string& path, const std::string& initfile) {
  if (state_ != FDM_NEW) return Fail("LoadScript: this instance has already loaded; create a new instance");
  state_ = FDM_DEAD;
  // A non-zero dt here overrides the script's <run dt>; JSBSim sets it before it loads the aircraft.
  if (!Guard("LoadScript", [&] { return fdm_->LoadScript(SGPath(path), dt_, SGPath(initfile)); })) return false;
  return AfterLoad("after LoadScript");
}

bool FdmHost::LoadIC(const std::string& file) {
  if (state_ != FDM_LOADED) return Fail("LoadIC: load an aircraft first (and before RunIC)");
  if (!Guard("LoadIC", [&] { return fdm_->GetIC()->Load(SGPath(file), true); })) {
    state_ = FDM_DEAD;
    return false;
  }
  return true;
}

bool FdmHost::RunIC() {
  if (state_ != FDM_LOADED) return Fail("RunIC: load an aircraft first; RunIC runs once per instance");
  state_ = FDM_DEAD;
  if (!Guard("RunIC", [&] { return fdm_->RunIC(); })) return false;
  if (!Guard("after RunIC", [&] {
        EnforceSettings(false);
        lastSimTime_ = fdm_->GetSimTime();
        ReadOutputs();
        prev_ = curr_;
        return true;
      }))
    return false;
  if (!StateFinite()) return Fail("RunIC: the initial state is not finite");
  state_ = FDM_RUNNING;
  return true;
}

// --- properties ----------------------------------------------------------------------------------------

int FdmHost::Prop(const std::string& name) {
  if (state_ == FDM_NEW || state_ == FDM_DEAD) {
    Fail("Prop: load an aircraft first");
    return -1;
  }
  auto found = handleByName_.find(name);
  if (found != handleByName_.end()) return found->second;
  int handle = -1;
  Guard("Prop", [&] {
    // GetNode with create = false never adds a node; an invalid path makes simgear throw std::string.
    SGPropertyNode* node = fdm_->GetPropertyManager()->GetNode(name, false);
    if (!node) throw std::string("unknown property: ") + name;
    const simgear::props::Type type = node->getType();
    // A node with children and no value of its own is a folder. A leaf that has never been written
    // (JSBSim creates some inputs that way, e.g. external_reactions/<name>/magnitude) is a value: it reads 0.
    if (type == simgear::props::NONE && node->nChildren() > 0)
      throw std::string("not a value (a folder): ") + name;
    int flags = 0;
    if (node->getAttribute(SGPropertyNode::READ)) flags |= FDM_PROP_READ;
    if (node->getAttribute(SGPropertyNode::WRITE)) flags |= FDM_PROP_WRITE;
    if (type == simgear::props::INT || type == simgear::props::LONG || type == simgear::props::BOOL)
      flags |= FDM_PROP_INTEGER;
    handles_.push_back(Handle{node, flags, name});
    handle = static_cast<int>(handles_.size()) - 1;
    handleByName_[name] = handle;
    return true;
  });
  return handle;
}

int FdmHost::PropFlags(int handle) const {
  if (handle < 0 || handle >= static_cast<int>(handles_.size())) return -1;
  return handles_[handle].flags;
}

double FdmHost::Get(int handle) {
  if (handle < 0 || handle >= static_cast<int>(handles_.size()) || state_ == FDM_DEAD) {
    Fail("Get: bad handle or dead instance");
    return std::numeric_limits<double>::quiet_NaN();
  }
  double value = std::numeric_limits<double>::quiet_NaN();
  Guard("Get", [&] {
    value = handles_[handle].node->getDoubleValue();
    return true;
  });
  return value;
}

// Checks a value against a property without writing it.
int FdmHost::CheckValue(const Handle& h, double value) const {
  if (!std::isfinite(value)) return FDM_SET_NAN;
  if (!(h.flags & FDM_PROP_WRITE)) return FDM_SET_READ_ONLY;
  if (h.flags & FDM_PROP_INTEGER) {
    // JSBSim would silently truncate (0.9 -> 0); refuse instead.
    if (value != std::trunc(value) || value < INT_MIN || value > INT_MAX) return FDM_SET_NOT_INTEGER;
  }
  return FDM_SET_OK;
}

int FdmHost::Set(int handle, double value) {
  if (handle < 0 || handle >= static_cast<int>(handles_.size()) || state_ == FDM_DEAD) return FDM_SET_BAD_HANDLE;
  const Handle& h = handles_[handle];
  int status = CheckValue(h, value);
  if (status != FDM_SET_OK) return status;
  // A setter can run JSBSim code (for example simulation/do_simple_trim) and throw.
  const bool ok = Guard("Set", [&] {
    if (!h.node->setDoubleValue(value)) {
      status = FDM_SET_REJECTED;
      return true;
    }
    if (h.flags & FDM_PROP_READ) {
      setReadback_ = h.node->getDoubleValue();
      if (setReadback_ != value) status = FDM_SET_READBACK_DIFFERS;
    } else {
      setReadback_ = value;
    }
    return true;
  });
  if (!ok) {
    state_ = FDM_DEAD;  // JSBSim threw inside a setter: its state is unknown
    return FDM_SET_REJECTED;
  }
  return status;
}

bool FdmHost::BindInputs(const int* handles, int n) {
  if (state_ != FDM_LOADED && state_ != FDM_RUNNING) return Fail("BindInputs: load an aircraft first");
  if (n < 0 || (n > 0 && !handles)) return Fail("BindInputs: bad arguments");
  for (int i = 0; i < n; ++i) {
    if (handles[i] < 0 || handles[i] >= static_cast<int>(handles_.size())) return Fail("BindInputs: bad handle");
    if (!(handles_[handles[i]].flags & FDM_PROP_WRITE))
      return Fail("BindInputs: read-only property: " + handles_[handles[i]].name);
  }
  inHandles_.assign(handles, handles + n);
  in_.assign(static_cast<size_t>(n), 0.0);
  // Start from the current values so that an input the caller never writes keeps its value.
  for (int i = 0; i < n; ++i) {
    const Handle& h = handles_[inHandles_[i]];
    in_[i] = (h.flags & FDM_PROP_READ) ? h.node->getDoubleValue() : 0.0;
  }
  return true;
}

bool FdmHost::BindOutputs(const int* handles, int n) {
  if (state_ != FDM_LOADED && state_ != FDM_RUNNING) return Fail("BindOutputs: load an aircraft first");
  if (n < 0 || (n > 0 && !handles)) return Fail("BindOutputs: bad arguments");
  for (int i = 0; i < n; ++i) {
    if (handles[i] < 0 || handles[i] >= static_cast<int>(handles_.size())) return Fail("BindOutputs: bad handle");
    if (!(handles_[handles[i]].flags & FDM_PROP_READ))
      return Fail("BindOutputs: write-only property: " + handles_[handles[i]].name);
  }
  outHandles_.assign(handles, handles + n);
  curr_.assign(static_cast<size_t>(n), 0.0);
  prev_.assign(static_cast<size_t>(n), 0.0);
  return Guard("BindOutputs", [&] {
    ReadOutputs();
    prev_ = curr_;
    return true;
  });
}

void FdmHost::ReadOutputs() {
  const size_t n = outHandles_.size();
  for (size_t i = 0; i < n; ++i) curr_[i] = handles_[outHandles_[i]].node->getDoubleValue();
}

bool FdmHost::StateFinite() const {
  const auto prop = fdm_->GetPropagate();
  const JSBSim::FGPropagate::VehicleState& s = prop->GetVState();
  for (int i = 1; i <= 3; ++i) {
    if (!std::isfinite(s.vLocation(i)) || !std::isfinite(s.vUVW(i)) || !std::isfinite(s.vPQR(i))) return false;
  }
  for (int i = 1; i <= 4; ++i)
    if (!std::isfinite(s.qAttitudeLocal(i))) return false;
  return true;
}

// --- stepping ------------------------------------------------------------------------------------------

int FdmHost::Step(int n) {
  stepsLastCall_ = 0;
  if (state_ == FDM_ENDED) return terminateNode_ && terminateNode_->getBoolValue() ? FDM_STEP_TERMINATE
                                                                                 : FDM_STEP_SCRIPT_END;
  if (state_ != FDM_RUNNING) {
    if (state_ != FDM_DEAD) Fail("Step: not running (load, then RunIC)");
    return FDM_STEP_NOT_RUNNING;
  }
  const size_t nIn = inHandles_.size();
  for (int k = 0; k < n; ++k) {
    // 1. Validate every input before writing any, so a refused step changes nothing.
    for (size_t i = 0; i < nIn; ++i) {
      const Handle& h = handles_[inHandles_[i]];
      const int status = CheckValue(h, in_[i]);
      if (status != FDM_SET_OK) {
        Fail("Step: input refused (status " + std::to_string(status) + "): " + h.name);
        return FDM_STEP_BAD_INPUT;
      }
    }
    // 2. Write inputs, run one JSBSim frame, read outputs.
    bool runResult = true;
    std::string refused;
    const bool ok = Guard("Run", [&] {
      for (size_t i = 0; i < nIn; ++i) {
        const Handle& h = handles_[inHandles_[i]];
        if (!h.node->setDoubleValue(in_[i])) refused = h.name;
      }
      runResult = fdm_->Run();
      // Copy, do not swap: callers hold pointers to prev and curr.
      if (!curr_.empty()) std::memcpy(prev_.data(), curr_.data(), curr_.size() * sizeof(double));
      ReadOutputs();
      return true;
    });
    if (!ok) {
      // JSBSim does not roll back a frame that threw (its clock has already advanced): discard.
      state_ = FDM_DEAD;
      return FDM_STEP_ERROR;
    }
    ++stepsLastCall_;
    ++counters_[FDM_CNT_STEPS];
    if (!refused.empty()) {
      Fail("Step: JSBSim's setter refused an input: " + refused);
      return FDM_STEP_BAD_INPUT;
    }
    // 3. Checks. Changes made by the aircraft or script while stepping are reported, not undone.
    if (fdm_->GetDeltaT() != dt_) ++counters_[FDM_CNT_DT_CHANGED];
    int now[4];
    ReadIntegrators(now);
    if (std::memcmp(now, integExpected_, sizeof(now)) != 0) {
      ++counters_[FDM_CNT_INTEGRATORS_CHANGED];
      std::memcpy(integExpected_, now, sizeof(now));
    }
    const double t = fdm_->GetSimTime();
    if (!(t > lastSimTime_)) ++counters_[FDM_CNT_TIME_STALLED];
    lastSimTime_ = t;
    if (!StateFinite()) {
      state_ = FDM_DEAD;
      Fail("Step: state is not finite (NaN or infinity) after step " + std::to_string(counters_[FDM_CNT_STEPS]));
      return FDM_STEP_NONFINITE;
    }
    if (!runResult) {
      state_ = FDM_ENDED;
      return terminateNode_ && terminateNode_->getBoolValue() ? FDM_STEP_TERMINATE : FDM_STEP_SCRIPT_END;
    }
  }
  return FDM_STEP_OK;
}

double FdmHost::SimTime() const { return fdm_ ? fdm_->GetSimTime() : 0.0; }

int64_t FdmHost::Counter(int which) const {
  if (which == FDM_CNT_GROUND_CALLS) return static_cast<int64_t>(groundStats_->calls);
  if (which == FDM_CNT_TERRAIN_ELEV_IGNORED) return static_cast<int64_t>(groundStats_->terrainElevationIgnored);
  if (which < 0 || which >= FDM_CNT_COUNT) return -1;
  return counters_[which];
}

bool FdmHost::GroundProbe(double x, double y, double z, double* out7) {
  if (!fdm_ || state_ == FDM_DEAD) return Fail("GroundProbe: no instance");
  return Guard("GroundProbe", [&] {
    JSBSim::FGLocation loc(JSBSim::FGColumnVector3(x, y, z));
    JSBSim::FGLocation contact;
    JSBSim::FGColumnVector3 normal, v, w;
    out7[0] = fdm_->GetInertial()->GetContactPoint(loc, contact, normal, v, w);
    for (int i = 1; i <= 3; ++i) {
      out7[i] = normal(i);
      out7[3 + i] = contact(i);
    }
    return true;
  });
}

}  // namespace fdmhost
