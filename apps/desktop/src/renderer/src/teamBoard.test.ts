import { describe, expect, it } from 'vitest'

import type { TeammateStatusView } from './status.js'
import { boardSectionOf, teamBoard } from './teamBoard.js'

const view = (status: TeammateStatusView['status']): TeammateStatusView =>
  ({ status, activity: 'idle', label: '', tone: 'muted', pulse: false }) as TeammateStatusView
const team = ['wren', 'juno', 'sable', 'quill', 'pip'].map((teammateId) => ({ teammateId }))

describe('the team, as a board', () => {
  it('puts each teammate where what they need from you says -- most urgent first', () => {
    const board = teamBoard(
      team,
      { wren: view('working'), juno: view('approval-needed'), sable: view('idle'), quill: view('blocked'), pip: view('idle') },
      new Set(['sable'])
    )
    expect(board?.map((section) => [section.title, section.members.map((member) => member.teammateId)])).toEqual([
      ['Needs you', ['juno', 'quill']],
      ['Working', ['wren']],
      ['Just finished', ['sable']],
      ['Ready', ['pip']]
    ])
  })

  it('draws a quiet team as the plain grid: no board of empty columns', () => {
    expect(teamBoard(team, { wren: view('idle') }, new Set())).toBeUndefined()
  })

  it('leaves out a section with nobody in it', () => {
    const board = teamBoard(team, { wren: view('working') }, new Set())
    expect(board?.map((section) => section.key)).toEqual(['working', 'ready'])
  })

  it('an unseen finish outranks idle, never a live run or a wait', () => {
    expect(boardSectionOf(view('idle'), true)).toBe('finished')
    expect(boardSectionOf(view('working'), true)).toBe('working')
    expect(boardSectionOf(view('approval-needed'), true)).toBe('needs-you')
    expect(boardSectionOf(undefined, false)).toBe('ready')
  })
})
