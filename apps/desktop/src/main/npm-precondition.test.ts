import { describe, expect, it } from 'vitest'

import { createRuntimeDiscoveryService } from './runtime-discovery.js'
import type { RuntimeDiscovery } from '@teammate/runtime-adapters'

/**
 * npm missing is a precondition, not a failure.
 *
 * Four of the five runtimes install through npm, so a machine without Node
 * cannot use the Install button at all -- and a button that cannot work is
 * worse than the truth. The design said check it during discovery and draw no
 * buttons; the screen was BUILT for that state, with an amber line and a link
 * to nodejs.org.
 *
 * And then nothing ever computed it, so the state could not occur. Pressing
 * the button for the first time on a machine without npm on its PATH produced
 * "npm stopped with an error after 1s. Show the output below" -- from the
 * command the app had just offered to run (drive, 2026-09-06). A designed
 * state that cannot happen is the same as no design at all.
 */

const found = (id: string): RuntimeDiscovery =>
  ({ id, displayName: id, availability: 'available', readiness: 'ready', version: '1.0.0', diagnostics: [] }) as unknown as RuntimeDiscovery

const ask = async (npmPresent?: () => Promise<boolean>) => {
  const service = createRuntimeDiscoveryService({
    probe: async () => [found('opencode')],
    ...(npmPresent === undefined ? {} : { npmPresent })
  })
  const response = await service.get()
  if (!response.ok) throw new Error('discovery refused')
  return response.data
}

describe('whether npm can be run reaches the window', () => {
  it('says so when npm is not there', async () => {
    expect((await ask(async () => false)).npmPresent).toBe(false)
  })

  it('says so when it is', async () => {
    // The control. Without it, "npmPresent is false" is equally satisfied by
    // a field that is always false -- which would hide every install button
    // on every machine.
    expect((await ask(async () => true)).npmPresent).toBe(true)
  })

  it('assumes it is there when nobody asked', async () => {
    // Every existing caller and test builds this service without the probe,
    // and none of them should suddenly start reporting a machine with no npm.
    expect((await ask()).npmPresent).toBe(true)
  })
})
