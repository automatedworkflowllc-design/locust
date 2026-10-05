"""Before | after, one image per frame (2026-10-05, the compare-layout pass).

    python _tools/side-by-side.py <before-folder> <after-folder> <out-folder>

Pairs the PNGs both folders have by name and writes each pair side by side,
labelled, so a look can be judged by its frames rather than described.
"""
import os
import sys

from PIL import Image, ImageDraw

before, after, out = sys.argv[1:4]
os.makedirs(out, exist_ok=True)
names = sorted(set(os.listdir(before)) & set(os.listdir(after)))
made = 0
for name in names:
    if not name.endswith('.png'):
        continue
    left, right = Image.open(os.path.join(before, name)), Image.open(os.path.join(after, name))
    bar = 24
    sheet = Image.new('RGB', (left.width + right.width + 16, max(left.height, right.height) + bar), (40, 42, 46))
    sheet.paste(left, (0, bar))
    sheet.paste(right, (left.width + 16, bar))
    draw = ImageDraw.Draw(sheet)
    draw.text((8, 6), f'BEFORE  {name}', fill=(220, 220, 220))
    draw.text((left.width + 24, 6), 'AFTER', fill=(200, 230, 120))
    sheet.save(os.path.join(out, name), optimize=True)
    made += 1
print(f'{made} pairs -> {out}')
