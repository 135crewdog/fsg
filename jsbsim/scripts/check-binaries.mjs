// Checks that the files in dist-wasm/ are the ones build-info.json describes (sha256 and size).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist-wasm");
const info = JSON.parse(readFileSync(join(dist, "build-info.json"), "utf8"));
let bad = 0;
for (const [variant, v] of Object.entries(info.variants)) {
  for (const [name, want] of Object.entries(v.files)) {
    const bytes = readFileSync(join(dist, name));
    const sha = createHash("sha256").update(bytes).digest("hex");
    const ok = sha === want.sha256 && bytes.length === want.bytes;
    console.log(`${ok ? "ok  " : "FAIL"} ${variant} ${name} ${bytes.length} bytes ${sha}`);
    if (!ok) bad++;
  }
}
console.log(`JSBSim ${info.jsbsim.tag} ${info.jsbsim.commit}; ${info.emscripten.emcc}; fixed memory ${info.memory.fixed_bytes} bytes`);
process.exit(bad ? 1 : 0);
