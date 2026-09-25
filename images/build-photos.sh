#!/bin/sh
# Rebuilds photos.js from every .jpg/.jpeg/.png in this folder.
# (The game can't load photos directly as 3D textures when opened as a local file, so they're embedded.)
cd "$(dirname "$0")"
tmp=$(mktemp -d)
printf 'window.AMMU_PHOTOS = [\n' > photos.js
for f in *.jpg *.jpeg *.JPG *.JPEG *.png *.PNG; do
  [ -f "$f" ] || continue
  sips -s format jpeg -s formatOptions 82 -Z 512 "$f" --out "$tmp/p.jpg" >/dev/null
  printf '  "data:image/jpeg;base64,%s",\n' "$(base64 -i "$tmp/p.jpg" | tr -d '\n')" >> photos.js
done
printf '];\n' >> photos.js
rm -rf "$tmp"
echo "photos.js: $(grep -c 'data:image' photos.js) photos"
