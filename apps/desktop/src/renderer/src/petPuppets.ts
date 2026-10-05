import type { SheetPrint } from './petScreens.js'

/**
 * PETS AS PUPPETS, WITH OUR TERMINAL EYES (2026-10-05).
 *
 * Colin, of the pets: *"i want you to stylize and redesign these in our
 * teammate style with the terminal face and reanimate/add animations if
 * necessary ... I want to keep codex buddy obviously, and then I want to try
 * out cabin, macintosh, bitty (I like this one alot, i use it), meowbot,
 * astro, and tmux ... as far as optional ones we can try rainbow terminal cat
 * and nori"*; of their screens, *"ill let you decide if you want to keep the
 * terminal screen colors ... but either way i want our terminal eyes"*; and
 * *"if removing their legs/bodies helps animating them like the other
 * teammates i completely understand"*.
 *
 * A pet's sheet steps through a few drawings a second; a bot is drawn
 * thirty times a second by its rig -- it floats, leans, looks about, hops and
 * lands, tips its head when curious, dozes. So each of these pets is a
 * PUPPET: one drawing, its resting pose, moved by a bot's own rig, its moods
 * and its changes (PetPuppet.tsx), and wearing a screen with a bot's eyes
 * where its own face was. Codex Buddy keeps his drawings: his lifts are what
 * he is (petRoutines.ts).
 *
 * WHERE A HEAD SITS ON A BODY, THE BODY GOES; NOTHING OF THE HEAD DOES. Astro
 * Bot and Meowbot are big heads on little bodies that walk, and TmuxAI a cube
 * on a stand: each is cut straight across its neck, on the dark line where the
 * two meet, so it floats as a bot's head does and its screen is a quarter as
 * big again in the same box. Their ears, antennae and headphones stay -- an
 * ellipse round each head was tried first, and Colin: *"you just drew a
 * circle around some of them and chopped off their ears lol"*. A pet whose
 * body is the pet is kept whole, arms and feet and all: Cabin, Macintosh,
 * Bitty (its hand is drawn over its own side; no line takes it off cleanly),
 * the cat and Nori.
 *
 * Their screens are terminals, dark, each with a hint of its own colour, as
 * a bot's visor takes its body's: our eyes glow in the colours that mean
 * something -- cyan, amber waiting on you, red stuck, the green of a finish
 * -- and on a light screen they would not glow at all.
 *
 * Their drawings stay their makers', downloaded when a person picks them;
 * Locust keeps only these numbers (`_tools/measure-pet-puppets.py`), and a
 * sheet that is not the one measured (screenFits) is drawn as it is.
 */

export interface PetPuppet extends SheetPrint {
  readonly id: string
  /** The drawing it is drawn from: its resting pose (row, column). */
  readonly rest: readonly [row: number, column: number]
  /** The row its head ends at, in the drawing's pixels: what is below it -- a body that walks, a stand -- is cut away. Absent, it is kept whole. */
  readonly neck?: number
  /** What is kept's painted bounds, in the drawing's pixels: its left, top, right and the row after its bottom. Its ring and dot sit on it. */
  readonly paint: readonly [left: number, top: number, right: number, bottom: number]
  /** The square of the drawing a bot's box shows: its left, its top and its side, in the drawing's pixels. */
  readonly window: readonly [left: number, top: number, side: number]
  /** Its screen, in the drawing's pixels. */
  readonly glass: readonly [x: number, y: number, w: number, h: number]
  /** The glass's hue: its own screen's, darkened as a bot's visor is. */
  readonly tint: string
  /** How dark the glass is beside a bot's visor (1, as dark): Cabin's is all but black. */
  readonly dark?: number
  /** Round the glass, where the pet has no bezel of its own. */
  readonly ink?: string
  /** The glass's corners, a fraction of its shorter side. */
  readonly corner: number
  /** The eyes' size beside a bot screen's (1, the same). */
  readonly eyeScale?: number
  /** The eyes' height on the glass: -1 its top, 0 its middle, 1 its bottom. */
  readonly eyeY?: number
}

export const PET_PUPPETS: readonly PetPuppet[] = [
  // Cabin: a phone that is all screen: kept whole, its glass near black as its own, its eyes as large as its old face.
  {
    id: 'cabin-face',
    frameWidth: 192,
    frameHeight: 208,
    counts: [6, 8, 8, 4, 5, 8, 6, 6, 6],
    rest: [0, 0],
    paint: [34, 5, 158, 203],
    window: [-8.9, -0.9, 209.9],
    glass: [44, 22, 104, 160],
    tint: '#121e22',
    dark: 0.45,
    corner: 0.22,
    eyeScale: 1.7,
    eyeY: -0.18,
    edges: [
      [[34, 5, 158, 203], [34, 5, 158, 203], [35, 5, 157, 203], [34, 5, 157, 203], [35, 5, 156, 203], [35, 5, 157, 203]],
      [[23, 5, 168, 203], [23, 5, 168, 203], [31, 5, 161, 203], [34, 5, 157, 203], [24, 5, 167, 203], [26, 5, 165, 203], [28, 5, 164, 203], [34, 5, 158, 203]],
      [[34, 5, 158, 203], [28, 5, 164, 203], [26, 5, 165, 203], [24, 5, 167, 203], [34, 5, 157, 203], [31, 5, 161, 203], [23, 5, 168, 203], [23, 5, 168, 203]],
      [[28, 5, 163, 203], [23, 5, 168, 203], [22, 5, 169, 203], [29, 5, 162, 203]],
      [[5, 31, 187, 177], [20, 5, 172, 203], [24, 5, 168, 203], [19, 5, 172, 203], [5, 30, 187, 177]],
      [[18, 5, 173, 203], [21, 5, 170, 203], [21, 5, 171, 203], [19, 5, 173, 203], [20, 5, 172, 203], [19, 5, 173, 203], [17, 5, 175, 203], [17, 5, 174, 203]],
      [[30, 5, 162, 203], [30, 5, 162, 203], [28, 5, 164, 203], [29, 5, 162, 203], [27, 5, 164, 203], [30, 5, 162, 203]],
      [[30, 5, 161, 203], [31, 5, 161, 203], [31, 5, 161, 203], [31, 5, 161, 203], [31, 5, 161, 203], [31, 5, 161, 203]],
      [[28, 5, 163, 203], [26, 5, 166, 203], [29, 5, 162, 203], [24, 5, 167, 203], [29, 5, 162, 203], [29, 5, 163, 203]]
    ]
  },
  // Astro Bot: its helmet, antennae and headphones, cut from its body at its neck, its eyes on its own black screen.
  {
    id: 'astro-bot',
    frameWidth: 192,
    frameHeight: 208,
    counts: [6, 8, 8, 4, 5, 8, 6, 6, 6],
    rest: [0, 0],
    neck: 136,
    paint: [18, 5, 174, 136],
    window: [13.3, -12.2, 165.4],
    glass: [55, 55, 85, 66],
    tint: '#141c28',
    corner: 0.38,
    edges: [
      [[18, 5, 174, 203], [20, 5, 172, 203], [22, 5, 170, 203], [22, 5, 170, 203], [22, 5, 170, 203], [22, 5, 170, 203]],
      [[28, 5, 163, 203], [27, 5, 164, 203], [31, 5, 161, 203], [23, 5, 169, 203], [29, 5, 163, 203], [26, 5, 165, 203], [29, 5, 162, 203], [28, 5, 163, 203]],
      [[28, 5, 163, 203], [29, 5, 162, 203], [26, 5, 165, 203], [29, 5, 163, 203], [23, 5, 169, 203], [31, 5, 161, 203], [27, 5, 164, 203], [28, 5, 163, 203]],
      [[17, 5, 174, 203], [12, 5, 180, 203], [9, 5, 182, 203], [18, 5, 173, 203]],
      [[18, 5, 174, 203], [23, 5, 168, 203], [8, 5, 183, 203], [14, 5, 178, 203], [18, 5, 174, 203]],
      [[23, 5, 169, 203], [21, 5, 170, 203], [9, 5, 182, 203], [5, 36, 187, 171], [7, 5, 184, 203], [7, 5, 185, 203], [8, 11, 184, 197], [5, 6, 187, 201]],
      [[22, 5, 170, 203], [25, 5, 166, 203], [22, 5, 169, 203], [27, 5, 164, 203], [21, 5, 170, 203], [27, 5, 165, 203]],
      [[26, 5, 165, 203], [18, 5, 173, 203], [23, 5, 168, 203], [24, 5, 167, 203], [22, 5, 170, 203], [25, 5, 166, 203]],
      [[23, 5, 169, 203], [26, 5, 165, 203], [28, 5, 164, 203], [24, 5, 168, 203], [29, 5, 163, 203], [26, 5, 166, 203]]
    ]
  },
  // Meowbot: its cat-eared helmet, antenna and headphones, cut from its body and tail at its collar, its eyes on its own dark visor.
  {
    id: 'meowbot',
    frameWidth: 192,
    frameHeight: 208,
    counts: [6, 8, 8, 4, 5, 8, 6, 6, 6],
    rest: [0, 0],
    neck: 143,
    paint: [24, 5, 178, 143],
    window: [18.3, -8.2, 164.3],
    glass: [65, 63, 89, 67],
    tint: '#141a1e',
    corner: 0.42,
    edges: [
      [[14, 5, 178, 203], [12, 5, 179, 203], [18, 5, 174, 203], [14, 5, 178, 203], [15, 5, 176, 203], [10, 5, 182, 203]],
      [[5, 5, 187, 203], [5, 5, 186, 203], [8, 5, 183, 203], [15, 5, 176, 203], [11, 5, 180, 203], [16, 5, 175, 203], [17, 5, 174, 203], [13, 5, 178, 203]],
      [[13, 5, 178, 203], [17, 5, 174, 203], [16, 5, 175, 203], [11, 5, 180, 203], [15, 5, 176, 203], [8, 5, 183, 203], [5, 5, 186, 203], [5, 5, 187, 203]],
      [[18, 5, 173, 203], [20, 5, 172, 203], [15, 5, 177, 203], [19, 5, 172, 203]],
      [[11, 5, 181, 203], [24, 5, 168, 203], [25, 5, 167, 203], [24, 5, 168, 203], [19, 5, 173, 203]],
      [[22, 5, 170, 203], [14, 5, 177, 203], [9, 5, 183, 203], [10, 5, 182, 203], [9, 5, 183, 203], [5, 5, 187, 203], [6, 5, 186, 203], [14, 5, 177, 203]],
      [[13, 5, 178, 203], [16, 5, 176, 203], [18, 5, 174, 203], [16, 5, 175, 203], [12, 5, 179, 203], [18, 5, 174, 203]],
      [[22, 5, 169, 203], [18, 5, 173, 203], [16, 5, 175, 203], [20, 5, 172, 203], [19, 5, 173, 203], [21, 5, 171, 203]],
      [[17, 5, 174, 203], [21, 5, 170, 203], [21, 5, 171, 203], [17, 5, 174, 203], [19, 5, 172, 203], [17, 5, 175, 203]]
    ]
  },
  // Macintosh: kept whole, arms and feet, its screen a terminal now: dark, with a hint of its lavender.
  {
    id: 'macintosh',
    frameWidth: 192,
    frameHeight: 208,
    counts: [6, 8, 8, 4, 5, 8, 6, 6, 6],
    rest: [0, 0],
    paint: [12, 5, 179, 203],
    window: [-9.4, -0.9, 209.9],
    glass: [56, 30, 78, 72],
    tint: '#c7bcf4',
    corner: 0.14,
    edges: [
      [[12, 5, 179, 203], [12, 5, 179, 203], [12, 5, 179, 203], [13, 5, 179, 203], [13, 5, 179, 203], [12, 5, 179, 203]],
      [[9, 5, 183, 203], [10, 5, 182, 203], [9, 5, 182, 203], [11, 5, 180, 203], [12, 5, 179, 203], [10, 5, 181, 203], [11, 5, 181, 203], [11, 5, 180, 203]],
      [[17, 5, 175, 203], [10, 5, 182, 203], [10, 5, 182, 203], [13, 5, 178, 203], [9, 5, 183, 203], [11, 5, 180, 203], [14, 5, 177, 203], [16, 5, 176, 203]],
      [[9, 5, 183, 203], [5, 8, 187, 200], [5, 11, 187, 196], [9, 5, 182, 203]],
      [[9, 5, 183, 203], [9, 5, 182, 203], [5, 8, 187, 200], [13, 5, 178, 203], [8, 5, 183, 203]],
      [[23, 5, 169, 203], [14, 5, 177, 203], [21, 5, 171, 203], [28, 5, 163, 203], [22, 5, 169, 203], [5, 9, 187, 199], [15, 5, 177, 203], [16, 5, 176, 203]],
      [[8, 5, 183, 203], [13, 5, 179, 203], [9, 5, 182, 203], [16, 5, 175, 203], [12, 5, 179, 203], [14, 5, 177, 203]],
      [[12, 5, 180, 203], [10, 5, 181, 203], [11, 5, 180, 203], [6, 5, 186, 203], [10, 5, 182, 203], [11, 5, 180, 203]],
      [[22, 5, 170, 203], [14, 5, 177, 203], [27, 5, 164, 203], [20, 5, 172, 203], [27, 5, 165, 203], [22, 5, 169, 203]]
    ]
  },
  // Bitty: kept whole, hands, cable and feet, its screen a terminal now: dark, with a hint of its green.
  {
    id: 'bitty',
    frameWidth: 192,
    frameHeight: 208,
    counts: [6, 8, 8, 4, 5, 8, 6, 6, 6],
    rest: [0, 0],
    paint: [5, 8, 187, 199],
    window: [-5.2, 2.3, 202.5],
    glass: [41, 38, 66, 57],
    tint: '#9acb6a',
    corner: 0.12,
    edges: [
      [[5, 8, 187, 199], [5, 8, 187, 199], [5, 7, 187, 200], [5, 7, 187, 200], [5, 7, 187, 200], [5, 8, 187, 199]],
      [[5, 5, 187, 203], [5, 6, 187, 201], [5, 5, 187, 202], [5, 6, 187, 202], [5, 6, 187, 202], [6, 5, 186, 203], [9, 5, 183, 203], [5, 5, 186, 203]],
      [[5, 5, 186, 203], [9, 5, 183, 203], [6, 5, 186, 203], [5, 6, 187, 202], [5, 6, 187, 202], [5, 5, 187, 202], [5, 6, 187, 201], [5, 5, 187, 203]],
      [[8, 5, 184, 203], [8, 5, 184, 203], [5, 8, 187, 199], [14, 5, 177, 203]],
      [[5, 16, 187, 192], [5, 12, 187, 195], [5, 16, 187, 191], [5, 20, 187, 187], [5, 9, 187, 199]],
      [[7, 5, 184, 203], [7, 5, 184, 203], [5, 11, 187, 196], [5, 16, 187, 191], [5, 39, 187, 168], [5, 23, 187, 185], [5, 6, 187, 202], [7, 5, 185, 203]],
      [[7, 5, 185, 203], [5, 7, 187, 201], [5, 7, 187, 201], [5, 58, 187, 150], [5, 43, 187, 164], [5, 58, 187, 150]],
      [[5, 6, 187, 202], [5, 6, 187, 202], [5, 5, 187, 202], [5, 6, 187, 201], [5, 7, 187, 201], [6, 5, 186, 203]],
      [[5, 5, 186, 203], [5, 5, 187, 202], [9, 5, 183, 203], [5, 5, 187, 202], [5, 5, 187, 203], [5, 7, 187, 201]]
    ]
  },
  // TmuxAI: the cube and its antenna, cut from its stand, a glass on its face where its painted eyes were.
  {
    id: 'tmuxai',
    frameWidth: 192,
    frameHeight: 208,
    counts: [6, 8, 8, 4, 5, 8, 6, 6, 6],
    rest: [0, 0],
    neck: 162,
    paint: [32, 5, 161, 161],
    window: [13.3, 0.3, 166.4],
    glass: [45, 63, 90, 76],
    tint: '#283c46',
    ink: '#24262c',
    corner: 0.3,
    eyeScale: 1.1,
    edges: [
      [[30, 5, 161, 203], [35, 5, 156, 203], [25, 5, 166, 203], [34, 5, 158, 203], [32, 5, 159, 203], [31, 5, 161, 203]],
      [[22, 5, 169, 203], [22, 5, 169, 203], [24, 5, 167, 203], [18, 5, 173, 203], [7, 5, 184, 203], [20, 5, 171, 203], [24, 5, 167, 203], [24, 5, 168, 203]],
      [[24, 5, 168, 203], [24, 5, 167, 203], [20, 5, 171, 203], [7, 5, 184, 203], [18, 5, 173, 203], [24, 5, 167, 203], [22, 5, 169, 203], [22, 5, 169, 203]],
      [[32, 5, 159, 203], [25, 5, 167, 203], [22, 5, 170, 203], [31, 5, 160, 203]],
      [[5, 17, 187, 191], [30, 5, 162, 203], [47, 5, 145, 203], [32, 5, 160, 203], [5, 30, 187, 178]],
      [[27, 5, 165, 203], [27, 5, 164, 203], [27, 5, 165, 203], [22, 5, 170, 203], [7, 5, 185, 203], [5, 11, 187, 197], [5, 24, 187, 183], [5, 56, 187, 152]],
      [[26, 5, 165, 203], [28, 5, 164, 203], [24, 5, 167, 203], [26, 5, 166, 203], [26, 5, 166, 203], [26, 5, 166, 203]],
      [[32, 5, 159, 203], [20, 5, 172, 203], [19, 5, 172, 203], [31, 5, 160, 203], [17, 5, 174, 203], [31, 5, 161, 203]],
      [[32, 5, 160, 203], [26, 5, 165, 203], [17, 5, 175, 203], [20, 5, 171, 203], [29, 5, 163, 203], [32, 5, 160, 203]]
    ]
  },
  // Rainbow Terminal Cat: kept whole, curled by its laptop, a visor of glass over its eyes.
  {
    id: 'rainbow-terminal-cat',
    frameWidth: 192,
    frameHeight: 208,
    counts: [6, 8, 8, 4, 5, 8, 6, 6, 6],
    rest: [0, 0],
    paint: [5, 43, 187, 165],
    window: [-0.5, 7.5, 192.9],
    glass: [45, 94, 58, 30],
    tint: '#3c325a',
    ink: '#1e1a28',
    corner: 0.45,
    edges: [
      [[5, 43, 187, 165], [5, 42, 187, 165], [5, 42, 187, 166], [5, 42, 187, 165], [5, 42, 187, 165], [5, 43, 187, 164]],
      [[5, 39, 187, 168], [5, 30, 187, 177], [5, 23, 187, 185], [5, 30, 187, 178], [5, 29, 187, 178], [5, 39, 187, 168], [5, 36, 187, 172], [5, 36, 187, 171]],
      [[5, 44, 187, 164], [5, 33, 187, 174], [5, 35, 187, 173], [5, 29, 187, 178], [5, 31, 187, 177], [5, 32, 187, 175], [5, 35, 187, 173], [5, 44, 187, 164]],
      [[5, 39, 187, 169], [5, 40, 187, 167], [5, 39, 187, 168], [5, 40, 187, 167]],
      [[5, 45, 187, 162], [5, 42, 187, 165], [5, 40, 187, 167], [5, 41, 187, 166], [5, 46, 187, 162]],
      [[5, 40, 187, 168], [5, 39, 187, 169], [5, 47, 187, 161], [5, 63, 187, 145], [5, 47, 187, 160], [5, 48, 187, 159], [5, 47, 187, 161], [5, 40, 187, 167]],
      [[5, 39, 187, 169], [5, 39, 187, 168], [5, 39, 187, 169], [5, 39, 187, 168], [5, 39, 187, 168], [5, 39, 187, 168]],
      [[5, 39, 187, 169], [5, 42, 187, 166], [5, 39, 187, 168], [5, 38, 187, 169], [5, 39, 187, 169], [5, 42, 187, 166]],
      [[5, 35, 187, 172], [5, 36, 187, 171], [5, 39, 187, 168], [5, 35, 187, 173], [5, 39, 187, 169], [5, 39, 187, 168]]
    ]
  },
  // Nori: kept whole, a visor of glass over its face.
  {
    id: 'nori',
    frameWidth: 192,
    frameHeight: 208,
    counts: [6, 8, 8, 4, 5, 8, 6, 6, 6],
    rest: [0, 0],
    paint: [5, 41, 187, 166],
    window: [-0.5, 7.0, 192.9],
    glass: [29, 108, 68, 30],
    tint: '#462828',
    ink: '#1e1616',
    corner: 0.45,
    edges: [
      [[5, 41, 187, 166], [5, 37, 187, 170], [5, 40, 187, 168], [5, 39, 187, 169], [5, 40, 187, 168], [5, 38, 187, 170]],
      [[5, 30, 187, 177], [5, 32, 187, 176], [5, 34, 187, 174], [5, 30, 187, 178], [5, 31, 187, 177], [5, 29, 187, 179], [5, 30, 187, 178], [5, 30, 187, 177]],
      [[5, 30, 187, 177], [5, 30, 187, 178], [5, 29, 187, 179], [5, 31, 187, 177], [5, 30, 187, 178], [5, 34, 187, 174], [5, 32, 187, 176], [5, 30, 187, 177]],
      [[5, 40, 187, 168], [5, 44, 187, 163], [5, 44, 187, 164], [5, 38, 187, 169]],
      [[5, 48, 187, 159], [5, 35, 187, 173], [5, 37, 187, 170], [5, 33, 187, 174], [5, 47, 187, 160]],
      [[5, 38, 187, 170], [5, 39, 187, 169], [5, 38, 187, 169], [5, 47, 187, 160], [5, 37, 187, 170], [5, 37, 187, 170], [5, 38, 187, 169], [5, 38, 187, 170]],
      [[5, 37, 187, 170], [5, 35, 187, 172], [5, 26, 187, 181], [5, 35, 187, 172], [5, 33, 187, 174], [5, 35, 187, 173]],
      [[5, 34, 187, 173], [5, 34, 187, 173], [5, 33, 187, 174], [5, 33, 187, 174], [5, 35, 187, 173], [5, 33, 187, 175]],
      [[5, 36, 187, 171], [5, 35, 187, 172], [5, 33, 187, 175], [5, 33, 187, 174], [5, 34, 187, 173], [5, 33, 187, 174]]
    ]
  }
]

/** The puppet of a pet of this id, before its sheet is checked (screenFits); undefined for any other pet. */
export function puppetFor(id: string): PetPuppet | undefined {
  return PET_PUPPETS.find((puppet) => puppet.id === id)
}
