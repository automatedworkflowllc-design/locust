import type { PetRows } from './pets.js'

/**
 * THE PETS LOCUST OFFERS (0.564): a short list, not the catalog.
 *
 * 0.563 opened openpets.dev's whole gallery in the look picker. Colin, after
 * using it: the catalog is community art in every style (fan art even among
 * its Featured), and it read as *"really janky"*. Then, of the pets he had
 * added from it: *"i want to keep those and remove all the others."* These
 * are those 21, in the order he added them (2026-10-03, 04:33-04:37) --
 * little robots, terminals and screen-faced gadgets, a cast that suits a
 * team of coding agents.
 *
 * Each is still made and hosted by its maker on openpets.dev. Locust ships
 * none of them -- the catalog states no licence for its pets -- it downloads
 * one when a person picks it (main/pet-library.ts refuses any other id). To
 * stop offering one, delete its line.
 */
export interface PetPick {
  readonly id: string
  /** Its maker's name for it, as its pet.json says. */
  readonly displayName: string
  readonly rows: PetRows
}

export const PET_PICKS: readonly PetPick[] = [
  { id: 'luna-techbot', displayName: 'Luna TechBot', rows: 11 },
  { id: 'pixel-terminal', displayName: 'Pixel Terminal', rows: 9 },
  { id: 'yeelight-scene-screen-commander', displayName: '智屏小司令', rows: 9 },
  { id: 'reaper', displayName: 'Reaper', rows: 9 },
  { id: 'glitchcat', displayName: 'Glitchcat', rows: 9 },
  { id: 'dot', displayName: 'Dot', rows: 9 },
  { id: 'brew', displayName: 'Brew', rows: 9 },
  { id: 'rainbow-terminal-cat', displayName: 'Rainbow Terminal Cat', rows: 9 },
  { id: 'tmuxai', displayName: 'TmuxAI Official', rows: 9 },
  { id: 'meowbyte', displayName: 'Meowbyte', rows: 9 },
  { id: 'robot', displayName: 'Robot', rows: 9 },
  { id: 'astro-bot', displayName: 'Astro Bot', rows: 9 },
  { id: 'meowbot', displayName: 'Meowbot', rows: 9 },
  { id: 'bitty', displayName: 'Bitty', rows: 9 },
  { id: 'cloud-puff', displayName: 'Cloud Puff', rows: 9 },
  { id: 'nori', displayName: 'Nori', rows: 9 },
  { id: 'bankr', displayName: 'Bankr', rows: 9 },
  { id: 'cabin-face', displayName: 'Cabin', rows: 9 },
  { id: 'dumpster-fire', displayName: 'Dumpster Fire', rows: 9 },
  { id: 'macintosh', displayName: 'Macintosh', rows: 9 },
  { id: 'codex-buddy', displayName: 'Codex Buddy', rows: 9 }
]

export function isPetPick(id: unknown): boolean {
  return typeof id === 'string' && PET_PICKS.some((pick) => pick.id === id)
}
