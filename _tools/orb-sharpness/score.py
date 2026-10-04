"""Score the two ways of drawing a dense orb at 26px against the ideal.

For each moment and each orb: crop the three 26x26 cells from the screen
capture, convert to luminance, and measure
  - error: root-mean-square difference from the ideal, in 0..255
  - ink:   how much light the cell carries above the panel, as a share of
           the ideal's (dropped dots show as ink well under 100%)
Across the eight moments, the spread of each method's error says how much it
shimmers: a method that sometimes catches a dot and sometimes misses it
swings, one that draws every dot does not.
"""
import glob
import json
import os
import statistics

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
PANEL = (0x12, 0x14, 0x15)


def lum(pixel):
    r, g, b = pixel[:3]
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def crop(image, cell):
    x, y = round(cell['x']), round(cell['y'])
    return [lum(image.getpixel((x + dx, y + dy))) for dy in range(26) for dx in range(26)]


panel = lum(PANEL)
results = {}
for png in sorted(glob.glob(os.path.join(HERE, 'frame-*.png'))):
    t = png.rsplit('frame-', 1)[1][:-4]
    image = Image.open(png).convert('RGB')
    cells = json.load(open(png[:-4] + '.json'))['cells']
    by = {(c['state'], c['kind']): c for c in cells}
    for state in sorted({c['state'] for c in cells}):
        ideal = crop(image, by[(state, 'ideal')])
        ideal_ink = sum(max(0.0, v - panel) for v in ideal) or 1.0
        for kind in ('scaled', 'native', 'ss2', 'hq'):
            got = crop(image, by[(state, kind)])
            error = (sum((a - b) ** 2 for a, b in zip(got, ideal)) / len(ideal)) ** 0.5
            ink = sum(max(0.0, v - panel) for v in got) / ideal_ink
            results.setdefault((state, kind), []).append((float(t), error, ink))

print(f"{'orb':12} {'method':7} {'error vs ideal':>15} {'spread':>7} {'ink vs ideal':>13}")
totals = {'scaled': [], 'native': [], 'ss2': [], 'hq': []}
for (state, kind), rows in sorted(results.items()):
    errors = [e for _, e, _ in rows]
    inks = [i for _, _, i in rows]
    totals[kind].extend(errors)
    print(f"{state:12} {kind:7} {statistics.mean(errors):15.2f} {statistics.pstdev(errors):7.2f} {statistics.mean(inks) * 100:12.0f}%")
print()
for kind, errors in totals.items():
    print(f"all six, {kind:7}: mean error {statistics.mean(errors):.2f}, worst {max(errors):.2f}")
