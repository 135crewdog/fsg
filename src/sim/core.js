// From 135crewdog/FDM, ts/core.ts, commit e478825. Made by tools/from-fdm.mjs: the types are removed
// (a line that was only types is kept as a comment), ".ts" in file names becomes ".js", and import paths
// follow FSG's folders. Nothing else is changed.
// In the comments below, host/, dist-wasm/, jsbsim-data/, build/ and tests/ are folders of jsbsim/; REPORT.md
// and RESEARCH.md are FDM's, at that commit; and "TypeScript" means this file, which is now JavaScript.
// TypeScript side of the host layer: loads the WebAssembly module and wraps the C exports of host/c_api.cpp.
// Runs unchanged in a browser page, a Web Worker and Node.
//
// Rules (see RESEARCH.md):
//  - one Fdm instance loads one aircraft once; to reset, dispose it and create another;
//  - every failure is a JavaScript Error (FdmError) carrying JSBSim's message;
//  - JSBSim's log records are delivered to the onLog callback;
//  - a WebAssembly trap marks the whole module dead (FdmCrash): throw the module away.

import { COUNTER_NAME, Counter, LOG_LEVEL_NAME, PropFlag, SET_STATUS_NAME, SetStatus, State, StepResult } from "./codes.js";

// export interface LogRecord {
//   level: number; // JSBSim::LogLevel: 0 BULK .. 5 FATAL, 6 STDOUT
//   levelName: string;
//   text: string;
//   file: string; // XML file for XML-related records, else ""
//   line: number;
// }

// export type FdmEvent =
//   | { type: "script-end"; simTime: number; step: number }
//   | { type: "terminate"; simTime: number; step: number }
//   | { type: "crash"; reason: "non-finite" | "trap"; message: string; simTime: number; step: number }
//   | { type: "error"; message: string; simTime: number; step: number }
//   | { type: "warning"; what: string; count: number; simTime: number; step: number };

/** Any failure reported by the host layer or JSBSim. `message` carries JSBSim's text. */
export class FdmError extends Error {
  status;
  constructor(message, status = -1) {
    super(message);
    this.name = "FdmError";
    this.status = status;
  }
}

/** The WebAssembly module itself failed (trap, abort, out of memory). The module must be discarded. */
export class FdmCrash extends FdmError {
  constructor(message) {
    super(message);
    this.name = "FdmCrash";
  }
}

// export interface FdmModuleOptions {
//   /** The .wasm file's bytes (Node, or a page that fetched it itself). */
//   wasmBinary?: ArrayBuffer | Uint8Array;
//   /** Maps a file name the loader asks for (the .wasm) to a URL. */
//   locateFile?: (path: string) => string;
//   onLog?: (record: LogRecord) => void;
// }

/** The factory is the default export of dist-wasm/fdm-weh.mjs or fdm-jseh.mjs. */
// export type FdmFactory = (options: Record<string, unknown>) => Promise<any>;

export class FdmModule {
  /** The Emscripten module object. */
  raw;
  onLog;
  /** Set after a trap: nothing in this module may be used again. */
  dead = false;
  deadReason = "";

  constructor(raw, onLog) {
    this.raw = raw;
    this.onLog = onLog;
  }

  /** Calls into WebAssembly. A trap marks the module dead and becomes FdmCrash. */
  call(fn) {
    if (this.dead) throw new FdmCrash(`module is dead: ${this.deadReason}`);
    try {
      return fn();
    } catch (e) {
      if (e instanceof FdmError) throw e;
      this.dead = true;
      this.deadReason = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      throw new FdmCrash(`WebAssembly trap: ${this.deadReason}`);
    }
  }

  /** Runs fn with C strings for the given JavaScript strings; frees them afterwards. */
  withStrings(strings, fn) {
    const m = this.raw;
    const ptrs = [];
    try {
      return this.call(() => {
        for (const s of strings) {
          const n = m.lengthBytesUTF8(s) + 1;
          const p = m._malloc(n);
          if (!p) throw new FdmError("out of memory");
          m.stringToUTF8(s, p, n);
          ptrs.push(p);
        }
        return fn(...ptrs);
      });
    } finally {
      if (!this.dead) for (const p of ptrs) m._free(p);
    }
  }

  str(ptr) {
    return this.raw.UTF8ToString(ptr);
  }

  version() {
    return this.call(() => this.str(this.raw._fdm_version()));
  }

  /** Delivers pending JSBSim log records to onLog. Called after every host call. */
  drainLog() {
    if (this.dead) return;
    const text = this.call(() => this.str(this.raw._fdm_log_take()));
    if (!text || !this.onLog) return;
    for (const rec of text.split("\x1e")) {
      if (!rec) continue;
      const f = rec.split("\x1f");
      const level = Number(f[0]);
      this.onLog({ level, levelName: LOG_LEVEL_NAME[level] ?? String(level), file: f[1] ?? "", line: Number(f[2]), text: f.slice(3).join("\x1f") });
    }
  }

  /** Bytes in use on the C heap. */
  heapInUse() {
    return this.call(() => this.raw._fdm_heap_in_use());
  }
  /** Highest address the C heap has reached (it never shrinks): shows the peak. */
  heapTop() {
    return this.call(() => this.raw._fdm_heap_top());
  }
  stackFree() {
    return this.call(() => this.raw._fdm_stack_free());
  }
  /** Total size of the fixed WebAssembly memory, bytes. */
  memoryBytes() {
    return this.raw.HEAPU8.buffer.byteLength;
  }

  // --- in-memory file system -----------------------------------------------------------------------------

  mkdir(path) {
    this.call(() => this.raw.FS.mkdirTree(path));
  }
  writeFile(path, data) {
    this.call(() => {
      const slash = path.lastIndexOf("/");
      if (slash > 0) this.raw.FS.mkdirTree(path.slice(0, slash));
      this.raw.FS.writeFile(path, data);
    });
  }
  readFile(path) {
    return this.call(() => this.raw.FS.readFile(path));
  }
  exists(path) {
    return this.call(() => this.raw.FS.analyzePath(path).exists);
  }
}

/** Instantiates the WebAssembly module. */
export async function loadFdmModule(factory, options = {}) {
  const holder = {};
  const print = (level) => (text) => {
    const onLog = holder.mod ? holder.mod.onLog : options.onLog;
    if (onLog) onLog({ level, levelName: level === 6 ? "STDOUT" : "STDERR", text: String(text), file: "", line: -1 });
  };
  const moduleOptions = { print: print(6), printErr: print(4) };
  if (options.wasmBinary) moduleOptions.wasmBinary = options.wasmBinary;
  if (options.locateFile) moduleOptions.locateFile = options.locateFile;
  const raw = await factory(moduleOptions);
  const mod = new FdmModule(raw, options.onLog);
  holder.mod = mod;
  mod.mkdir("/out");
  return mod;
}

// export interface GroundGrid {
//   /** Geodetic latitude of row 0 and longitude of column 0, radians. */
//   lat0: number;
//   lon0: number;
//   /** Row and column spacing, radians. */
//   dlat: number;
//   dlon: number;
//   nlat: number;
//   nlon: number;
//   /** nlat * nlon heights in feet above the ellipsoid, row by row. */
//   heights: Float64Array;
// }

// export interface FdmOptions {
//   /** Step size in seconds. 0 = take the script's own dt (only with loadScript). Default 1/120. */
//   dt?: number;
//   /** JSBSim root folder inside the module's file system. Default "/data". */
//   root?: string;
//   /** Folder JSBSim may write to. Default "/out". */
//   outDir?: string;
//   /** Aircraft, engine and systems folders, relative to root or absolute. */
//   paths?: { aircraft: string; engine: string; systems: string };
//   /** Integrator settings to enforce (rate rot, rate trans, pos rot, pos trans); -1 keeps what the load set. */
//   integrators?: [number, number, number, number];
//   ground?: GroundGrid;
//   onEvent?: (event: FdmEvent) => void;
// }

/** One JSBSim instance. Loads one aircraft once. */
export class Fdm {
  module;
  onEvent;
  /** Bulk inputs: write here, then step(). Bound by bindInputs. */
  inputs = new Float64Array(0);
  /** Bulk outputs before and after the last step. Bound by bindOutputs. */
  prev = new Float64Array(0);
  curr = new Float64Array(0);
  inputNames = [];
  outputNames = [];

  ptr;
  lastCounters = new Array(COUNTER_NAME.length).fill(0);
  handleCache = new Map();

  constructor(module, ptr) {
    this.module = module;
    this.ptr = ptr;
  }

  static create(module, options = {}) {
    const m = module.raw;
    const dt = options.dt ?? 1 / 120;
    const ptr = module.withStrings([options.root ?? "/data", options.outDir ?? "/out"], (root, out) => m._fdm_new(dt, root, out));
    module.drainLog();
    if (!ptr) throw new FdmError(module.str(m._fdm_global_error()));
    const fdm = new Fdm(module, ptr);
    fdm.onEvent = options.onEvent;
    try {
      if (options.paths) {
        const p = options.paths;
        fdm.check(module.withStrings([p.aircraft, p.engine, p.systems], (a, e, s) => m._fdm_set_paths(ptr, a, e, s)));
      }
      if (options.integrators) {
        const i = options.integrators;
        fdm.check(module.call(() => m._fdm_set_integrators(ptr, i[0], i[1], i[2], i[3])));
      }
      if (options.ground) fdm.setGround(options.ground);
    } catch (e) {
      fdm.dispose();
      throw e;
    }
    return fdm;
  }

  /** Frees the instance. Safe to call twice. */
  dispose() {
    if (!this.ptr) return;
    const p = this.ptr;
    this.ptr = 0;
    if (!this.module.dead) {
      this.module.call(() => this.module.raw._fdm_delete(p));
      this.module.drainLog();
    }
  }

  get p() {
    if (!this.ptr) throw new FdmError("this Fdm instance was disposed");
    return this.ptr;
  }

  lastError() {
    return this.module.str(this.module.raw._fdm_last_error(this.p));
  }

  /** Turns a failed status into FdmError, after delivering the log and any warnings. */
  check(status) {
    this.afterCall();
    if (status !== 0) throw new FdmError(this.lastError(), status);
  }

  afterCall() {
    this.module.drainLog();
    this.reportWarnings();
  }

  emit(event) {
    if (this.onEvent) this.onEvent(event);
  }

  setGround(g) {
    const m = this.module.raw;
    if (g.heights.length !== g.nlat * g.nlon) throw new FdmError("ground grid: heights.length must be nlat * nlon");
    const bytes = g.heights.length * 8;
    const buf = this.module.call(() => m._malloc(bytes));
    if (!buf) throw new FdmError("out of memory");
    try {
      new Float64Array(m.HEAPF64.buffer, buf, g.heights.length).set(g.heights);
      this.check(this.module.call(() => m._fdm_set_ground_grid(this.p, g.lat0, g.lon0, g.dlat, g.dlon, g.nlat, g.nlon, buf)));
    } finally {
      if (!this.module.dead) m._free(buf);
    }
  }

  // --- load ----------------------------------------------------------------------------------------------

  loadModel(name) {
    this.check(this.module.withStrings([name], (n) => this.module.raw._fdm_load_model(this.p, n)));
  }
  /** path is relative to the root folder. A host dt other than 0 overrides the script's own dt. */
  loadScript(path, initfile = "") {
    this.check(this.module.withStrings([path, initfile], (a, b) => this.module.raw._fdm_load_script(this.p, a, b)));
  }
  /** Initial-condition file, relative to the aircraft's folder. After loadModel, before runIC. */
  loadIC(file) {
    this.check(this.module.withStrings([file], (f) => this.module.raw._fdm_load_ic(this.p, f)));
  }
  runIC() {
    this.check(this.module.call(() => this.module.raw._fdm_run_ic(this.p)));
  }

  // --- properties ----------------------------------------------------------------------------------------

  /** Handle of a property. Throws if the name is unknown or invalid; never creates a property. */
  prop(name) {
    const cached = this.handleCache.get(name);
    if (cached !== undefined) return cached;
    const h = this.module.withStrings([name], (n) => this.module.raw._fdm_prop(this.p, n));
    this.afterCall();
    if (h < 0) throw new FdmError(this.lastError());
    this.handleCache.set(name, h);
    return h;
  }
  has(name) {
    try {
      this.prop(name);
      return true;
    } catch (e) {
      if (e instanceof FdmCrash) throw e;
      return false;
    }
  }
  isWritable(handle) {
    return (this.module.call(() => this.module.raw._fdm_prop_flags(this.p, handle)) & PropFlag.WRITE) !== 0;
  }
  isInteger(handle) {
    return (this.module.call(() => this.module.raw._fdm_prop_flags(this.p, handle)) & PropFlag.INTEGER) !== 0;
  }
  get(handle) {
    return this.module.call(() => this.module.raw._fdm_get(this.p, handle));
  }
  getByName(name) {
    return this.get(this.prop(name));
  }
  /**
   * Writes one property and returns the value read back.
   * Throws FdmError (status = SetStatus) for a read-only property, NaN/infinity, a non-integer written to an
   * integer property, or a setter that refused. The property is unchanged in those cases.
   */
  set(handle, value) {
    const m = this.module.raw;
    // The C side takes a double; anything else from JavaScript is refused here.
    if (typeof value !== "number") throw new FdmError("set: value must be a number", SetStatus.NAN);
    const status = this.module.call(() => m._fdm_set(this.p, handle, value));
    this.afterCall();
    if (status === SetStatus.OK || status === SetStatus.READBACK_DIFFERS) return this.module.call(() => m._fdm_set_readback(this.p));
    const detail = status === SetStatus.REJECTED ? `: ${this.lastError()}` : "";
    throw new FdmError(`set refused (${SET_STATUS_NAME[status] ?? status})${detail}`, status);
  }
  setByName(name, value) {
    return this.set(this.prop(name), value);
  }

  bind(names, fn) {
    const m = this.module.raw;
    const handles = names.map((n) => this.prop(n));
    const buf = this.module.call(() => m._malloc(Math.max(4, handles.length * 4)));
    if (!buf) throw new FdmError("out of memory");
    try {
      new Int32Array(m.HEAP32.buffer, buf, handles.length).set(handles);
      this.check(this.module.call(() => m[fn](this.p, buf, handles.length)));
    } finally {
      if (!this.module.dead) m._free(buf);
    }
  }

  /** Binds the bulk input array. `inputs[i]` is written to names[i] before every step. */
  bindInputs(names) {
    this.bind(names, "_fdm_bind_inputs");
    const m = this.module.raw;
    this.inputNames = names.slice();
    // Memory is fixed (no growth), so this view stays valid for the life of the instance.
    this.inputs = new Float64Array(m.HEAPF64.buffer, this.module.call(() => m._fdm_in(this.p)), names.length);
    return this.inputs;
  }

  /** Binds the bulk output arrays. After each step, `prev` and `curr` hold names[i] before and after it. */
  bindOutputs(names) {
    this.bind(names, "_fdm_bind_outputs");
    const m = this.module.raw;
    this.outputNames = names.slice();
    this.prev = new Float64Array(m.HEAPF64.buffer, this.module.call(() => m._fdm_prev(this.p)), names.length);
    this.curr = new Float64Array(m.HEAPF64.buffer, this.module.call(() => m._fdm_curr(this.p)), names.length);
  }

  // --- stepping ------------------------------------------------------------------------------------------

  /**
   * Runs n steps and returns the StepResult code (see codes.js). Does not throw for script end, terminate,
   * a non-finite state or a JSBSim error: those are reported through onEvent and the return value.
   * It throws FdmCrash only when the WebAssembly module itself trapped.
   */
  step(n = 1) {
    const m = this.module.raw;
    let result;
    try {
      result = this.module.call(() => m._fdm_step(this.p, n));
    } catch (e) {
      if (e instanceof FdmCrash) this.emit({ type: "crash", reason: "trap", message: e.message, simTime: NaN, step: this.lastCounters[Counter.STEPS] });
      throw e;
    }
    if (result === StepResult.OK) {
      this.fastWarnings();
      return result;
    }
    this.afterCall();
    const simTime = this.simTime;
    const step = this.counter(Counter.STEPS);
    if (result === StepResult.SCRIPT_END) this.emit({ type: "script-end", simTime, step });
    else if (result === StepResult.TERMINATE) this.emit({ type: "terminate", simTime, step });
    else if (result === StepResult.NONFINITE) this.emit({ type: "crash", reason: "non-finite", message: this.lastError(), simTime, step });
    else this.emit({ type: "error", message: this.lastError(), simTime, step });
    return result;
  }

  /** Steps actually run by the last step() call. */
  get stepsInLastCall() {
    return this.module.call(() => this.module.raw._fdm_steps_in_last_call(this.p));
  }

  // After an ordinary step, only look at the log and counters when a listener exists (keeps the hot path short).
  fastWarnings() {
    if (this.module.onLog) this.module.drainLog();
    if (this.onEvent) this.reportWarnings();
  }

  reportWarnings() {
    if (!this.ptr || this.module.dead) return;
    const m = this.module.raw;
    for (let i = 0; i <= Counter.TIME_STALLED; i++) {
      const c = m._fdm_counter(this.ptr, i);
      if (c !== this.lastCounters[i]) {
        this.lastCounters[i] = c;
        if (this.onEvent) this.onEvent({ type: "warning", what: COUNTER_NAME[i], count: c, simTime: m._fdm_sim_time(this.ptr), step: m._fdm_counter(this.ptr, Counter.STEPS) });
      }
    }
    this.lastCounters[Counter.STEPS] = m._fdm_counter(this.ptr, Counter.STEPS);
  }

  // --- state ---------------------------------------------------------------------------------------------

  get state() {
    return this.module.call(() => this.module.raw._fdm_state(this.p));
  }
  get running() {
    return this.state === State.RUNNING;
  }
  get dt() {
    return this.module.call(() => this.module.raw._fdm_dt(this.p));
  }
  get simTime() {
    return this.module.call(() => this.module.raw._fdm_sim_time(this.p));
  }
  counter(which) {
    return this.module.call(() => this.module.raw._fdm_counter(this.p, which));
  }

  /** Asks the installed ground callback about an ECEF point (feet). */
  groundProbe(x, y, z) {
    const m = this.module.raw;
    const buf = this.module.call(() => m._malloc(7 * 8));
    try {
      this.check(this.module.call(() => m._fdm_ground_probe(this.p, x, y, z, buf)));
      const v = new Float64Array(m.HEAPF64.buffer, buf, 7);
      return { height: v[0], normal: [v[1], v[2], v[3]], contact: [v[4], v[5], v[6]] };
    } finally {
      if (!this.module.dead) m._free(buf);
    }
  }
}

/** Runs a scenario file with the C++ scenario runner compiled into the module (tests). */
export function runScenarioInWasm(module, scenarioPath) {
  const m = module.raw;
  module.withStrings([scenarioPath], (p) => m._fdm_scn_run(p));
  module.drainLog();
  const meta = JSON.parse(module.str(module.call(() => m._fdm_scn_meta())));
  const n = meta.rows * meta.columns.length;
  const data = new Float64Array(n);
  if (n > 0) data.set(new Float64Array(m.HEAPF64.buffer, module.call(() => m._fdm_scn_data()), n));
  module.call(() => m._fdm_scn_free());
  return { meta, data };
}
