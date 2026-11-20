// From 135crewdog/FDM, host/fdm_host.h, commit e478825. Changed for FSG (milestone 1): one comment line on
// SetGroundGrid. Nothing else is changed; tools/from-fdm.mjs lists the change.
// Host layer (not physics): a thin wrapper around one JSBSim::FGFDMExec.
//
// Rules it enforces (see RESEARCH.md for the sources):
//  - one instance loads one aircraft once; a reset is a new instance;
//  - dt is set before loading and checked afterwards;
//  - integrator settings are checked after load and RunIC;
//  - properties are reached through cached handles; writes are validated;
//  - no C++ exception leaves a public method: errors are stored in LastError().
#pragma once
#include <cstdint>
#include <memory>
#include <string>
#include <unordered_map>
#include <vector>

#include "fdm_codes.h"
#include "grid_ground.h"
#include "host_logger.h"

class SGPropertyNode;
namespace JSBSim { class FGFDMExec; }

namespace fdmhost {

class FdmHost {
 public:
  // dt > 0: the step size, also forced onto scripts. dt == 0: only for LoadScript; the script's own dt is used.
  // root: JSBSim root folder. outDir: where JSBSim may write files (must exist).
  FdmHost(double dt, const std::string& root, const std::string& outDir);
  ~FdmHost();
  FdmHost(const FdmHost&) = delete;
  FdmHost& operator=(const FdmHost&) = delete;

  // --- before load ---------------------------------------------------------------------------------------
  // Paths relative to root, or absolute. Defaults: "aircraft", "engine", "systems".
  bool SetPaths(const std::string& aircraft, const std::string& engine, const std::string& systems);
  // Integrator settings to enforce after load and RunIC. Default: JSBSim's own defaults 1, 3, 1, 4.
  // A value of -1 means "keep whatever the load produced".
  bool SetIntegrators(int rateRot, int rateTrans, int posRot, int posTrans);
  // Installs the height grid as the ground. Without it JSBSim's default ground callback stays in place.
  // FSG: may be called again after load and between steps; the new grid replaces the old one.
  bool SetGroundGrid(std::shared_ptr<const HeightGrid> grid);

  // --- load, once ----------------------------------------------------------------------------------------
  bool LoadModel(const std::string& name);
  bool LoadScript(const std::string& path, const std::string& initfile);
  // Loads an initial-condition file (relative to the aircraft's folder) after LoadModel.
  bool LoadIC(const std::string& file);
  bool RunIC();

  // --- properties ----------------------------------------------------------------------------------------
  int Prop(const std::string& name);  // handle >= 0, or -1 (unknown, invalid, or a folder)
  int PropFlags(int handle) const;    // FdmPropFlags bits, or -1
  double Get(int handle);             // NaN and LastError for a bad handle
  int Set(int handle, double value);  // FdmSetStatus
  double SetReadback() const { return setReadback_; }
  bool BindInputs(const int* handles, int n);
  bool BindOutputs(const int* handles, int n);
  double* In() { return in_.data(); }
  double* Prev() { return prev_.data(); }
  double* Curr() { return curr_.data(); }
  int NumIn() const { return static_cast<int>(in_.size()); }
  int NumOut() const { return static_cast<int>(curr_.size()); }

  // --- stepping ------------------------------------------------------------------------------------------
  // Runs up to n steps: write bulk inputs, Run(), prev <- curr, read bulk outputs, checks.
  int Step(int n);  // FdmStepResult
  int StepsInLastCall() const { return stepsLastCall_; }

  // --- state ---------------------------------------------------------------------------------------------
  int State() const { return state_; }
  double Dt() const { return dt_; }
  double SimTime() const;
  const std::string& LastError() const { return lastError_; }
  int64_t Counter(int which) const;
  // Asks the installed ground callback about an ECEF point (ft). out: height, normal xyz, contact xyz.
  bool GroundProbe(double x, double y, double z, double* out7);

  JSBSim::FGFDMExec* Exec() { return fdm_.get(); }

 private:
  struct Handle {
    SGPropertyNode* node;  // owned by the property tree, which lives as long as fdm_
    int flags;
    std::string name;
  };
  template <class F> bool Guard(const char* what, F&& body);
  bool Fail(const std::string& message);
  void InstallGround();
  bool AfterLoad(const char* what);
  void EnforceSettings(bool afterLoad);
  void ReadIntegrators(int out[4]) const;
  int CheckValue(const Handle& h, double value) const;
  void ReadOutputs();
  bool StateFinite() const;

  std::shared_ptr<HostLogger> logger_;
  std::unique_ptr<JSBSim::FGFDMExec> fdm_;
  int state_ = FDM_NEW;
  double dt_ = 0.0;
  std::string lastError_;

  int integConfigured_[4] = {1, 3, 1, 4};
  int integExpected_[4] = {1, 3, 1, 4};
  SGPropertyNode* integNode_[4] = {nullptr, nullptr, nullptr, nullptr};
  SGPropertyNode* terminateNode_ = nullptr;

  std::shared_ptr<const HeightGrid> grid_;
  std::shared_ptr<GroundStats> groundStats_;

  std::vector<Handle> handles_;
  std::unordered_map<std::string, int> handleByName_;
  std::vector<int> inHandles_, outHandles_;
  std::vector<double> in_, prev_, curr_;
  double setReadback_ = 0.0;

  int64_t counters_[FDM_CNT_COUNT] = {0};
  int stepsLastCall_ = 0;
  double lastSimTime_ = 0.0;
};

}  // namespace fdmhost
