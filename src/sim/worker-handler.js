// From 135crewdog/FDM, ts/worker-handler.ts, commit e478825. Made by tools/from-fdm.mjs: the types are removed
// (a line that was only types is kept as a comment), ".ts" in file names becomes ".js", and import paths
// follow FSG's folders. Also changed: 2 lines, listed in tools/from-fdm.mjs.
// In the comments below, host/, dist-wasm/, jsbsim-data/, build/ and tests/ are folders of jsbsim/; REPORT.md
// and RESEARCH.md are FDM's, at that commit; and "TypeScript" means this file, which is now JavaScript.
// The message handler that runs JSBSim off the main thread. It knows nothing about where it runs:
// src/sim/worker.js wires it to a browser Worker, tests wire it to Node (directly and through worker_threads).
//
// Every request carries an id and gets exactly one reply with the same id:
//   { id, ok: true, ...result }   or   { id, ok: false, error: string, crash: boolean }
// Unasked messages from the worker have no id: { type: "event", event } and { type: "log", record }.
import { benchSteps, runCycles } from "./bench.js";
import { StepResult } from "./codes.js";
import { Fdm, FdmCrash, loadFdmModule } from "./core.js";
import { readPack, writeFiles } from "./files.js";
import { FixedStepLoop } from "./loop.js";

// export type Request =
//   /** Load the WebAssembly module. moduleUrl: URL of fdm-weh.mjs / fdm-jseh.mjs. packs: [mount point, pack bytes]. */
//   | { id: number; type: "init"; moduleUrl: string; wasmBinary?: ArrayBuffer | Uint8Array; packs?: [string, Uint8Array][]; forwardLogs?: boolean }
//   /** Add files after init. */
//   | { id: number; type: "files"; mountPoint: string; pack: Uint8Array }
//   /** Create the instance, load, bind, RunIC, and start the loop (paused until the first tick). */
//   | {
//       id: number; type: "create"; dt?: number; root?: string; paths?: { aircraft: string; engine: string; systems: string };
//       model?: string; script?: string; initfile?: string; ic?: string; ground?: GroundGrid;
//       outputs: string[]; inputs?: string[]; loop?: LoopOptions;
//     }
//   /** One frame: now in seconds. inputs (optional) are held for every step of this frame. */
//   | { id: number; type: "tick"; now: number; inputs?: Float64Array }
//   | { id: number; type: "pause" }
//   | { id: number; type: "resume" }
//   | { id: number; type: "dispose" }
//   | { id: number; type: "bench"; options: Omit<BenchOptions, "now"> }
//   /** 20 create/load/step/destroy cycles; replies with heap bytes in use after each. */
//   | { id: number; type: "cycles"; count: number; model: string; ic: string; steps: number }
//   /** Tries to load an aircraft; replies loaded true, or loaded false with JSBSim's message. */
//   | { id: number; type: "tryload"; model: string; paths?: { aircraft: string; engine: string; systems: string } };

// export type Post = (message: Record<string, unknown>, transfer?: ArrayBuffer[]) => void;

// FSG: `extend`, if given, is handed every request whose type this handler does not know, with what the
// handler holds: extend(req, { post, module, fdm, loop }). FSG's own messages live in their own files.
export function createHandler(post, extend) {
  let module;
  let fdm;
  let loop;
  let inputsView;

  const need = () => {
    if (!module) throw new Error("not initialised: send init first");
    return module;
  };
  const onEvent = (event) => post({ type: "event", event });

  async function run(req) {
    switch (req.type) {
      case "init": {
        const factory = (await import(/* @vite-ignore */ req.moduleUrl)).default;
        module = await loadFdmModule(factory, {
          wasmBinary: req.wasmBinary,
          onLog: req.forwardLogs ? (record) => post({ type: "log", record }) : undefined,
        });
        for (const [mountPoint, pack] of req.packs ?? []) writeFiles(module, mountPoint, readPack(pack));
        return { version: module.version(), memoryBytes: module.memoryBytes() };
      }
      case "files": {
        writeFiles(need(), req.mountPoint, readPack(req.pack));
        return {};
      }
      case "create": {
        const m = need();
        if (fdm) fdm.dispose();
        fdm = Fdm.create(m, { dt: req.dt, root: req.root, paths: req.paths, ground: req.ground, onEvent });
        if (req.script) fdm.loadScript(req.script, req.initfile ?? "");
        else fdm.loadModel(req.model);
        if (req.ic) fdm.loadIC(req.ic);
        fdm.bindOutputs(req.outputs);
        inputsView = fdm.bindInputs(req.inputs ?? []);
        fdm.runIC();
        loop = new FixedStepLoop(fdm, req.loop);
        return { dt: fdm.dt, outputs: fdm.outputNames, simTime: fdm.simTime, curr: Float64Array.from(fdm.curr) };
      }
      case "tick": {
        if (!fdm || !loop) throw new Error("no instance: send create first");
        if (req.inputs && inputsView) inputsView.set(req.inputs);
        const steps = loop.advance(req.now);
        // Copies: the views point into WebAssembly memory, which never leaves the worker.
        const prev = Float64Array.from(loop.prev);
        const curr = Float64Array.from(loop.curr);
        return [
          { steps, alpha: loop.alpha, simTime: fdm.simTime, result: loop.lastResult, ended: loop.lastResult !== StepResult.OK,
            totalSteps: loop.totalSteps, droppedSeconds: loop.droppedSeconds, prev, curr },
          [prev.buffer, curr.buffer],
        ];
      }
      case "pause":
        if (loop) loop.pause();
        return {};
      case "resume":
        if (loop) loop.resume();
        return {};
      case "dispose":
        if (fdm) fdm.dispose();
        fdm = undefined;
        loop = undefined;
        return {};
      case "bench":
        return { result: benchSteps(need(), req.options) };
      case "cycles":
        return { ...runCycles(need(), req.count, req.model, req.ic, req.steps) };
      case "tryload": {
        const f = Fdm.create(need(), { paths: req.paths });
        try {
          f.loadModel(req.model);
          return { loaded: true };
        } catch (e) {
          if (e instanceof FdmCrash) throw e;
          return { loaded: false, errorName: (e).name, isError: e instanceof Error, message: (e).message };
        } finally {
          f.dispose();
        }
      }
      default:
        if (extend) return extend(req, { post, module: need, fdm: () => fdm, loop: () => loop });
    }
  }

  return async (req) => {
    try {
      const out = await run(req);
      if (Array.isArray(out)) post({ id: req.id, ok: true, ...out[0] }, out[1]);
      else post({ id: req.id, ok: true, ...out });
    } catch (e) {
      const crash = e instanceof FdmCrash;
      if (crash) post({ type: "event", event: { type: "crash", reason: "trap", message: (e).message, simTime: NaN, step: -1 } });
      post({ id: req.id, ok: false, error: e instanceof Error ? e.message : String(e), crash });
    }
  };
}

/** Client side: turns postMessage traffic into promises. Works with a browser Worker or a Node Worker. */
export class WorkerClient {
  onEvent;
  onLog;
  nextId = 1;
  pending = new Map();
  send;

  constructor(send) {
    this.send = send;
  }

  /** Feed every message that arrives from the worker into this. */
  receive(message) {
    if (message && message.type === "event") {
      if (this.onEvent) this.onEvent(message.event);
      return;
    }
    if (message && message.type === "log") {
      if (this.onLog) this.onLog(message.record);
      return;
    }
    const p = this.pending.get(message.id);
    if (!p) return;
    this.pending.delete(message.id);
    if (message.ok) p.resolve(message);
    else p.reject(new Error(message.error));
  }

  /** Fails every request still waiting (the worker died). */
  failAll(reason) {
    for (const p of this.pending.values()) p.reject(new Error(reason));
    this.pending.clear();
  }

  request(body, transfer) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ ...body, id }, transfer);
    });
  }
}
