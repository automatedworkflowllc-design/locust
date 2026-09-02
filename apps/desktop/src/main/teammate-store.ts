import { randomUUID } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

import { isAvatarSpec, seedAvatar } from '../shared/avatar.js'
import type { PublicTeammate, TeammateHue, TeammateRole, WorkspaceSettings } from '../shared/ipc.js'

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
  create(input: { name: unknown; hue: unknown; role: unknown; avatar?: unknown }): Promise<PublicTeammate>
  remove(teammateId: unknown): Promise<void>
  /** Remember which teammate a mission belongs to. */
  assignMission(teammateId: unknown, missionId: unknown): Promise<void>
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

const DEFAULT_SETTINGS: WorkspaceSettings = { swarm: false }

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
export function validName(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= 40 && !/[\u0000-\u001f\u007f]/.test(trimmed)
}

function safeId(value: unknown): value is string {
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
    // A record from before faces were persisted gets the face its id seeds --
    // the same face every reader would derive, so nothing changes on upgrade.
    avatar: isAvatarSpec(record.avatar) ? record.avatar : seedAvatar(record.teammateId),
    createdAt: record.createdAt
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
      : false
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
          avatar: input.avatar ?? seedAvatar(teammateId),
          createdAt: new Date().toISOString()
        }
        await write({ ...file, teammates: [...file.teammates, teammate] })
        return teammate
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
        await write({
          ...file,
          missionOwners: { ...file.missionOwners, [missionId]: teammateId }
        })
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
            : false
        }
        const file = await read()
        await write({ ...file, settings: next })
        return next
      })
    }
  }
}
