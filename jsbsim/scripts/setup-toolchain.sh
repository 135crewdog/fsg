#!/usr/bin/env bash
# Installs the pinned toolchain into build/ (git-ignored):
#   build/emsdk       Emscripten SDK at EMSDK_VERSION
#   build/jsbsim-src  JSBSim at JSBSIM_COMMIT, unpatched
# Stops on any error.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/pins.env"
mkdir -p "$ROOT/build"

# --- JSBSim source at the pin -------------------------------------------------
SRC="$ROOT/build/jsbsim-src"
if [ ! -d "$SRC/.git" ]; then
  git clone -q --branch "$JSBSIM_TAG" "$JSBSIM_REPO" "$SRC"
fi
HEAD_NOW="$(git -C "$SRC" rev-parse HEAD)"
if [ "$HEAD_NOW" != "$JSBSIM_COMMIT" ]; then
  echo "JSBSim clone is at $HEAD_NOW, expected $JSBSIM_COMMIT" >&2
  exit 1
fi
if [ -n "$(git -C "$SRC" status --porcelain)" ]; then
  echo "JSBSim clone has local changes; the baseline takes no patches:" >&2
  git -C "$SRC" status --porcelain >&2
  exit 1
fi
echo "JSBSim source: $JSBSIM_TAG $HEAD_NOW (clean)"

# --- Emscripten ---------------------------------------------------------------
EMSDK="$ROOT/build/emsdk"
if [ ! -d "$EMSDK/.git" ]; then
  git clone -q "$EMSDK_REPO" "$EMSDK"
fi
"$EMSDK/emsdk" install "$EMSDK_VERSION"
"$EMSDK/emsdk" activate "$EMSDK_VERSION"
# shellcheck disable=SC1091
source "$EMSDK/emsdk_env.sh" >/dev/null 2>&1
EMCC_VERSION="$(emcc --version | head -1)"
case "$EMCC_VERSION" in
  *" $EMSDK_VERSION "*) echo "Emscripten: $EMCC_VERSION" ;;
  *) echo "emcc reports '$EMCC_VERSION', expected $EMSDK_VERSION" >&2; exit 1 ;;
esac
