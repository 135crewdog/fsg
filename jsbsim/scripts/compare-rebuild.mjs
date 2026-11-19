// After scripts/build.sh has rebuilt dist-wasm/: are the four files byte for byte the committed ones?
// New in FSG (the method is GitHub's "check-dist" workflow: rebuild, then fail on any difference).
// Prints each file as same or DIFFERENT with how many bytes differ. build-info.json is compared field by
// field, leaving out the native compiler's name, which belongs to the machine and not to the build.
//   node scripts/compare-rebuild.mjs        exit 0 only if nothing differs
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const prefix = execFileSync("git", ["-C", root, "rev-parse", "--show-prefix"], { encoding: "utf8" }).trim();
const committed = (name) => execFileSync("git", ["-C", root, "show", `HEAD:${prefix}dist-wasm/${name}`], { maxBuffer: 1 << 28 });
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

let different = 0;
for (const name of ["fdm-weh.wasm", "fdm-weh.mjs", "fdm-jseh.wasm", "fdm-jseh.mjs"]) {
  const was = committed(name), now = readFileSync(join(root, "dist-wasm", name));
  if (was.equals(now)) { console.log(`same      ${name} ${now.length} bytes ${sha256(now)}`); continue; }
  different++;
  let bytes = Math.abs(was.length - now.length);
  for (let i = 0; i < Math.min(was.length, now.length); i++) if (was[i] !== now[i]) bytes++;
  console.log(`DIFFERENT ${name}: committed ${was.length} bytes ${sha256(was)}, rebuilt ${now.length} bytes ${sha256(now)}; ${bytes} bytes differ`);
}

const strip = (info) => { delete info.native_answer_key.compiler; return info; };
const was = strip(JSON.parse(committed("build-info.json"))), now = strip(JSON.parse(readFileSync(join(root, "dist-wasm/build-info.json"), "utf8")));
const fields = [...new Set([...Object.keys(was), ...Object.keys(now)])].filter((key) => !isDeepStrictEqual(was[key], now[key]));
if (fields.length) { different++; console.log(`DIFFERENT build-info.json, in: ${fields.join(", ")}`); }
else console.log("same      build-info.json (every field but the native compiler's name)");

console.log(different ? "REBUILD DIFFERS from the committed files" : "REBUILD is byte for byte the committed files");
process.exit(different ? 1 : 0);
