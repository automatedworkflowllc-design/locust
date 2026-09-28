import type { CSSProperties, ReactElement } from 'react'

import type { MissionRuntimeId } from '@teammate/runtime-adapters'
import type { CompareSlotId, PublicCompare } from '../../../shared/compare.js'
import type { PublicTeammate } from '../../../shared/ipc.js'
import type { ThreadItem } from '../missionView.js'
import { RuntimeMark } from './RuntimeMark.js'
import { ThreadItems } from './Thread.js'
import { WorkingSpark } from './WorkingSpark.js'

/**
 * COMPARE, SIDE BY SIDE (0.441, shared/compare.ts,
 * docs/PLAN-2026-09-28-COMPARE.md).
 *
 * One column per model, in place of the thread. Each ask runs across the
 * whole width, and the answers to it sit side by side beneath it, so a
 * follow-up lines up with the answers it follows. The column heads stay at
 * the top; the feet say how long each took and what it cost, and hold the
 * one control that decides: Keep this one.
 */
export interface CompareColumnView {
  readonly slot: CompareSlotId
  readonly name: string
  readonly runtime: MissionRuntimeId
  readonly runtimeName: string
  /** Why it could not start, when it could not. */
  readonly refused?: string
  /** One cell per ask, oldest first; a column that could not take an ask has none for it. */
  readonly turns: readonly { readonly missionId: string; readonly items: readonly ThreadItem[]; readonly running: boolean }[]
  readonly running: boolean
  /** "done", "working", "stopped", "failed" -- what the head says. */
  readonly state: string
  /** "41s", summed over its turns, when known. */
  readonly span?: string
  /** What it cost, as its runtime reported it. */
  readonly cost?: string
}

export function CompareView({
  compare,
  prompts,
  columns,
  owner,
  workspacePath,
  keeping,
  problem,
  onKeep,
  onBack
}: {
  readonly compare: PublicCompare
  /** Each ask, oldest first. */
  readonly prompts: readonly string[]
  readonly columns: readonly CompareColumnView[]
  readonly owner: PublicTeammate | undefined
  readonly workspacePath: string | undefined
  /** A keep is under way: no second one. */
  readonly keeping: boolean
  /** What the last keep could not do, said in the bar. */
  readonly problem?: string
  readonly onKeep: (slot: CompareSlotId) => void
  /** Kept already: back to the conversation it carries on in. */
  readonly onBack: (() => void) | undefined
}): ReactElement {
  const kept = compare.kept?.slot
  const keptName = columns.find((column) => column.slot === kept)?.name
  const style = { '--lc-compare-columns': String(columns.length) } as CSSProperties
  return (
    <section className="lc-compare" aria-label="Comparison" style={style}>
      <div className="lc-compare__bar">
        <span>
          {kept === undefined
            ? `Comparing ${columns.map((column) => column.name).join(columns.length === 2 ? ' and ' : ', ')}. They answer without changing files.`
            : `You kept ${keptName ?? 'one'}; the conversation carries on with it.`}
        </span>
        {problem !== undefined && <span className="lc-compare__problem" role="status">{problem}</span>}
        {onBack !== undefined && (
          <button type="button" className="lc-button" onClick={onBack}>
            Back to the conversation
          </button>
        )}
      </div>
      <div className="lc-compare__scroll">
        <div className="lc-compare__grid">
          {columns.map((column) => (
            <div key={`head:${column.slot}`} className={`lc-compare__head${column.slot === kept ? ' is-kept' : ''}`}>
              <RuntimeMark runtime={column.runtime} size={13} />
              <span className="lc-compare__name">{column.name}</span>
              <span className="lc-compare__runtime lc-mono">{column.runtimeName}</span>
              <span className="lc-compare__state lc-mono">
                {column.running && <WorkingSpark />}
                {column.state}
              </span>
            </div>
          ))}
          {prompts.map((prompt, turn) => (
            <div key={`turn:${String(turn)}`} className="lc-compare__turn">
              <div className="lc-compare__ask">{prompt}</div>
              <div className="lc-compare__cells">
                {columns.map((column) => {
                  const cell = column.turns[turn]
                  return (
                    <div key={`cell:${column.slot}:${String(turn)}`} className="lc-compare__cell" aria-label={`${column.name}'s answer`}>
                      {cell === undefined ? (
                        <p className="lc-compare__quiet">{turn === 0 && column.refused !== undefined ? column.refused : 'Not asked this.'}</p>
                      ) : cell.items.length === 0 ? (
                        <p className="lc-compare__quiet">{cell.running ? 'Starting…' : 'No answer was recorded.'}</p>
                      ) : (
                        <ThreadItems
                          items={cell.items}
                          owner={owner}
                          faces={false}
                          activity={cell.running ? 'thinking' : 'idle'}
                          workspacePath={workspacePath}
                          decision={undefined}
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="lc-compare__feet">
        {columns.map((column) => (
          <div key={`foot:${column.slot}`} className="lc-compare__foot">
            <span className="lc-compare__numbers lc-mono">{[column.span, column.cost].filter((part) => part !== undefined && part.length > 0).join(' · ')}</span>
            {kept === undefined ? (
              <button
                type="button"
                className="lc-primarybutton"
                disabled={keeping || column.turns.length === 0}
                title="Keep this one. The others stop, and the conversation carries on with it."
                onClick={() => onKeep(column.slot)}
              >
                Keep this one
              </button>
            ) : column.slot === kept ? (
              <span className="lc-compare__kept lc-mono">Kept</span>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  )
}
