"""The pets that become puppets with our terminal eyes (2026-10-05, petPuppets.ts).

    python _tools/measure-pet-puppets.py <pets folder> [review.png]

<pets folder> holds each pet as Locust downloaded it (userData/pets/<id>/spritesheet.webp); the
sheets are their makers' and never kept in this repository. Nothing is sent anywhere.

For each pet below, the decisions are made here, by eye, and the rest is measured from its sheet:

- NECK: the row its head ends at, where a head sits on a body that walks (Astro Bot, Meowbot) or
  on a stand (TmuxAI): what is below it is cut away, straight across, on the dark line where the
  two meet (Colin: "if removing their legs/bodies helps animating them like the other teammates
  i completely understand"). Nothing of the head is cut: its ears, antennae and headphones
  stay. An ellipse round the head was tried first, and cut through the ears (Colin: "you just
  drew a circle around some of them and chopped off their ears lol"). A pet whose body is the
  pet -- Cabin, Macintosh, Bitty, the cat, Nori -- is kept whole, arms and feet and all: Bitty's
  hand is drawn over its own side, so no line takes it off cleanly.
- GLASS: where its screen goes, over its own screen or face, in the drawing's pixels.
- LOOK: the glass's hue (its own screen's, darkened, as a bot's visor takes its body's colour),
  how dark, an outline where it has no bezel of its own, the corners, and the eyes' size and
  height on the glass.

Measured: the PAINT, what is kept's painted bounds (its waiting ring and presence dot sit on it);
the WINDOW, the square of the drawing a bot's box shows -- that paint and a little air -- and the
EDGES, each drawing's painted left, top, right and bottom,
by which the window knows a sheet is the one these were measured on (petScreens.ts's
screenFits). All four: some makers fill each frame edge to edge, so their sides alone say
little.

Prints PET_PUPPETS as petPuppets.ts has it, character for character; with a second path, draws
each as a puppet at 96, 44 and 32 px beside its drawing as it is, to look at before the numbers
are kept.
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

W, H = 192, 208

PUPPETS = {
    'cabin-face': dict(name='Cabin', note='a phone that is all screen: kept whole, its glass near black as its own, its eyes as large as its old face', neck=None, glass=(44, 22, 104, 160), tint='#121e22', dark=0.45, corner=0.22, eyeScale=1.7, eyeY=-0.18),
    # Its helmet's dark rim is row 135; its shoulders rise to row 136 under the helmet's corners.
    'astro-bot': dict(name='Astro Bot', note='its helmet, antennae and headphones, cut from its body at its neck, its eyes on its own black screen', neck=136, glass=(55, 55, 85, 66), tint='#141c28', corner=0.38),
    # Its helmet's grey ends at row 140, a dark collar runs 141 to 144, its body starts at 145.
    'meowbot': dict(name='Meowbot', note='its cat-eared helmet, antenna and headphones, cut from its body and tail at its collar, its eyes on its own dark visor', neck=143, glass=(65, 63, 89, 67), tint='#141a1e', corner=0.42),
    'macintosh': dict(name='Macintosh', note='kept whole, arms and feet, its screen a terminal now: dark, with a hint of its lavender', neck=None, glass=(56, 30, 78, 72), tint='#c7bcf4', corner=0.14),
    'bitty': dict(name='Bitty', note='kept whole, hands, cable and feet, its screen a terminal now: dark, with a hint of its green', neck=None, glass=(41, 38, 66, 57), tint='#9acb6a', corner=0.12),
    # Its cube ends at row 160; rows 161 to 163 are empty; its stand starts at 164.
    'tmuxai': dict(name='TmuxAI', note='the cube and its antenna, cut from its stand, a glass on its face where its painted eyes were', neck=162, glass=(45, 63, 90, 76), tint='#283c46', ink='#24262c', corner=0.3, eyeScale=1.1),
    'rainbow-terminal-cat': dict(name='Rainbow Terminal Cat', note='kept whole, curled by its laptop, a visor of glass over its eyes', neck=None, glass=(45, 94, 58, 30), tint='#3c325a', ink='#1e1a28', corner=0.45),
    'nori': dict(name='Nori', note='kept whole, a visor of glass over its face', neck=None, glass=(29, 108, 68, 30), tint='#462828', ink='#1e1616', corner=0.45),
}


def kept(frame, neck):
    """The drawing above its neck: all of it where there is none."""
    if neck is None:
        return frame
    out = frame.copy()
    alpha = out.getchannel('A')
    alpha.paste(0, (0, neck, W, H))
    out.putalpha(alpha)
    return out


def measure(sheet):
    rows = sheet.height // H
    edges, counts = [], []
    for r in range(rows):
        row = []
        for c in range(8):
            bb = sheet.crop((c * W, r * H, (c + 1) * W, (r + 1) * H)).getchannel('A').point(lambda v: 255 if v > 128 else 0).getbbox()
            if bb is None:
                break
            row.append([bb[0], bb[1], bb[2], bb[3]])
        edges.append(row)
        counts.append(len(row))
    return counts, edges


def paint_of(rest, spec):
    """What is kept's painted bounds: its left, top, right and the row after its bottom (alpha over half)."""
    bb = kept(rest, spec['neck']).getchannel('A').point(lambda v: 255 if v > 128 else 0).getbbox()
    return [bb[0], bb[1], bb[2], bb[3]]


def window_of(rest, spec):
    """The square a bot's box shows: what is kept, its painted bounds, 6% of air."""
    bb = kept(rest, spec['neck']).getchannel('A').point(lambda v: 255 if v > 16 else 0).getbbox()
    side = max(bb[2] - bb[0], bb[3] - bb[1]) * 1.06
    return [round((bb[0] + bb[2]) / 2 - side / 2, 1), round((bb[1] + bb[3]) / 2 - side / 2, 1), round(side, 1)]


def numbers(values):
    return '[' + ', '.join(str(v) for v in values) + ']'


def entry_ts(pid, spec, counts, edges, paint, window):
    """One pet's entry in PET_PUPPETS, as petPuppets.ts has it."""
    lines = [f"  // {spec['name']}: {spec['note']}.", '  {', f"    id: '{pid}',", f'    frameWidth: {W},', f'    frameHeight: {H},',
             f'    counts: {numbers(counts)},', '    rest: [0, 0],']
    if spec['neck'] is not None:
        lines.append(f"    neck: {spec['neck']},")
    lines += [f'    paint: {numbers(paint)},', f'    window: {numbers(window)},', f"    glass: {numbers(spec['glass'])},", f"    tint: '{spec['tint']}',"]
    for key in ('dark', 'ink', 'corner', 'eyeScale', 'eyeY'):
        if key in spec:
            value = spec[key]
            lines.append(f"    {key}: '{value}'," if isinstance(value, str) else f'    {key}: {value},')
    lines.append('    edges: [')
    lines.append(',\n'.join('      [' + ', '.join(numbers(edge) for edge in row) + ']' for row in edges))
    lines += ['    ]', '  }']
    return '\n'.join(lines)


def main():
    folder = Path(sys.argv[1])
    review = Path(sys.argv[2]) if len(sys.argv) > 2 else None
    shown = []
    entries = []
    for pid, spec in PUPPETS.items():
        sheet = Image.open(folder / pid / 'spritesheet.webp').convert('RGBA')
        counts, edges = measure(sheet)
        rest = sheet.crop((0, 0, W, H))
        window = window_of(rest, spec)
        paint = paint_of(rest, spec)
        entries.append(entry_ts(pid, spec, counts, edges, paint, window))
        shown.append((pid, rest, spec, window))
    print('export const PET_PUPPETS: readonly PetPuppet[] = [')
    print(',\n'.join(entries))
    print(']')
    if review is not None:
        out = Image.new('RGB', (len(shown) * 120 + 20, 330), (23, 25, 28))
        for i, (pid, rest, spec, window) in enumerate(shown):
            x = 10 + i * 120
            piece = kept(rest, spec['neck'])
            left, top, side = window
            square = Image.new('RGBA', (round(side), round(side)), (0, 0, 0, 0))
            square.alpha_composite(piece, (round(-left), round(-top)))
            draw = ImageDraw.Draw(square)
            gx, gy, gw, gh = spec['glass']
            draw.rounded_rectangle([gx - left, gy - top, gx - left + gw, gy - top + gh], min(gw, gh) * spec['corner'], outline=(80, 255, 160, 255), width=2)
            for size, y in ((96, 10), (44, 120), (32, 176)):
                small = square.resize((size, size), Image.LANCZOS)
                out.paste(small.convert('RGB'), (x, y), small)
            whole = rest.resize((round(44 * W / H), 44), Image.LANCZOS)
            out.paste(whole.convert('RGB'), (x, 240), whole)
        out.save(review)
        print('review:', review, file=sys.stderr)


if __name__ == '__main__':
    main()
