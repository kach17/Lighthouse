#!/bin/sh
# The store package, built from this repository: the extension folder and the license, its scripts and stylesheets without
# comments and with their text in plain ASCII (esbuild, pinned, for Chrome 120: the code is not otherwise changed, and stays
# readable). Reproducible: the same commit gives the same zip, byte for byte (fixed order and dates), so anyone can check a
# release's store package against its source.
#   sh scripts/build-store.sh [out.zip]
set -e
OUT="${1:-lighthouse-store.zip}"
case "$OUT" in /*) ;; *) OUT="$PWD/$OUT" ;; esac
DIR=$(mktemp -d); BUILT=$(mktemp -d)
git archive HEAD:extension | tar -x -C "$DIR"
git show HEAD:LICENSE > "$DIR/LICENSE"
FILES=$(cd "$DIR" && find src \( -name '*.js' -o -name '*.css' \) | LC_ALL=C sort)
(cd "$DIR" && npx --yes esbuild@0.28.2 $FILES --outdir="$BUILT" --outbase=. --target=chrome120 --log-level=warning)
(cd "$BUILT" && find . -type f -exec cp {} "$DIR/{}" \;)
find "$DIR" -exec touch -t 198001010000 {} +
rm -f "$OUT"
(cd "$DIR" && find . -type f | LC_ALL=C sort | zip -X -q -@ "$OUT")
rm -rf "$DIR" "$BUILT"
