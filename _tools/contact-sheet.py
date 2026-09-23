"""A contact sheet of a drive's frames, and how much of them MOVES.

    python _tools/contact-sheet.py <folder> [<folder> ...]

Each folder's frame-*.png become one row; the sheet is written beside the
first folder as contact-sheet.png. Per folder it prints the beam's contrast:
for each pixel in the ring around the button, how far its brightness ranges
across the frames. A static ring or edge ranges by nothing, so what is left
is the light that travels -- a peak and the mean of the brightest hundred.
(The first version of this printed the brightest pixel, which was the disc's
own static edge, and read the same whatever the beam did.)
"""
import sys
from pathlib import Path

from PIL import Image

rows = []
for folder in map(Path, sys.argv[1:]):
    frames = sorted(folder.glob('frame-*.png'))
    images = [Image.open(frame).convert('L') for frame in frames]
    rows.append([Image.open(frame).convert('RGB') for frame in frames])
    if not images:
        continue
    width, height = images[0].size
    cx, cy = width / 2, height / 2
    outer = min(width, height) / 2
    inner = outer * 0.5
    data = [image.load() for image in images]
    ranges = []
    for y in range(height):
        for x in range(width):
            distance = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
            if inner <= distance <= outer:
                values = [pixels[x, y] for pixels in data]
                ranges.append(max(values) - min(values))
    ranges.sort(reverse=True)
    top = ranges[:100]
    print(f'{folder.name}: travelling light peaks at {ranges[0]} of 255, the brightest hundred average {sum(top) / len(top):.0f}')

if rows:
    cell = rows[0][0].size
    sheet = Image.new('RGB', (cell[0] * max(len(r) for r in rows), cell[1] * len(rows)), (0, 0, 0))
    for row_index, images in enumerate(rows):
        for column, image in enumerate(images):
            sheet.paste(image.resize(cell), (column * cell[0], row_index * cell[1]))
    target = Path(sys.argv[1]).parent / 'contact-sheet.png'
    sheet.save(target)
    print(f'sheet: {target}')
