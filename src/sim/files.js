// From 135crewdog/FDM, ts/files.ts, commit e478825. Made by tools/from-fdm.mjs: the types are removed
// (a line that was only types is kept as a comment), ".ts" in file names becomes ".js", and import paths
// follow FSG's folders. Nothing else is changed.
// In the comments below, host/, dist-wasm/, jsbsim-data/, build/ and tests/ are folders of jsbsim/; REPORT.md
// and RESEARCH.md are FDM's, at that commit; and "TypeScript" means this file, which is now JavaScript.
// Getting JSBSim's data files into the module's in-memory file system.
// The module never reads the host's disk or the network itself: the caller writes the files it needs.

/** A set of files: path relative to some root -> bytes. */
// export type FileSet = Map<string, Uint8Array>;

/** Writes every file of the set under `mountPoint` (for example "/data"). */
export function writeFiles(module, mountPoint, files) {
  for (const [path, bytes] of files) module.writeFile(`${mountPoint}/${path}`, bytes);
}

// --- pack: many files in one download ------------------------------------------------------------------------
// Layout: 4 bytes little-endian = length of the index; the index as UTF-8 JSON [[path, offset, length], ...];
// then the file bytes.

export function buildPack(files) {
  const index = [];
  let offset = 0;
  for (const [path, bytes] of files) {
    index.push([path, offset, bytes.length]);
    offset += bytes.length;
  }
  const head = new TextEncoder().encode(JSON.stringify(index));
  const pack = new Uint8Array(4 + head.length + offset);
  new DataView(pack.buffer).setUint32(0, head.length, true);
  pack.set(head, 4);
  let at = 4 + head.length;
  for (const bytes of files.values()) {
    pack.set(bytes, at);
    at += bytes.length;
  }
  return pack;
}

export function readPack(pack) {
  const headLength = new DataView(pack.buffer, pack.byteOffset, pack.byteLength).getUint32(0, true);
  const index = JSON.parse(new TextDecoder().decode(pack.subarray(4, 4 + headLength)));
  const base = 4 + headLength;
  const files = new Map();
  for (const [path, offset, length] of index) files.set(path, pack.subarray(base + offset, base + offset + length));
  return files;
}
