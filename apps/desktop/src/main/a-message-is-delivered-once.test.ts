import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFileWorkroom } from '@teammate/mission-store'
import { afterEach, describe, expect, it } from 'vitest'

import type { CodexMissionUpdate } from '../shared/ipc.js'
import { createPeerExchange } from './peer-exchange.js'
import type { MissionPeerContext } from './workroom-briefing.js'

/*
 * A MESSAGE IS DELIVERED ONCE (A2.2).
 *
 * Each delivery to a teammate can start a run. The same words, from the same
 * run, to the same teammate are one message -- whether a model wrote the
 * block twice or the reply is read again -- recorded, shown and relayed once.
 */

const WREN = { teammateId: 'tm_wren', name: 'Wren', role: 'Code & Migrations' }
const ATLAS = { teammateId: 'tm_atlas', name: 'Atlas', role: 'Research & Briefs' }
const PEER: MissionPeerContext = { self: WREN, others: [ATLAS] }
const BLOCK = '<locust-share to="Atlas">The build runs through pnpm check.</locust-share>'

let root: string | undefined
afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function exchange() {
  root = await mkdtemp(join(tmpdir(), 'locust-delivered-once-'))
  const workroom = createFileWorkroom({ rootDirectory: root })
  const links: unknown[] = []
  const ledger = { appendPeerLinks: async (_missionId: string, appended: readonly unknown[]) => void links.push(...appended) }
  const reports: CodexMissionUpdate[] = []
  const peers = createPeerExchange({ workroom, ledger: ledger as never })
  const share = (text: string) => peers.share({ runId: 'run_1', missionId: 'mission_1', peer: PEER, text }, (update) => void reports.push(update))
  return { workroom, links, reports, share }
}

describe('a message is delivered once', () => {
  it('the same block twice in one reply: one message, one record, one report, one relay', async () => {
    const { workroom, links, reports, share } = await exchange()
    const posted = await share(`Done.\n${BLOCK}\n${BLOCK}`)
    expect(posted).toHaveLength(1)
    expect((await workroom.read()).messages).toHaveLength(1)
    expect(links).toHaveLength(1)
    expect(reports.filter((update) => update.kind === 'peer-message')).toHaveLength(1)
  })

  it('the same reply read again delivers nothing new', async () => {
    const { workroom, share } = await exchange()
    await share(`Done.\n${BLOCK}`)
    await share(`Done.\n${BLOCK}`)
    expect((await workroom.read()).messages).toHaveLength(1)
  })
})
