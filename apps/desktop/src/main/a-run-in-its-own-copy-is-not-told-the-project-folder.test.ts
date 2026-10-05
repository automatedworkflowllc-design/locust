import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { createPeerExchange } from './peer-exchange.js'
import type { ConversationHint, MemoryBriefing } from './peer-exchange.js'
import { folderSentences, worktreeSection } from './workspace-brief.js'
import type { WorkspaceBrief } from './workspace-brief.js'

/**
 * A RUN IN ITS OWN COPY IS NOT TOLD THE PROJECT FOLDER (0.638).
 *
 * The arena round of 2026-10-05: in a comparison that edits a folder with no
 * git, each column works in a plain copy of the project (compare-copies.ts).
 * Claude Code and Codex wrote the game at the copy's root; both OpenCode
 * columns wrote it to `<copy>/arena-rpg/index.html`. They had been told "You
 * are working in the folder arena-rpg" -- the project folder's name -- from
 * inside a copy that does not contain a folder by that name, and made one.
 * A run that stands apart from the project is now told it has its own copy,
 * as a teammate's worktree run always was.
 */
const brief: WorkspaceBrief = { text: '# Project\nKeep answers short.', lines: 2, truncated: false }

describe('where a run is told it stands', () => {
  it('names the project folder to a run that stands in it', () => {
    expect(folderSentences(undefined, false, 'arena-rpg').join('\n')).toContain('You are working in the folder "arena-rpg"')
    expect(folderSentences(brief, false, 'arena-rpg').join('\n')).toContain('Instructions for the folder "arena-rpg"')
  })

  it('tells a run in its own copy that it has one, and never the folder\'s name', () => {
    const plain = folderSentences(undefined, true, 'arena-rpg').join('\n')
    expect(plain).toBe(worktreeSection())
    expect(plain).not.toContain('arena-rpg')
    const withBrief = folderSentences(brief, true, 'arena-rpg').join('\n')
    expect(withBrief).not.toContain('"arena-rpg"')
    expect(withBrief).toContain('Keep answers short.')
  })

  it("hands the run's own folder to the brief, for a teammate's run and for nobody's", async () => {
    const seen: (ConversationHint | undefined)[] = []
    const memory: MemoryBriefing = {
      async section(_peer, conversation) {
        seen.push(conversation)
        return undefined
      }
    }
    type Options = Parameters<typeof createPeerExchange>[0]
    const exchange = createPeerExchange({ workroom: {} as Options['workroom'], ledger: {} as Options['ledger'], memory })
    await exchange.briefSolo('Make the game.', 'opencode', { folder: 'C:/work/arena-rpg', ownFolder: 'C:/Users/me/.locust/compare/cmp_1-b' })
    expect(seen[0]?.ownFolder).toBe('C:/Users/me/.locust/compare/cmp_1-b')
    // The mission service passes a slot's folder as `ownFolder` on both paths.
    const service = readFileSync(fileURLToPath(new URL('./codex-mission.ts', import.meta.url)), 'utf8')
    expect(service.match(/\.\.\.\(slot\?\.cwd === undefined \? \{\} : \{ ownFolder: slot\.cwd \}\)/g)).toHaveLength(2)
    // And the brief reads it as standing apart (index.ts).
    const host = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8')
    expect(host).toMatch(/const standsApart = peer\?\.cwd !== undefined \|\| conversation\?\.ownFolder !== undefined/)
    expect(host).toMatch(/sections\.push\(\.\.\.folderSentences\(brief, standsApart, here\.name\)\)/)
  })
})
