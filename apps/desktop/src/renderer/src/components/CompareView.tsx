import { useState, type CSSProperties, type ReactElement } from 'react'

import type { MissionRuntimeId } from '@teammate/runtime-adapters'
import type { CompareSlotId, PublicCompare } from '../../../shared/compare.js'
import type { PublicTeammate } from '../../../shared/ipc.js'
import { activityEntries } from '../missionView.js'
import type { ThreadItem } from '../missionView.js'
import { InComparisonCell, PinnedPagesContext } from '../pinnedPages.js'
import { PagePreview } from './DocPreview.js'
import { ApprovalCard } from './ApprovalCard.js'
import type { MissionApprovalDecision, MissionApprovalRequest, MissionMode } from '../../../shared/ipc.js'
import { Icon } from './Icon.js'
import { ChevronGlyph } from './ChatGlyphs.js'
import { RuntimeMark } from './RuntimeMark.js'
import { ThreadItems } from './Thread.js'
import { WorkingSpark } from './WorkingSpark.js'
import type { CompareRecordRow } from '../compareRecord.js'
import { keptSentence } from '../status.js'

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
  /** It answers in a copy of the folder, because it cannot be held read-only here (0.443). */
  readonly copy?: true
  /** Why it could not start, when it could not. */
  readonly refused?: string
  /** Where it works, when not the person's folder (0.555): its files are read there. */
  readonly folder?: string
  /** One cell per ask, oldest first; a column that could not take an ask has none for it. */
  readonly turns: readonly { readonly missionId: string; readonly items: readonly ThreadItem[]; readonly running: boolean }[]
  readonly running: boolean
  /** Its newest answer finished: a failed or empty column has nothing to keep. */
  readonly keepable: boolean
  /** Its newest ask did not get an answer (failed, stopped, or never started): it can be asked again. */
  readonly retryable: boolean
  /** Its newest answer's words, for Copy; empty when there are none. */
  readonly answer: string
  /** "done", "working", "stopped", "failed" -- what the head says. */
  readonly state: string
  /** "41s", summed over its turns, when known. */
  readonly span?: string
  /** What it cost, as its runtime reported it. */
  readonly cost?: string
  /**
   * What its run is waiting on the person for (0.451). The 0.450 three-way
   * comparison sat twenty minutes on "Using a tool..." while four approvals
   * waited under the title bar's "4 need you" -- a column never drew its card.
   */
  readonly approvals?: readonly MissionApprovalRequest[]
}

/** The web page a turn created, if it made one: what its column shows running at the top (0.450). */
const NO_PAGES: ReadonlySet<string> = new Set()

export function builtPageOf(items: readonly ThreadItem[], workspacePath: string | undefined): string | undefined {
  for (const item of items) {
    if (item.type !== 'activity') continue
    for (const entry of activityEntries(item.details, workspacePath)) {
      if (entry.kind === 'file' && entry.file.status === 'ADDED' && /\.html?$/i.test(entry.file.path)) return entry.file.path
    }
  }
  return undefined
}

export function CompareView({
  compare,
  changeLines,
  prompts,
  columns,
  owner,
  workspacePath,
  keeping,
  conversationMode,
  retrying,
  problem,
  onKeep,
  onRetry,
  onBack,
  decidingIds,
  onDecide,
  onAnswer,
  record,
  judge,
  judgeChoices = [],
  judging = false,
  onJudge,
  addChoices = [],
  adding = false,
  onAddModel
}: {
  readonly compare: PublicCompare
  /** In a comparison that edits (0.445): what each column has changed, "+12 -3 in 2 files". */
  readonly changeLines: Partial<Record<CompareSlotId, string>>
  /** Each ask, oldest first. */
  readonly prompts: readonly string[]
  readonly columns: readonly CompareColumnView[]
  readonly owner: PublicTeammate | undefined
  readonly workspacePath: string | undefined
  /** A keep is under way: no second one. */
  readonly keeping: boolean
  /** The mode the conversation is in (the chat box's own): what the kept sentence says it carries on in. */
  readonly conversationMode?: MissionMode
  /** The column being asked again, while it is being started. */
  readonly retrying: CompareSlotId | undefined
  /** What the last keep could not do, said in the bar. */
  readonly problem?: string
  readonly onKeep: (slot: CompareSlotId) => void
  readonly onRetry: (slot: CompareSlotId) => void
  /** Answering a column's approval, as the thread answers one. */
  readonly decidingIds?: readonly string[]
  readonly onDecide?: (approvalId: string, decision: MissionApprovalDecision, reason?: string) => void
  readonly onAnswer?: (approvalId: string, answers: Readonly<Record<string, readonly string[]>>) => void
  /** Kept already: back to the conversation it carries on in. */
  readonly onBack: (() => void) | undefined
  /** Once one is kept: every model's record across your decided comparisons (0.519). */
  readonly record?: readonly CompareRecordRow[]
  /** The judge's view, when one was asked (0.520): its model, and what it said or is saying. */
  readonly judge?: { readonly name: string; readonly running: boolean; readonly answer: string; readonly items: readonly ThreadItem[]; readonly pick?: CompareSlotId; readonly failed?: string }
  /** The models a judge can be, the first the one offered (0.520). */
  readonly judgeChoices?: readonly ModelChoice[]
  /** A judge is being asked. */
  readonly judging?: boolean
  readonly onJudge?: (choiceKey: string, criteria: string) => void
  /** Models not yet in it, that the same question can be put to (0.523). */
  readonly addChoices?: readonly ModelChoice[]
  readonly adding?: boolean
  readonly onAddModel?: (choiceKey: string) => void
}): ReactElement {
  const kept = compare.kept?.slot
  // A blind comparison hides what would name the model -- its mark, its runtime, its cost -- until one is kept (0.449).
  const veiled = compare.blind === true && kept === undefined
  const keptName = columns.find((column) => column.slot === kept)?.name
  /*
   * FOCUS (0.444, Arena's Expand): one column wide, the others narrowed to
   * rails that still say who they are and how they are doing. A rail's head
   * focuses it; the wide column's own button shows them all again.
   */
  const [focusedSlot, setFocusedSlot] = useState<CompareSlotId | undefined>(undefined)
  const focused = columns.some((column) => column.slot === focusedSlot) ? focusedSlot : undefined
  const railed = (slot: CompareSlotId): boolean => focused !== undefined && slot !== focused
  const [copied, setCopied] = useState<CompareSlotId | undefined>(undefined)
  const copy = (column: CompareColumnView): void => {
    const done = (): void => {
      setCopied(column.slot)
      window.setTimeout(() => setCopied((now) => (now === column.slot ? undefined : now)), 1_600)
    }
    // Same fallback as the shell output's Copy: `navigator.clipboard` is not always there for a packaged page.
    navigator.clipboard?.writeText(column.answer).then(done).catch(() => {
      const field = document.createElement('textarea')
      field.value = column.answer
      document.body.appendChild(field)
      field.select()
      try {
        document.execCommand('copy')
        done()
      } finally {
        field.remove()
      }
    })
  }
  const style = {
    '--lc-compare-columns': String(columns.length),
    ...(focused === undefined ? {} : { '--lc-compare-template': columns.map((column) => (column.slot === focused ? 'minmax(var(--lc-compare-min), 1fr)' : 'var(--lc-compare-rail)')).join(' ') })
  } as CSSProperties
  return (
    <section className="lc-compare" aria-label="Comparison" style={style}>
      <div className="lc-compare__bar">
        <span>
          {kept === undefined
            ? `Comparing ${columns.map((column) => column.name).join(columns.length === 2 ? ' and ' : ', ')}${veiled ? ', names hidden until you keep one' : ''}. ${
                compare.changes !== true
                  ? 'They answer without changing files.'
                  : compare.changesIn === 'folder'
                    ? 'This folder is too big to give each its own copy, so they all work in your folder itself.'
                    : `Each changes its own copy of your project; only the one you keep comes into your folder.${
                        // Said, not promised (0.555): Auto runs with the whole disk, and Sol, told to, wrote outside its copy.
                        compare.slots.some((column) => column.route.mode === 'auto') ? ' On Auto, a model can still change files outside its copy if it is asked to.' : ''
                      }`
              }`
            : keptSentence(keptName, conversationMode, compare.slots.find((column) => column.slot === kept)?.route.mode)}
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
          {columns.map((column) => railed(column.slot) ? (
            <button
              key={`head:${column.slot}`}
              type="button"
              className={`lc-compare__head is-rail${column.slot === kept ? ' is-kept' : ''}`}
              title={`${column.name}: ${column.state}. Focus on it.`}
              onClick={() => setFocusedSlot(column.slot)}
            >
              {!veiled && <RuntimeMark runtime={column.runtime} size={13} />}
              <span className="lc-compare__name">{column.name}</span>
              {column.running && <WorkingSpark />}
            </button>
          ) : (
            <div key={`head:${column.slot}`} className={`lc-compare__head${column.slot === kept ? ' is-kept' : ''}`}>
              {!veiled && <RuntimeMark runtime={column.runtime} size={13} />}
              <span className="lc-compare__name">{column.name}</span>
              {judge?.pick === column.slot && <span className="lc-compare__judgebadge" title="The judge would keep this answer. Its view, not a decision.">Judge's pick</span>}
              {!veiled && (
              <span
                className="lc-compare__runtime lc-mono"
                {...(column.copy === true ? { title: `${column.runtimeName} cannot be held read-only on this computer, so it answers in a copy of your folder. Nothing in your folder changes.` } : {})}
              >
                {column.copy === true ? `${column.runtimeName} · in a copy` : column.runtimeName}
              </span>
              )}
              <span className="lc-compare__state lc-mono">
                {column.running && <WorkingSpark />}
                {column.state}
              </span>
              <button
                type="button"
                className="lc-compare__tool"
                aria-label={`Copy ${column.name}'s answer`}
                title={column.answer.length === 0 ? 'No answer to copy yet.' : copied === column.slot ? 'Copied.' : 'Copy its answer.'}
                disabled={column.answer.length === 0}
                onClick={() => copy(column)}
              >
                <Icon name={copied === column.slot ? 'check' : 'copy'} size={14} />
              </button>
              {columns.length > 1 && (
                <button
                  type="button"
                  className="lc-compare__tool"
                  aria-label={focused === column.slot ? 'Show every answer' : `Focus on ${column.name}`}
                  title={focused === column.slot ? 'Show every answer side by side.' : 'Give this answer the width. The others stay at the side.'}
                  aria-pressed={focused === column.slot}
                  onClick={() => setFocusedSlot(focused === column.slot ? undefined : column.slot)}
                >
                  <Icon name={focused === column.slot ? 'collapse' : 'expand'} size={14} />
                </button>
              )}
            </div>
          ))}
          {prompts.map((prompt, turn) => (
            <div key={`turn:${String(turn)}`} className="lc-compare__turn">
              <div className="lc-compare__ask">{prompt}</div>
              <div className="lc-compare__cells">
                {columns.map((column) => {
                  const cell = column.turns[turn]
                  if (railed(column.slot)) return <div key={`cell:${column.slot}:${String(turn)}`} className="lc-compare__cell is-rail" />
                  const built = cell === undefined || cell.running ? undefined : builtPageOf(cell.items, workspacePath)
                  /*
                   * A COLUMN NOT KEPT HAS NO PAGE LEFT (0.571). Keep removes the
                   * other copies, and their page's name then reads from the
                   * folder -- which holds the KEPT page: the blind arena run
                   * showed Sonnet's title screen in Opus's column, under Opus's name.
                   */
                  const copyGone = built !== undefined && compare.changes === true && compare.changesIn !== 'folder' && compare.kept !== undefined && compare.kept.slot !== column.slot
                  const page = copyGone ? undefined : built
                  return (
                    <div key={`cell:${column.slot}:${String(turn)}`} className="lc-compare__cell" aria-label={`${column.name}'s answer`}>
                      {cell === undefined ? (
                        <p className="lc-compare__quiet">{turn === 0 && column.refused !== undefined ? column.refused : 'Not asked this.'}</p>
                      ) : cell.items.length === 0 ? (
                        <p className="lc-compare__quiet">{cell.running ? 'Starting…' : 'No answer was recorded.'}</p>
                      ) : (
                        <>
                          {copyGone && (
                            <p className="lc-compare__quiet">{`Its copy was removed when you kept ${columns.find((other) => other.slot === compare.kept?.slot)?.name ?? 'another model'}, so the page it made is no longer on this computer. What it said about it is below.`}</p>
                          )}
                          {page !== undefined && (
                            <div className="lc-compare__page" aria-label={`The page ${column.name} made, running`}>
                              <PagePreview path={page} name={page.replace(/\\/g, '/').split('/').pop() ?? page} column={{ compareId: compare.compareId, slot: column.slot }} />
                            </div>
                          )}
                          <PinnedPagesContext.Provider value={page === undefined ? NO_PAGES : new Set([page])}>
                            <InComparisonCell.Provider value={true}>
                            <ThreadItems
                              items={cell.items}
                              owner={owner}
                              faces={false}
                              activity={cell.running ? 'thinking' : 'idle'}
                              workspacePath={column.folder ?? workspacePath}
                              decision={undefined}
                            />
                            </InComparisonCell.Provider>
                          </PinnedPagesContext.Provider>
                        </>
                      )}
                      {/* What this column waits on you for, where you are looking: its newest turn. */}
                      {turn === column.turns.length - 1 && onDecide !== undefined && onAnswer !== undefined &&
                        (column.approvals ?? []).map((request) => (
                          <ApprovalCard
                            key={request.approvalId}
                            request={request}
                            busy={(decidingIds ?? []).includes(request.approvalId)}
                            onDecide={(decision, reason) => onDecide(request.approvalId, decision, reason)}
                            onAnswer={(answers) => onAnswer(request.approvalId, answers)}
                          />
                        ))}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
        {judge !== undefined && (
          /*
           * THE JUDGE'S VIEW (0.520), after Optima's judge models: a model
           * the person picked read the answers under their letters. Its
           * view, marked as one; the person still keeps an answer.
           */
          <div className="lc-compare__judge" aria-label="The judge's view">
            <span className="lc-compare__recordlabel lc-mono">
              {judge.running && <WorkingSpark />}
              {`THE JUDGE'S VIEW · ${judge.name}${judge.running ? ' · reading' : ''}`}
            </span>
            {/*
             * Drawn as every other reply (0.554). Colin, on 0.553: "very
             * unresponsive... not even sure myself if its doing anything" --
             * it said "Reading the answers…" until the judge was done, and
             * hid its steps and words while they came.
             */}
            {judge.failed !== undefined ? (
              <p className="lc-compare__quiet">{judge.failed}</p>
            ) : judge.items.length === 0 ? (
              <p className="lc-compare__quiet">{judge.running ? 'Starting the judge…' : 'No answer was recorded.'}</p>
            ) : (
              <div className="lc-compare__judgesaid">
                <InComparisonCell.Provider value={true}>
                  <ThreadItems
                    items={judge.items}
                    owner={undefined}
                    faces={false}
                    activity={judge.running ? 'thinking' : 'idle'}
                    workspacePath={workspacePath}
                    decision={undefined}
                  />
                </InComparisonCell.Provider>
              </div>
            )}
            <p className="lc-compare__judgenote">It read the answers as Answer A, Answer B and so on, not by model. Its view, not a decision: you keep the answer.</p>
          </div>
        )}
        {onJudge !== undefined && judgeChoices.length > 0 && judge?.running !== true && columns.filter((column) => column.keepable).length >= 2 && !columns.some((column) => column.running) && (
          <JudgeAsk choices={judgeChoices} again={judge !== undefined} busy={judging} onJudge={onJudge} />
        )}
        {onAddModel !== undefined && addChoices.length > 0 && columns.length < 3 && compare.changes !== true && !columns.some((column) => column.running) && columns.every((column) => column.turns.length <= 1) && (
          <AddModelAsk choices={addChoices} busy={adding} onAdd={onAddModel} />
        )}
        {/*
          * WHY IT WENT (0.539). Sol, on 0.532, confirmed by Cursor on 0.537:
          * after a follow-up the block was gone with nothing said. A new
          * column is asked the first question only, so after a follow-up it
          * would be answering a different conversation.
          */}
        {onAddModel !== undefined && addChoices.length > 0 && columns.length < 3 && compare.changes !== true && !columns.some((column) => column.running) && columns.some((column) => column.turns.length > 1) && (
          <p className="lc-compare__judgenote">Another model can join only before the first follow-up: it would be asked the first question and miss the turns since. Start a new comparison to add one.</p>
        )}
        {record !== undefined && record.length > 0 && (
          /*
           * YOUR RECORD (0.519), as Optima's results table: every model you
           * have compared, how often you kept it, and what its answers
           * typically took. Under the answers, once one is kept.
           */
          <div className="lc-compare__record">
            <span className="lc-compare__recordlabel lc-mono">YOUR RECORD</span>
            <div className="lc-tablewrap">
              <table className="lc-table">
                <thead>
                  <tr>
                    <th>Model</th>
                    <th>Kept</th>
                    <th>Typical time</th>
                    <th>Typical tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {record.map((row) => (
                    <tr key={row.key}>
                      <td>{row.name}</td>
                      <td className="lc-compare__recordnum">{`${String(row.kept)} of ${String(row.compared)}`}</td>
                      <td className="lc-compare__recordnum">{row.time ?? '—'}</td>
                      <td className="lc-compare__recordnum">{row.cost ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
      <div className="lc-compare__feet">
        {columns.map((column) => (
          <div key={`foot:${column.slot}`} className={`lc-compare__foot${railed(column.slot) ? ' is-rail' : ''}`}>
            {!railed(column.slot) && (
              <span className="lc-compare__numbers lc-mono">
                {[changeLines[column.slot], column.span, veiled ? undefined : column.cost].filter((part) => part !== undefined && part.length > 0).join(' · ')}
              </span>
            )}
            {railed(column.slot) ? null : kept === undefined && column.retryable ? (
              <button
                type="button"
                className="lc-button"
                disabled={retrying !== undefined || keeping}
                title="Ask it again, on the same model. The answer it gives takes this one's place."
                onClick={() => onRetry(column.slot)}
              >
                {retrying === column.slot ? 'Starting…' : 'Try again'}
              </button>
            ) : kept === undefined ? (
              <button
                type="button"
                className="lc-primarybutton"
                disabled={keeping || !column.keepable}
                title={
                  column.keepable
                    ? compare.changes === true && compare.changesIn === 'folder'
                      ? 'Keep this one: the conversation carries on with it. They all worked in your folder, so its changes are there already, with the others’.'
                      : compare.changes === true
                      ? 'Keep this one. Its changes come into your folder, not committed; the others stop, and their copies are removed.'
                      : 'Keep this one. The others stop, and the conversation carries on with it.'
                    : column.running ? 'Still answering.' : 'Nothing to keep: its answer did not finish.'
                }
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

/** A model a judge or a new column can be: grouped under its agent when `group` is given. */
export interface ModelChoice {
  readonly key: string
  readonly label: string
  /** "Claude Code", "OpenCode": the agent it runs on, the menu's heading. */
  readonly group?: string
  /** Its name alone, under that heading. */
  readonly short?: string
}

/**
 * THE MODEL PICKED, OR THE ONE OFFERED (0.554). The menu is first drawn
 * before the agents are found, when only the compared models can judge; a
 * pick held from then stayed on one of them, and the judge ran on a model it
 * was judging. Until the person picks, it follows the one offered first.
 */
function useChosenModel(choices: readonly ModelChoice[]): readonly [string, (key: string) => void] {
  const [picked, setPicked] = useState<string>()
  const held = picked !== undefined && choices.some((one) => one.key === picked) ? picked : undefined
  return [held ?? choices[0]?.key ?? '', setPicked] as const
}

/**
 * EVERY MODEL, UNDER ITS AGENT (0.554), as the composer's model menu lists
 * them. Colin, on 0.553: "not all of our models showing in judge category"
 * -- sixteen fit, and the free OpenCode ones filled most of them. The one
 * offered stays first; the rest follow under their agent's name.
 */
function ModelOptions({ choices }: { readonly choices: readonly ModelChoice[] }): ReactElement {
  const [first, ...rest] = choices
  const groups: { readonly name: string; readonly members: ModelChoice[] }[] = []
  for (const one of rest) {
    const name = one.group ?? ''
    const group = groups.find((candidate) => candidate.name === name)
    if (group === undefined) groups.push({ name, members: [one] })
    else group.members.push(one)
  }
  return (
    <>
      {first !== undefined && <option value={first.key}>{first.label}</option>}
      {groups.map((group) =>
        group.name.length === 0 ? (
          group.members.map((one) => <option key={one.key} value={one.key}>{one.label}</option>)
        ) : (
          <optgroup key={group.name} label={group.name}>
            {group.members.map((one) => <option key={one.key} value={one.key}>{one.short ?? one.label}</option>)}
          </optgroup>
        )
      )}
    </>
  )
}

/**
 * ASK A JUDGE (0.520): which model reads the answers, and what a good answer
 * does if the person wants to say. One line under the answers, once at
 * least two have finished; nothing runs until Judge is pressed.
 */
function JudgeAsk({ choices, again, busy, onJudge }: {
  readonly choices: readonly ModelChoice[]
  readonly again: boolean
  readonly busy: boolean
  readonly onJudge: (choiceKey: string, criteria: string) => void
}): ReactElement {
  const [choice, setChoice] = useChosenModel(choices)
  const [criteria, setCriteria] = useState('')
  return (
    <div className="lc-compare__judgeask">
      <span className="lc-compare__recordlabel lc-mono">{again ? 'ASK ANOTHER JUDGE' : 'ASK A JUDGE'}</span>
      <div className="lc-compare__judgerow">
        <span className="lc-compare__select">
          <select className="lc-input lc-compare__judgepick" aria-label="The model that judges" value={choice} onChange={(event) => setChoice(event.target.value)}>
            <ModelOptions choices={choices} />
          </select>
          <ChevronGlyph />
        </span>
        <input
          className="lc-input lc-compare__judgecriteria"
          aria-label="What a good answer does"
          placeholder="What a good answer does (optional)"
          maxLength={1000}
          value={criteria}
          onChange={(event) => setCriteria(event.target.value)}
        />
        <button type="button" className="lc-button" disabled={busy || choice.length === 0} onClick={() => onJudge(choice, criteria)}>
          {busy ? 'Asking…' : 'Judge'}
        </button>
      </div>
      <p className="lc-compare__judgenote">It reads the answers without the models&rsquo; names and says which it would keep. It keeps nothing itself.</p>
    </div>
  )
}

/**
 * ANOTHER MODEL, THE SAME QUESTION (0.523): a third column, asked what the
 * others were. After Optima, which runs a benchmark again on each new model.
 */
function AddModelAsk({ choices, busy, onAdd }: {
  readonly choices: readonly ModelChoice[]
  readonly busy: boolean
  readonly onAdd: (choiceKey: string) => void
}): ReactElement {
  const [choice, setChoice] = useChosenModel(choices)
  return (
    <div className="lc-compare__judgeask">
      <span className="lc-compare__recordlabel lc-mono">ASK ANOTHER MODEL</span>
      <div className="lc-compare__judgerow">
        <select className="lc-input lc-compare__judgepick" aria-label="The model to ask too" value={choice} onChange={(event) => setChoice(event.target.value)}>
          <ModelOptions choices={choices} />
        </select>
        <button type="button" className="lc-button" disabled={busy || choice.length === 0} onClick={() => onAdd(choice)}>
          {busy ? 'Asking…' : 'Ask it too'}
        </button>
      </div>
      <p className="lc-compare__judgenote">It is asked the same question, as a new column. What you kept stays kept.</p>
    </div>
  )
}
