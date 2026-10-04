import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * THE TEAM, AS A BOARD (0.380) -- the half a unit test cannot hold.
 *
 * teamBoard.ts decides who sits where (its own tests); drive-team-board
 * shows it. These pin the joins and the lessons of the five drives it took.
 */
const read = (path: string): string => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const css = read('../renderer/src/shell.css')
const screens = read('../renderer/src/components/Screens.tsx')
const app = read('../renderer/src/App.tsx')

describe('the team, as a board', () => {
  it('has a class of its own: `.lc-board` is the room task board, a flex COLUMN', () => {
    expect(screens).toContain('<div className="lc-teamboard">')
    expect(css).toContain('.lc-teamboard {')
    // One `.lc-board` rule, the room's: a second one merged with it,
    // stacked the columns and leaked into Rooms (the fifth drive).
    expect(css.match(/^\.lc-board \{/gm)).toHaveLength(1)
  })

  it('tints only where a person should look: amber waiting, green unseen', () => {
    expect(css).toContain('.lc-rostercard--needs-you {')
    expect(css).toContain('.lc-rostercard--finished {')
    expect(css).not.toContain('.lc-rostercard--working {')
  })

  it('a finish is unseen only when nobody was looking, and looking clears it', () => {
    expect(app).toContain("if (owner !== undefined && !(looking.screen === 'workroom' && looking.teammateId === owner)) {")
    expect(app).toContain("if (screen !== 'workroom' || selectedTeammateId === undefined) return")
    expect(app).toContain('finishedUnseen={finishedUnseen}')
  })

  it('a live mission is running on its card, never the record\'s "interrupted"', () => {
    expect(screens).toContain("runningMissionIds?.has(entry.missionId) === true ? missionPhaseView('running', false).tone")
    expect(app).toContain('runningMissionIds={runningMissionIds}')
  })
})
