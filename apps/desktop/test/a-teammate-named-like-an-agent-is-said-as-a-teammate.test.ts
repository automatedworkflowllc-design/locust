import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { composeRuntimePrompt } from '../src/main/workroom-briefing.js'
import { NewTeammateDialog } from '../src/renderer/src/components/NewTeammateDialog.js'
import { agentNamed } from '../src/shared/runtimes.js'

describe('the agent matcher', () => {
  it('matches exact name', () => {
    expect(agentNamed('Codex')).toBe('Codex')
    expect(agentNamed('Claude Code')).toBe('Claude Code')
  })

  it('matches different case', () => {
    expect(agentNamed('codex')).toBe('Codex')
    expect(agentNamed('CODEX')).toBe('Codex')
  })

  it('matches "claude code" vs "Claude Code"', () => {
    expect(agentNamed('claude code')).toBe('Claude Code')
    expect(agentNamed('Claude Code')).toBe('Claude Code')
  })

  it('returns undefined for non-matches like "Codexa" and "Cody"', () => {
    expect(agentNamed('Codexa')).toBeUndefined()
    expect(agentNamed('Cody')).toBeUndefined()
    expect(agentNamed('Casper')).toBeUndefined()
  })
})

describe('the roster line for peers', () => {
  const CASPER = { teammateId: 'tm_casper', name: 'Casper', role: 'Code & Migrations' }
  const CODEX = { teammateId: 'tm_codex', name: 'Codex', role: 'Code & Migrations' }
  const WREN = { teammateId: 'tm_wren', name: 'Wren', role: 'Code & Migrations' }

  it('lists a peer matching an agent name with words that settle it', () => {
    const prompt = composeRuntimePrompt({
      prompt: 'Check the roster.',
      peer: { self: CASPER, others: [CODEX] },
      inbound: [],
      remaining: 0
    }).prompt

    expect(prompt).toContain(
      'Teammates in this workspace besides you (Casper, Code & Migrations): Codex (Code & Migrations; a teammate here, not the Codex program).'
    )
    // The role stays; only the bare form, which read as the program, is gone.
    expect(prompt).not.toContain('Codex (Code & Migrations)')
  })

  it('leaves a non-matching peer unchanged as the control', () => {
    const prompt = composeRuntimePrompt({
      prompt: 'Check the roster.',
      peer: { self: CASPER, others: [WREN] },
      inbound: [],
      remaining: 0
    }).prompt

    expect(prompt).toContain(
      'Teammates in this workspace besides you (Casper, Code & Migrations): Wren (Code & Migrations).'
    )
  })
})

describe("the teammate editor's agent name note", () => {
  const noop = (): void => undefined
  const teammate = {
    teammateId: 'tm_test',
    name: 'Wren',
    hue: 'lime',
    role: 'Code & Migrations',
    createdAt: '2026-09-23T05:00:00.000Z',
    avatar: { headwear: 0, accessory: 0, mouth: 0 }
  } as never

  it('shows the note for "codex" and does not block saving', () => {
    const html = renderToStaticMarkup(
      React.createElement(NewTeammateDialog, {
        error: undefined,
        mode: 'accept-edits',
        initial: { ...teammate, name: 'codex' },
        onCancel: noop,
        onCreate: noop
      })
    )
    expect(html).toMatch(
      /Codex is also an AI agent('s|&#x27;s|&apos;s) name\. Your other teammates will be told this Codex is a teammate\./
    )
    expect(html).not.toMatch(/<button[^>]*class="lc-primarybutton"[^>]*disabled=""|<button[^>]*disabled=""[^>]*class="lc-primarybutton"/)
  })

  it('does not show the note for "Casper"', () => {
    const html = renderToStaticMarkup(
      React.createElement(NewTeammateDialog, {
        error: undefined,
        mode: 'accept-edits',
        initial: { ...teammate, name: 'Casper' },
        onCancel: noop,
        onCreate: noop
      })
    )
    expect(html).not.toContain("is also an AI agent's name")
  })
})
