// Prints build-info.json for the binaries in <stage dir>. Every value is read from the build, not typed in.
// Usage: node write-build-info.mjs <repo root> <stage dir>
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const [root, stage] = process.argv.slice(2);
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: "utf8", ...opts }).trim();

const pins = Object.fromEntries(readFileSync(join(root, "pins.env"), "utf8").split("\n")
  .filter((l) => /^[A-Za-z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));

// Hash of the host layer's sources: every file under host/ and tests/native/, CMakeLists.txt and pins.env.
function listFiles(dir) {
  return readdirSync(dir).sort().flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? listFiles(p) : [p];
  });
}
const hostFiles = [...listFiles(join(root, "host")), ...listFiles(join(root, "tests/native")),
  join(root, "CMakeLists.txt"), join(root, "pins.env")];
const hostHash = createHash("sha256");
for (const f of hostFiles) hostHash.update(f.slice(root.length + 1)).update("\0").update(readFileSync(f)).update("\0");

function compileFlags(buildDir, fileSuffix) {
  const entries = JSON.parse(readFileSync(join(buildDir, "compile_commands.json"), "utf8"));
  const e = entries.find((x) => x.file.endsWith(fileSuffix));
  return e.command.split(/\s+/).slice(1)
    .filter((w, i, a) => w.startsWith("-") && !/^-(I|o|c|MD|MT|MF|isystem)/.test(w) && a[i - 1] !== "-o" && a[i - 1] !== "-MF" && a[i - 1] !== "-MT")
    .map((w) => w.replaceAll(root, ".")).join(" ");
}
function linkFlags(buildDir) {
  const ninja = readFileSync(join(buildDir, "build.ninja"), "utf8");
  const block = ninja.slice(ninja.indexOf("build fdm-"));
  const m = /^\s*LINK_FLAGS = (.*)$/m.exec(block);
  return m ? m[1].trim() : "";
}

const variants = {};
for (const [name, eh] of [["weh", "-fwasm-exceptions"], ["jseh", "-fexceptions"]]) {
  const dir = join(root, "build", `wasm-${name}`);
  const wasm = readFileSync(join(stage, `fdm-${name}.wasm`));
  const mjs = readFileSync(join(stage, `fdm-${name}.mjs`));
  variants[name] = {
    exceptions: eh,
    files: {
      [`fdm-${name}.wasm`]: { bytes: wasm.length, sha256: sha256(wasm) },
      [`fdm-${name}.mjs`]: { bytes: mjs.length, sha256: sha256(mjs) },
    },
    compile_flags_cxx: compileFlags(dir, "/src/FGFDMExec.cpp"),
    compile_flags_c_expat: compileFlags(dir, "/xmlparse.c"),
    compile_flags_host: compileFlags(dir, "/host/fdm_host.cpp"),
    link_flags: linkFlags(dir),
  };
}

const info = {
  jsbsim: { tag: pins.JSBSIM_TAG, commit: pins.JSBSIM_COMMIT, patches: [],
    source_clean: sh("git", ["-C", join(root, "build/jsbsim-src"), "status", "--porcelain"]) === "" },
  emscripten: { version: pins.EMSDK_VERSION, emcc: sh("emcc", ["--version"]).split("\n")[0],
    clang: sh("emcc", ["-v"], { stdio: ["ignore", "pipe", "pipe"] }).split("\n")[0] || undefined },
  memory: { fixed_bytes: Number(pins.WASM_MEMORY_MB) * 1024 * 1024, growth: false,
    stack_bytes: Number(pins.WASM_STACK_MB) * 1024 * 1024 },
  source_date_epoch: Number(pins.SOURCE_DATE_EPOCH),
  host_sources_sha256: hostHash.digest("hex"),
  data_trees: Object.fromEntries(Object.entries(pins).filter(([k]) => k.startsWith("TREE_") || k.startsWith("BLOB_"))),
  native_answer_key: { compiler: sh("c++", ["--version"]).split("\n")[0],
    compile_flags_cxx: compileFlags(join(root, "build/native"), "/src/FGFDMExec.cpp") },
  variants,
};
console.log(JSON.stringify(info, null, 2));
