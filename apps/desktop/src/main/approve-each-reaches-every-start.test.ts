import { describe, expect, it } from 'vitest'

import { MAX_LIVE_MISSIONS } from './codex-mission.js'
import { MAX_LIVE_ANTIGRAVITY_MISSIONS } from './antigravity-mission.js'

/**
 * Per-action approvals reach every way of starting a mission.
 *
 * THE OLD SHAPE, and why this file changed rather than being deleted. The
 * cards existed on one transport -- `codex app-server` -- reached by one
 * caller, the composer's own start, which branched into a second mission
 * service built for that mode alone. Three other start paths (a routine, a
 * room post, a relay) went through `codex exec`, where the mode map read
 *
 *     auto -> full-access, accept-edits -> workspace-write, ELSE read-only
 *
 * so `approve-each` fell through to read-only: no cards, no writes, and
 * nothing anywhere saying either, while the chip still claimed approvals.
 * Wren found it by reading the source on 2026-09-08. The fix then was three
 * refusals, and this file pinned them -- with a note saying that if the mode
 * map ever named approve-each explicitly, "the refusals below become the
 * wrong fix and should be revisited rather than left in place."
 *
 * That is what happened. Since 0.65.0 every Codex mode runs on app-server
 * through the one mission loop, so approve-each reaches that loop from every
 * caller and the approval channel is attached to all of them. The mode map
 * names it. The refusals are gone, and a routine, a room post and a relay run
 * it for real.
 *
 * So the invariant is inverted, and pinned here in its new form: the mode
 * must be NAMED rather than falling through, and nothing may refuse it on the
 * grounds that it cannot be shown.
 */

const SOURCE = new URL('./', import.meta.url)
const read = async (file: string): Promise<string> =>
  (await import('node:fs')).readFileSync(new URL(file, SOURCE), 'utf8')

describe('approve-each is a mode the mission loop runs, not one it falls through', () => {
  it('the mode map names it, so it can never land on read-only again', async () => {
    const codex = await read('codex-mission.ts')
    // Named explicitly, beside accept-edits: approvals only mean something
    // when the run could otherwise act.
    expect(codex).toContain("mode === 'accept-edits' || mode === 'approve-each'")
    // And the old fall-through, the exact string this file used to require,
    // is gone.
    expect(codex).not.toContain("mode === 'auto' ? 'full-access' : mode === 'accept-edits' ? 'workspace-write' : 'read-only'")
  })

  it('the policy asks the server to stop, which is what makes a card appear', async () => {
    const commands = await read('../../../../packages/runtime-adapters/src/commands.ts')
    // `untrusted` is the protocol's "ask before each consequential action".
    // Without it the run would stream past every action and the channel would
    // never be called.
    expect(commands).toContain('approvalPolicy: "untrusted"')
    expect(commands).toContain('mode === "approve-each"')
  })

  it('no start path refuses it any more', async () => {
    // The three refusals that existed only because those callers could not
    // reach the transport. Each is now a path that runs the mode.
    const runner = await read('routine-runner.ts')
    expect(runner).not.toContain("routine.route.mode === 'approve-each'")
    const main = await read('index.ts')
    expect([...main.matchAll(/route\.mode === 'approve-each'|input\.mode === 'approve-each'/g)]).toHaveLength(0)
    // And the code they answered with is retired, so a new refusal cannot
    // quietly reuse it.
    const ipc = await read('../shared/ipc.ts')
    expect(ipc).not.toContain('RUN_MODE_UNSUPPORTED')
  })

  it('a run that stops to ask is answered by the channel, and released when it ends', async () => {
    const codex = await read('codex-mission.ts')
    // The handler is attached for this mode and no other: every other mode
    // runs under `never`, where nothing asks.
    expect(codex).toContain("mode === 'approve-each' && options.approvals !== undefined")
    // And whatever it was still asking is refused when the run is cleared,
    // so no card is left waiting on a run that has gone.
    expect(codex).toContain('options.approvals?.release(candidate.runId)')
  })

  it('one host answers a card, whichever asked for it', async () => {
    const main = await read('index.ts')
    // The mission service's channel, then Claude Code's permission host. An
    // id is minted by exactly one of them, so the first to claim it wins and
    // the other is asked only if it does not.
    expect(main).toContain('codexMissions.decide(decided) || permissionHost.decide(decided)')
  })
})

/**
 * And the cap is one pool.
 *
 * Also Wren's, and worse than reported: they found two counters of four, and
 * there were three. Each service counted only its own live runs while every
 * READ in the app -- `teammateBusy`, the sidebar count, the busy list -- had
 * always summed them into one number, and both refusal messages said "up to
 * 4". Twelve missions could be live under a product wall of four.
 *
 * Two transports now, not three: the approval service is gone. The property
 * that matters is unchanged -- each counts the other before admitting a start.
 */
describe('the live-mission cap is one pool across the transports', () => {
  it('both transports carry the same bound', () => {
    expect(MAX_LIVE_ANTIGRAVITY_MISSIONS).toBe(MAX_LIVE_MISSIONS)
  })

  it('each one counts the other before admitting a start', async () => {
    for (const file of ['codex-mission.ts', 'antigravity-mission.ts']) {
      const source = await read(file)
      expect(source, file).toContain('liveElsewhere')
      // The count must be IN the comparison, not merely declared next to it.
      expect(source, file).toMatch(/\+ \(options\.liveElsewhere \?\? \(\(\) => 0\)\)\(\) >= MAX_LIVE/)
    }
  })

  it('the host wires each service to the other', async () => {
    const main = await read('index.ts')
    expect([...main.matchAll(/liveElsewhere: \(\) =>/g)]).toHaveLength(2)
  })
})

/**
 * 0.377: Copilot asks too, over the Agent Client Protocol. The run's own
 * rules are tested against a scripted agent in runtime-adapters
 * (acp-run.test.ts); what is pinned here is that the mission hands it the
 * rules at all.
 */
describe('Copilot runs Approve-each over ACP, held to the mode that asks', () => {
  it('rides ACP in Approve-each only, with Agent mode and allow-all off', async () => {
    const codex = await read('codex-mission.ts')
    expect(codex).toContain("const copilotAcp = runtime === 'copilot' && mode === 'approve-each' && options.acpSpawn !== undefined")
    expect(codex).toContain('modeId: COPILOT_ACP_SESSION.modeId')
    expect(codex).toContain('requiredConfig: COPILOT_ACP_SESSION.requiredConfig')
  })

  it('what it asks is the card every runtime uses, named as Copilot, and a reason reaches it as its next prompt', async () => {
    const codex = await read('codex-mission.ts')
    expect(codex).toContain("requestHandlerFor({ runId, missionId, cwd: runCwd, changesByItem, runtime: 'copilot' })")
    expect(codex).toContain('acpAnswerFor(await handler(acpPermissionRequest(asked, runCwd)))')
    expect(codex).toContain('steer = acp.steer')
  })

  it('the host starts the agent IN its folder, and admits the mode for Copilot', async () => {
    const main = await read('index.ts')
    expect(main).toContain('acpSpawn: (executablePath, args, env, cwd) => spawnAppServer(executablePath, args, env, cwd)')
    // And OpenCode's server too (0.378): it was started with no folder, so
    // it stood in the app's own -- the install directory, in real use.
    expect(main).toContain('opencodeServeSpawn: (executablePath, args, env, cwd) => spawnAppServer(executablePath, args, env, cwd)')
    expect(main).toContain("runtime !== 'codex' && runtime !== 'opencode' && runtime !== 'copilot'")
  })
})
