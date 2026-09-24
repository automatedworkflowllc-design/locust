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
      /*
       * A forget that removed NOTHING, said out loud.
       *
       * This was `if (removed > 0) forgotten.push(...)` and no else, which is
       * the worst shape a correction path can have: the teammate quoted a
       * memory it had decided was wrong, the quote missed, nothing was
       * removed, and nobody was told. The wrong memory stayed in every brief
       * afterwards, and the corrected memory the teammate wrote next landed
       * beside it, so both were briefed and neither was marked. A person
       * reading the reply saw a teammate confidently correcting itself.
       *
       * Silence about a failed write is the one thing a memory store must
       * never do, because every other surface here is built from what the
       * store HAS -- a memory that was not removed is invisible as a failure
       * and indistinguishable from a memory nobody tried to remove.
       */
      const missed: string[] = []
      /*
       * A memory that REPLACED an earlier one under the same name.
       *
       * Reported separately from a new one, because they are different
       * events: one adds a fact, the other changes a fact the person may
       * already have read and acted on. Folding a rewrite into "remembered"
       * would let a memory change under them silently, which is the same
       * failure the `missed` list above exists to prevent.
       */
      const rewritten: string[] = []
      /*
       * Memories the store REFUSED, with its reason: full (400), a line too
       * long, a file it could not read. They were dropped without a word --
       * a teammate "remembered" something and nothing was kept, and nobody
       * was told (harness review, 2026-09-24).
       */
      const refused: string[] = []
      // Changes to kept memories that wait for the person, in ask mode (0.315).
      const proposedChanges: string[] = []
      const proposedForgets: string[] = []
      for (const op of ops) {
        try {
          if (op.kind === 'forget') {
            // In ask mode a forget is proposed, not applied (0.315).
            // Who forgot it goes with it into Recently forgotten (A1.8).
            const result = await options.memories.forget(op.text, recovered.metadata.workspaceId, {
              by,
              missionId: mission.missionId,
              ask: mode === 'ask'
            })
            const waiting = result.proposed ?? []
            if (waiting.length > 0) proposedForgets.push(...waiting)
            if (result.removed.length > 0) {
              forgotten.push(...result.removed)
            } else if (waiting.length > 0) {
              // Proposed, not missed: it waits for the person.
            } else if (result.refusal === 'ambiguous') {
              missed.push(
                `"${op.text}" matches more than one memory (${quoted(result.candidates)}), so none was forgotten. Quote one of them exactly.`
              )
            } else {
              missed.push(`"${op.text}" matches nothing that is remembered, so nothing was forgotten.`)
            }
            continue
          }
          const result = await options.memories.add({
            text: op.text,
            scope: op.scope,
            workspaceId: recovered.metadata.workspaceId,
            workspaceName: options.workspaceName,
            by,
            missionId: mission.missionId,
            status: mode === 'ask' ? 'proposed' : 'kept',
            ...(op.name === undefined ? {} : { name: op.name })
          })
          // A rewrite proposed in ask mode waits for the person like a new one.
          if (result.proposedChange === true) {
            if (!proposedChanges.includes(result.memory.text)) proposedChanges.push(result.memory.text)
            continue
          }
          if (result.rewritten === true) {
            rewritten.push(result.memory.text)
            continue
          }
          if (!result.created) continue
          ;(result.memory.status === 'proposed' ? proposed : kept).push(result.memory.text)
        } catch (error) {
          // The reply itself is untouched and the person can still read it;
          // what the store said is kept, once, for the notice below.
          const reason = error instanceof Error ? error.message : 'It could not be kept.'
          if (!refused.includes(reason)) refused.push(reason)
        }
      }
      if (
        kept.length === 0 &&
        proposed.length === 0 &&
        forgotten.length === 0 &&
        missed.length === 0 &&
        rewritten.length === 0 &&
        refused.length === 0 &&
        proposedChanges.length === 0 &&
        proposedForgets.length === 0
      ) {
        return
      }

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
      options.notify({
        kind: 'memory-changed',
        by: by.name,
        kept,
        proposed,
        forgotten,
        ...(rewritten.length === 0 ? {} : { rewritten }),
        ...(proposedChanges.length === 0 ? {} : { proposedChanges }),
        ...(proposedForgets.length === 0 ? {} : { proposedForgets })
      })
      if (refused.length > 0) {
        // Amber, like a forget that failed: the person may need to act --
        // make room on the Memory screen, or read what the store said.
        options.notify({
          kind: 'relay-notice',
          runId: recovered.metadata.runId,
          missionId: mission.missionId,
          message: `${by.name} tried to remember something and it was not kept. ${refused.join(' ')}`
        })
      }
      if (missed.length > 0) {
        // Amber: a person may need to act. The memory that was meant to go is
        // still there, and only they can settle what it should say.
        options.notify({
          kind: 'relay-notice',
          runId: recovered.metadata.runId,
          missionId: mission.missionId,
          message: `${by.name} tried to forget something and could not. ${missed.join(' ')} It is still remembered.`
        })
      }
      /*
       * A forget that WORKED says nothing here.
       *
       * It used to quote every forgotten memory in full on an amber line,
       * directly above the memory card. Colin, 2026-09-14: "these two yellow
       * texts are both unneccessary, the remember thing is more than enough."
       *
       * The note that kept this line argued the card cannot draw a memory
       * that is gone, which is true and is not the point: nobody has to DO
       * anything about a memory a teammate correctly dropped, and amber in
       * this app means a person may need to act. The Memory screen holds what
       * is remembered, and what is not there is not there.
       *
       * The failed forget above still speaks, and for exactly the reason this
       * one does not: a memory that was MEANT to go and did not is still
       * being briefed to every mission, and only a person can settle it.
       */
    }
  }
}
