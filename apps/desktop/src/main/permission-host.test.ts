import { existsSync, readFileSync } from 'node:fs'
import { request } from 'node:http'
import { dirname } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { MissionApprovalRequest } from '../shared/ipc.js'
import { bridgeConfig, connectorSummary, createPermissionHost, serverPrefixOf } from './permission-host.js'
import type { BridgeAnswer, PermissionHost } from './permission-host.js'

/**
 * Locust answers Claude Code's permission questions, and only Locust's own
 * runs can ask.
 *
 * These go over a real loopback socket rather than calling the handler,
 * because the thing that can go wrong is the wire: a field misnamed in the
 * config, a token that is not checked before the body is read, a request
 * that never resolves when the run ends. Each of those is a connector call
 * silently refused, which is exactly how 0.60.1 failed.
 */

const hosts: PermissionHost[] = []
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.dispose()))
})

function post(port: number, body: unknown): Promise<BridgeAnswer> {
  return new Promise((resolve, reject) => {
    const text = JSON.stringify(body)
    const req = request(
      { host: '127.0.0.1', port, path: '/approve', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) } },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as BridgeAnswer))
      }
    )
    req.on('error', reject)
    req.end(text)
  })
}

async function hostWithCards(): Promise<{ host: PermissionHost; cards: MissionApprovalRequest[] }> {
  const cards: MissionApprovalRequest[] = []
  let n = 0
  const host = createPermissionHost({
    bridgePath: 'C:/locust/resources/locust-permission-bridge.mjs',
    node: 'node',
    emitApproval: (card) => cards.push(card),
    createId: () => `id_${String(++n)}`
  })
  hosts.push(host)
  await host.start()
  return { host, cards }
}

/** The token a registered run was given, read back out of its own config. */
function tokenOf(configPath: string): string {
  const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as { mcpServers: { locust: { env: { LOCUST_PERMISSION_TOKEN: string } } } }
  return parsed.mcpServers.locust.env.LOCUST_PERMISSION_TOKEN
}

describe('the permission host', () => {
  it('refuses a request that carries no token of ours, before reading anything else', async () => {
    const { host, cards } = await hostWithCards()
    const answer = await post(host.port, { token: 'not-ours', toolName: 'mcp__claude_ai_Robinhood__place_equity_order' })
    expect(answer.behavior).toBe('deny')
    // And no card was raised: a stranger cannot make the window ask.
    expect(cards).toEqual([])
  })

  it('turns a question into the card the app already has, and answers with the decision', async () => {
    const { host, cards } = await hostWithCards()
    const { configPath, toolName } = await host.register({ runId: 'run1', missionId: 'm1', cwd: 'C:/work' })
    expect(toolName).toBe('mcp__locust__approve')
    const token = tokenOf(configPath)

    const asked = post(host.port, { token, toolName: 'mcp__claude_ai_Robinhood__get_watchlists', input: { limit: 5 } })
    await new Promise((r) => setTimeout(r, 30))
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({ runId: 'run1', missionId: 'm1', kind: 'connector', summary: 'Use get_watchlists on Robinhood', cwd: 'C:/work' })
    expect(cards[0]!.detail).toContain('"limit": 5')

    expect(host.decide({ approvalId: cards[0]!.approvalId, decision: 'approve-once' })).toBe(true)
    const answer = await asked
    expect(answer).toEqual({ behavior: 'allow', updatedInput: { limit: 5 } })
  })

  it('carries a denial to the model with a sentence, not a bare refusal', async () => {
    const { host, cards } = await hostWithCards()
    const { configPath } = await host.register({ runId: 'run1', missionId: 'm1', cwd: null })
    const asked = post(host.port, { token: tokenOf(configPath), toolName: 'mcp__claude_ai_Gmail__send_message' })
    await new Promise((r) => setTimeout(r, 30))
    host.decide({ approvalId: cards[0]!.approvalId, decision: 'deny' })
    const answer = await asked
    expect(answer.behavior).toBe('deny')
    expect(answer.behavior === 'deny' && answer.message.length > 0).toBe(true)
  })

  it('carries the person’s reason for a denial, when they gave one (0.374)', async () => {
    const { host, cards } = await hostWithCards()
    const { configPath } = await host.register({ runId: 'run1', missionId: 'm1', cwd: null })
    const asked = post(host.port, { token: tokenOf(configPath), toolName: 'mcp__claude_ai_Gmail__send_message' })
    await new Promise((r) => setTimeout(r, 30))
    host.decide({ approvalId: cards[0]!.approvalId, decision: 'deny', reason: 'draft it instead of sending' })
    const answer = await asked
    expect(answer).toEqual({ behavior: 'deny', message: 'Denied in Locust. The person declined this, and said: draft it instead of sending' })
  })

  // QA-2026-09-29 round 2, R35: Always is the TOOL, not the connector. It was
  // the connector, and "list_issues" let "delete_file" through with no card.
  it('remembers "always" for that tool on that run, and still asks about another tool, even on the same connector', async () => {
    const { host, cards } = await hostWithCards()
    const { configPath } = await host.register({ runId: 'run1', missionId: 'm1', cwd: null })
    const token = tokenOf(configPath)

    const first = post(host.port, { token, toolName: 'mcp__claude_ai_Robinhood__get_watchlists' })
    await new Promise((r) => setTimeout(r, 30))
    expect(cards[0]!.alwaysCovers).toBe('get_watchlists on Robinhood again, and no other tool')
    host.decide({ approvalId: cards[0]!.approvalId, decision: 'approve-always' })
    expect((await first).behavior).toBe('allow')

    // The same tool again: answered without a card.
    const again = await post(host.port, { token, toolName: 'mcp__claude_ai_Robinhood__get_watchlists' })
    expect(again.behavior).toBe('allow')
    expect(cards).toHaveLength(1)

    // Same connector, a different tool: asks.
    const other = post(host.port, { token, toolName: 'mcp__claude_ai_Robinhood__get_accounts' })
    await new Promise((r) => setTimeout(r, 30))
    expect(cards).toHaveLength(2)
    host.decide({ approvalId: cards[1]!.approvalId, decision: 'deny' })
    expect((await other).behavior).toBe('deny')

    // A different connector still asks. Robinhood is not Gmail.
    const third = post(host.port, { token, toolName: 'mcp__claude_ai_Gmail__list_labels' })
    await new Promise((r) => setTimeout(r, 30))
    expect(cards).toHaveLength(3)
    host.decide({ approvalId: cards[2]!.approvalId, decision: 'deny' })
    expect((await third).behavior).toBe('deny')
  })

  it('does not let one run answer for another', async () => {
    const { host, cards } = await hostWithCards()
    const a = await host.register({ runId: 'runA', missionId: 'mA', cwd: null })
    const b = await host.register({ runId: 'runB', missionId: 'mB', cwd: null })
    const askedA = post(host.port, { token: tokenOf(a.configPath), toolName: 'mcp__claude_ai_Robinhood__get_watchlists' })
    await new Promise((r) => setTimeout(r, 30))
    host.decide({ approvalId: cards[0]!.approvalId, decision: 'approve-always' })
    await askedA
    // B asks the same connector: its own run never said always.
    const askedB = post(host.port, { token: tokenOf(b.configPath), toolName: 'mcp__claude_ai_Robinhood__get_watchlists' })
    await new Promise((r) => setTimeout(r, 30))
    expect(cards).toHaveLength(2)
    host.decide({ approvalId: cards[1]!.approvalId, decision: 'deny' })
    expect((await askedB).behavior).toBe('deny')
  })

  it('refuses whatever is still waiting when the run ends, and removes its config', async () => {
    const { host, cards } = await hostWithCards()
    const { configPath } = await host.register({ runId: 'run1', missionId: 'm1', cwd: null })
    const token = tokenOf(configPath)
    expect(existsSync(configPath)).toBe(true)
    const asked = post(host.port, { token, toolName: 'mcp__claude_ai_Robinhood__get_watchlists' })
    await new Promise((r) => setTimeout(r, 30))
    expect(cards).toHaveLength(1)
    await host.release('run1')
    const answer = await asked
    expect(answer.behavior).toBe('deny')
    expect(existsSync(dirname(configPath))).toBe(false)
    // The token died with the run.
    const after = await post(host.port, { token, toolName: 'mcp__claude_ai_Robinhood__get_watchlists' })
    expect(after.behavior).toBe('deny')
    expect(host.decide({ approvalId: cards[0]!.approvalId, decision: 'approve-once' })).toBe(false)
  })

  it("refuses a question's answer aimed at a permission, and says so", async () => {
    const { host, cards } = await hostWithCards()
    const { configPath } = await host.register({ runId: 'run1', missionId: 'm1', cwd: null })
    const asked = post(host.port, { token: tokenOf(configPath), toolName: 'mcp__x__y' })
    await new Promise((r) => setTimeout(r, 30))
    host.decide({ approvalId: cards[0]!.approvalId, answers: { q1: ['yes'] } })
    const answer = await asked
    expect(answer.behavior).toBe('deny')
    expect(answer.behavior === 'deny' && answer.message).toContain('belongs to a question')
  })
})

describe('what the CLI is handed', () => {
  it('is an mcp.json that names the bridge, the loopback URL and the token, under the name the tool flag expects', () => {
    const text = bridgeConfig({ bridgePath: 'C:/r/bridge.mjs', url: 'http://127.0.0.1:4321/approve', token: 'tok' , node: 'node' })
    const parsed = JSON.parse(text) as { mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }> }
    // `mcp__locust__approve` is `mcp__<server>__<tool>`: the server MUST be
    // called `locust` or the flag names a tool that does not exist.
    expect(Object.keys(parsed.mcpServers)).toEqual(['locust'])
    expect(parsed.mcpServers.locust).toEqual({
      command: 'node',
      args: ['C:/r/bridge.mjs'],
      env: { ELECTRON_RUN_AS_NODE: '1', LOCUST_PERMISSION_URL: 'http://127.0.0.1:4321/approve', LOCUST_PERMISSION_TOKEN: 'tok' }
    })
  })

  it('names a connector the way the activity rows do', () => {
    expect(connectorSummary('mcp__claude_ai_Robinhood__get_watchlists')).toBe('Use get_watchlists on Robinhood')
    expect(connectorSummary('mcp__linear__create_issue')).toBe('Use create_issue on linear')
    expect(serverPrefixOf('mcp__claude_ai_Robinhood__get_watchlists')).toBe('mcp__claude_ai_Robinhood__')
    expect(serverPrefixOf('Bash')).toBe('Bash')
  })
})

/*
 * A B4 lead from the code review, settled: two Claude runs registering at
 * once both found no server and each started one; the first listener stayed
 * open on loopback, and dispose closed only the second.
 */
describe('two runs registering at once', () => {
  it('share one listener, and both are answered on it', async () => {
    let n = 0
    const host = createPermissionHost({
      bridgePath: 'C:/locust/resources/locust-permission-bridge.mjs',
      node: 'node',
      emitApproval: () => undefined,
      createId: () => `id_${String(++n)}`
    })
    hosts.push(host)
    const [a, b] = await Promise.all([
      host.register({ runId: 'run_a', missionId: 'm_a', cwd: null }),
      host.register({ runId: 'run_b', missionId: 'm_b', cwd: null })
    ])
    const urlOf = (configPath: string) =>
      (JSON.parse(readFileSync(configPath, 'utf8')) as { mcpServers: { locust: { env: { LOCUST_PERMISSION_URL: string } } } }).mcpServers.locust.env.LOCUST_PERMISSION_URL
    expect(urlOf(a.configPath)).toBe(urlOf(b.configPath))
    // And nothing is left listening once it is closed.
    const listening = () => process.getActiveResourcesInfo().filter((kind) => kind === 'TCPServerWrap').length
    await host.dispose()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(listening()).toBe(0)
  })
})
