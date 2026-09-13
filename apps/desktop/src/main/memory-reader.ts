import type { MissionLedger } from '@teammate/mission-store'

import type { CodexMissionUpdate, PublicTeammate, WorkspaceSettings } from '../shared/ipc.js'
import { parseMemoryBlocks } from '../shared/memory.js'
import type { MemoryStore } from './memory-store.js'
import { createTranscriptTracker } from './peer-exchange.js'

/**
 * When a run ends, read its reply for a memory block and move the team's
 * memory: remember what it said to remember, forget what it said to forget.
 *
 * Only a COMPLETED run's reply counts -- a run that failed or was stopped
 * ended mid-thought, and a memory from it would be a guess about what it
 * meant to say. What it did is said twice: once in the thread that wrote
 * it (a notice line, the way Claude Code prints "Saved 2 memories"), and
 * once to the window as a whole so the Memory screen and the sidebar
 * re-read the file.
 */
export interface MemoryReaderOptions {
  readonly memories: Pick<MemoryStore, 'add' | 'forget'>
  readonly ledger: Pick<MissionLedger, 'getMission'>
  readonly teammates: {
    list(): Promise<readonly PublicTeammate[]>
    missionOwners(): Promise<Readonly<Record<string, string>>>
    readSettings(): Promise<WorkspaceSettings>
  }
  /** The folder's name, as the Memory screen shows it. */
  readonly workspaceName: string
  readonly notify: (update: CodexMissionUpdate) => void
}

export interface MemoryReader {
  onRunEnded(mission: { readonly missionId: string }): Promise<void>
}

const quoted = (texts: readonly string[]): string => texts.map((text) => `"${text}"`).join('; ')

export function createMemoryReader(options: MemoryReaderOptions): MemoryReader {
  return {
    async onRunEnded(mission) {
      let mode: WorkspaceSettings['memoryMode']
      try {
        mode = (await options.teammates.readSettings()).memoryMode
      } catch {
        return
      }
      if (mode === 'off') return

      let recovered
      try {
        recovered = await options.ledger.getMission(mission.missionId)
      } catch {
        return
      }
      if (recovered === undefined || recovered.phase !== 'completed') return
      const tracker = createTranscriptTracker()
      tracker.track(recovered.events)
      const text = tracker.latestFinal
      if (text === undefined) return
      const ops = parseMemoryBlocks(text)
      if (ops.length === 0) return

      let by: { readonly teammateId?: string; readonly name: string } = { name: 'a conversation' }
      try {
        const owners = await options.teammates.missionOwners()
        const teammateId = owners[mission.missionId]
        if (teammateId !== undefined) {
          const actor = (await options.teammates.list()).find((entry) => entry.teammateId === teammateId)
          by = actor === undefined ? { teammateId, name: 'a teammate' } : { teammateId, name: actor.name }
        }
      } catch {
        // Attribution that cannot be read is said as such, not invented.
      }

      const kept: string[] = []
      const proposed: string[] = []
      const forgotten: string[] = []
      for (const op of ops) {
        try {
          if (op.kind === 'forget') {
            const removed = await options.memories.forget(op.text, recovered.metadata.workspaceId)
            if (removed > 0) forgotten.push(op.text)
            continue
          }
          const result = await options.memories.add({
            text: op.text,
            scope: op.scope,
            workspaceId: recovered.metadata.workspaceId,
            workspaceName: options.workspaceName,
            by,
            missionId: mission.missionId,
            status: mode === 'ask' ? 'proposed' : 'kept'
          })
          if (!result.created) continue
          ;(result.memory.status === 'proposed' ? proposed : kept).push(result.memory.text)
        } catch {
          // A memory the store refuses (full, malformed) is dropped; the
          // reply itself is untouched and the person can still read it.
        }
      }
      if (kept.length === 0 && proposed.length === 0 && forgotten.length === 0) return

      /*
       * Only what the memory card cannot say.
       *
       * Colin, 2026-09-13, with a screenshot of one memory announced twice:
       * an amber line quoting it in full, and directly under it the card --
       * "Yurt remembered 1 thing" -- holding the same sentence. Two notices,
       * one fact, from these two adjacent `notify` calls.
       *
       * The card is the better surface and the one that was designed for
       * this: it folds, it counts, and it names the action for a proposal.
       * So KEPT and PROPOSED are the card's alone now. FORGOTTEN stays here,
       * because the card is read from the memories that exist and a memory
       * that was forgotten is exactly the one it cannot draw.
       */
      options.notify({ kind: 'memory-changed', by: by.name, kept, proposed, forgotten })
      if (forgotten.length > 0) {
        options.notify({
          kind: 'relay-notice',
          runId: recovered.metadata.runId,
          missionId: mission.missionId,
          message: `${by.name} forgot ${quoted(forgotten)}.`
        })
      }
    }
  }
}
