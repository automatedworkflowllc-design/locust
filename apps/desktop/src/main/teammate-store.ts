import { randomUUID } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

import { isAvatarSpec, seedAvatar } from '../shared/avatar.js'
import type { PublicTeammate, TeammateHue, TeammateRole, TeammateRoute, WorkspaceSettings } from '../shared/ipc.js'
import { isMissionRuntime } from '../shared/runtimes.js'

/**
 * Teammates are local identity plus routing defaults: a name, an avatar hue, a
 * role, and which route and approval mode their missions start on. Nothing here
 * runs anything -- the multi-agent runtime is a separate problem, and the
 * roster does not need it to be real.
 *
 * The file is treated as untrusted on read. It lives in the user's profile
 * where anything can edit it, and a malformed record must degrade to "that
 * teammate is missing" rather than to a renderer crash or, worse, a teammate
 * whose route says something the runtime layer never validated.
 */

export const MAX_TEAMMATES = 64

/**
 * How many mission-to-teammate assignments the roster will hold.
 *
 * Teammates were capped and assignments were not, and the file has a size
 * cliff: past `MAX_FILE_BYTES` it reads as EMPTY, and the next write saves
 * that empty file over the real one. A window that assigned missions in a
 * loop could therefore delete the person's whole roster.
 *
 * The number has to sit well UNDER that cliff to be worth anything. An entry
 * is roughly 65 bytes (a `mission_<uuid>` key and a teammate id), so five
 * thousand is about a third of a megabyte against a one-megabyte limit --
 * headroom enough for the teammates and settings beside it. My first attempt
 * at this was 20,000, and the test written for it proved that a full roster
 * crossed the cliff and emptied itself, which is the bug the cap exists to
 * prevent. Five thousand is still more than a dozen missions a day for a year.
 */
export const MAX_MISSION_OWNERS = 5_000
const MAX_FILE_BYTES = 1_000_000
const SCHEMA_VERSION = 1 as const

export const TEAMMATE_HUES: readonly TeammateHue[] = ['lime', 'blue', 'violet', 'clay']

export const TEAMMATE_ROLES: readonly TeammateRole[] = [
  'Code & Migrations',
  'Research & Briefs',
  'Ops & Scheduling',
  'Docs & QA',
  'Data & Reporting',
  'Custom'
]

export interface TeammateStore {
  list(): Promise<readonly PublicTeammate[]>
  create(input: { name: unknown; hue: unknown; role: unknown; roleTitle?: unknown; avatar?: unknown }): Promise<PublicTeammate>
  remove(teammateId: unknown): Promise<void>
  /** Change what a person may change; the id and the missions filed under it stay. */
  update(input: { teammateId: unknown; name: unknown; hue: unknown; role: unknown; roleTitle?: unknown; avatar: unknown }): Promise<PublicTeammate>
  /** Record the route a person just started this teammate on. Unknown teammate or bad route: nothing changes. */
  rememberRoute(teammateId: unknown, route: unknown): Promise<void>
  /** Remember which teammate a mission belongs to. */
  assignMission(teammateId: unknown, missionId: unknown): Promise<void>
  /** Forget which teammate a mission belonged to, once the mission is gone. */
  unassignMission(missionId: unknown): Promise<void>
  missionOwners(): Promise<Readonly<Record<string, string>>>
  readSettings(): Promise<WorkspaceSettings>
  writeSettings(settings: unknown): Promise<WorkspaceSettings>
}

interface StoredFile {
  readonly schemaVersion: typeof SCHEMA_VERSION
  readonly teammates: readonly PublicTeammate[]
  readonly missionOwners: Readonly<Record<string, string>>
  readonly settings: WorkspaceSettings
}

// Relay is ON unless switched off: teammates talking to each other is the
// point of having more than one, and the hop cap is what bounds the spend.
const DEFAULT_SETTINGS: WorkspaceSettings = { swarm: false, relay: true }

export function isTeammateRoute(value: unknown): value is TeammateRoute {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (
    isMissionRuntime(record.runtime)
    && typeof record.model === 'string'
    && record.model.length > 0
    && record.model.length <= 200
    // `plan` is a mode like the others, so a teammate last started in it
    // records that honestly. Refusing it here would not stop the mode -- it
    // would only make `rememberRoute` fail silently and leave a stale one on
    // the roster, which is the worse of the two.
    && (record.mode === 'ask' || record.mode === 'accept-edits' || record.mode === 'approve-each' || record.mode === 'plan')
  )
}

function isHue(value: unknown): value is TeammateHue {
  return typeof value === 'string' && (TEAMMATE_HUES as readonly string[]).includes(value)
}

function isRole(value: unknown): value is TeammateRole {
  return typeof value === 'string' && (TEAMMATE_ROLES as readonly string[]).includes(value)
}

/**
 * A name the UI can render and the file can hold. Control characters are
 * refused rather than stripped: a name is shown back to the user, and silently
 * rewriting what they typed is worse than telling them it is invalid.
 */
/**
 * A Custom role's title: the person's own words, one line, no control
 * characters, short enough to sit beside a name. It is briefed to every
 * runtime on the roster, so it is bounded like a name is.
 */
export const MAX_ROLE_TITLE_LENGTH = 60

export function validRoleTitle(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= MAX_ROLE_TITLE_LENGTH && !/[\u0000-\u001f\u007f]/.test(trimmed)
}

/** Only a Custom role keeps a title, and only a valid one. Anything else is dropped, never rejected. */
function roleTitleFor(role: TeammateRole, value: unknown): string | undefined {
  if (role !== 'Custom' || !validRoleTitle(value)) return undefined
  return value.trim()
}

export function validName(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= 40 && !/[\u0000-\u001f\u007f]/.test(trimmed)
}

export function safeId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value)
}

export function parsedTeammate(value: unknown): PublicTeammate | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  if (
    !safeId(record.teammateId) ||
    !validName(record.name) ||
    !isHue(record.hue) ||
    !isRole(record.role) ||
    typeof record.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(record.createdAt))
  ) {
    return undefined
  }
  return {
    teammateId: record.teammateId,
    name: (record.name as string).trim(),
    hue: record.hue,
    role: record.role,
    ...(roleTitleFor(record.role, record.roleTitle) === undefined ? {} : { roleTitle: roleTitleFor(record.role, record.roleTitle) }),
    // A record from before faces were persisted gets the face its id seeds --
    // the same face every reader would derive, so nothing changes on upgrade.
    avatar: isAvatarSpec(record.avatar) ? record.avatar : seedAvatar(record.teammateId),
    createdAt: record.createdAt,
    ...(isTeammateRoute(record.route) ? { route: record.route } : {})
  }
}

function parsedFile(text: string): StoredFile {
  const empty: StoredFile = {
    schemaVersion: SCHEMA_VERSION,
    teammates: [],
    missionOwners: {},
    settings: DEFAULT_SETTINGS
  }
  let value: unknown
  try {
    value = JSON.parse(text) as unknown
  } catch {
    return empty
  }
  if (typeof value !== 'object' || value === null) return empty
  const record = value as Record<string, unknown>
  if (record.schemaVersion !== SCHEMA_VERSION) return empty

  const teammates: PublicTeammate[] = []
  if (Array.isArray(record.teammates)) {
    for (const entry of record.teammates.slice(0, MAX_TEAMMATES)) {
      const teammate = parsedTeammate(entry)
      // A malformed record is dropped, not repaired. The rest of the roster
      // stays usable, which is the behaviour a user can actually recover from.
      if (teammate !== undefined && !teammates.some((held) => held.teammateId === teammate.teammateId)) {
        teammates.push(teammate)
      }
    }
  }

  const owners: Record<string, string> = {}
  if (typeof record.missionOwners === 'object' && record.missionOwners !== null) {
    for (const [missionId, teammateId] of Object.entries(record.missionOwners as Record<string, unknown>)) {
      if (Object.keys(owners).length >= MAX_MISSION_OWNERS) break
      if (!safeId(missionId) || !safeId(teammateId)) continue
      if (!teammates.some((teammate) => teammate.teammateId === teammateId)) continue
      owners[missionId] = teammateId
    }
  }

  // Settings default rather than fail: a corrupt flag must not take the
  // roster with it, and `off` is the safe reading of an unreadable switch.
  const rawSettings = record.settings
  const settings: WorkspaceSettings = {
    swarm: typeof rawSettings === 'object' && rawSettings !== null
      ? (rawSettings as Record<string, unknown>).swarm === true
      : false,
    // Only a literal false turns replies off; absent or malformed keeps the default.
    relay: typeof rawSettings === 'object' && rawSettings !== null
      ? (rawSettings as Record<string, unknown>).relay !== false
      : true
  }

  return { schemaVersion: SCHEMA_VERSION, teammates, missionOwners: owners, settings }
}

export function createTeammateStore(options: { readonly rootDirectory: string }): TeammateStore {
  const rootDirectory = options.rootDirectory
  if (!isAbsolute(rootDirectory)) throw new Error('Teammate store directory is invalid')
  const path = join(rootDirectory, 'teammates.json')

  let queue: Promise<unknown> = Promise.resolve()
  const serialize = <T>(task: () => Promise<T>): Promise<T> => {
    const next = queue.then(task, task)
    queue = next.then(
      () => undefined,
      () => undefined
    )
    return next
  }

  const read = async (): Promise<StoredFile> => {
    try {
      const text = await readFile(path, 'utf8')
      if (Buffer.byteLength(text, 'utf8') > MAX_FILE_BYTES) {
        return { schemaVersion: SCHEMA_VERSION, teammates: [], missionOwners: {}, settings: DEFAULT_SETTINGS }
      }
      return parsedFile(text)
    } catch {
      return { schemaVersion: SCHEMA_VERSION, teammates: [], missionOwners: {}, settings: DEFAULT_SETTINGS }
    }
  }

  const write = async (file: StoredFile): Promise<void> => {
    await mkdir(rootDirectory, { recursive: true, mode: 0o700 })
    // Write-and-rename, so a crash mid-write leaves the previous roster intact
    // rather than a truncated file that parses to an empty one.
    const temporary = `${path}.${randomUUID()}.tmp`
    const handle = await open(temporary, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, 0o600)
    try {
      await handle.writeFile(`${JSON.stringify(file, null, 2)}\n`, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    try {
      await rename(temporary, path)
    } catch (error) {
      await unlink(temporary).catch(() => undefined)
      throw error
    }
  }

  return {
    list(): Promise<readonly PublicTeammate[]> {
      return serialize(async () => (await read()).teammates)
    },

    create(input): Promise<PublicTeammate> {
      return serialize(async () => {
        if (!validName(input.name)) throw new Error('Teammate name is invalid')
        if (!isHue(input.hue)) throw new Error('Teammate hue is invalid')
        if (!isRole(input.role)) throw new Error('Teammate role is invalid')
        const file = await read()
        if (file.teammates.length >= MAX_TEAMMATES) throw new Error('Too many teammates')
        if (input.avatar !== undefined && !isAvatarSpec(input.avatar)) throw new Error('Teammate avatar is invalid')
        const teammateId = `tm_${randomUUID().replace(/-/g, '').slice(0, 24)}`
        const teammate: PublicTeammate = {
          teammateId,
          name: input.name.trim(),
          hue: input.hue,
          role: input.role,
          ...(roleTitleFor(input.role, input.roleTitle) === undefined ? {} : { roleTitle: roleTitleFor(input.role, input.roleTitle) }),
          avatar: input.avatar ?? seedAvatar(teammateId),
          createdAt: new Date().toISOString()
        }
        await write({ ...file, teammates: [...file.teammates, teammate] })
        return teammate
      })
    },

    update(input): Promise<PublicTeammate> {
      return serialize(async () => {
        if (!safeId(input.teammateId)) throw new Error('Teammate id is invalid')
        if (!validName(input.name)) throw new Error('Teammate name is invalid')
        if (!isHue(input.hue)) throw new Error('Teammate hue is invalid')
        if (!isRole(input.role)) throw new Error('Teammate role is invalid')
        if (!isAvatarSpec(input.avatar)) throw new Error('Teammate avatar is invalid')
        const file = await read()
        const existing = file.teammates.find((teammate) => teammate.teammateId === input.teammateId)
        if (existing === undefined) throw new Error('Unknown teammate')
        // Identity is the id and the creation time; everything else is theirs
        // to change. Mission ownership is keyed by id, so it follows for free.
        const updated: PublicTeammate = {
          teammateId: existing.teammateId,
          name: input.name.trim(),
          hue: input.hue,
          role: input.role,
          ...(roleTitleFor(input.role, input.roleTitle) === undefined ? {} : { roleTitle: roleTitleFor(input.role, input.roleTitle) }),
          avatar: input.avatar,
          createdAt: existing.createdAt,
          ...(existing.route === undefined ? {} : { route: existing.route })
        }
        await write({
          ...file,
          teammates: file.teammates.map((teammate) => (teammate.teammateId === updated.teammateId ? updated : teammate))
        })
        return updated
      })
    },

    rememberRoute(teammateId, route): Promise<void> {
      return serialize(async () => {
        if (!safeId(teammateId) || !isTeammateRoute(route)) return
        const file = await read()
        const existing = file.teammates.find((teammate) => teammate.teammateId === teammateId)
        if (existing === undefined) return
        const kept: TeammateRoute = { runtime: route.runtime, model: route.model, mode: route.mode }
        await write({
          ...file,
          teammates: file.teammates.map((teammate) =>
            teammate.teammateId === teammateId ? { ...teammate, route: kept } : teammate
          )
        })
      })
    },

    remove(teammateId): Promise<void> {
      return serialize(async () => {
        if (!safeId(teammateId)) throw new Error('Teammate id is invalid')
        const file = await read()
        const teammates = file.teammates.filter((teammate) => teammate.teammateId !== teammateId)
        // Mission ownership follows the teammate out; a mission whose owner is
        // gone shows as unassigned rather than pointing at nothing.
        const missionOwners = Object.fromEntries(
          Object.entries(file.missionOwners).filter(([, owner]) => owner !== teammateId)
        )
        await write({ ...file, teammates, missionOwners })
      })
    },

    assignMission(teammateId, missionId): Promise<void> {
      return serialize(async () => {
        if (!safeId(teammateId) || !safeId(missionId)) throw new Error('Mission assignment is invalid')
        const file = await read()
        if (!file.teammates.some((teammate) => teammate.teammateId === teammateId)) {
          throw new Error('Unknown teammate')
        }
        // Bounded on write as well as on read. Without this the file grows
        // until it crosses the size cliff, and crossing it empties the roster.
        if (
          file.missionOwners[missionId] === undefined
          && Object.keys(file.missionOwners).length >= MAX_MISSION_OWNERS
        ) {
          throw new Error('Too many mission assignments')
        }
        await write({
          ...file,
          missionOwners: { ...file.missionOwners, [missionId]: teammateId }
        })
      })
    },

    unassignMission(missionId): Promise<void> {
      return serialize(async () => {
        if (!safeId(missionId)) throw new Error('Mission id is invalid')
        const file = await read()
        if (!(missionId in file.missionOwners)) return
        const { [missionId]: _gone, ...missionOwners } = file.missionOwners
        await write({ ...file, missionOwners })
      })
    },

    missionOwners(): Promise<Readonly<Record<string, string>>> {
      return serialize(async () => (await read()).missionOwners)
    },

    readSettings(): Promise<WorkspaceSettings> {
      return serialize(async () => (await read()).settings)
    },

    writeSettings(settings: unknown): Promise<WorkspaceSettings> {
      return serialize(async () => {
        // Only a literal true turns it on. Anything else -- absent, a string,
        // a truthy object -- is off, so a malformed message cannot enable a
        // workspace-wide setting.
        const next: WorkspaceSettings = {
          swarm: typeof settings === 'object' && settings !== null
            ? (settings as Record<string, unknown>).swarm === true
            : false,
          relay: typeof settings === 'object' && settings !== null
            ? (settings as Record<string, unknown>).relay !== false
            : true
        }
        const file = await read()
        await write({ ...file, settings: next })
        return next
      })
    }
  }
}
