import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { isAvatarSpec, isPetId, cleanAvatar, seedAvatar, shuffledAvatar } from '../shared/avatar.js'
import { isPetPick, PET_PICKS } from '../shared/pet-picks.js'
import { petRowsFor } from '../shared/pets.js'
import { CATALOG_INDEX_URL, createPetLibrary, PET_SHEET_MAX } from './pet-library.js'
import type { PetFetch } from './pet-library.js'
import { createTeammateStore } from './teammate-store.js'
import { webpSize } from './webp-size.js'

/**
 * A PET IS CHECKED BEFORE IT IS KEPT, AND KEPT ONLY ON A CLICK (0.563).
 *
 * Colin, 2026-10-03, of OpenPets: "that project is fully mit so yeah i want a
 * full port" -- "theyre just going to be added to the list of potential
 * choices for teammates". The gallery's pets are other people's art ("Rights
 * remain with their respective owners", openpets.dev's terms), so Locust ships
 * none: a person picks one of the pets Locust offers (shared/pet-picks.ts,
 * 0.564 -- the open gallery went) and that one pet is downloaded. What
 * comes down is held to OpenPets' own rules -- its addresses (https,
 * openpets.dev, /pets/), an answer from where it was sent and nowhere else, a
 * size that fits, and a sheet the shape of a pet -- before it is written.
 */

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function scratch(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'locust-pets-'))
  roots.push(root)
  return root
}

/** A WebP file's first bytes, for a sheet of this size: lossless, extended or lossy. */
function webp(kind: 'VP8L' | 'VP8X' | 'VP8 ', width: number, height: number, options: { alpha?: boolean; animated?: boolean; length?: number } = {}): Uint8Array {
  const alpha = options.alpha ?? true
  const length = options.length ?? 64
  const bytes = new Uint8Array(length)
  const view = new DataView(bytes.buffer)
  bytes.set(new TextEncoder().encode('RIFF'), 0)
  view.setUint32(4, length - 8, true)
  bytes.set(new TextEncoder().encode('WEBP'), 8)
  bytes.set(new TextEncoder().encode(kind), 12)
  view.setUint32(16, length - 20, true)
  if (kind === 'VP8L') {
    bytes[20] = 0x2f
    view.setUint32(21, ((width - 1) | ((height - 1) << 14) | ((alpha ? 1 : 0) << 28)) >>> 0, true)
  } else if (kind === 'VP8X') {
    bytes[20] = (alpha ? 0x10 : 0) | (options.animated === true ? 0x02 : 0)
    view.setUint16(24, (width - 1) & 0xffff, true)
    bytes[26] = ((width - 1) >> 16) & 0xff
    view.setUint16(27, (height - 1) & 0xffff, true)
    bytes[29] = ((height - 1) >> 16) & 0xff
  } else {
    bytes.set([0x9d, 0x01, 0x2a], 23)
    view.setUint16(26, width, true)
    view.setUint16(28, height, true)
  }
  return bytes
}

describe('a WebP sheet, read from its first bytes', () => {
  it('reads a lossless sheet, an extended one and a lossy one', () => {
    expect(webpSize(webp('VP8L', 1536, 2288))).toEqual({ width: 1536, height: 2288, alpha: true, animated: false })
    expect(webpSize(webp('VP8X', 1536, 1872, { animated: true }))).toEqual({ width: 1536, height: 1872, alpha: true, animated: true })
    expect(webpSize(webp('VP8 ', 200, 100))).toEqual({ width: 200, height: 100, alpha: false, animated: false })
  })

  it('refuses what is not a WebP, or a file cut short', () => {
    const png = webp('VP8L', 1536, 2288)
    png.set(new TextEncoder().encode('\u0089PNG'), 0)
    expect(webpSize(png)).toBeUndefined()
    // Its own length says 64 bytes; a download that stopped at 40 is not the image.
    expect(webpSize(webp('VP8L', 1536, 2288), 40)).toBeUndefined()
    const unsigned = webp('VP8L', 1536, 2288)
    unsigned[20] = 0
    expect(webpSize(unsigned)).toBeUndefined()
  })
})

describe('the shape of a pet', () => {
  it('is exact for a version 2 sheet, and transparent', () => {
    expect(petRowsFor({ width: 1536, height: 2288, alpha: true, animated: false }, 2)).toBe(11)
    expect(petRowsFor({ width: 1536, height: 2000, alpha: true, animated: false }, 2)).toMatch(/1536 x 2288/)
    expect(petRowsFor({ width: 1536, height: 2288, alpha: false, animated: false }, 2)).toMatch(/transparency/)
    expect(petRowsFor({ width: 1536, height: 2288, alpha: true, animated: true }, 2)).toMatch(/animation/)
  })

  it('reads a version 1 sheet at its own scale, eight across and nine down', () => {
    expect(petRowsFor({ width: 1536, height: 1872, alpha: true, animated: false }, 1)).toBe(9)
    expect(petRowsFor({ width: 768, height: 936, alpha: true, animated: false }, 1)).toBe(9)
    expect(petRowsFor({ width: 1536, height: 2000, alpha: true, animated: false }, 1)).toMatch(/nine down/)
    expect(petRowsFor({ width: 1536, height: 1530, alpha: true, animated: false }, 1)).toMatch(/shape/)
    expect(petRowsFor({ width: 384, height: 468, alpha: true, animated: false }, 1)).toMatch(/too small/)
  })
})

/** A gallery the tests serve: the catalog, its search pages, one catalog page and each pet's files. */
function gallery(pets: readonly { id: string; name: string; featured?: boolean; original?: boolean; v2?: boolean; sheet?: string; thumbnail?: string }[]) {
  const page = 'https://openpets.dev/pets/catalog.v3/page-000.json'
  const search = 'https://openpets.dev/pets/catalog.v3/search.json'
  const searchPage = 'https://openpets.dev/pets/catalog.v3/search-page-000.json'
  const answers = new Map<string, () => Response>()
  const json = (value: unknown) => () => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } })
  answers.set(CATALOG_INDEX_URL, json({ version: 3, generatedAt: '2026-09-24T06:19:36.274Z', total: pets.length, pageSize: 100, search, filters: { categories: [] }, pages: [page] }))
  answers.set(search, json({ version: 3, generatedAt: '2026-09-24T06:19:36.274Z', total: pets.length, pageSize: 250, pages: [searchPage] }))
  answers.set(
    searchPage,
    json({
      version: 3,
      page: 0,
      pageSize: 250,
      pets: pets.map((pet) => ({ id: pet.id, displayName: pet.name, searchText: `${pet.name} a small friend`, category: 'western', catalogPage: 0, featured: pet.featured ?? true, original: pet.original ?? false, ...(pet.v2 === false ? {} : { spriteVersionNumber: 2 }) }))
    })
  )
  answers.set(
    page,
    json({
      version: 3,
      page: 0,
      pageSize: 100,
      pets: pets.map((pet) => ({
        id: pet.id,
        displayName: pet.name,
        description: `${pet.name}, drawn for the tests.`,
        thumbnail: pet.thumbnail ?? `https://openpets.dev/pets/${pet.id}-openpets/thumb.webp`,
        spritesheet: pet.sheet ?? `https://openpets.dev/pets/${pet.id}-openpets/spritesheet.webp`,
        zip: `https://zip.openpets.dev/pets/${pet.id}-openpets/${pet.id}.zip`,
        category: 'western',
        featured: pet.featured ?? true,
        ...(pet.v2 === false ? {} : { spriteVersionNumber: 2 })
      }))
    })
  )
  const asked: string[] = []
  const serve = (url: string, answer: () => Response): void => {
    answers.set(url, answer)
  }
  const fetch: PetFetch = async (url) => {
    asked.push(url)
    const answer = answers.get(url)
    if (answer === undefined) return new Response('not here', { status: 404 })
    return answer()
  }
  return { fetch, asked, serve }
}

const sheetAt = (id: string): string => `https://openpets.dev/pets/${id}-openpets/spritesheet.webp`
const thumbAt = (id: string): string => `https://openpets.dev/pets/${id}-openpets/thumb.webp`

async function library(fetch: PetFetch, now: () => number = () => Date.now()) {
  const root = await scratch()
  const pets = createPetLibrary({
    installedRoot: join(root, 'pets'),
    cacheRoot: join(root, 'pets-cache'),
    bundledRoot: join(root, 'bundled'),
    codexRoot: join(root, 'codex'),
    fetch,
    now
  })
  return { root, pets }
}

describe('adding one of the pets Locust offers', () => {
  it('downloads nothing until a pet is picked, and then only that one pet', async () => {
    const served = gallery([{ id: 'luna-techbot', name: 'Luna TechBot' }, { id: 'robot', name: 'Robot' }])
    served.serve(sheetAt('luna-techbot'), () => new Response(webp('VP8L', 1536, 2288), { status: 200 }))
    served.serve(thumbAt('robot'), () => new Response(webp('VP8L', 148, 160), { status: 200 }))
    const { root, pets } = await library(served.fetch)

    expect(await pets.thumbnail('robot')).toMatch(/^data:image\/webp;base64,/)
    expect(served.asked.some((url) => url.endsWith('spritesheet.webp'))).toBe(false)

    const added = await pets.add('luna-techbot')
    expect(added).toEqual({ source: 'gallery', id: 'luna-techbot', displayName: 'Luna TechBot', description: 'Luna TechBot, drawn for the tests.', rows: 11 })
    expect(served.asked.filter((url) => url.endsWith('spritesheet.webp'))).toEqual([sheetAt('luna-techbot')])
    expect(await readdir(join(root, 'pets'))).toEqual(['luna-techbot'])
    const meta = JSON.parse(await readFile(join(root, 'pets', 'luna-techbot', 'pet.json'), 'utf8')) as Record<string, unknown>
    expect(meta).toMatchObject({ id: 'luna-techbot', displayName: 'Luna TechBot', spritesheetPath: 'spritesheet.webp', spriteVersionNumber: 2, addedFrom: 'https://openpets.dev' })
    expect((await pets.list()).map((pet) => `${pet.source}/${pet.id}`)).toEqual(['gallery/luna-techbot'])
  })

  it('refuses a sheet that is not the shape of a pet, and keeps nothing of it', async () => {
    const served = gallery([{ id: 'robot', name: 'Robot' }, { id: 'nori', name: 'Nori' }, { id: 'bitty', name: 'Bitty' }])
    served.serve(sheetAt('robot'), () => new Response(webp('VP8L', 1536, 2000), { status: 200 }))
    served.serve(sheetAt('nori'), () => new Response(webp('VP8L', 1536, 2288, { alpha: false }), { status: 200 }))
    served.serve(sheetAt('bitty'), () => new Response('<html>a page, not a pet</html>', { status: 200 }))
    const { root, pets } = await library(served.fetch)
    await expect(pets.add('robot')).rejects.toThrow(/1536 x 2288/)
    await expect(pets.add('nori')).rejects.toThrow(/transparency/)
    await expect(pets.add('bitty')).rejects.toThrow(/not a WebP/)
    expect(await readdir(join(root, 'pets')).catch(() => [])).toEqual([])
  })

  it('refuses a file larger than a pet, whether it says so or not', async () => {
    const served = gallery([{ id: 'dot', name: 'Dot' }, { id: 'brew', name: 'Brew' }])
    served.serve(sheetAt('dot'), () => new Response(webp('VP8L', 1536, 2288), { status: 200, headers: { 'content-length': String(PET_SHEET_MAX + 1) } }))
    // No length given, and more than the cap sent: counted as it arrives.
    served.serve(sheetAt('brew'), () => {
      let sent = 0
      const chunk = new Uint8Array(1024 * 1024)
      return new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            if (sent > PET_SHEET_MAX) {
              controller.close()
              return
            }
            sent += chunk.byteLength
            controller.enqueue(chunk)
          }
        }),
        { status: 200 }
      )
    })
    const { pets } = await library(served.fetch)
    await expect(pets.add('dot')).rejects.toThrow(/larger than a pet/)
    await expect(pets.add('brew')).rejects.toThrow(/larger than a pet/)
  })

  it('refuses an answer that came from somewhere else', async () => {
    const served = gallery([{ id: 'reaper', name: 'Reaper' }])
    served.serve(sheetAt('reaper'), () => {
      const response = new Response(webp('VP8L', 1536, 2288), { status: 200 })
      Object.defineProperty(response, 'redirected', { value: true })
      Object.defineProperty(response, 'url', { value: 'https://elsewhere.example/sheet.webp' })
      return response
    })
    const { pets } = await library(served.fetch)
    await expect(pets.add('reaper')).rejects.toThrow(/somewhere else/)
  })

  it('never fetches an address off openpets.dev, nor a pet Locust does not offer', async () => {
    const served = gallery([
      { id: 'glitchcat', name: 'Glitchcat', sheet: 'https://evil.example/pets/glitchcat/spritesheet.webp' },
      { id: 'meowbot', name: 'Meowbot', sheet: 'https://openpets.dev/elsewhere/spritesheet.webp' },
      { id: 'yuyu-chibi', name: 'Yuyu' }
    ])
    const { pets } = await library(served.fetch)
    await expect(pets.add('glitchcat')).rejects.toThrow(/no longer lists/)
    await expect(pets.add('meowbot')).rejects.toThrow(/no longer lists/)
    // In the catalog, but not one of the picks (shared/pet-picks.ts): refused before anything is asked.
    const before = served.asked.length
    for (const id of ['yuyu-chibi', '../robot', 'builtin', 'Robot', '', 'a'.repeat(70)]) {
      await expect(pets.add(id)).rejects.toThrow(/not one Locust offers/)
      await expect(pets.thumbnail(id)).rejects.toThrow(/not one Locust offers/)
    }
    expect(served.asked.length).toBe(before)
    expect(served.asked.some((url) => !url.startsWith('https://openpets.dev/pets/'))).toBe(false)
    expect(served.asked.some((url) => url.endsWith('spritesheet.webp'))).toBe(false)
  })

  it('takes a pet back off the computer', async () => {
    const served = gallery([{ id: 'luna-techbot', name: 'Luna TechBot' }])
    served.serve(sheetAt('luna-techbot'), () => new Response(webp('VP8L', 1536, 2288), { status: 200 }))
    const { root, pets } = await library(served.fetch)
    await pets.add('luna-techbot')
    await pets.remove('luna-techbot')
    expect(await readdir(join(root, 'pets'))).toEqual([])
    await expect(pets.remove('../pets')).rejects.toThrow(/not on this computer/)
  })

  it('takes several out of the picker at once, keeps a worn one\'s files, and brings one back when picked (0.569)', async () => {
    const served = gallery([{ id: 'luna-techbot', name: 'Luna TechBot' }, { id: 'robot', name: 'Robot' }])
    served.serve(sheetAt('luna-techbot'), () => new Response(webp('VP8L', 1536, 2288), { status: 200 }))
    served.serve(sheetAt('robot'), () => new Response(webp('VP8L', 1536, 2288), { status: 200 }))
    const { root, pets } = await library(served.fetch)
    await pets.add('luna-techbot')
    await pets.add('robot')
    expect(await pets.removedPicks()).toEqual([])
    // At once, as the picker's Remove 3 sends them: every one is kept in the list.
    await Promise.all([pets.remove('luna-techbot'), pets.remove('robot', true), pets.remove('reaper')])
    expect([...(await pets.removedPicks())].sort()).toEqual(['luna-techbot', 'reaper', 'robot'])
    // A worn pet's files stay, so its teammate's face does.
    expect(await readdir(join(root, 'pets'))).toEqual(['robot'])
    // Picked again: back in the picker, and nothing downloaded, its files having stayed.
    const asked = served.asked.length
    await pets.add('robot')
    expect(served.asked.length).toBe(asked)
    expect([...(await pets.removedPicks())].sort()).toEqual(['luna-techbot', 'reaper'])
  })

  it('reads a removed list that does not read as nothing removed, and keeps only picks from one that does', async () => {
    const { root, pets } = await library(gallery([]).fetch)
    await writeFile(join(root, 'pets-removed.json'), '{ not json')
    expect(await pets.removedPicks()).toEqual([])
    await writeFile(join(root, 'pets-removed.json'), JSON.stringify({ schemaVersion: 1, ids: ['robot', '../pets', 'yuyu-chibi', 5, 'robot'] }))
    expect(await pets.removedPicks()).toEqual(['robot'])
  })

  it('says so in words when openpets.dev cannot be reached at all', async () => {
    const { pets } = await library(async () => {
      throw new Error('offline')
    })
    await expect(pets.thumbnail('robot')).rejects.toThrow(/could not be reached/)
    await expect(pets.add('robot')).rejects.toThrow(/could not be reached/)
  })
})

describe('the pets Locust offers', () => {
  it('are 21 distinct pets, each a pet id the library accepts', () => {
    expect(PET_PICKS).toHaveLength(21)
    expect(new Set(PET_PICKS.map((pick) => pick.id)).size).toBe(21)
    for (const pick of PET_PICKS) {
      expect(isPetId(pick.id), pick.id).toBe(true)
      expect(isPetPick(pick.id)).toBe(true)
      expect(pick.displayName.trim().length).toBeGreaterThan(0)
    }
    expect(isPetPick('hoodie-cat')).toBe(false)
  })
})

describe('the pets on this computer', () => {
  async function petFolder(root: string, id: string, meta: Record<string, unknown>, sheet: Uint8Array = webp('VP8L', 1536, 2288)): Promise<void> {
    await mkdir(join(root, id), { recursive: true })
    await writeFile(join(root, id, 'pet.json'), JSON.stringify({ id, displayName: 'A Pet', description: 'One.', spritesheetPath: 'spritesheet.webp', spriteVersionNumber: 2, ...meta }))
    await writeFile(join(root, id, 'spritesheet.webp'), sheet)
  }

  it('are Locust\u2019s own, the gallery\u2019s added ones and Codex\u2019s, each read where it is', async () => {
    const { root, pets } = await library(gallery([]).fetch)
    await petFolder(join(root, 'bundled'), 'hoodie-cat', { displayName: 'Hoodie Cat' })
    await petFolder(join(root, 'pets'), 'yuyu-chibi', { displayName: 'Yuyu' })
    await petFolder(join(root, 'codex'), 'mochi', { displayName: 'Mochi', spriteVersionNumber: undefined }, webp('VP8L', 1536, 1872))
    expect((await pets.list()).map((pet) => `${pet.source}/${pet.id}/${String(pet.rows)}`)).toEqual(['bundled/hoodie-cat/11', 'gallery/yuyu-chibi/11', 'codex/mochi/9'])
    const sheet = await pets.sheet({ source: 'codex', id: 'mochi' })
    expect(sheet.rows).toBe(9)
    expect(webpSize(sheet.bytes)?.height).toBe(1872)
  })

  it('leaves out a pet whose pet.json names another, or that is not the shape of a pet', async () => {
    const { root, pets } = await library(gallery([]).fetch)
    await petFolder(join(root, 'codex'), 'impostor', { id: 'someone-else' })
    await petFolder(join(root, 'codex'), 'squashed', {}, webp('VP8L', 1536, 2000))
    await petFolder(join(root, 'codex'), 'fine', {})
    expect((await pets.list()).map((pet) => pet.id)).toEqual(['fine'])
    await expect(pets.sheet({ source: 'codex', id: 'impostor' })).rejects.toThrow(/another pet/)
  })

  it('reads nothing through a link: not a linked pet folder, nor a linked Codex folder', async () => {
    const { root, pets } = await library(gallery([]).fetch)
    const outside = await scratch()
    await petFolder(outside, 'stray', {})
    await mkdir(join(root, 'pets'), { recursive: true })
    // A junction needs no special rights on Windows; elsewhere it is a plain directory link.
    await symlink(join(outside, 'stray'), join(root, 'pets', 'stray'), 'junction')
    await symlink(outside, join(root, 'codex'), 'junction')
    expect(await pets.list()).toEqual([])
    await expect(pets.sheet({ source: 'gallery', id: 'stray' })).rejects.toThrow(/not on this computer/)
    await expect(pets.sheet({ source: 'codex', id: 'stray' })).rejects.toThrow(/not on this computer/)
  })
})

describe('a pet on a teammate\u2019s record', () => {
  it('is kept through a save and a reopen, beside the bot it falls back to', async () => {
    const root = await scratch()
    const look = { ...seedAvatar('draft'), bot: { shape: 'droid' as const, face: 'eyes' as const }, pet: { source: 'gallery' as const, id: 'yuyu-chibi' } }
    const made = await createTeammateStore({ rootDirectory: root }).create({ name: 'Yuyu', hue: 'rose', role: 'Docs & QA', avatar: look })
    expect(made.avatar).toEqual(look)
    expect((await createTeammateStore({ rootDirectory: root }).list())[0]?.avatar).toEqual(look)
  })

  it('refuses a pet that names no real source, or an id that is a path', async () => {
    const base = seedAvatar('draft')
    expect(isAvatarSpec({ ...base, pet: { source: 'bundled', id: 'hoodie-cat' } })).toBe(true)
    expect(isAvatarSpec({ ...base, pet: { source: 'web', id: 'hoodie-cat' } })).toBe(false)
    expect(isAvatarSpec({ ...base, pet: { source: 'codex', id: '../../secrets' } })).toBe(false)
    expect(isAvatarSpec({ ...base, pet: { source: 'gallery', id: 'builtin' } })).toBe(false)
    expect(cleanAvatar({ ...base, pet: { source: 'codex', id: 'mochi', path: 'C:\\x' } as never }).pet).toEqual({ source: 'codex', id: 'mochi' })
    // A shuffle rolls through the bots: it takes the pet off.
    expect(shuffledAvatar({ ...base, pet: { source: 'codex', id: 'mochi' } }).pet).toBeUndefined()
  })
})
