"""Real openpets.dev pets drawn as pixel art, to compare with the OpenPets banner Colin sent."""
import io
import json
import os
import urllib.request

from PIL import Image

# Usage: python _tools/look-pixel-pets.py <scratch folder holding page0.json (a catalog page)>; writes look/ there.
import sys
S = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__)))
THUMBS = os.path.join(S, 'thumbs')
os.makedirs(THUMBS, exist_ok=True)
os.makedirs(os.path.join(S, 'look'), exist_ok=True)
page = json.load(open(os.path.join(S, 'page0.json'), encoding='utf-8'))
pets = [p for p in page['pets'] if p.get('featured') or p.get('original')][:56]


def fetch(pet):
    path = os.path.join(THUMBS, pet['id'] + '.webp')
    if not os.path.exists(path):
        with urllib.request.urlopen(urllib.request.Request(pet['thumbnail'], headers={'User-Agent': 'Mozilla/5.0 Locust-look'}), timeout=20) as r:
            open(path, 'wb').write(r.read())
    return Image.open(path).convert('RGBA')


def pixelate(im, height=30, colors=20, scale=3):
    box = im.getchannel('A').point(lambda a: 255 if a > 40 else 0).getbbox()
    im = im.crop(box)
    w = max(1, round(im.width * height / im.height))
    small = im.resize((w, height), Image.LANCZOS)
    alpha = small.getchannel('A').point(lambda a: 255 if a > 110 else 0)
    rgb = small.convert('RGB').quantize(colors=colors, method=Image.Quantize.MEDIANCUT).convert('RGB')
    out = Image.new('RGBA', (w + 2, height + 2), (0, 0, 0, 0))
    body = Image.merge('RGBA', (*rgb.split(), alpha))
    out.paste(body, (1, 1), body)
    px = out.load()
    a = [[px[x, y][3] > 0 for y in range(out.height)] for x in range(out.width)]
    for x in range(out.width):
        for y in range(out.height):
            if a[x][y]:
                continue
            if any(0 <= x + dx < out.width and 0 <= y + dy < out.height and a[x + dx][y + dy] for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                px[x, y] = (20, 18, 28, 255)
    return out.resize((out.width * scale, out.height * scale), Image.NEAREST)


cells = []
for pet in pets:
    try:
        cells.append((pet, fetch(pet)))
    except Exception as error:  # a picture that will not come is left out
        print('skip', pet['id'], error)

# The mosaic: every pet as pixel art, on Locust's dark ground.
cols, cell = 10, 110
rows = (len(cells) + cols - 1) // cols
mosaic = Image.new('RGBA', (cols * cell + 20, rows * cell + 20), (18, 19, 22, 255))
for i, (pet, im) in enumerate(cells):
    sprite = pixelate(im)
    x = 10 + (i % cols) * cell + (cell - sprite.width) // 2
    y = 10 + (i // cols) * cell + (cell - sprite.height) // 2
    mosaic.alpha_composite(sprite, (x, y))
mosaic.save(os.path.join(S, 'look', 'pets-pixel-mosaic.png'))

# Side by side: the same pets as drawn today (smooth, at a sidebar's 44 px) and as pixel art.
pick = cells[:8]
side = Image.new('RGBA', (len(pick) * 120 + 20, 260), (18, 19, 22, 255))
for i, (pet, im) in enumerate(pick):
    smooth = im.copy()
    smooth.thumbnail((96, 96), Image.LANCZOS)
    side.alpha_composite(smooth, (10 + i * 120 + (110 - smooth.width) // 2, 10 + (110 - smooth.height) // 2))
    sprite = pixelate(im)
    side.alpha_composite(sprite, (10 + i * 120 + (110 - sprite.width) // 2, 140 + (110 - sprite.height) // 2))
side.save(os.path.join(S, 'look', 'pets-smooth-vs-pixel.png'))
print('wrote', len(cells), 'pets')
