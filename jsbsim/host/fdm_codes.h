// Status codes shared by the C++ host, the C exports and the TypeScript wrapper (ts/codes.ts mirrors this).
#pragma once

// Lifecycle of one instance. One instance loads one aircraft once (JSBSim issue #1506).
enum FdmState {
  FDM_NEW = 0,       // created, nothing loaded
  FDM_LOADED = 1,    // aircraft or script loaded, initial conditions not run
  FDM_RUNNING = 2,   // RunIC done, steps allowed
  FDM_ENDED = 3,     // the script ended or simulation/terminate was set
  FDM_DEAD = 4       // an error or a non-finite state: discard the instance
};

// Result of fdm_step.
enum FdmStepResult {
  FDM_STEP_OK = 0,
  FDM_STEP_SCRIPT_END = 1,   // Run() returned false: the script reached its end time
  FDM_STEP_TERMINATE = 2,    // Run() returned false and simulation/terminate is set
  FDM_STEP_NONFINITE = 3,    // position, velocity, rates or attitude are not finite ("crash" of the core)
  FDM_STEP_ERROR = -1,       // JSBSim threw; message in fdm_last_error
  FDM_STEP_NOT_RUNNING = -2, // wrong state (not loaded, no RunIC, ended, or dead)
  FDM_STEP_BAD_INPUT = -3    // a bulk input was refused; nothing was stepped for that step
};

// Result of fdm_set (and of a refused bulk input).
enum FdmSetStatus {
  FDM_SET_OK = 0,
  FDM_SET_READ_ONLY = 1,        // the property has no write access
  FDM_SET_NAN = 2,              // the value is NaN or infinite
  FDM_SET_NOT_INTEGER = 3,      // the property is int/long/bool and the value is not a whole number in range
  FDM_SET_REJECTED = 4,         // JSBSim's setter returned false
  FDM_SET_READBACK_DIFFERS = 5, // written, but reading it back gives another value (see fdm_set_readback)
  FDM_SET_BAD_HANDLE = 6
};

// Counters readable with fdm_counter.
enum FdmCounter {
  FDM_CNT_DT_RESTORED = 0,           // dt put back after load / RunIC
  FDM_CNT_INTEGRATORS_RESTORED = 1,  // integrator settings put back after load / RunIC
  FDM_CNT_DT_CHANGED = 2,            // dt found changed after a step (reported, not undone)
  FDM_CNT_INTEGRATORS_CHANGED = 3,   // integrator settings found changed after a step (reported, not undone)
  FDM_CNT_TIME_STALLED = 4,          // a step did not advance sim time by dt (hold / pause)
  FDM_CNT_GROUND_CALLS = 5,          // calls into our ground callback
  FDM_CNT_TERRAIN_ELEV_IGNORED = 6,  // SetTerrainElevation calls ignored because a grid is installed
  FDM_CNT_STEPS = 7,                 // steps run since RunIC
  FDM_CNT_COUNT = 8
};

// Bits of fdm_prop_flags.
enum FdmPropFlags {
  FDM_PROP_READ = 1,
  FDM_PROP_WRITE = 2,
  FDM_PROP_INTEGER = 4   // int, long or bool: only whole numbers may be written
};
