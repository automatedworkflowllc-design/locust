import io, os, sys
root = sys.argv[1]
p = os.path.join(root, 'apps/desktop/src/main/codex-mission.ts')
s = io.open(p, encoding='utf-8').read()

def rep(a, b):
    global s
    assert a in s, a[:90]
    assert s.count(a) == 1, ('not unique', a[:90])
    s = s.replace(a, b, 1)

# Imports.
rep("""  cursorCanEnforceReadOnly,
  startCodexAppServerRun
} from '@teammate/runtime-adapters'""",
    """  cursorCanEnforceReadOnly,
  notificationOfRecord,
  startCodexAppServerRun
} from '@teammate/runtime-adapters'""")
rep("""import type {
  CodexMissionCancelResponse,
  CodexMissionStartResponse,
  CodexMissionUpdate,
  MissionHandoffResponse,
  MissionMode
} from '../shared/ipc.js'""",
    """import type {
  CodexMissionCancelResponse,
  CodexMissionStartResponse,
  CodexMissionUpdate,
  MissionApprovalAnswer,
  MissionHandoffResponse,
  MissionMode
} from '../shared/ipc.js'
import { withFileChanges } from './approval-channel.js'
import type { ApprovalChannel } from './approval-channel.js'
import { fileChangesOf, itemOf } from './approval-patch.js'
import type { FileChangeRecord } from './approval-patch.js'""")

# The service answers approvals now.
rep("""  cancel(runId: unknown): CodexMissionCancelResponse
  /**
   * Pick a stopped mission back up from its last checkpoint.""",
    """  cancel(runId: unknown): CodexMissionCancelResponse
  /**
   * The person's answer to something a run asked. False when no run of this
   * service was waiting under that id -- another host may hold it.
   */
  decide(answer: MissionApprovalAnswer): boolean
  /**
   * Pick a stopped mission back up from its last checkpoint.""")

# The option.
rep("""    release(runId: string): Promise<void>
  }
}

function error(""",
    """    release(runId: string): Promise<void>
  }
  /**
   * What answers a Codex run that stops to ask -- Approve-each's whole point.
   * Without it that mode has nobody to ask, and every request is refused.
   */
  readonly approvals?: ApprovalChannel
}

function error(""")

# Approve-each earns workspace-write, like Accept edits: approvals only mean
# something when the run could otherwise act.
rep("""      const sandbox: MissionSandbox =
        mode === 'auto' ? 'full-access' : mode === 'accept-edits' ? 'workspace-write' : 'read-only'""",
    """      // Approve-each is workspace-write: approvals only mean something when
      // the run could otherwise act, and the server stops it before each act.
      // It used to fall through to read-only here because it never reached
      // this loop at all -- it had a service of its own -- and three other
      // start paths refused it rather than run it wrong. It runs here now.
      const sandbox: MissionSandbox =
        mode === 'auto'
          ? 'full-access'
          : mode === 'accept-edits' || mode === 'approve-each'
            ? 'workspace-write'
            : 'read-only'""")

# The normalizer: on app-server, file changes are read off the same records
# and folded into the tool rows, as the old service did.
rep("""        const codexStreams = runtime === 'codex' && options.appServerSpawn !== undefined
        const normalizer = codexStreams
          ? asProcessNormalizer(createAppServerEventNormalizer({ ...normalizerContext, runtime: 'codex' }))
          : runtime === 'claude'""",
    """        const codexStreams = runtime === 'codex' && options.appServerSpawn !== undefined
        // What the run has announced it will change, by item id. Read off the
        // stream so a file-change tool row can carry its diff, and so an
        // approval card for that item can show what it is about.
        const changesByItem = new Map<string, readonly FileChangeRecord[]>()
        const appServerNormalizer = (): CodexEventNormalizer => {
          const inner = asProcessNormalizer(createAppServerEventNormalizer({ ...normalizerContext, runtime: 'codex' }))
          return {
            get runtimeThreadId() {
              return inner.runtimeThreadId
            },
            get finalized() {
              return inner.finalized
            },
            accept: (record) => {
              const notification = notificationOfRecord(record)
              const found = notification === undefined ? undefined : itemOf(notification.params)
              if (found !== undefined) {
                const changes = fileChangesOf(found.item)
                if (changes !== undefined) changesByItem.set(found.id, changes)
              }
              return withFileChanges(inner.accept(record), changesByItem, runCwd)
            },
            finish: (completion) => inner.finish(completion)
          }
        }
        const normalizer = codexStreams
          ? appServerNormalizer()
          : runtime === 'claude'""")

# `runCwd` is declared after the normalizer today; the wrapper closes over it
# lazily (accept runs after start), but the declaration must still precede use
# in source order for `const`. Move nothing: `runCwd` is a `const` declared
# further down and only READ inside `accept`, which runs after start returns.
# TypeScript accepts a closure over a later `const`; the TDZ is never hit.

# The policy carries the mode, and the approval channel answers for it.
rep("""            const policy = codexAppServerPolicy(effectiveSandbox)
            process = startCodexAppServerRun({
              spawn: options.appServerSpawn!,
              command,
              prompt: runtimePrompt,
              sandbox: policy.sandbox,
              approvalPolicy: policy.approvalPolicy,""",
    """            const policy = codexAppServerPolicy(effectiveSandbox, mode)
            // Approve-each stops to ask, and this is who answers. Any other
            // mode never asks, and the run's default refuses just in case.
            const onRequest =
              mode === 'approve-each' && options.approvals !== undefined
                ? options.approvals.requestHandlerFor({ runId, missionId, cwd: runCwd, changesByItem })
                : undefined
            process = startCodexAppServerRun({
              spawn: options.appServerSpawn!,
              command,
              prompt: runtimePrompt,
              sandbox: policy.sandbox,
              approvalPolicy: policy.approvalPolicy,
              ...(onRequest === undefined ? {} : { onRequest }),""")

# The run is over: whatever it was still asking is refused.
rep("""    void options.permissionHost?.release(candidate.runId).catch(() => undefined)
    // Whatever ended this run, anyone waiting on it is told.""",
    """    void options.permissionHost?.release(candidate.runId).catch(() => undefined)
    options.approvals?.release(candidate.runId)
    // Whatever ended this run, anyone waiting on it is told.""")

# decide().
rep("""          state: 'cancellation-requested'
        }
      }
    },

    async handOff(""",
    """          state: 'cancellation-requested'
        }
      }
    },

    decide(answer: MissionApprovalAnswer): boolean {
      return options.approvals?.decide(answer) ?? false
    },

    async handOff(""")

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('codex-mission edited')
