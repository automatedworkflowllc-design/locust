"""Side by side: the live line's orb in the real app, main vs the
orb-paint-down branch, from _tools/drive-orb-frames.mjs. Each photograph's
orb is cropped with a little margin, enlarged 6x with hard pixel edges, and
shown with the live line at true size beneath."""
import json
import os

from PIL import Image, ImageDraw

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FRAMES = os.path.join(REPO, 'docs', 'orb-frames-2026-09-22')
Z, M = 6, 6
side = (26 + 2 * M) * Z
rows = []
for label in ('main', 'branch'):
    crops = []
    for n in range(1, 5):
        png = os.path.join(FRAMES, label, f'orb-{n}.png')
        if not os.path.exists(png):
            continue
        info = json.load(open(png[:-4] + '.json'))
        image = Image.open(png).convert('RGB')
        x, y = info['x'], info['y']
        big = image.crop((x - M, y - M, x + 26 + M, y + 26 + M)).resize((side, side), Image.NEAREST)
        line = image.crop((x - 8, y - 6, x + 180, y + 32))
        crops.append((big, line))
    rows.append((label, crops))

width = 16 + 4 * (side + 12)
height = 16 + len(rows) * (side + 60 + 30)
sheet = Image.new('RGB', (width, height), (0x12, 0x14, 0x15))
draw = ImageDraw.Draw(sheet)
y = 8
for label, crops in rows:
    draw.text((16, y), {'main': 'now (shipped): library canvas shrunk by CSS', 'branch': 'orb-paint-down: drawn 4x, high-quality shrink'}[label], fill=(142, 149, 143))
    y += 18
    for i, (big, line) in enumerate(crops):
        sheet.paste(big, (16 + i * (side + 12), y))
        sheet.paste(line, (16 + i * (side + 12), y + side + 8))
    y += side + 60 + 12
out = os.path.join(REPO, 'docs', 'orb-frames-2026-09-22', 'side-by-side.png')
sheet.save(out)
print('wrote', out, sheet.size)
