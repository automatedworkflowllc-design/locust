import { randomBytes } from 'node:crypto'
import { lstat, mkdir, open, readdir, readFile, realpath, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { join, sep } from 'node:path'

import { isPetId } from '../shared/avatar.js'
import type { PetRef, PetSource } from '../shared/avatar.js'
import type { PublicPet } from '../shared/ipc.js'
import { isPetPick } from '../shared/pet-picks.js'
import { petRowsFor } from '../shared/pets.js'
import type { PetRows } from '../shared/pets.js'
import { webpSize, WEBP_HEADER_BYTES } from './webp-size.js'

/**
 * THE PETS A TEAMMATE CAN WEAR (0.563), kept by the host.
 *
 * Colin, 2026-10-03, of OpenPets (https://github.com/OpenPetsHQ/openpets, MIT):
 * "that would be quite the library of teammates, no?" -- "i want a full port"
 * -- "theyre just going to be added to the list of potential choices for
 * teammates". Three places a pet comes from:
 *
 *   - Locust's own: OpenPets' Hoodie Cat, the one pet in the installer (it is
 *     in OpenPets' MIT repository; THIRD_PARTY_NOTICES.md).
 *   - The openpets.dev gallery, DOWNLOADED ON THE PERSON'S CLICK and never
 *     before. Its terms say a pet "may include user-submitted, community-made,
 *     or fan-made assets ... Rights remain with their respective owners", so
 *     no gallery pet is ever shipped in Locust -- each person adds the one they
 *     pick to their own computer, which is what OpenPets itself does.
 *   - Codex: pets the person made, in `~/.codex/pets`, read where they are and
 *     never written.
 *
 * What this ports from OpenPets, and why: the catalog's addresses and their
 * rules (`catalog-validation.ts`: https, openpets.dev, `/pets/`, no port, no
 * credentials), a download that went anywhere but where it was sent is
 * refused (`catalog-remote.ts`'s final-URL check), bounded reads of pet files
 * (`codex-pets.ts`: a size checked before and after, no links followed, at
 * most 100 Codex pets) and the sheet's shape (`codex-pets-core.ts`). What it
 * does not: OpenPets downloads a ZIP and unpacks it; the catalog's
 * `spritesheet` address IS the sheet, so Locust downloads that one file and
 * writes its own `pet.json`, and there is no archive to open at all.
 *
 * The window never names a path or an address: a pet is a source and an id,
 * and every address comes from the catalog the host itself read.
 */

export const PET_JSON_MAX = 128 * 1024
export const PET_SHEET_MAX = 24 * 1024 * 1024
export const PET_THUMBNAIL_MAX = 1024 * 1024
export const CATALOG_JSON_MAX = 4 * 1024 * 1024
/** OpenPets reads at most this many Codex pets (`maxCodexPets`). */
export const CODEX_PETS_MAX = 100
/** How long a read of the gallery's catalog is used before it is read again. */
export const CATALOG_FRESH_MS = 6 * 60 * 60 * 1000
export const THUMBNAILS_KEPT = 400
/** One screen of gallery tiles. */
const FETCH_TIMEOUT_MS = 30_000

export const CATALOG_INDEX_URL = 'https://openpets.dev/pets/catalog.v3.json'

/** A refusal in words a person can act on: the window shows the message as it is. */
export class PetError extends Error {}

export interface PetFetch {
  (url: string, init: { readonly signal: AbortSignal; readonly redirect: 'error' }): Promise<Response>
}

export interface PetLibraryOptions {
  /** Pets added from the gallery: `<userData>/pets`. */
  readonly installedRoot: string
  /** The gallery's catalog and small pictures: `<userData>/pets-cache`. */
  readonly cacheRoot: string
  /** Locust's own, beside the app. */
  readonly bundledRoot: string
  /** `~/.codex/pets`, read only. */
  readonly codexRoot?: string
  readonly fetch: PetFetch
  readonly now?: () => number
  readonly log?: (message: string) => void
}

export interface PetLibrary {
  list(): Promise<readonly PublicPet[]>
  /** A pet's sheet, checked, to draw. */
  sheet(ref: PetRef): Promise<{ readonly bytes: Uint8Array; readonly rows: PetRows }>
  thumbnail(id: string): Promise<string>
  add(id: string): Promise<PublicPet>
  remove(id: string): Promise<void>
}

/** A pet.json, as Codex writes one and as Locust writes its own. */
interface PetMeta {
  readonly displayName: string
  readonly description: string
  readonly version: 1 | 2
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * OpenPets' `validateCodexPetMetadata`, a little kinder: the id must be its
 * folder's name; a name of 1-120 characters (the catalog's limit); a
 * description of up to 500, which may be empty (the gallery's can be); the
 * sheet's file named as Codex names it; version 2 said only as the number 2.
 */
export function parsedPetMeta(value: unknown, folder: string): PetMeta | string {
  if (!isRecord(value)) return 'Its pet.json is not an object.'
  if (value.id !== folder) return 'Its pet.json names another pet than its folder.'
  const displayName = typeof value.displayName === 'string' ? value.displayName.trim() : ''
  if (displayName.length === 0 || displayName.length > 120) return 'Its pet.json has no name, or one too long.'
  const description = value.description === undefined ? '' : value.description
  if (typeof description !== 'string' || description.length > 500) return 'Its pet.json has a description too long.'
  if (value.spritesheetPath !== 'spritesheet.webp') return 'Its pet.json does not name spritesheet.webp.'
  if (value.spriteVersionNumber !== undefined && value.spriteVersionNumber !== 2) return 'Its pet.json names a sheet version Locust does not know.'
  return { displayName, description: description.trim(), version: value.spriteVersionNumber === 2 ? 2 : 1 }
}

/**
 * A catalog address, by OpenPets' rule (`validateCatalogUrl`): https on
 * openpets.dev, under `/pets/` -- `/pets/catalog.v3/` for the catalog's own
 * pages -- with no port and no credentials. Returned as the URL the fetch
 * will compare its answer with.
 */
export function catalogAddress(raw: unknown, kind: 'file' | 'catalog'): string | undefined {
  if (typeof raw !== 'string' || raw.length > 2048) return undefined
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return undefined
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== '') return undefined
  if (url.hostname !== 'openpets.dev') return undefined
  if (!url.pathname.startsWith(kind === 'catalog' ? '/pets/catalog.v3/' : '/pets/')) return undefined
  // A path that climbs out of /pets/ is resolved by URL above; this catches what is left.
  if (url.pathname.includes('..')) return undefined
  return url.toString()
}

/** A pet in the gallery's search index: enough to list, find and filter it. */
interface GalleryEntry {
  readonly id: string
  readonly displayName: string
  readonly searchText: string
  readonly catalogPage: number
  readonly featured: boolean
  readonly original: boolean
  readonly rows: PetRows
}

/** A pet on one of the catalog's pages: where its sheet and small picture are. */
interface CatalogEntry {
  readonly id: string
  readonly displayName: string
  readonly description: string
  readonly thumbnail: string
  readonly spritesheet: string
  readonly version: 1 | 2
}

interface GalleryIndex {
  readonly fetchedAt: number
  readonly pages: readonly string[]
  readonly entries: readonly GalleryEntry[]
}

/** The search index's entries that read; any other is left out, not the whole index. */
export function parsedGalleryEntries(value: unknown, catalogPages: number): readonly GalleryEntry[] {
  if (!isRecord(value) || !Array.isArray(value.pets)) return []
  const entries: GalleryEntry[] = []
  for (const pet of value.pets) {
    if (!isRecord(pet) || !isPetId(pet.id)) continue
    if (typeof pet.displayName !== 'string' || pet.displayName.trim().length === 0 || pet.displayName.length > 120) continue
    const page = pet.catalogPage
    if (typeof page !== 'number' || !Number.isInteger(page) || page < 0 || page >= catalogPages) continue
    if (pet.spriteVersionNumber !== undefined && pet.spriteVersionNumber !== 2) continue
    entries.push({
      id: pet.id,
      displayName: pet.displayName.trim(),
      searchText: typeof pet.searchText === 'string' ? pet.searchText.slice(0, 400) : '',
      catalogPage: page,
      featured: pet.featured === true,
      original: pet.original === true,
      rows: pet.spriteVersionNumber === 2 ? 11 : 9
    })
  }
  return entries
}

/** A catalog page's entries that read, their addresses held to OpenPets' rule. */
export function parsedCatalogEntries(value: unknown): readonly CatalogEntry[] {
  if (!isRecord(value) || !Array.isArray(value.pets)) return []
  const entries: CatalogEntry[] = []
  for (const pet of value.pets) {
    if (!isRecord(pet) || !isPetId(pet.id)) continue
    const thumbnail = catalogAddress(pet.thumbnail, 'file')
    const spritesheet = catalogAddress(pet.spritesheet, 'file')
    if (thumbnail === undefined || spritesheet === undefined) continue
    if (typeof pet.displayName !== 'string' || pet.displayName.trim().length === 0 || pet.displayName.length > 120) continue
    if (pet.spriteVersionNumber !== undefined && pet.spriteVersionNumber !== 2) continue
    entries.push({
      id: pet.id,
      displayName: pet.displayName.trim(),
      description: typeof pet.description === 'string' ? pet.description.slice(0, 500).trim() : '',
      thumbnail,
      spritesheet,
      version: pet.spriteVersionNumber === 2 ? 2 : 1
    })
  }
  return entries
}

const UNREACHABLE = 'openpets.dev could not be reached. Check your connection and try again.'
const NOT_OFFERED = 'That pet is not one Locust offers.'
const NOT_LISTED = 'openpets.dev no longer lists that pet.'

export function createPetLibrary(options: PetLibraryOptions): PetLibrary {
  const now = options.now ?? (() => Date.now())
  const log = options.log ?? (() => undefined)
  const thumbnailsRoot = join(options.cacheRoot, 'thumbnails')

  /**
   * One address, read whole, refused past `max` bytes -- counted as it
   * arrives, so a lying length cannot make it read more -- and refused when
   * the answer came from anywhere but where it was sent.
   */
  async function download(url: string, max: number): Promise<Uint8Array> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      let response: Response
      try {
        response = await options.fetch(url, { signal: controller.signal, redirect: 'error' })
      } catch {
        throw new PetError(UNREACHABLE)
      }
      if (response.redirected || (response.url !== '' && response.url !== url)) {
        throw new PetError('The gallery sent Locust somewhere else, so nothing was downloaded.')
      }
      if (!response.ok) throw new PetError(`The gallery answered ${String(response.status)}, so nothing was downloaded. Try again later.`)
      const declared = Number(response.headers.get('content-length') ?? Number.NaN)
      if (Number.isFinite(declared) && declared > max) throw new PetError('That file is larger than a pet should be, so it was not downloaded.')
      const body = response.body
      if (body === null) return new Uint8Array(await response.arrayBuffer())
      const reader = body.getReader()
      const chunks: Uint8Array[] = []
      let total = 0
      for (;;) {
        let part: Awaited<ReturnType<typeof reader.read>>
        try {
          part = await reader.read()
        } catch {
          throw new PetError(UNREACHABLE)
        }
        if (part.done) break
        total += part.value.byteLength
        if (total > max) {
          controller.abort()
          throw new PetError('That file is larger than a pet should be, so it was not downloaded.')
        }
        chunks.push(part.value)
      }
      const bytes = new Uint8Array(total)
      let at = 0
      for (const chunk of chunks) {
        bytes.set(chunk, at)
        at += chunk.byteLength
      }
      return bytes
    } finally {
      clearTimeout(timer)
    }
  }

  async function downloadJson(url: string): Promise<unknown> {
    const bytes = await download(url, CATALOG_JSON_MAX)
    try {
      return JSON.parse(new TextDecoder().decode(bytes)) as unknown
    } catch {
      throw new PetError('The gallery sent something Locust could not read. Try again later.')
    }
  }

  /**
   * A file inside `root`, read whole: a real file (not a link), no larger
   * than `max` before it is read or after, and -- its links resolved -- still
   * inside `root`. Undefined when it is not there; a refusal in words when it
   * is there and fails.
   */
  async function readInside(root: string, path: string, max: number): Promise<Uint8Array | undefined> {
    let info
    try {
      info = await lstat(path)
    } catch {
      return undefined
    }
    if (!info.isFile()) throw new PetError('A pet file is not a plain file, so it was not read.')
    if (info.size > max) throw new PetError('A pet file is larger than a pet should be, so it was not read.')
    const [real, realRoot] = await Promise.all([realpath(path), realpath(root)])
    if (!real.startsWith(realRoot + sep)) throw new PetError('A pet file is outside its folder, so it was not read.')
    const bytes = new Uint8Array(await readFile(real))
    if (bytes.byteLength > max) throw new PetError('A pet file is larger than a pet should be, so it was not read.')
    return bytes
  }

  function rootOf(source: PetSource): string | undefined {
    if (source === 'bundled') return options.bundledRoot
    if (source === 'gallery') return options.installedRoot
    return options.codexRoot
  }

  /** A root that is itself a link is not read at all (OpenPets refuses a linked Codex folder). */
  async function usableRoot(root: string): Promise<boolean> {
    try {
      const info = await lstat(root)
      return info.isDirectory() && !info.isSymbolicLink()
    } catch {
      return false
    }
  }

  /** One pet's folder: its pet.json and its sheet's size, checked. Throws a PetError saying why not. */
  async function readPet(source: PetSource, id: string): Promise<PublicPet & { readonly version: 1 | 2 }> {
    const root = rootOf(source)
    if (root === undefined || !isPetId(id) || !(await usableRoot(root))) throw new PetError('That pet is not on this computer.')
    const folder = join(root, id)
    let folderInfo
    try {
      folderInfo = await lstat(folder)
    } catch {
      throw new PetError('That pet is not on this computer.')
    }
    if (!folderInfo.isDirectory() || folderInfo.isSymbolicLink()) throw new PetError('That pet is not on this computer.')
    const metaBytes = await readInside(root, join(folder, 'pet.json'), PET_JSON_MAX)
    if (metaBytes === undefined) throw new PetError('That pet has no pet.json.')
    let parsed: unknown
    try {
      parsed = JSON.parse(new TextDecoder().decode(metaBytes)) as unknown
    } catch {
      throw new PetError('That pet’s pet.json does not read.')
    }
    const meta = parsedPetMeta(parsed, id)
    if (typeof meta === 'string') throw new PetError(meta)
    const sheetPath = join(folder, 'spritesheet.webp')
    let sheetInfo
    try {
      sheetInfo = await lstat(sheetPath)
    } catch {
      throw new PetError('That pet has no sheet.')
    }
    if (!sheetInfo.isFile() || sheetInfo.size > PET_SHEET_MAX) throw new PetError('That pet’s sheet is not a plain file of a pet’s size.')
    const head = await readHead(root, sheetPath)
    const size = webpSize(head, sheetInfo.size)
    if (size === undefined) throw new PetError('That pet’s sheet is not a WebP image.')
    const rows = petRowsFor(size, meta.version)
    if (typeof rows === 'string') throw new PetError(rows)
    return { source, id, displayName: meta.displayName, description: meta.description, rows, version: meta.version }
  }

  /** The first bytes of a sheet, for its size, by the same rules as a whole read. */
  async function readHead(root: string, path: string): Promise<Uint8Array> {
    const [real, realRoot] = await Promise.all([realpath(path), realpath(root)])
    if (!real.startsWith(realRoot + sep)) throw new PetError('A pet file is outside its folder, so it was not read.')
    const handle = await open(real, 'r')
    try {
      const head = new Uint8Array(WEBP_HEADER_BYTES)
      const { bytesRead } = await handle.read(head, 0, WEBP_HEADER_BYTES, 0)
      return head.subarray(0, bytesRead)
    } finally {
      await handle.close()
    }
  }

  async function readPets(source: PetSource, cap: number): Promise<readonly PublicPet[]> {
    const root = rootOf(source)
    if (root === undefined || !(await usableRoot(root))) return []
    let names: string[]
    try {
      names = (await readdir(root, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && isPetId(entry.name))
        .map((entry) => entry.name)
        .sort()
        .slice(0, cap)
    } catch {
      return []
    }
    const pets: PublicPet[] = []
    for (const id of names) {
      try {
        const { version: _version, ...pet } = await readPet(source, id)
        pets.push(pet)
      } catch (error) {
        log(`${source} pet ${id} left out: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return pets
  }

  /* ---- The gallery's catalog, read and kept for CATALOG_FRESH_MS. ---- */

  let index: GalleryIndex | undefined
  let indexReading: Promise<{ readonly index: GalleryIndex; readonly stale: boolean }> | undefined
  const indexFile = join(options.cacheRoot, 'gallery.json')

  async function storedIndex(): Promise<GalleryIndex | undefined> {
    try {
      const value = JSON.parse(await readFile(indexFile, 'utf8')) as unknown
      if (!isRecord(value) || typeof value.fetchedAt !== 'number' || !Array.isArray(value.pages)) return undefined
      const pages = value.pages.map((page) => catalogAddress(page, 'catalog'))
      if (pages.some((page) => page === undefined)) return undefined
      return { fetchedAt: value.fetchedAt, pages: pages as string[], entries: parsedGalleryEntries({ pets: value.entries }, pages.length) }
    } catch {
      return undefined
    }
  }

  async function freshIndex(): Promise<GalleryIndex> {
    const root = await downloadJson(CATALOG_INDEX_URL)
    if (!isRecord(root) || root.version !== 3 || !Array.isArray(root.pages)) throw new PetError('The gallery sent a catalog Locust does not know.')
    const pages = root.pages.slice(0, 200).map((page) => catalogAddress(page, 'catalog'))
    const search = catalogAddress(root.search, 'catalog')
    if (pages.length === 0 || pages.some((page) => page === undefined) || search === undefined) throw new PetError('The gallery sent a catalog Locust does not know.')
    const searchIndex = await downloadJson(search)
    if (!isRecord(searchIndex) || searchIndex.version !== 3 || !Array.isArray(searchIndex.pages)) throw new PetError('The gallery sent a catalog Locust does not know.')
    const searchPages = searchIndex.pages.slice(0, 50).map((page) => catalogAddress(page, 'catalog'))
    if (searchPages.some((page) => page === undefined)) throw new PetError('The gallery sent a catalog Locust does not know.')
    const entries: GalleryEntry[] = []
    const seen = new Set<string>()
    for (const page of searchPages as string[]) {
      for (const entry of parsedGalleryEntries(await downloadJson(page), pages.length)) {
        if (seen.has(entry.id)) continue
        seen.add(entry.id)
        entries.push(entry)
      }
    }
    const read: GalleryIndex = { fetchedAt: now(), pages: pages as string[], entries }
    try {
      await mkdir(options.cacheRoot, { recursive: true })
      await writeFile(indexFile, JSON.stringify(read))
    } catch (error) {
      log(`gallery catalog not kept: ${error instanceof Error ? error.message : String(error)}`)
    }
    return read
  }

  /** The catalog: fresh, or read again; when the gallery cannot be reached, the last one read, said to be stale. */
  async function galleryIndex(): Promise<{ readonly index: GalleryIndex; readonly stale: boolean }> {
    index ??= await storedIndex()
    if (index !== undefined && now() - index.fetchedAt < CATALOG_FRESH_MS) return { index, stale: false }
    indexReading ??= (async () => {
      try {
        index = await freshIndex()
        return { index, stale: false }
      } catch (error) {
        if (index !== undefined) {
          log(`gallery catalog not refreshed, using the last read: ${error instanceof Error ? error.message : String(error)}`)
          return { index, stale: true }
        }
        throw error
      } finally {
        indexReading = undefined
      }
    })()
    return indexReading
  }

  const pageEntries = new Map<number, { readonly fetchedAt: number; readonly entries: readonly CatalogEntry[] }>()

  /** The catalog page a pet is on, read once per CATALOG_FRESH_MS. */
  async function catalogEntry(id: string): Promise<CatalogEntry> {
    const { index: known } = await galleryIndex()
    const listed = known.entries.find((entry) => entry.id === id)
    if (listed === undefined) throw new PetError(NOT_LISTED)
    const address = known.pages[listed.catalogPage]
    if (address === undefined) throw new PetError(NOT_LISTED)
    let page = pageEntries.get(listed.catalogPage)
    if (page === undefined || now() - page.fetchedAt >= CATALOG_FRESH_MS) {
      page = { fetchedAt: now(), entries: parsedCatalogEntries(await downloadJson(address)) }
      pageEntries.set(listed.catalogPage, page)
    }
    const entry = page.entries.find((candidate) => candidate.id === id)
    if (entry === undefined) throw new PetError(NOT_LISTED)
    return entry
  }

  async function isAdded(id: string): Promise<boolean> {
    try {
      await readPet('gallery', id)
      return true
    } catch {
      return false
    }
  }

  const thumbnailsReading = new Map<string, Promise<string>>()
  const adding = new Map<string, Promise<PublicPet>>()

  async function pruneThumbnails(): Promise<void> {
    const names = await readdir(thumbnailsRoot)
    if (names.length <= THUMBNAILS_KEPT) return
    const aged = await Promise.all(names.map(async (name) => ({ name, at: (await stat(join(thumbnailsRoot, name))).mtimeMs })))
    aged.sort((a, b) => a.at - b.at)
    for (const old of aged.slice(0, aged.length - THUMBNAILS_KEPT)) await rm(join(thumbnailsRoot, old.name), { force: true })
  }

  return {
    async list() {
      const bundled = await readPets('bundled', 10)
      const added = await readPets('gallery', 1000)
      const codex = await readPets('codex', CODEX_PETS_MAX)
      return [...bundled, ...added, ...codex]
    },

    async sheet(ref) {
      const pet = await readPet(ref.source, ref.id)
      const root = rootOf(ref.source)!
      const bytes = await readInside(root, join(root, ref.id, 'spritesheet.webp'), PET_SHEET_MAX)
      if (bytes === undefined) throw new PetError('That pet has no sheet.')
      // The whole file, checked again: it is what is drawn.
      const size = webpSize(bytes, bytes.byteLength)
      if (size === undefined || typeof petRowsFor(size, pet.version) === 'string') throw new PetError('That pet’s sheet changed and no longer reads.')
      return { bytes, rows: pet.rows }
    },

    async thumbnail(id) {
      // Only the pets Locust offers (shared/pet-picks.ts, 0.564): the rest of the catalog is not shown.
      if (!isPetId(id) || !isPetPick(id)) throw new PetError(NOT_OFFERED)
      const running = thumbnailsReading.get(id)
      if (running !== undefined) return running
      const reading = (async () => {
        const kept = join(thumbnailsRoot, `${id}.webp`)
        try {
          const bytes = await readFile(kept)
          const at = new Date()
          await utimes(kept, at, at).catch(() => undefined)
          return `data:image/webp;base64,${bytes.toString('base64')}`
        } catch {
          // Not kept yet: read it from the gallery.
        }
        const entry = await catalogEntry(id)
        const bytes = await download(entry.thumbnail, PET_THUMBNAIL_MAX)
        if (webpSize(bytes) === undefined) throw new PetError('The gallery sent a picture Locust could not read.')
        try {
          await mkdir(thumbnailsRoot, { recursive: true })
          await writeFile(kept, bytes)
          await pruneThumbnails()
        } catch (error) {
          log(`gallery picture not kept: ${error instanceof Error ? error.message : String(error)}`)
        }
        return `data:image/webp;base64,${Buffer.from(bytes).toString('base64')}`
      })()
      thumbnailsReading.set(id, reading)
      try {
        return await reading
      } finally {
        thumbnailsReading.delete(id)
      }
    },

    async add(id) {
      if (!isPetId(id) || !isPetPick(id)) throw new PetError(NOT_OFFERED)
      const running = adding.get(id)
      if (running !== undefined) return running
      const work = (async (): Promise<PublicPet> => {
        // Added before: nothing to download.
        try {
          const { version: _version, ...pet } = await readPet('gallery', id)
          return pet
        } catch {
          // Not here yet.
        }
        const entry = await catalogEntry(id)
        const bytes = await download(entry.spritesheet, PET_SHEET_MAX)
        const size = webpSize(bytes, bytes.byteLength)
        if (size === undefined) throw new PetError(`${entry.displayName}’s sheet is not a WebP image, so it was not added.`)
        const rows = petRowsFor(size, entry.version)
        if (typeof rows === 'string') throw new PetError(`${entry.displayName} was not added. ${rows}`)
        const meta = {
          id,
          displayName: entry.displayName,
          description: entry.description,
          spritesheetPath: 'spritesheet.webp',
          ...(entry.version === 2 ? { spriteVersionNumber: 2 } : {}),
          // Where it came from, for the person and for whoever reads this folder next.
          addedFrom: 'https://openpets.dev',
          addedAt: new Date(now()).toISOString()
        }
        // Written beside, then moved into place: a pet is never half there.
        await mkdir(options.installedRoot, { recursive: true })
        const incoming = join(options.installedRoot, `.incoming-${id}-${randomBytes(4).toString('hex')}`)
        await mkdir(incoming)
        try {
          await writeFile(join(incoming, 'spritesheet.webp'), bytes)
          await writeFile(join(incoming, 'pet.json'), `${JSON.stringify(meta, null, 2)}\n`)
          await rename(incoming, join(options.installedRoot, id))
        } catch (error) {
          await rm(incoming, { recursive: true, force: true })
          // Added meanwhile (another window, another click): that one stands.
          if (await isAdded(id)) {
            const { version: _version, ...pet } = await readPet('gallery', id)
            return pet
          }
          throw error instanceof PetError ? error : new PetError(`${entry.displayName} could not be saved on this computer.`)
        }
        log(`added gallery pet ${id} (${String(rows)} rows)`)
        return { source: 'gallery', id, displayName: entry.displayName, description: entry.description, rows }
      })()
      adding.set(id, work)
      try {
        return await work
      } finally {
        adding.delete(id)
      }
    },

    async remove(id) {
      if (!isPetId(id)) throw new PetError('That pet is not on this computer.')
      const folder = join(options.installedRoot, id)
      let info
      try {
        info = await lstat(folder)
      } catch {
        return
      }
      if (!info.isDirectory() || info.isSymbolicLink()) throw new PetError('That pet is not on this computer.')
      await rm(folder, { recursive: true, force: true })
      log(`removed gallery pet ${id}`)
    }
  }
}
