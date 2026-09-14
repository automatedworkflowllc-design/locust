import { describe, expect, it } from 'vitest'

import { composeRuntimePrompt } from './workroom-briefing.js'
import type { MissionPeerContext } from './workroom-briefing.js'

/**
 * A teammate is told which connectors it can call, by name.
 *
 * Colin, 2026-09-14, after a local `mcp-remote` bridge finally gave the Cursor
 * CLI a Robinhood credential: "that worked, i asked it to try rh local."
 *
 * He had to tell it the name, and that is its own defect. The obvious name on
 * that machine was `robinhood-trading`, an entry that has never worked -- so a
 * teammate asked about Robinhood checked THAT one, read `needsAuth, 0 tools`,
 * and reported the connector dead. Correct about the one it checked, and
 * wrong about the machine, with a working `robinhood-local` sitting beside it.
 *
 * A person should not have to know what a server is called in a config file.
 */

const peer: MissionPeerContext = {
  self: { teammateId: 'tm_j', name: 'Jimothy', role: 'finance' },
  others: []
}

const compose = (connectors?: string): string =>
  composeRuntimePrompt({
    prompt: 'Check my positions.',
    peer,
    inbound: [],
    remaining: 0,
    ...(connectors === undefined ? {} : { connectors })
  }).prompt

describe('what a teammate knows about its connectors', () => {
  it('names them when the machine has any', () => {
    const prompt = compose('Connectors you can call on this machine, by name: robinhood-local.')
    expect(prompt).toContain('robinhood-local')
  })

  it('says nothing when there are none, rather than an empty heading', () => {
    expect(compose()).not.toContain('Connectors you can call')
  })

  it('keeps the person words last, so the ask still reads closest to the asking', () => {
    // The line is STANDING -- it describes the machine, not the turn -- so it
    // belongs in the cached prefix with memory and the block formats.
    expect(compose('Connectors you can call on this machine, by name: x.').trimEnd()).toMatch(
      /Check my positions\.$/
    )
  })
})
