#!/usr/bin/env bash
# Builds only the native answer keys, without Emscripten: what the tests compare the WebAssembly builds with.
#   build/native          fdm_native, the system compiler
#   build/native-asserts  the same with assert() kept (the ground-hook check)
# New in FSG, for GitHub Actions' test job. The clone and the two builds are the same commands
# scripts/setup-toolchain.sh and scripts/build.sh use (from 135crewdog/FDM, commit e478825); those two
# scripts also install Emscripten and build the WebAssembly, which the tests do not need rebuilt.
# Stops on any error.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/pins.env"
export SOURCE_DATE_EPOCH
# JSBSim's own build file stamps the build number into its version text when it finds one of these set
# (GitHub Actions sets the first). The answer keys are built without the stamp, like the committed binaries.
unset GITHUB_RUN_NUMBER TRAVIS APPVEYOR
BUILD="$ROOT/build"
JOBS="$(nproc)"
mkdir -p "$BUILD"

# --- JSBSim source at the pin (as setup-toolchain.sh) ----------------------------
SRC="$BUILD/jsbsim-src"
if [ ! -d "$SRC/.git" ]; then
  git clone -q --branch "$JSBSIM_TAG" "$JSBSIM_REPO" "$SRC"
fi
[ "$(git -C "$SRC" rev-parse HEAD)" = "$JSBSIM_COMMIT" ] || { echo "JSBSim source is not at the pin" >&2; exit 1; }
[ -z "$(git -C "$SRC" status --porcelain)" ] || { echo "JSBSim source has local changes" >&2; exit 1; }
echo "JSBSim source: $JSBSIM_TAG $JSBSIM_COMMIT (clean)"

# --- the two native builds (as build.sh) -----------------------------------------
echo "== native"
cmake -G Ninja -S "$ROOT" -B "$BUILD/native" -DFDM_EH=native -DFDM_ASSERTS=OFF >"$BUILD/native.cmake.log"
cmake --build "$BUILD/native" --target fdm_native --parallel "$JOBS"

echo "== native with assertions"
cmake -G Ninja -S "$ROOT" -B "$BUILD/native-asserts" -DFDM_EH=native -DFDM_ASSERTS=ON >"$BUILD/native-asserts.cmake.log"
cmake --build "$BUILD/native-asserts" --target fdm_native --parallel "$JOBS"

echo "== flag check"
node "$ROOT/scripts/check-flags.mjs" "$BUILD/native" native "$BUILD/native-asserts" native-asserts
c++ --version | head -1
