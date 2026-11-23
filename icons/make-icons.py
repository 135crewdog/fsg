#!/usr/bin/env python3
"""Makes the app's icons from the owner's artwork, icons/icon-1024.png.

New in FSG (23 November 2026): the owner's own icon, an F-4C in Southeast Asia camouflage over yellow,
orange and red stripes, replaces the Wings icon the app started with. A second drawing (the same day, version
0.0.8) saw the jet from behind and above, looking into the nozzles, so it could be drawn bigger; the owner
preferred the first, and it came back in version 0.0.9. The 1,024-pixel square is the master, kept as the
owner gave it; every size the app uses is made from it by this script and nothing else.

  icon-32.png    the browser tab's icon             (index.html, rel="icon")
  icon-180.png   the iPhone home screen's icon      (index.html, rel="apple-touch-icon"; 60 points at 3x)
  icon-192.png   the web app manifest's icons       (manifest.webmanifest)
  icon-512.png

The master is square and opaque, so iOS rounds its corners itself and has no see-through pixel to fill with
black. The sizes are made with Lanczos filtering, the usual choice for shrinking a picture.

Run it from anywhere:  python3 icons/make-icons.py
It needs Python 3 with Pillow. Run again it makes the same files byte for byte, on the same Pillow;
tests/app.test.js checks each file's size and that it has no transparency.
"""
import os

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SIZES = (32, 180, 192, 512)

master = Image.open(os.path.join(HERE, 'icon-1024.png'))
assert master.size == (1024, 1024), f'the master is {master.size}, not 1024 x 1024'
assert master.mode == 'RGB', f'the master is {master.mode}, not opaque RGB'
for size in SIZES:
    path = os.path.join(HERE, f'icon-{size}.png')
    master.resize((size, size), Image.LANCZOS).save(path, optimize=True)
    print(f'{path}: {size} x {size}, {os.path.getsize(path):,} bytes')
