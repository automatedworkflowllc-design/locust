import { describe, expect, it } from 'vitest'

import { TEAMMATE_ROLES } from './teammate-store.js'
import { composeRuntimePrompt, roleBrief } from './workroom-briefing.js'
import type { MissionPeerContext } from './workroom-briefing.js'

/**
 * A role is a brief, not a label.
 *
 * Until 2026-09-17 the roster line said "Wren (Code & Migrations)" and nothing
 * told Wren what that asked of it. Grok Build gives every subagent profile its
 * own prompt and the orchestrator a rule for briefing the others; Colin
 * (2026-09-17): "the routing 'chief of staff' and other roles you mentioned
 * are interesting."
 */

const peer = (kind: MissionPeerContext['self']['kind'], role = String(kind)): MissionPeerContext => ({
  self: { teammateId: 'tm_w', name: 'Wren', role, ...(kind === undefined ? {} : { kind }) },
  others: [{ teammateId: 'tm_b', name: 'Booty', role: 'Research & Briefs', kind: 'Research & Briefs' }]
})

const compose = (context: MissionPeerContext): string =>
  composeRuntimePrompt({ prompt: 'Look at the repo.', peer: context, inbound: [], remaining: 0 }).prompt

describe('what a role means to the teammate that has it', () => {
  it('every preset but Custom has a brief, and Custom has none because the title is the brief', () => {
    for (const role of TEAMMATE_ROLES) {
      if (role === 'Custom') expect(roleBrief(role)).toBeUndefined()
      else expect(roleBrief(role), role).toMatch(/^Your role is /)
    }
  })

  it('the chief of staff is told to route, to say what was delegated, and to report back in one message', () => {
    const said = roleBrief('Chief of Staff') ?? ''
    expect(said).toContain('brief that teammate through the share block')
    expect(said).toContain('what is needed and why, what you already know, the end state and what done looks like')
    expect(said).toContain('Tell the person what you delegated and to whom')
    expect(said).toContain('one message that stands on its own')
    // And when to do it themselves, so the role is not a rule against working.
    expect(said).toContain('Do the work yourself only when')
  })

  it('goes into the prompt ahead of the roster line it refers to, in the stable prefix', () => {
    const prompt = compose(peer('Chief of Staff'))
    const role = prompt.indexOf('Your role is to run the team')
    const roster = prompt.indexOf('Teammates in this workspace besides you')
    const ask = prompt.indexOf('Look at the repo.')
    expect(role).toBeGreaterThan(-1)
    expect(roster).toBeGreaterThan(role)
    expect(ask).toBeGreaterThan(roster)
  })

  it('says nothing about a role for a Custom teammate, or one whose preset is unknown to the brief', () => {
    expect(compose(peer('Custom', 'release manager'))).not.toContain('Your role is')
    expect(compose(peer(undefined, 'Code & Migrations'))).not.toContain('Your role is')
  })
})
