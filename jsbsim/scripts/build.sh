#!/usr/bin/env bash
# Builds everything from the pinned sources and stops on the first error:
#   build/native          native answer key (fdm_native), system compiler
#   build/native-asserts  the same with assert() kept (ground-hook check)
#   build/wasm-weh        WebAssembly, -fwasm-exceptions
#   build/wasm-jseh       WebAssembly, -fexceptions (fallback)
# Then checks the compiler flags of every file, and only if everything succeeded copies the two
# WebAssembly builds and build-info.json into dist-wasm/.
#
# No "|| true", no pipes on build commands: a failing compiler fails this script.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/pins.env"
export SOURCE_DATE_EPOCH
BUILD="$ROOT/build"
DIST="$ROOT/dist-wasm"
JOBS="$(nproc)"

[ "$(git -C "$BUILD/jsbsim-src" rev-parse HEAD)" = "$JSBSIM_COMMIT" ] || { echo "JSBSim source is not at the pin" >&2; exit 1; }
[ -z "$(git -C "$BUILD/jsbsim-src" status --porcelain)" ] || { echo "JSBSim source has local changes" >&2; exit 1; }

# shellcheck disable=SC1091
source "$BUILD/emsdk/emsdk_env.sh" >/dev/null 2>&1
case "$(emcc --version | head -1)" in
  *" $EMSDK_VERSION "*) ;;
  *) echo "emcc is not $EMSDK_VERSION" >&2; exit 1 ;;
esac

echo "== native"
cmake -G Ninja -S "$ROOT" -B "$BUILD/native" -DFDM_EH=native -DFDM_ASSERTS=OFF >"$BUILD/native.cmake.log"
cmake --build "$BUILD/native" --target fdm_native --parallel "$JOBS"

echo "== native with assertions"
cmake -G Ninja -S "$ROOT" -B "$BUILD/native-asserts" -DFDM_EH=native -DFDM_ASSERTS=ON >"$BUILD/native-asserts.cmake.log"
cmake --build "$BUILD/native-asserts" --target fdm_native --parallel "$JOBS"

for variant in weh jseh; do
  if [ "$variant" = weh ]; then eh=wasm; else eh=js; fi
  echo "== wasm $variant"
  emcmake cmake -G Ninja -S "$ROOT" -B "$BUILD/wasm-$variant" -DFDM_EH="$eh" -DFDM_OUTPUT_NAME="fdm-$variant" \
    -DFDM_WASM_MEMORY_MB="$WASM_MEMORY_MB" -DFDM_WASM_STACK_MB="$WASM_STACK_MB" >"$BUILD/wasm-$variant.cmake.log"
  cmake --build "$BUILD/wasm-$variant" --target fdm --parallel "$JOBS"
done

echo "== flag check"
node "$ROOT/scripts/check-flags.mjs" "$BUILD/native" native "$BUILD/native-asserts" native-asserts \
  "$BUILD/wasm-weh" wasm "$BUILD/wasm-jseh" js

echo "== dist-wasm"
STAGE="$BUILD/dist-stage"
rm -rf "$STAGE"
mkdir -p "$STAGE"
for variant in weh jseh; do
  cp "$BUILD/wasm-$variant/fdm-$variant.mjs" "$BUILD/wasm-$variant/fdm-$variant.wasm" "$STAGE/"
done
chmod 644 "$STAGE"/*
node "$ROOT/scripts/write-build-info.mjs" "$ROOT" "$STAGE" >"$STAGE/build-info.json"
# Everything succeeded: replace dist-wasm in one move.
rm -rf "$DIST.old"
if [ -d "$DIST" ]; then mv "$DIST" "$DIST.old"; fi
mv "$STAGE" "$DIST"
rm -rf "$DIST.old"
echo "built:"
( cd "$DIST" && sha256sum fdm-*.wasm fdm-*.mjs )
