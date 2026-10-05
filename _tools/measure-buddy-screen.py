"""Where Codex Buddy's screen goes on each of his drawings (2026-10-05, petScreens.ts).

    python _tools/measure-buddy-screen.py <spritesheet.webp> [review.png]

Prints CODEX_BUDDY's `cells` and `edges` for apps/desktop/src/renderer/src/petScreens.ts,
and with a second path draws every drawing with its screen on it, to LOOK at before the
numbers are kept: run it again only if his maker changes his sheet (petScreens.ts's
screenFits then says so: his screen stops showing).

His sheet is his maker's (openpets.dev) and is never kept in this repository: give the copy
Locust downloaded (userData/pets/codex-buddy/spritesheet.webp). Nothing is sent anywhere.

How each drawing is measured:

1. His cap (the biggest patch of its blue) says where his head is.
2. His face is the skin under it: the patches of skin that make up one face (his eyes and a
   strained brow can cut it in two), not an arm or a hand reaching in from a side or below,
   and not his ear beside it.
3. His face's FEATURES are what that skin encloses -- eyes, brows, mouth -- and the screen
   covers them, a pixel or so round, kept inside his face. Whatever crosses in front of his
   face (a hand, a bar) is outside it, and stays on top.
4. One screen SIZE for each way he faces (VIEW), the median of that view's own, so the
   screen holds its size as he moves; placed on each drawing's own face. Where the
   features do not say where the face is (a blink, a strain, hands at his cheeks: BY_CAP),
   it goes where the cap says. Turned, his far brow reaches a pixel past it, so the turned
   views are a pixel wider; straining on the bench his brows rise, so the bench's screen
   is taller and two pixels higher. Squatting he is drawn larger, so is his screen; with his
   head tucked between his arms (hanging, locked out) it is measured as it is.
"""
import json
import statistics
import sys
from collections import deque
from pathlib import Path

from PIL import Image, ImageDraw

W, H = 192, 208
COUNTS = [6, 8, 8, 4, 5, 8, 6, 6, 6]

VIEW = {}
for _c in range(6):
    VIEW[(0, _c)] = VIEW[(8, _c)] = 'front'
for _c in range(8):
    VIEW[(1, _c)] = 'right'
    VIEW[(2, _c)] = 'left'
    VIEW[(5, _c)] = 'bench'
for _c in range(4):
    VIEW[(3, _c)] = 'front'
for _c in (1, 2, 3):
    VIEW[(4, _c)] = 'front'
for _c in (0, 1, 3, 4, 5):
    VIEW[(6, _c)] = 'front'
for _c in (0, 1, 2, 4, 5):
    VIEW[(7, _c)] = 'front'
VIEW[(4, 0)] = VIEW[(4, 4)] = VIEW[(7, 3)] = 'tucked'
VIEW[(6, 2)] = 'squat'
BY_CAP = {(0, 2), (5, 2), (6, 3), (8, 2)}


def skin(p):
    r, g, b, a = p
    return a > 200 and r > 190 and 140 < g < 225 and 95 < b < 190 and r - b > 55


def blue(p):
    return p[3] > 200 and p[2] > 150 and p[0] < 60 and 80 < p[1] < 140


def components(inside, test):
    """4-connected patches of the pixels in `inside` that pass `test`."""
    seen = set()
    for start in sorted(inside):
        if start in seen or not test(start):
            continue
        comp, queue = [], deque([start])
        seen.add(start)
        while queue:
            x, y = queue.popleft()
            comp.append((x, y))
            for n in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if n in inside and n not in seen and test(n):
                    seen.add(n)
                    queue.append(n)
        yield comp


def cap_of(px):
    everywhere = {(x, y) for y in range(H) for x in range(W)}
    cap = max(components(everywhere, lambda p: blue(px[p])), key=len)
    left, right = min(x for x, _ in cap), max(x for x, _ in cap)
    return (left + right) / 2, max(y for _, y in cap), right - left, left


def features(px):
    """His face's features (what its skin encloses), and the screen they ask for: x, y, w, h."""
    _, brim, width, left = cap_of(px)
    right = left + width
    x0, x1, y0, y1 = max(0, left - 8), min(W - 1, right + 8), max(0, brim - 26), min(H - 1, brim + 42)
    window = {(x, y) for y in range(y0, y1 + 1) for x in range(x0, x1 + 1)}
    patches = [p for p in components(window, lambda p: skin(px[p])) if len(p) >= 12]
    candidates = [p for p in patches if not any(x in (x0, x1) or y == y1 for x, y in p)]
    if not candidates:
        return None
    main = max(candidates, key=len)
    mx0, mx1 = min(x for x, _ in main), max(x for x, _ in main)
    face = set(main)
    for patch in candidates:
        px0, px1 = min(x for x, _ in patch), max(x for x, _ in patch)
        if patch is not main and max(0, min(px1, mx1) - max(px0, mx0) + 1) / (px1 - px0 + 1) >= 0.7:
            face |= set(patch)
    fx0, fx1 = min(x for x, _ in face) - 1, max(x for x, _ in face) + 1
    fy0, fy1 = min(y for _, y in face) - 1, max(y for _, y in face) + 1
    box = {(x, y) for y in range(fy0, fy1 + 1) for x in range(fx0, fx1 + 1)}
    outside, queue = set(), deque()
    for x, y in box:
        if (x in (fx0, fx1) or y in (fy0, fy1)) and (x, y) not in face:
            outside.add((x, y))
            queue.append((x, y))
    while queue:
        x, y = queue.popleft()
        for n in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if n in box and n not in face and n not in outside:
                outside.add(n)
                queue.append(n)
    enclosed = box - face - outside
    marks = [p for p in components(enclosed, lambda p: True) if len(p) >= 4]
    shown = set().union(*marks) if marks else enclosed
    if not shown:
        return None
    whole = face | enclosed
    l, r = min(x for x, _ in shown) - 3, max(x for x, _ in shown) + 3
    t, b = min(y for _, y in shown) - 2, max(y for _, y in shown) + 2
    # Kept inside the face: pulled in wherever a side would leave it (a rounded corner forgives a little).
    for _ in range(30):
        spill = {'l': 0, 'r': 0, 't': 0, 'b': 0}
        for y in range(t, b + 1):
            spill['l'] += (l, y) not in whole
            spill['r'] += (r, y) not in whole
        for x in range(l, r + 1):
            spill['t'] += (x, t) not in whole
            spill['b'] += (x, b) not in whole
        worst = max(spill, key=spill.get)
        if spill[worst] <= 3:
            break
        l, r, t, b = l + (worst == 'l'), r - (worst == 'r'), t + (worst == 't'), b - (worst == 'b')
    return {'x': l, 'y': t, 'w': r - l + 1, 'h': b - t + 1}


def main():
    sheet = Image.open(sys.argv[1]).convert('RGBA')
    cells, caps, edges = {}, {}, []
    for r, n in enumerate(COUNTS):
        row = []
        for c in range(n):
            frame = sheet.crop((c * W, r * H, (c + 1) * W, (r + 1) * H))
            px = frame.load()
            cells[(r, c)] = features(px)
            caps[(r, c)] = cap_of(px)
            alpha = frame.getchannel('A').point(lambda v: 255 if v > 128 else 0).getbbox()
            row.append([alpha[0], alpha[2]])
        edges.append(row)
    sizes, offsets = {}, {}
    for view in ('front', 'right', 'bench'):
        own = [(k, cells[k]) for k, v in VIEW.items() if v == view and cells[k] is not None and k not in BY_CAP]
        sizes[view] = [round(statistics.median(x['w'] for _, x in own)), round(statistics.median(x['h'] for _, x in own))]
        offsets[view] = (statistics.median(x['x'] + x['w'] / 2 - caps[k][0] for k, x in own), statistics.median(x['y'] + x['h'] / 2 - caps[k][1] for k, x in own))
    sizes['right'][0] += 1
    sizes['bench'][1] += 2
    sizes['left'], offsets['left'] = sizes['right'], (-offsets['right'][0], offsets['right'][1])
    lift = {'bench': 2}
    front_cap = statistics.median(caps[k][2] for k, v in VIEW.items() if v == 'front')
    table = []
    for r, n in enumerate(COUNTS):
        row = []
        for c in range(n):
            view, rect = VIEW[(r, c)], cells[(r, c)]
            if view == 'tucked':
                row.append([rect['x'], rect['y'], rect['w'], rect['h']])
                continue
            centre_x, brim, width, _ = caps[(r, c)]
            if view == 'squat':
                k = width / front_cap
                w, h = round(sizes['front'][0] * k), round(sizes['front'][1] * k)
                centre = (centre_x + offsets['front'][0] * k, brim + offsets['front'][1] * k)
            else:
                w, h = sizes[view]
                centre = (centre_x + offsets[view][0], brim + offsets[view][1]) if (r, c) in BY_CAP or rect is None else (rect['x'] + rect['w'] / 2, rect['y'] + rect['h'] / 2)
            centre = (centre[0], centre[1] - lift.get(view, 0))
            row.append([round(centre[0] - w / 2), round(centre[1] - h / 2), w, h])
        table.append(row)
    print('  cells: [')
    print(',\n'.join('    [' + ', '.join('[%d, %d, %d, %d]' % tuple(cell) for cell in row) + ']' for row in table))
    print('  ],')
    print('  edges: [')
    print(',\n'.join('    [' + ', '.join('[%d, %d]' % tuple(edge) for edge in row) + ']' for row in edges))
    print('  ]')
    if len(sys.argv) > 2:
        out = Image.new('RGBA', (W * 8, H * 9), (40, 42, 46, 255))
        for r, row in enumerate(table):
            for c, (x, y, w, h) in enumerate(row):
                frame = sheet.crop((c * W, r * H, (c + 1) * W, (r + 1) * H))
                draw = ImageDraw.Draw(frame)
                draw.rounded_rectangle([x - 2, y - 2, x + w + 1, y + h + 1], radius=min(w, h) * 0.32 + 2, fill=(12, 8, 13, 255))
                draw.rounded_rectangle([x, y, x + w - 1, y + h - 1], radius=min(w, h) * 0.32, fill=(20, 40, 62, 255))
                out.alpha_composite(frame, (c * W, r * H))
        out.convert('RGB').save(sys.argv[2])
        print('review:', sys.argv[2], file=sys.stderr)


if __name__ == '__main__':
    main()
