#!/usr/bin/env bash
# Two checks on the build itself (criterion 1), run in a copy of the sources under build/selftest/:
#   1. a deliberately broken source file makes build.sh exit non-zero and leaves dist-wasm/ unchanged;
#   2. a clean build in that other folder gives the same binaries as the repository's dist-wasm/.
# The toolchain and the JSBSim clone are shared through symlinks. Prints a summary; exit 0 only if 1 holds
# (2 is reported, not required: REPORT.md part 2).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COPY="$ROOT/build/selftest/src"
rm -rf "$ROOT/build/selftest"
mkdir -p "$COPY/build" "$COPY/tests"
cp -r "$ROOT/CMakeLists.txt" "$ROOT/pins.env" "$ROOT/host" "$ROOT/scripts" "$COPY/"
cp -r "$ROOT/tests/native" "$COPY/tests/"
ln -s "$ROOT/build/jsbsim-src" "$COPY/build/jsbsim-src"
ln -s "$ROOT/build/emsdk" "$COPY/build/emsdk"

echo "== 1. injected compile error"
mkdir -p "$COPY/dist-wasm"
echo "marker" > "$COPY/dist-wasm/marker.txt"
cp "$COPY/host/grid_ground.cpp" "$COPY/grid_ground.cpp.good"
echo 'this line is not C++ ;' >> "$COPY/host/grid_ground.cpp"
set +e
"$COPY/scripts/build.sh" > "$ROOT/build/selftest/broken-build.log" 2>&1
code=$?
set -e
echo "build.sh exit code with the broken file: $code"
after="$(cd "$COPY/dist-wasm" && ls | tr '\n' ' ')"
echo "dist-wasm/ afterwards: $after"
fail=0
if [ "$code" -eq 0 ]; then echo "FAIL: the build did not stop on the error"; fail=1; fi
if [ "$after" != "marker.txt " ] || [ "$(cat "$COPY/dist-wasm/marker.txt")" != "marker" ]; then echo "FAIL: dist-wasm/ was changed by a failed build"; fail=1; fi
grep -m1 -n "error" "$ROOT/build/selftest/broken-build.log" | cut -c1-200 || true
[ "$fail" -eq 0 ] && echo "ok: the build stops on an error and leaves dist-wasm/ unchanged"

echo "== 2. clean build in another folder"
cp "$COPY/grid_ground.cpp.good" "$COPY/host/grid_ground.cpp"
rm "$COPY/grid_ground.cpp.good"
rm -rf "$COPY/dist-wasm" "$COPY/build/native" "$COPY/build/native-asserts" "$COPY/build/wasm-weh" "$COPY/build/wasm-jseh"
"$COPY/scripts/build.sh" > "$ROOT/build/selftest/clean-build.log" 2>&1
same=1
for f in fdm-weh.wasm fdm-weh.mjs fdm-jseh.wasm fdm-jseh.mjs; do
  a="$(sha256sum "$ROOT/dist-wasm/$f" | cut -d' ' -f1)"
  b="$(sha256sum "$COPY/dist-wasm/$f" | cut -d' ' -f1)"
  if [ "$a" = "$b" ]; then echo "same      $f $a"; else echo "DIFFERENT $f repository $a, other folder $b ($(cmp -l "$ROOT/dist-wasm/$f" "$COPY/dist-wasm/$f" | wc -l) bytes differ)"; same=0; fi
done
na="$(sha256sum "$ROOT/build/native/fdm_native" | cut -d' ' -f1)"; nb="$(sha256sum "$COPY/build/native/fdm_native" | cut -d' ' -f1)"
if [ "$na" = "$nb" ]; then echo "same      fdm_native (native answer key) $na"; else echo "different fdm_native (native answer key; not shipped)"; fi
[ "$same" -eq 1 ] && echo "ok: both WebAssembly builds are byte-identical when rebuilt in another folder" || echo "note: the rebuilt binaries differ (reported, not a pass/fail line)"
exit $fail
