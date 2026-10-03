// W8 (0.567): a connector check that hit the 20 s limit is said, not hidden;
// how long a check took and when each connector last worked are kept; and the
// allow rules keep using the last reading that answered.
import { expect, it } from 'vitest'

import { createConnectorReader } from './connector-reader.js'
import type { ConnectorRead } from './connector-reader.js'

const OUTPUT = ['alpha: https://alpha.example/mcp - ✔ Connected', 'beta: https://beta.example/mcp - ! Needs authentication'].join('\n')

it('keeps how long the check took and when each was last seen connected', async () => {
  let clock = 1_000_000
  const reader = createConnectorReader({
    read: async () => {
      clock += 1_500
      return OUTPUT
    },
    now: () => clock
  })
  await reader.refresh()
  const [alpha, beta] = reader.current()
  expect(alpha).toMatchObject({ name: 'alpha', status: 'connected', checkedInMs: 1_500, lastConnectedAt: new Date(1_001_500).toISOString() })
  expect(beta).toMatchObject({ name: 'beta', status: 'needs-auth', checkedInMs: 1_500 })
  expect(beta).not.toHaveProperty('lastConnectedAt')
})

it('a check that timed out says so for every connector, and the rules keep the last good reading', async () => {
  let clock = 1_000_000
  let answer: ConnectorRead = OUTPUT
  const reader = createConnectorReader({ read: async () => answer, now: () => clock, ttlMs: 10 })
  await reader.refresh()
  clock += 60_000
  answer = 'timed-out'
  await reader.refresh()
  expect(reader.current().map((entry) => `${entry.name}:${entry.status}`)).toEqual(['alpha:timed-out', 'beta:timed-out'])
  // When it last worked survives the timeout: it is the person's best clue.
  expect(reader.current()[0]?.lastConnectedAt).toBe(new Date(1_000_000).toISOString())
  expect(reader.names()).toEqual(['alpha'])
  // The next answer that comes back puts the real states back.
  clock += 60_000
  answer = OUTPUT
  await reader.refresh()
  expect(reader.current().map((entry) => entry.status)).toEqual(['connected', 'needs-auth'])
})
