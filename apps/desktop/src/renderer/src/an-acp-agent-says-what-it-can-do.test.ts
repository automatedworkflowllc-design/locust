// W12 (0.566): Settings > AI agents says, in plain words, what an ACP agent
// told Locust it can do -- as the agent's own answer, with when.
import { expect, it } from 'vitest'

import { agentCapabilityHeading, agentCapabilityLines } from './agentCapabilities.js'

const told = { continuesSessions: true, images: false, audio: false, embeddedContext: true, mcpOverHttp: true, mcpOverSse: false, toldAt: '2026-10-01T09:00:00.000Z' }

it('says each thing as a plain yes or no', () => {
  expect(agentCapabilityLines(told)).toEqual([
    'Can continue an earlier session: yes',
    'Takes pictures in a message: no',
    'Takes sound in a message: no',
    'Takes a file’s contents in a message: yes',
    'Connects to connectors over the web (HTTP): yes',
    'Connects to connectors over SSE: no'
  ])
})

it('says it is the agent’s own word, and when it said it', () => {
  expect(agentCapabilityHeading('GitHub Copilot', told, new Date('2026-10-01T18:00:00.000Z'))).toBe('What GitHub Copilot said it can do (today):')
  expect(agentCapabilityHeading('GitHub Copilot', told, new Date('2026-10-02T10:00:00.000Z'))).toBe('What GitHub Copilot said it can do (yesterday):')
  expect(agentCapabilityHeading('GitHub Copilot', told, new Date('2026-10-04T10:00:00.000Z'))).toBe('What GitHub Copilot said it can do (3 days ago):')
})
