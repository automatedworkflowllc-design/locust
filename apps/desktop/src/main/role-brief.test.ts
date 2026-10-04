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
  it('every preset has a brief, and so does Custom', () => {
    for (const role of TEAMMATE_ROLES) {
      expect(roleBrief(role, 'release manager'), role).toMatch(/^Your role is /)
    }
  })

  it('builds a Custom brief around the title the person typed', () => {
    // Colin, 2026-09-17: "make sure we have something for if the user picks
    // a custom role." The title is theirs; the shape is the presets'.
    const said = roleBrief('Custom', 'release manager') ?? ''
    expect(said).toContain('Your role is release manager, in the person\'s own words')
    expect(said).toContain('say plainly when an ask falls outside it')
    // No title yet: the shared part alone, never "Your role is Custom".
    expect(roleBrief('Custom', 'Custom')).toContain('Your role is the one the person set you up for')
    expect(roleBrief('Custom')).not.toContain('Custom')
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

  it('puts the Custom title into the prompt, and says nothing when the preset is unknown', () => {
    expect(compose(peer('Custom', 'release manager'))).toContain('Your role is release manager')
    expect(compose(peer(undefined, 'Code & Migrations'))).not.toContain('Your role is')
  })
})
