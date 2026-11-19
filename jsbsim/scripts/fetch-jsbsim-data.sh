#!/usr/bin/env bash
# Copies JSBSim's data folders, byte for byte, from the pinned clone (build/jsbsim-src) into jsbsim-data/.
# Run scripts/setup-toolchain.sh first. Stops on any error.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/pins.env"
SRC="$ROOT/build/jsbsim-src"
[ "$(git -C "$SRC" rev-parse HEAD)" = "$JSBSIM_COMMIT" ] || { echo "build/jsbsim-src is not at the pin" >&2; exit 1; }
OUT="$ROOT/jsbsim-data"
rm -rf "$OUT"
mkdir -p "$OUT"
# git archive exports exactly the tracked files of the pinned commit (no build leftovers).
git -C "$SRC" archive "$JSBSIM_COMMIT" aircraft engine systems scripts check_cases/NASA_EOM_2015 COPYING \
  | tar -x -C "$OUT"
printf '%s\n%s\n' "$JSBSIM_TAG" "$JSBSIM_COMMIT" > "$OUT/REF"
echo "jsbsim-data/: $(find "$OUT" -type f | wc -l) files, $(du -sb "$OUT" | cut -f1) bytes"
