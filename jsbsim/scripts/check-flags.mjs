// Checks the compiler command of every file in each build folder (from compile_commands.json):
//   -O3 is the last optimisation level, the build's exception flag is present, no fast-math.
// Usage: node check-flags.mjs <build dir> <native|native-asserts|wasm|js> [<build dir> <kind> ...]
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
let failed = false;
for (let i = 0; i < args.length; i += 2) {
  const dir = args[i], kind = args[i + 1];
  const eh = kind === "wasm" ? "-fwasm-exceptions" : "-fexceptions";
  const entries = JSON.parse(readFileSync(`${dir}/compile_commands.json`, "utf8"));
  // Only the files that end up in our binary: JSBSim's library, expat, the host, the test oracle.
  const mine = entries.filter((e) => /jsbsim-src\/src\/|\/host\/|\/tests\/native\//.test(e.file) &&
    !/jsbsim-src\/src\/JSBSim\.cpp$/.test(e.file));
  let bad = 0, cFiles = 0;
  for (const e of mine) {
    const words = e.command.split(/\s+/);
    const opt = words.filter((w) => /^-O(\d|s|z|g|fast)?$/.test(w));
    const problems = [];
    if (opt[opt.length - 1] !== "-O3") problems.push(`last -O flag is ${opt[opt.length - 1]}`);
    if (!words.includes(eh)) problems.push(`missing ${eh}`);
    if (kind === "wasm" && words.includes("-fexceptions")) problems.push("has -fexceptions too");
    if (words.some((w) => /^-(ffast-math|Ofast|funsafe-math-optimizations|ffinite-math-only|fassociative-math|freciprocal-math)$/.test(w)))
      problems.push("fast-math flag");
    if (!words.includes("-ffp-contract=off")) problems.push("missing -ffp-contract=off");
    const hasNdebug = words.includes("-DNDEBUG");
    if (kind === "native-asserts" ? hasNdebug : !hasNdebug) problems.push(`NDEBUG ${hasNdebug ? "set" : "missing"}`);
    if (e.file.endsWith(".c")) cFiles++;
    if (problems.length) { bad++; console.log(`FAIL ${dir}: ${e.file}: ${problems.join("; ")}`); }
  }
  if (cFiles < 3) { bad++; console.log(`FAIL ${dir}: expected expat's C files in the list, found ${cFiles}`); }
  console.log(`${bad ? "FAIL" : "ok  "} ${kind.padEnd(14)} ${mine.length} files (${cFiles} C files: expat and MSIS) -O3, ${eh}, no fast-math`);
  if (bad) failed = true;
}
process.exit(failed ? 1 : 0);
