#!/usr/bin/env bash
# Renders each slide at 2x and stitches them into a PDF. Run from repo root with `python3 -m http.server 8765` serving.
#   ./deck/build-pdf.sh          -> deck/campaign-commons-deck.pdf        (projector deck, index.html)
#   ./deck/build-pdf.sh laptop   -> deck/campaign-commons-deck-laptop.pdf (laptop deck, laptop.html)
set -euo pipefail
page=${1:-index}
out="deck/campaign-commons-deck.pdf"
[ "$page" = "index" ] || out="deck/campaign-commons-deck-$page.pdf"
tmp=$(mktemp -d)
n=$(grep -c "<section " "deck/$page.html")
for ((i=0;i<n;i++)); do
  google-chrome --headless=new --disable-gpu --window-size=1600,900 --force-device-scale-factor=2 --hide-scrollbars \
    --virtual-time-budget=6000 --screenshot="$tmp/s$i.png" "http://localhost:8765/deck/$page.html?static#/$i" 2>/dev/null
done
python3 - "$tmp" "$n" "$out" <<'PY'
import sys; from PIL import Image
tmp,n,out=sys.argv[1],int(sys.argv[2]),sys.argv[3]
ims=[Image.open(f"{tmp}/s{i}.png").convert("RGB") for i in range(n)]
ims[0].save(out, save_all=True, append_images=ims[1:], resolution=200)
PY
echo "wrote $out ($n pages)"
