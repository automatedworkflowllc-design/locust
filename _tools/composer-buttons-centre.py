"""Where each composer button's glyph is drawn, against the button's centre.

    python _tools/composer-buttons-centre.py docs/composer-buttons-2026-09-23/<tag>

Reads the 4x photographs drive-composer-buttons.mjs took. The glyph is the
bright pixels inside the button (well clear of its edge, where a border or a
beam is drawn); its box's centre against the button's centre, in CSS pixels,
is how far off it looks.
"""
import json
import sys
from pathlib import Path

from PIL import Image

folder = Path(sys.argv[1])
measured = json.loads((folder / 'measured.json').read_text(encoding='utf-8'))
report = {}
for label, entry in measured.items():
    image = Image.open(folder / entry['file']).convert('RGB')
    scale, pad = entry['scale'], entry['pad']
    button = entry['button']
    # The button's centre in the photograph.
    cx = (pad + button['width'] / 2) * scale
    cy = (pad + button['height'] / 2) * scale
    # Look only well inside the button: a ring 30% of the way in from its edge
    # is where borders, glows and beams live.
    reach = min(button['width'], button['height']) / 2 * 0.62 * scale
    width, height = image.size
    pixels = image.load()
    # The background is what sits just inside that ring, left of centre.
    background = pixels[int(cx - reach * 0.95), int(cy)]
    base = sum(background) / 3
    xs, ys = [], []
    for y in range(int(cy - reach), int(cy + reach)):
        for x in range(int(cx - reach), int(cx + reach)):
            if (x - cx) ** 2 + (y - cy) ** 2 > reach ** 2:
                continue
            r, g, b = pixels[x, y]
            if (r + g + b) / 3 - base > 38:
                xs.append(x)
                ys.append(y)
    if not xs:
        report[label] = {'glyph': 'none found'}
        continue
    gx = (min(xs) + max(xs) + 1) / 2
    gy = (min(ys) + max(ys) + 1) / 2
    report[label] = {
        'drawn_dx': round((gx - cx) / scale, 2),
        'drawn_dy': round((gy - cy) / scale, 2),
        'glyph_px': [round((max(xs) - min(xs) + 1) / scale, 1), round((max(ys) - min(ys) + 1) / scale, 1)],
        'layout': entry['layout']
    }
print(json.dumps(report, indent=2))
