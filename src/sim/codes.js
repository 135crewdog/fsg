// From 135crewdog/FDM, ts/codes.ts, commit e478825. Made by tools/from-fdm.mjs: the types are removed
// (a line that was only types is kept as a comment), ".ts" in file names becomes ".js", and import paths
// follow FSG's folders. Nothing else is changed.
// In the comments below, host/, dist-wasm/, jsbsim-data/, build/ and tests/ are folders of jsbsim/; REPORT.md
// and RESEARCH.md are FDM's, at that commit; and "TypeScript" means this file, which is now JavaScript.
// Mirrors host/fdm_codes.h. Plain objects (no TypeScript enums) so Node can run this file as it is.

export const State = { NEW: 0, LOADED: 1, RUNNING: 2, ENDED: 3, DEAD: 4 };

export const StepResult = {
  OK: 0,
  SCRIPT_END: 1,
  TERMINATE: 2,
  NONFINITE: 3,
  ERROR: -1,
  NOT_RUNNING: -2,
  BAD_INPUT: -3,
};

export const SetStatus = {
  OK: 0,
  READ_ONLY: 1,
  NAN: 2,
  NOT_INTEGER: 3,
  REJECTED: 4,
  READBACK_DIFFERS: 5,
  BAD_HANDLE: 6,
};

export const SET_STATUS_NAME = ["ok", "read-only", "nan", "not-integer", "rejected", "readback-differs", "bad-handle"];

export const Counter = {
  DT_RESTORED: 0,
  INTEGRATORS_RESTORED: 1,
  DT_CHANGED: 2,
  INTEGRATORS_CHANGED: 3,
  TIME_STALLED: 4,
  GROUND_CALLS: 5,
  TERRAIN_ELEV_IGNORED: 6,
  STEPS: 7,
};

export const COUNTER_NAME = [
  "dt-restored",
  "integrators-restored",
  "dt-changed",
  "integrators-changed",
  "time-stalled",
  "ground-calls",
  "terrain-elevation-ignored",
  "steps",
];

export const PropFlag = { READ: 1, WRITE: 2, INTEGER: 4 };

// JSBSim::LogLevel
export const LOG_LEVEL_NAME = ["BULK", "DEBUG", "INFO", "WARN", "ERROR", "FATAL", "STDOUT"];
