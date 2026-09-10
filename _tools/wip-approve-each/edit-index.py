import io, os, sys
root = sys.argv[1]
p = os.path.join(root, 'apps/desktop/src/main/index.ts')
s = io.open(p, encoding='utf-8').read()

def rep(a, b, count=1):
    global s
    assert a in s, a[:90]
    assert s.count(a) == count, ('count', s.count(a), a[:90])
    s = s.replace(a, b)

# Imports.
rep("import { createAppServerMissionService, PeerRecordError } from './app-server-mission.js'\n",
    "import { createApprovalChannel } from './approval-channel.js'\nimport { PeerRecordError } from './peer-exchange.js'\n")
rep("import type { AppServerMissionService } from './app-server-mission.js'\n", "")
rep("let appServerServiceForShutdown: AppServerMissionService | undefined\n", "")

# The cap: two transports now.
rep("      liveElsewhere: () => appServerMissions.liveMissionIds().length + antigravityMissions.liveMissionIds().length,",
    "      liveElsewhere: () => antigravityMissions.liveMissionIds().length,")
rep("      liveElsewhere: () => codexMissions.liveMissionIds().length + appServerMissions.liveMissionIds().length,",
    "      liveElsewhere: () => codexMissions.liveMissionIds().length,")

# The approval channel is created where the old service was, and handed to
# the one mission service. Order in this scope: `raiseApproval` and
# `approvalWindow` exist above `codexMissions`; the channel is a value, so it
# is declared before the service that takes it -- which means moving it ABOVE
# `createCodexMissionService`. Done in two steps: remove the old block, then
# insert the channel before the service.
start = s.index("    const appServerMissions = createAppServerMissionService({")
end = s.index("      memory: memoryBriefing\n    })\n", start) + len("      memory: memoryBriefing\n    })\n")
block = s[start:end]
assert 'emitApproval: raiseApproval' in block and block.count('createAppServerMissionService') == 1
s = s[:start] + s[end:]

rep("""    const codexMissions = createCodexMissionService({
      workspacePath,
      permissionHost,""",
    """    /*
     * What answers a run that stops to ask. Approve-each used to have a whole
     * second mission service for this; since every Codex mode runs on
     * app-server through the one loop, the channel is all that mode still
     * needs of its own.
     */
    const approvals = createApprovalChannel({
      emitApproval: raiseApproval,
      emitUpdate: (update) => {
        const target = approvalWindow
        if (target && !target.isDestroyed() && !target.webContents.isDestroyed()) {
          target.webContents.send(CODEX_MISSION_UPDATE_CHANNEL, update)
        }
      }
    })

    const codexMissions = createCodexMissionService({
      workspacePath,
      permissionHost,
      approvals,""")

# Deciding.
rep("""      // Whichever service is holding this id. A Codex approval lives in the
      // app-server service; a Claude Code connector permission lives in the
      // permission host. An id is minted by exactly one of them.
      const decided = { approvalId: payload.approvalId, decision: normalized } as const
      return { ok: appServerMissions.decide(decided) || permissionHost.decide(decided) } as const""",
    """      // Whichever host is holding this id. A Codex approval lives in the
      // mission service's approval channel; a Claude Code connector permission
      // lives in the permission host. An id is minted by exactly one of them.
      const decided = { approvalId: payload.approvalId, decision: normalized } as const
      return { ok: codexMissions.decide(decided) || permissionHost.decide(decided) } as const""")
rep("    appServerServiceForShutdown = appServerMissions\n", "")

# The unions.
rep("[...codexMissions.liveMissionIds(), ...appServerMissions.liveMissionIds(), ...antigravityMissions.liveMissionIds()]",
    "[...codexMissions.liveMissionIds(), ...antigravityMissions.liveMissionIds()]", count=3)
rep("codexMissions.liveMissionIds().length + appServerMissions.liveMissionIds().length + antigravityMissions.liveMissionIds().length,",
    "codexMissions.liveMissionIds().length + antigravityMissions.liveMissionIds().length,")
rep("(id) => codexMissions.hasMission(id) || appServerMissions.hasMission(id) || antigravityMissions.hasMission(id)",
    "(id) => codexMissions.hasMission(id) || antigravityMissions.hasMission(id)")

# The start: approve-each is an ordinary mode now.
rep("""      // `approve-each` is the only mode that needs a runtime able to stop and
      // ask, so it is the only one routed to the experimental transport --
      // which is Codex's app-server. Another runtime asked for it would have
      // been started on Codex without a word; it is refused instead.
      if (runtime === 'antigravity') {""",
    """      // `approve-each` needs a runtime able to stop and ask, and only Codex
      // has one. Another runtime asked for it would have been started on
      // Codex without a word; it is refused instead.
      if (runtime === 'antigravity') {""")
start = s.index("      if (mode === 'approve-each') {\n        if (typeof prompt !== 'string' || prompt.trim().length === 0) {")
end = s.index("      const model = typeof payload.model === 'string' ? payload.model : undefined\n      const effort = typeof payload.effort === 'string' ? payload.effort : undefined\n      try {\n        const peer = await peerContextFor(payload.teammateId)", start)
branch = s[start:end]
assert 'appServerMissions.start' in branch and "resolvedRouteId: 'codex-app-server:default'" in branch
s = s[:start] + s[end:]

# Cancel and handoff: one transport fewer to ask.
rep("""      const viaExec = codexMissions.cancel(runId)
      if (viaExec.ok || typeof runId !== 'string') return viaExec
      // Not an exec run: the approval transport owns its own runs, and a stop
      // control that only knew one transport reported "no longer active" at a
      // run that was very much still going.
      if (appServerMissions.cancel(runId) || antigravityMissions.cancel(runId)) {""",
    """      const viaExec = codexMissions.cancel(runId)
      if (viaExec.ok || typeof runId !== 'string') return viaExec
      // Not one of the mission service's runs: Antigravity owns its own, and a
      // stop control that only knew one transport reported "no longer active"
      // at a run that was very much still going.
      if (antigravityMissions.cancel(runId)) {""")
rep("""      // An approve-each run cannot be handed off yet, and saying "no longer
      // active" about a run that is still going would be a lie. Refused
      // without touching the run.
      if (typeof payload.runId === 'string' && appServerMissions.has(payload.runId)) {
        return {
          ok: false,
          error: {
            code: 'HANDOFF_REFUSED',
            message: 'A mission running with per-action approvals cannot be handed to another runtime yet. It is still running.'
          }
        } as const
      }
""", "")

# Shutdown.
rep("""        await missionServiceForShutdown?.dispose()
        // Releases any pending approval and takes the app-server process tree
        // with it, so nothing is left prompting for an app that has gone.
        await appServerServiceForShutdown?.dispose()
""", """        await missionServiceForShutdown?.dispose()
""")

# The two refusals that existed because approve-each could not reach exec.
rep("""        // Same silent degrade as routines and room posts: a relay goes through
        // exec, where approve-each falls through to read-only and no card is
        // ever drawn. A teammate relaying to a teammate saved on that mode ran
        // with no approvals and no mention of it.
        if (input.mode === 'approve-each') {
          return {
            ok: false,
            error: {
              code: 'RUN_MODE_UNSUPPORTED',
              message:
                'That teammate is set to "approve each action", and a relayed message cannot show per-action approvals. Nothing was started.'
            }
          } as const
        }
""", "")
rep("""      // Per-action approvals only exist on the app-server transport, which a
      // room post does not use. Without this the post ran read-only with no
      // cards while the chip said approvals.
      if (route.mode === 'approve-each') {
        return {
          ok: false,
          name: teammate.name,
          message: 'This teammate is set to "approve each action", and a room post cannot show per-action approvals. Message them directly instead.',
          retryable: false
        }
      }
""", "")

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('index edited; app-server service gone from the host')
