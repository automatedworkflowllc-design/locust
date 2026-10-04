"""A contact sheet of one moment: each dense orb as the four methods draw it
at 26px, enlarged 6x with hard pixel edges (so what you see is exactly the
device pixels), and the same row at true size underneath."""
import json
import os
import sys

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
t = sys.argv[1] if len(sys.argv) > 1 else '1.3'
image = Image.open(os.path.join(HERE, f'frame-{t}.png')).convert('RGB')
cells = json.load(open(os.path.join(HERE, f'frame-{t}.json')))['cells']
by = {(c['state'], c['kind']): c for c in cells}
states = ['composing', 'listening', 'solving', 'searching', 'connecting', 'weaving']
kinds = ['scaled', 'ss2', 'hq', 'ideal']
Z = 6
pad = 14
cell = 26 * Z
sheet = Image.new('RGB', (pad + len(kinds) * (cell + pad) + 26 * len(kinds) + pad * 3, pad + len(states) * (cell + pad) + 20), (0x12, 0x14, 0x15))
draw = ImageDraw.Draw(sheet)
for k, kind in enumerate(kinds):
    draw.text((pad + k * (cell + pad), 2), {'scaled': 'now (64 -> 26)', 'ss2': '2x supersample', 'hq': '4x + high quality', 'ideal': 'ideal'}[kind], fill=(142, 149, 143))
for s, state in enumerate(states):
    y0 = 16 + s * (cell + pad)
    for k, kind in enumerate(kinds):
        c = by[(state, kind)]
        x, y = round(c['x']), round(c['y'])
        crop = image.crop((x, y, x + 26, y + 26))
        sheet.paste(crop.resize((cell, cell), Image.NEAREST), (pad + k * (cell + pad), y0))
        # true size, to the right
        sheet.paste(crop, (pad + len(kinds) * (cell + pad) + k * (26 + 6), y0 + cell // 2 - 13))
    draw.text((pad + len(kinds) * (cell + pad), y0 + cell // 2 + 16), state, fill=(142, 149, 143))
out = os.path.join(HERE, f'sheet-{t}.png')
sheet.save(out)
print('wrote', out, sheet.size)
