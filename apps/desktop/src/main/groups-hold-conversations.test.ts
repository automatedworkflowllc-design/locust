import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import {
  createGroupStore,
  GROUPS_UNREADABLE,
  MAX_GROUPS,
  MAX_GROUP_INSTRUCTIONS_LENGTH,
  MAX_GROUP_NAME_LENGTH
} from './group-store.js'

/**
 * Groups: named sets of conversations, per folder.
 *
 * Colin ruled the model on 2026-09-15 — *"just grouped and ungrouped, and
 * ungrouped will have most recent as first"* — and then took the design
 * agent's stronger version of it: a group carries standing instructions and
 * a default route, so filing something into one buys something back. A
 * folder that only sorts is a tax people stop paying in week two.
 */

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const store = async () => {
  const root = await mkdtemp(join(tmpdir(), 'locust-groups-'))
  roots.push(root)
  let next = 0
  return { store: createGroupStore({ rootDirectory: root, createId: () => `grp_${String((next += 1))}` }), root }
}

describe('making and naming a group', () => {
  it('keeps what it was called', async () => {
    const { store: groups } = await store()
    await groups.create('Investments')
    expect((await groups.list()).groups.map((group) => group.name)).toEqual(['Investments'])
  })

  it('refuses a name that is only spaces', async () => {
    const { store: groups } = await store()
    await expect(groups.create('   ')).rejects.toThrow()
  })

  it('flattens a name to one line, because a row is one line', async () => {
    const { store: groups } = await store()
    await groups.create('Trading\n\nideas')
    expect((await groups.list()).groups[0]?.name).toBe('Trading ideas')
  })

  it('caps the length rather than letting a name become a paragraph', async () => {
    const { store: groups } = await store()
    await groups.create('x'.repeat(MAX_GROUP_NAME_LENGTH + 100))
    expect((await groups.list()).groups[0]?.name.length).toBe(MAX_GROUP_NAME_LENGTH)
  })

  it('renames one', async () => {
    const { store: groups } = await store()
    const made = await groups.create('Old')
    await groups.rename(made.groupId, 'New')
    expect((await groups.list()).groups[0]?.name).toBe('New')
  })

  it('says so when renaming one that is not there', async () => {
    const { store: groups } = await store()
    await expect(groups.rename('grp_nope', 'x')).rejects.toThrow()
  })

  it('will not make more than it can list', async () => {
    const { store: groups } = await store()
    for (let index = 0; index < MAX_GROUPS; index += 1) await groups.create(`g${String(index)}`)
    await expect(groups.create('one too many')).rejects.toThrow()
  }, 60_000)
})

describe('putting a conversation in one', () => {
  it('remembers where it went', async () => {
    const { store: groups } = await store()
    const made = await groups.create('Investments')
    await groups.assign('m_1', made.groupId)
    expect((await groups.list()).members.m_1?.groupId).toBe(made.groupId)
  })

  it('takes it out again with no group', async () => {
    const { store: groups } = await store()
    const made = await groups.create('Investments')
    await groups.assign('m_1', made.groupId)
    await groups.assign('m_1', undefined)
    expect((await groups.list()).members.m_1).toBeUndefined()
  })

  it('moves it rather than putting it in two places', async () => {
    const { store: groups } = await store()
    const one = await groups.create('One')
    const two = await groups.create('Two')
    await groups.assign('m_1', one.groupId)
    await groups.assign('m_1', two.groupId)
    const listed = await groups.list()
    expect(listed.members.m_1?.groupId).toBe(two.groupId)
    expect(Object.keys(listed.members)).toHaveLength(1)
  })

  it('refuses a group that does not exist', async () => {
    const { store: groups } = await store()
    await expect(groups.assign('m_1', 'grp_nope')).rejects.toThrow()
  })

  it('refuses an id that could not be one', async () => {
    const { store: groups } = await store()
    await expect(groups.assign('../escape', undefined)).rejects.toThrow()
  })
})

describe('removing a group keeps the conversations', () => {
  it('lets them fall back to ungrouped rather than deleting them', async () => {
    /*
     * Removing a container must never remove its contents. Someone tidying
     * their sidebar is not asking to destroy their work, and there is
     * exactly one place in this app where records are destroyed — and it
     * asks twice first.
     */
    const { store: groups } = await store()
    const made = await groups.create('Temporary')
    await groups.assign('m_1', made.groupId)
    await groups.remove(made.groupId)
    const listed = await groups.list()
    expect(listed.groups).toEqual([])
    expect(listed.members.m_1).toBeUndefined()
  })

  it('removing one that is not there is not an error', async () => {
    const { store: groups } = await store()
    await expect(groups.remove('grp_nope')).resolves.toBeUndefined()
  })
})

describe('the file is read as untrusted', () => {
  it('drops a membership pointing at a group that is gone', async () => {
    // What makes removal safe: nothing has to sweep the file, and no reader
    // ever sees a dangling id.
    const { store: groups, root } = await store()
    await writeFile(
      join(root, 'groups.json'),
      JSON.stringify({ schemaVersion: 1, groups: [], members: { m_1: 'grp_vanished' } }),
      'utf8'
    )
    expect((await groups.list()).members.m_1).toBeUndefined()
  })

  it('drops a group with no usable name and keeps the rest', async () => {
    const { store: groups, root } = await store()
    await writeFile(
      join(root, 'groups.json'),
      JSON.stringify({
        schemaVersion: 1,
        groups: [
          { groupId: 'grp_a', name: '' },
          { groupId: 'grp_b', name: 'Fine' }
        ],
        members: {}
      }),
      'utf8'
    )
    expect((await groups.list()).groups.map((group) => group.groupId)).toEqual(['grp_b'])
  })

  it('treats a file it cannot read as unreadable, never as empty', async () => {
    /*
     * The ruling this store inherits. Grok, 2026-09-14: with `rooms.json`
     * replaced by a directory, a rename read zero rooms and answered "That
     * room does not exist" — under a window that was showing the room. It
     * was never read, not gone.
     */
    const { store: groups, root } = await store()
    await mkdir(join(root, 'groups.json'))
    await expect(groups.list()).rejects.toThrow(GROUPS_UNREADABLE)
  })

  it('treats a file that does not parse as unreadable too, and refuses to write over it', async () => {
    /*
     * Astra, 2026-09-16, on 0.154.0, with the file cut off mid-array: the
     * store read it as no groups and the sidebar drew none. Her ask was the
     * important half -- "do not let subsequent saves silently replace
     * unreadable state" -- and every write here reads first, so the one
     * `return EMPTY` on a parse failure was the whole distance between a
     * torn file and a torn file replaced by an empty one.
     */
    const { store: groups, root } = await store()
    const torn = '{"schemaVersion":1,"groups":['
    await writeFile(join(root, 'groups.json'), torn, 'utf8')
    await expect(groups.list()).rejects.toThrow(GROUPS_UNREADABLE)
    await expect(groups.create('Trading')).rejects.toThrow(GROUPS_UNREADABLE)
    await expect(groups.assign('mission_1', undefined)).rejects.toThrow(GROUPS_UNREADABLE)
    expect(readFileSync(join(root, 'groups.json'), 'utf8')).toBe(torn)
  })

  it('is genuinely empty when there is simply no file yet', async () => {
    const { store: groups } = await store()
    expect(await groups.list()).toEqual({ groups: [], members: {}, left: {} })
  })
})

describe('what a group is, beyond a folder', () => {
  it('takes a default route, refuses one a mission could not start on, and clears it', async () => {
    // A group is not only a folder: filing a conversation into one buys a
    // route as well as a brief. The composer's pending selection seeds from
    // it on join, rewriting nothing (design ruling, 2026-09-15).
    const { store: groups } = await store()
    const made = await groups.create('Trading')
    const route = { runtime: 'opencode', model: 'opencode/muse-spark-1.3-contributor-free', mode: 'ask', effort: 'low' }
    await groups.setRoute(made.groupId, route)
    expect((await groups.list()).groups[0]?.route).toEqual(route)
    await expect(groups.setRoute(made.groupId, { runtime: 'opencode', model: '', mode: 'ask' })).rejects.toThrow('not one a mission can start on')
    await expect(groups.setRoute('grp_missing', route)).rejects.toThrow('does not exist')
    expect((await groups.list()).groups[0]?.route).toEqual(route)
    await groups.setRoute(made.groupId, undefined)
    expect((await groups.list()).groups[0]?.route).toBeUndefined()
  })

  it('carries standing instructions from the start', async () => {
    // Read and written before anything sets them, because they are part of
    // what a group IS -- a store that learned about them later would mean
    // migrating a file people already had.
    const { store: groups } = await store()
    const made = await groups.create('Trading')
    expect(made.instructions).toBe('')
  })

  it('keeps instructions and a route that are already in the file', async () => {
    const { store: groups, root } = await store()
    await writeFile(
      join(root, 'groups.json'),
      JSON.stringify({
        schemaVersion: 1,
        groups: [
          {
            groupId: 'grp_a',
            name: 'Trading',
            createdAt: '2026-09-15T00:00:00.000Z',
            instructions: 'Analysis only. Never place an order.',
            route: { runtime: 'claude', model: 'sonnet', mode: 'read-only' }
          }
        ],
        members: {}
      }),
      'utf8'
    )
    const held = (await groups.list()).groups[0]
    expect(held?.instructions).toContain('Never place an order')
    expect(held?.route?.runtime).toBe('claude')
  })
})

describe('groups are read back when the app opens', () => {
  /*
   * THE LESSON FROM THE RENAME BUG, applied before it could happen again.
   *
   * `missionTitles` shipped in 0.141.0 saving perfectly and never being read
   * at startup, so a name lasted exactly until the window reloaded. The
   * drive that passed had asked the host whether the value came back -- it
   * did -- and never restarted the app, which is the only place a
   * load-that-never-runs shows.
   *
   * So groups were driven through a reload before shipping, and this holds
   * the structural half: the startup read has to ask for them.
   */
  const APP = readFileSync(fileURLToPath(new URL('../renderer/src/App.tsx', import.meta.url)), 'utf8')

  it('asks for groups in the load that runs at startup', () => {
    // The same effect that lists teammates and routines on mount.
    const mount = APP.slice(APP.indexOf('.listTeammates()'), APP.indexOf('.listRoutines()'))
    expect(mount).toContain('.listGroups()')
  })

  it('applies both halves of the answer, not just the names', () => {
    // A group list with no membership is a set of empty folders.
    expect(APP).toContain('setGroups(response.data.groups)')
    expect(APP).toContain('setGroupMembers(response.data.members)')
  })
})

describe('moving a conversation is one row, not one row per group', () => {
  /*
   * Colin's reference, 2026-09-15, is Claude's own menu: one **Move to
   * group** row opening a list with a tick on the one it is already in,
   * `Ungrouped` to take it out, and `New group...` at the bottom.
   *
   * It was a flat `Move to <name>` per group -- the shape the menu already
   * used for `Assign to <teammate>` -- which does not survive many groups:
   * five of them buried Open, Rename and Delete under five near-identical
   * lines.
   *
   * Driven: the menu reads Open / Rename / Move to group > / Copy mission id
   * / Save as routine / Delete, the submenu reads `Ungrouped checked` and
   * `New group...`, and choosing the latter made "Investments 1" with the
   * conversation already in it.
   */
  const APP = readFileSync(fileURLToPath(new URL('../renderer/src/App.tsx', import.meta.url)), 'utf8')

  it('offers the row even when no group exists yet', () => {
    // `New group...` lives inside it, so the empty case is the one that
    // needs it most. Suppressing the row until a group existed left the `+`
    // beside the logo as the only way in -- the Rooms discoverability
    // problem with a different noun.
    expect(APP).not.toContain('groupsRef.current.length === 0 && groupMembersRef.current')
    expect(APP).toContain("label: 'Move to group'")
  })

  it('ticks the one it is already in, so the list also answers where it is', () => {
    /*
     * Read through `groupOfConversation`, which asks under EVERY id the
     * conversation has worn -- not only its root. A membership saved while
     * the row was keyed by a live turn is otherwise never found again, which
     * is how a conversation "left the group" on its own (2026-09-16).
     */
    expect(APP).toContain('checked: groupOfConversation(missionId)?.groupId === group.groupId')
  })

  it('offers Ungrouped as a destination rather than a separate verb', () => {
    const submenu = APP.slice(APP.indexOf("label: 'Move to group'"))
    expect(submenu.slice(0, 2400)).toContain("label: 'Ungrouped'")
  })

  it('makes the group AND puts the conversation in it', () => {
    // Creating a group from a conversation's own menu and not moving that
    // conversation into it would be an item doing half of what it says.
    expect(APP).toContain('setNewGroupFor(conversationKeyOf(missionId))')
    expect(APP).toContain('assignGroup(waiting, mine.groupId)')
  })

  it('picks the newest match when two groups share a name', () => {
    // The store answers with `{}` rather than the group, so the one just
    // made is found by name -- and names are not unique.
    expect(APP).toContain('Date.parse(right.createdAt) - Date.parse(left.createdAt)')
  })
})

describe('standing instructions on a group', () => {
  it('keeps what was written', async () => {
    const { store: groups } = await store()
    const made = await groups.create('Trading')
    await groups.setInstructions(made.groupId, 'Analysis only. Never place an order.')
    expect((await groups.list()).groups[0]?.instructions).toContain('Never place an order')
  })

  it('clears with empty text, so a group can stop briefing', async () => {
    // As easy to stop as to start: a group with no instructions is an
    // ordinary folder again, which is a real thing to want.
    const { store: groups } = await store()
    const made = await groups.create('Trading')
    await groups.setInstructions(made.groupId, 'something')
    await groups.setInstructions(made.groupId, '   ')
    expect((await groups.list()).groups[0]?.instructions).toBe('')
  })

  it('caps the length', async () => {
    const { store: groups } = await store()
    const made = await groups.create('Trading')
    await groups.setInstructions(made.groupId, 'x'.repeat(9_000))
    expect((await groups.list()).groups[0]?.instructions.length).toBe(MAX_GROUP_INSTRUCTIONS_LENGTH)
  })

  it('refuses a group that does not exist, rather than writing nowhere', async () => {
    const { store: groups } = await store()
    await expect(groups.setInstructions('grp_nope', 'x')).rejects.toThrow()
  })
})

describe('when a conversation joined', () => {
  /*
   * Recorded because instructions brief from joining ONWARD and never
   * retroactively. The thread has to mark that boundary -- the turns above
   * it genuinely were not briefed, and a line at the top of a thread would
   * claim they were.
   */
  it('is kept with the membership', async () => {
    const { store: groups } = await store()
    const made = await groups.create('Trading')
    await groups.assign('m_1', made.groupId)
    const held = (await groups.list()).members.m_1
    expect(held?.groupId).toBe(made.groupId)
    expect(Date.parse(held?.at ?? '')).not.toBeNaN()
  })

  it('is updated when a conversation moves to another group', async () => {
    // Moving is joining somewhere else, so the boundary moves with it.
    const { store: groups } = await store()
    const one = await groups.create('One')
    const two = await groups.create('Two')
    await groups.assign('m_1', one.groupId)
    const first = (await groups.list()).members.m_1?.at
    await new Promise((resolve) => setTimeout(resolve, 5))
    await groups.assign('m_1', two.groupId)
    const second = (await groups.list()).members.m_1?.at
    expect(second).not.toBe(first)
  })

  it('reads an older file that recorded no moment', async () => {
    /*
     * The shape before 0.152.0 was a bare `missionId: groupId` string. It
     * still means "this conversation is in that group"; it just cannot say
     * since when, so the thread will not draw a boundary for it rather than
     * inventing one.
     */
    const { store: groups, root } = await store()
    await writeFile(
      join(root, 'groups.json'),
      JSON.stringify({
        schemaVersion: 1,
        groups: [{ groupId: 'grp_a', name: 'Trading', createdAt: '2026-09-15T00:00:00.000Z' }],
        members: { m_1: 'grp_a' }
      }),
      'utf8'
    )
    const held = (await groups.list()).members.m_1
    expect(held?.groupId).toBe('grp_a')
    expect(held?.at).toBeUndefined()
  })
})
