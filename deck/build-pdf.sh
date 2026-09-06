#!/usr/bin/env bash
# Renders each slide at 2x and stitches them into deck/campaign-commons-deck.pdf. Run from repo root with `python3 -m http.server 8765` serving.
set -euo pipefail
tmp=$(mktemp -d)
n=$(grep -c '<section ' deck/index.html)
for ((i=0;i<n;i++)); do
  google-chrome --headless=new --disable-gpu --window-size=1600,900 --force-device-scale-factor=2 --hide-scrollbars \
    --virtual-time-budget=6000 --screenshot="$tmp/s$i.png" "http://localhost:8765/deck/index.html?static#/$i" 2>/dev/null
done
python3 - "$tmp" "$n" <<'PY'
import sys; from PIL import Image
tmp,n=sys.argv[1],int(sys.argv[2])
ims=[Image.open(f"{tmp}/s{i}.png").convert("RGB") for i in range(n)]
ims[0].save("deck/campaign-commons-deck.pdf", save_all=True, append_images=ims[1:], resolution=200)
PY
echo "wrote deck/campaign-commons-deck.pdf ($n pages)"
