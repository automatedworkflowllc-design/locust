import mark from '../assets/locust-mark.svg'
import { useState } from 'react'
import type { ContextReading } from '../cost.js'
import { usagePercent, usageWindowSentence } from '../missionView.js'
import type { FormEvent, KeyboardEvent, ReactElement } from 'react'

import type {
  MissionMode,
  MissionRouteSummary,
  PublicModel,
  PublicRuntimeStatus
} from '../../../shared/ipc.js'
import { hostCanRunMission, isMissionRuntime, runtimeDisplayName } from '../../../shared/runtimes.js'
import {
  handoffAvailability,
  handoffTitle,
  modeRunsOn,
  modesFor,
  modeUnavailableReason,
  modelFamily,
  runtimeIsUsable
} from '../status.js'
import { ContextRing } from './ContextRing.js'
import { defaultEffort, modelLabelFor } from '../status.js'
import { Icon } from './Icon.js'
import { effortDescription, effortFooter } from '../effortLevels.js'
import { effortScale, joinEffort, splitEffort } from '../effortScale.js'
import { attachmentLabel, MAX_ATTACHMENTS, withAttachments } from '../../../shared/attachments.js'
import { availableCommands, matchingCommands, slashQuery } from '../slashCommands.js'
import type { SlashCommand } from '../slashCommands.js'
import { RoutePicker } from './RoutePicker.js'
import type { RouteChoice } from './RoutePicker.js'

const MAX_PROMPT_LENGTH = 8_000

/**
 * Each mode states its consequence, not just its name. There are two because
 * there are two the runtime can actually honour: `codex exec` has no
 * interactive approval channel, so "plan first" and "automatic" would be
 * labels over behaviour that does not differ.
 */
const MODES: readonly { readonly mode: MissionMode; readonly name: string; readonly consequence: string }[] = [
  { mode: 'ask', name: 'Ask', consequence: 'Reads and explains. Every write is refused by the sandbox.' },
  {
    mode: 'accept-edits',
    name: 'Accept edits',
    consequence: 'May edit files inside this workspace folder, and nowhere else.'
  },
  {
    mode: 'plan',
    name: 'Plan',
    consequence: 'Answers with the steps it would take, and changes nothing.'
  },
  {
    mode: 'approve-each',
    name: 'Approve each action',
    consequence: 'Stops and asks before every command or file change.'
  },
  {
    mode: 'auto',
    name: 'Auto',
    consequence: 'Runs without asking and may change files anywhere on this machine, not only this folder.'
  }
]

export interface ComposerProps {
  readonly runtimes: readonly PublicRuntimeStatus[]
  /** Runtimes whose last run ended on the account's usage limit, with its own words. */
  readonly limitedRuntimes: ReadonlyMap<string, string>
  /** The latest still-allowed rate-limit reading per runtime, for the route chip's tooltip. */
  readonly usageWindows?: ReadonlyMap<string, string>
  readonly discoveryPhase: 'loading' | 'ready' | 'error'
  readonly running: boolean
  readonly cancelling: boolean
  readonly activeRoute: MissionRouteSummary | undefined
  readonly error: string | undefined
  readonly mode: MissionMode
  readonly onModeChange: (mode: MissionMode) => void
  /** How full the model's context is, when the runtime reported its size. */
  readonly context?: ContextReading
  /** Whether this workspace has Auto switched on. Picking Auto here switches it on. */
  readonly autoMode?: boolean
  /** Turn Auto on for the workspace, because the person just chose it. */
  readonly onEnableAutoMode?: () => void
  readonly route: RouteChoice
  readonly onRouteChange: (route: RouteChoice) => void
  readonly models: readonly PublicModel[]
  /** What each route's model resolved to last time, keyed `runtime:model`. */
  readonly resolvedModels: ReadonlyMap<string, string>
  /** Routes this person has run, newest first, as `runtime:model`. */
  readonly recentRoutes: readonly string[]
  /** Where this build is running; some containment is platform specific. */
  readonly platform: string | undefined
  readonly effort: string | undefined
  readonly onEffortChange: (effort: string | undefined) => void
  readonly swarm: boolean
  readonly onSwarmChange: (swarm: boolean) => void
  readonly onStart: (prompt: string) => Promise<boolean>
  readonly onCancel: () => void
  readonly onOpenRoutePicker: () => void
  /**
   * Move the RUNNING mission to another route. Distinct from `onRouteChange`,
   * which only decides what the next mission starts on: this one stops the
   * current run, reconciles it, and starts a briefed continuation. Two very
   * different consequences, so they are two different callbacks rather than one
   * that quietly means something else while a run is live.
   */
  readonly onHandOff: (route: RouteChoice) => void
  readonly handingOff: boolean
  /** The folder the next mission runs in, by its last segment; undefined when none is chosen. */
  readonly workspaceName: string | undefined
  /** The whole path, for the chip's tooltip -- a name alone is ambiguous across projects. */
  readonly workspacePath: string | undefined
  readonly workspaceMade?: boolean
  readonly onChooseFolder: () => void
  /** Who the next mission is messaged to; the placeholder says so. */
  readonly teammateName: string | undefined
  /**
   * Set when the addressed teammate already has a live mission somewhere.
   * Starting is refused for THEM, not for the workspace: another teammate's
   * run being on screen does not block this one.
   */
  readonly busyWith: string | undefined
  /**
   * Said above the box when the next message continues a stopped run on a
   * DIFFERENT runtime: the person is told, before sending, that the new
   * runtime starts from the old one's checkpoint rather than its memory.
   */
  readonly continuationNote: string | undefined
  /** What is waiting to be sent when the running mission finishes, if anything. */
  readonly queued: string | undefined
  /** Why a queued message has not gone yet, when it is not simply still running. */
  readonly queuedNote: string | undefined
  readonly onQueue: (text: string) => void
  readonly onUnqueue: () => void
  readonly onSendQueued: () => void
  /** The queued message belongs to a conversation that is NOT the one on screen. */
  readonly queuedElsewhere: boolean
}

/**
 * The composer: one field, one border, controls underneath.
 *
 * The design puts mode, add, route, effort and swarm on this row. Mode, add,
 * effort and swarm are drawn as disabled here on purpose -- each needs a
 * capability that does not exist yet, and a control that silently does nothing
 * is worse than one that says it is not ready. The route control is real: it
 * opens the picker, and what it displays comes from the running mission or from
 * discovery, never from a constant.
 */
export function Composer({
  continuationNote,
  workspaceName,
  workspacePath,
  workspaceMade = false,
  onChooseFolder,
  runtimes,
  limitedRuntimes,
  usageWindows,
  discoveryPhase,
  running,
  cancelling,
  activeRoute,
  error,
  mode,
  onModeChange,
  autoMode,
  context,
  onEnableAutoMode,
  route,
  onRouteChange,
  models,
  resolvedModels,
  recentRoutes,
  platform,
  effort,
  onEffortChange,
  swarm,
  onSwarmChange,
  onStart,
  onCancel,
  onOpenRoutePicker,
  onHandOff,
  handingOff,
  teammateName,
  busyWith,
  queued,
  queuedNote,
  onQueue,
  onUnqueue,
  onSendQueued,
  queuedElsewhere
}: ComposerProps): ReactElement {
  const [value, setValue] = useState('')
  /** Why the last press of Enter did nothing. Cleared as soon as one lands. */
  const [refusal, setRefusal] = useState<string>()
  const type = (next: string): void => {
    setValue(next)
    // The refusal was about the press, not about the text. Typing again is
    // the person trying something; leaving the old sentence up implies it
    // still applies.
    if (refusal !== undefined) setRefusal(undefined)
  }
  const [modeOpen, setModeOpen] = useState(false)
  /**
   * Files this message will point the runtime at, workspace-relative.
   *
   * Cleared on send, like the box itself: an attachment belongs to the message
   * it was chosen for, and carrying it silently into the next one would attach
   * a file nobody asked for.
   */
  const [attached, setAttached] = useState<readonly string[]>([])
  const [attaching, setAttaching] = useState(false)
  /**
   * Which slash command the arrow keys are on.
   *
   * Typing narrows the list under it, so this index can outlive the entry it
   * pointed at. Every read clamps to the last row rather than resetting on
   * every keystroke: resetting would drag the highlight back to the top mid-typing,
   * and clamping means the index can never name a command that is not there.
   */
  const [slashAt, setSlashAt] = useState(0)
  const [effortOpen, setEffortOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)

  // A mode the chosen route cannot run is not the mode a mission would start
  // in, so it is not the mode the control shows either. Switching route used
  // to leave "Approve each action" selected against a runtime that refuses
  // it, and every message was then rejected before it began.
  const effectiveMode: MissionMode = modeRunsOn(mode, route.runtime, platform)
    ? mode
    : modesFor(route.runtime, platform)[0] ?? 'accept-edits'
  /*
   * Slash commands. Every one maps to a control already on this row, so the
   * menu is a keyboard path to things that exist rather than a new capability
   * -- and the list is filtered by what is actually possible, so a command can
   * never be offered and then refused.
   */
  const slashing = slashQuery(value)
  const slashChoices = slashing === undefined
    ? []
    : matchingCommands(slashing, availableCommands({
        modes: modesFor(route.runtime, platform),
        running,
        canSwarm: !running
      }))
  const runSlash = (command: SlashCommand): void => {
    setValue('')
    setSlashAt(0)
    switch (command.action.kind) {
      case 'mode':
        // Exactly what choosing the mode in the menu does, including the part
        // that is easy to miss: Auto is refused unless the workspace switch is
        // on, and App turns it straight back to Accept edits. A drive on
        // 2026-09-08 typed `/auto`, watched the box clear, and watched the
        // mode not change -- a command offered and then quietly undone, which
        // is the one thing this menu promises cannot happen.
        if (command.action.mode === 'auto' && autoMode !== true) onEnableAutoMode?.()
        onModeChange(command.action.mode)
        break
      case 'route':
        onOpenRoutePicker()
        break
      case 'stop':
        onCancel()
        break
      case 'swarm':
        onSwarmChange(!swarm)
        break
    }
  }
  const selected = runtimes.find((runtime) => runtime.id === route.runtime)
  // The account's window, from the latest reading (SURFACES-0.22 §3): a
  // sentence in the tooltip always; a dot on the chip only from 80%, when a
  // long run might not finish.
  const usageReading = usageWindows?.get(route.runtime)
  const usagePercentNow = usageReading === undefined ? undefined : usagePercent(usageReading)
  const usageSentence = usageReading === undefined
    ? undefined
    : usagePercentNow !== undefined && usagePercentNow >= 100
      ? `${usageWindowSentence(usageReading)}. This window's limit is used up.`
      : usagePercentNow !== undefined && usagePercentNow >= 80
        ? `${usageWindowSentence(usageReading)}. Long runs may be cut short.`
        : usageWindowSentence(usageReading)
  const usagePressing = usagePercentNow !== undefined && usagePercentNow >= 80
  const selectedReady = selected !== undefined && runtimeIsUsable(selected)
  // A runtime that could run this message even though the route does not
  // point at it. Only consulted when the selected one cannot.
  const readyElsewhere = selectedReady
    ? undefined
    : runtimes.find(
        (runtime) => runtimeIsUsable(runtime) && isMissionRuntime(runtime.id) && hostCanRunMission(runtime.id)
      )
  // A runtime can own a mission once the host can read its events. Readiness
  // still comes from discovery, so a route that is installed but signed out
  // cannot be started.
  const routeCanRun = hostCanRunMission(route.runtime)
  const canStart = selectedReady && routeCanRun && busyWith === undefined && value.trim().length > 0
  // While a mission works, what you type is not lost and not sent into a run
  // that cannot hear it: it waits and goes as the next turn when this one
  // finishes. Before 0.20.0 the box was simply disabled, so the only way to
  // say the next thing was to stop the work first.
  //
  // Keyed on the RUN being live, not on a teammate being busy: a mission
  // that belongs to nobody -- which is every mission until someone makes a
  // teammate -- has no busy teammate, and the first version of this could
  // not be used at all on a fresh profile (steering smoke, 2026-09-05).
  const workingNow = running || busyWith !== undefined
  const canQueue = workingNow && queued === undefined && value.trim().length > 0
  const workingName = busyWith ?? 'this mission'

  const placeholder = workingNow
    ? queued === undefined
      ? `Say what is next — it goes to ${workingName} when this finishes…`
      : `Waiting to send when ${workingName} finishes…`
    : !routeCanRun
      ? `The ${selected?.displayName ?? 'selected'} adapter is not finished — switch the route to run a mission…`
      : selectedReady
        ? // Just the invitation. Three of these used to restate the
          // permission mode -- "it may edit files in this workspace" -- which
          // the mode control says in two words directly underneath, so the
          // box was the second voice saying the same thing (Colin,
          // 2026-09-05). Every OTHER line here survives, because each says
          // something no other part of the screen does.
          teammateName === undefined
          ? 'Write a message…'
          : `Message ${teammateName}…`
        : discoveryPhase === 'loading'
          ? 'Checking local runtimes…'
          : discoveryPhase === 'error'
            ? 'Runtime discovery is unavailable…'
            : // Something on this machine CAN run; it just is not the route
              // this box is pointing at. Telling the person to install a
              // coding agent when they have just installed one -- and been
              // told by Settings to -- is the wall the whole first run hits
              // (QA, 2026-09-06, reproduced live). The route normally moves
              // itself; this covers the case where the person has chosen one
              // deliberately and it has since stopped being usable.
              readyElsewhere !== undefined
              ? `${readyElsewhere.displayName} is ready — switch the route to it…`
              : 'Install a coding agent and sign in to start a mission…'

  const submit = (submitEvent: FormEvent<HTMLFormElement>): void => {
    submitEvent.preventDefault()
    const prompt = value.trim()
    if (prompt.length === 0) return
    if (canQueue) {
      onQueue(prompt)
      setValue('')
      return
    }
    if (!canStart) {
      // Silence here is the single worst thing this box can do: the person
      // types, presses Enter, and the app neither sends nor explains. It cost
      // the whole first run in the QA pass. Every refusal now names itself.
      setRefusal(
        !routeCanRun
          ? `The ${selected?.displayName ?? 'selected'} adapter is not finished, so a mission cannot start on it. Switch the route.`
          : readyElsewhere !== undefined
            ? `This message would go to ${selected?.displayName ?? 'the selected runtime'}, which is not ready. ${readyElsewhere.displayName} is — switch the route to it.`
            : 'No runtime on this machine can run a mission yet. Settings lists what to install.'
      )
      return
    }
    setRefusal(undefined)
    // Cleared NOW, not when the host answers. The turn is already on screen as
    // a bubble the instant it is sent, so waiting for the round trip left the
    // same sentence in two places for the whole "Starting..." window and read
    // as lag (Colin, 2026-09-05, screenshot). If the send never happened at
    // all, the words come straight back rather than being lost.
    setValue('')
    const sending = attached
    setAttached([])
    void onStart(withAttachments(prompt, sending)).then((started) => {
      if (!started) {
        setValue(prompt)
        setAttached(sending)
      }
    })
  }

  const keyDown = (keyEvent: KeyboardEvent<HTMLTextAreaElement>): void => {
    // While the slash menu is open the arrows and Enter belong to it. Enter
    // must NOT fall through to submit: sending "/plan" as a message to a
    // teammate is the one outcome this feature exists to prevent.
    if (slashChoices.length > 0) {
      if (keyEvent.key === 'ArrowDown') {
        keyEvent.preventDefault()
        setSlashAt((at) => (at + 1) % slashChoices.length)
        return
      }
      if (keyEvent.key === 'ArrowUp') {
        keyEvent.preventDefault()
        setSlashAt((at) => (at - 1 + slashChoices.length) % slashChoices.length)
        return
      }
      if (keyEvent.key === 'Enter' && !keyEvent.shiftKey) {
        keyEvent.preventDefault()
        const chosen = slashChoices[Math.min(slashAt, slashChoices.length - 1)]
        if (chosen !== undefined) runSlash(chosen)
        return
      }
      if (keyEvent.key === 'Escape') {
        keyEvent.preventDefault()
        setValue('')
        return
      }
    }
    if (keyEvent.key === 'Enter' && !keyEvent.shiftKey) {
      keyEvent.preventDefault()
      keyEvent.currentTarget.form?.requestSubmit()
    }
  }

  // Effort is offered ONLY where the chosen model says it is supported. The
  // design's rule is that an unsupported effort must show as unsupported
  // rather than be sent as a silent no-op.

  // While a mission runs, the control states what IT is on. Otherwise it
  // states what the next mission will use -- which is what the person just
  // picked. Reading the live run's model when nothing is running left a
  // finished mission's `account-default` on screen over a chosen model.
  const shownRuntime = running ? activeRoute?.runtime ?? route.runtime : route.runtime
  const shownModel = running ? activeRoute?.model ?? route.model : route.model
  // Keyed to the route the chip is SHOWING, which while a mission runs is the
  // live one rather than the next one. It used to read the next route's
  // levels under the live route's name -- two models on one chip. The control
  // is disabled during a run, so this is display only and has to agree with
  // the label beside it; when nothing is running the two are the same route.
  // Through `modelFamily`, not a bare id match: once a run resolves a Cursor
  // route to a variant, an id match finds no family and the chip vanishes.
  const supportedEfforts = modelFamily(models, shownRuntime, shownModel)?.supportedEfforts ?? []
  // Swarm means "this model's maximum", and the catalog orders efforts lowest
  // to highest, so the maximum is the last one THIS model reported -- not a
  // fixed name that some models do not have.
  const swarmEffort = supportedEfforts[supportedEfforts.length - 1]
  // What the chip states. Swarm overrides it, and otherwise an unchosen
  // level shows the model's default rather than nothing -- the same value
  // App.tsx sets on a route change, so the chip says what the run gets.
  const shownEffort = swarm ? swarmEffort : effort ?? defaultEffort(supportedEfforts)
  // The scale this model actually offers, and where the current level sits on
  // it. Four stops and a switch rather than eight rows; see `effortScale.ts`.
  const { bases: effortBases, hasFast: effortHasFast } = effortScale(supportedEfforts)
  const { base: effortBase, fast: effortIsFast } = splitEffort(shownEffort ?? effortBases[0] ?? '')
  const effortIndex = Math.max(0, effortBases.indexOf(effortBase))
  const shownRuntimeStatus = runtimes.find((runtime) => runtime.id === shownRuntime)
  const runtimeLabel = shownRuntimeStatus?.displayName ?? runtimeDisplayName(shownRuntime)
  // A family known only through its effort variants is listed under its
  // family name; showing the stand-in variant's id ("cursor-grok-4.6-high-fast")
  // beside "effort · low" read as two different answers (2026-09-06).
  const shownEntry = models.find((model) => model.runtime === shownRuntime && model.id === shownModel)
  const modelLabel =
    shownEntry?.variants !== undefined ? shownEntry.displayName : modelLabelFor(shownRuntime, shownModel)
  // What the RUNNING mission is actually on, which is not always what the
  // composer's next-run route says. A handoff has to be measured against the
  // live run, or picking "the same" route would still stop it.
  const handoff = handoffAvailability(running, activeRoute !== undefined, handingOff)
  const activeChoice: RouteChoice =
    activeRoute === undefined
      ? route
      : { runtime: activeRoute.runtime, model: activeRoute.model }

  return (
    <div className="lc-composer">
      <div className="lc-composer__inner">
        {error !== undefined && (
          <div className="lc-notice" role="status" aria-live="polite">
            <Icon name="shield" size={13} />
            {error}
          </div>
        )}
        {/*
          * Why the last Enter did nothing. Same surface as the host's own
          * errors: one place the box speaks, rather than a second voice.
          */}
        {refusal !== undefined && (
          <div className="lc-notice" role="status" aria-live="polite">
            <Icon name="shield" size={13} />
            {refusal}
          </div>
        )}
        {queued !== undefined && (
          <div className="lc-queued" role="status" aria-live="polite">
            <span className="lc-queued__label lc-mono">NEXT</span>
            <span className="lc-queued__text">{queued}</span>
            <span className="lc-queued__actions">
              {!workingNow && (
                <button type="button" className="lc-ghostbutton" onClick={onSendQueued}>
                  {/* It always goes into the conversation ON SCREEN, so where
                      that is not the one it was typed at, the button says so
                      rather than reading as "send it where it was going". */}
                  {queuedElsewhere ? 'Send here' : 'Send now'}
                </button>
              )}
              {/*
                * Fixing one word meant discarding the sentence and retyping
                * it from memory: while a message is queued the box is
                * disabled, so Discard was the only way back to the text
                * (design pass, gap 2). Edit is those same two operations in
                * the order people want them.
                */}
              <button
                type="button"
                className="lc-ghostbutton"
                onClick={() => {
                  setValue(queued)
                  onUnqueue()
                }}
              >
                Edit
              </button>
              <button type="button" className="lc-ghostbutton" onClick={onUnqueue} aria-label="Discard the queued message">
                Discard
              </button>
            </span>
            {/*
              * The reason, or what will happen -- never a description of the
              * button. "ready to send" was the one state a person could not
              * act on intelligently (design pass, objection 1), and it is now
              * unreachable: a queue that is ready has already gone.
              */}
            <span className="lc-queued__note lc-mono">
              {queuedNote ?? `sends when ${workingName} finishes`}
            </span>
          </div>
        )}
        {continuationNote !== undefined && (
          <div className="lc-continuation lc-mono" role="status">
            <Icon name="route" size={12} />
            <span>{continuationNote}</span>
          </div>
        )}
        {/*
          * The command menu, above the box, reading what is being typed.
          *
          * Every entry maps to a control already on the row below it, so this
          * is a keyboard path to what exists rather than a second way to do
          * something new -- and `availableCommands` drops any command that
          * would be refused, so nothing here can be chosen and then fail.
          */}
        {slashChoices.length > 0 && (
          <div className="lc-slash" role="listbox" aria-label="Commands">
            {slashChoices.map((command, index) => (
              <button
                key={command.name}
                type="button"
                role="option"
                aria-selected={index === Math.min(slashAt, slashChoices.length - 1)}
                className={`lc-slash__item${index === Math.min(slashAt, slashChoices.length - 1) ? ' is-active' : ''}`}
                onMouseEnter={() => setSlashAt(index)}
                onClick={() => runSlash(command)}
              >
                <span className="lc-slash__name lc-mono">/{command.name}</span>
                <span
                  className={`lc-slash__detail${command.action.kind === 'mode' && command.action.mode === 'auto' ? ' lc-tone-amber' : ''}`}
                >
                  {command.detail}
                </span>
              </button>
            ))}
          </div>
        )}
        <form className="command-dock lc-composer__form" onSubmit={submit}>
          <div className="lc-composer__box">
            <textarea
              value={value}
              onChange={(changeEvent) => type(changeEvent.target.value)}
              onKeyDown={keyDown}
              placeholder={placeholder}
              aria-label="Mission instruction"
              rows={1}
              maxLength={MAX_PROMPT_LENGTH}
              disabled={workingNow && queued !== undefined}
            />
            {/*
              * The "Shift+Enter for a new line" hint is GONE, on Colin's word
              * (2026-09-07): "everyone knows that and it takes up half the
              * chat box." It was added the same week because an outside tester
              * lost their opening mission to it -- a two-line prompt whose
              * first Enter submitted the first line -- so do not restore it
              * citing that tester without asking him again.
              *
              * The fact itself is not lost: it is on the send button's title,
              * where it costs no space in the box.
              */}
            {running && !canQueue ? (
              <button
                type="button"
                className="send-button lc-send is-stop"
                onClick={onCancel}
                disabled={cancelling}
                aria-label="Stop the running mission"
              >
                {/* A small rounded square, as drawn -- not a pause icon. */}
                <span className="lc-stopsquare" />
              </button>
            ) : canQueue ? (
              // Typed text turns the control into "queue this", so the stop
              // button is still one click away with an empty box. What the
              // button does is what the placeholder just promised.
              <button
                type="submit"
                className="send-button lc-send is-queue"
                aria-label="Send this when the mission finishes"
                title="Send this when the mission finishes"
              >
                <Icon name="arrow-up" size={15} />
              </button>
            ) : (
              <button
                type="submit"
                className="send-button lc-send"
                disabled={!canStart}
                aria-label="Start mission"
                title="Start mission — Shift+Enter for a new line"
              >
                <Icon name="arrow-up" size={15} />
              </button>
            )}
          </div>
          <div className="lc-composer__controls">
            <div className="lc-composer__group">
              <span className="lc-control__anchor">
                {modeOpen && (
                  <div className="lc-menu" role="menu" aria-label="Permission mode">
                    {MODES.map((option) => {
                      const unavailable = modeUnavailableReason(option.mode, route.runtime, platform)
                      return (
                        <button
                          key={option.mode}
                          type="button"
                          role="menuitemradio"
                          aria-checked={mode === option.mode}
                          className="lc-menu__item"
                          disabled={unavailable !== undefined}
                          title={unavailable}
                          onClick={() => {
                            // Choosing Auto is what turns it on. Settings shows
                            // the same state and takes it back; this is that
                            // decision made where it is needed, rather than a
                            // trip to another screen before the mode works.
                            if (option.mode === 'auto' && autoMode !== true) onEnableAutoMode?.()
                            onModeChange(option.mode)
                            setModeOpen(false)
                          }}
                        >
                          <span className="lc-menu__text">
                            <span className="lc-menu__name">{option.name}</span>
                            <span
                              className={`lc-menu__desc${unavailable === undefined && option.mode === 'auto' ? ' lc-tone-amber' : ''}`}
                            >
                              {unavailable ?? option.consequence}
                            </span>
                          </span>
                          {mode === option.mode && <Icon name="check" size={13} />}
                        </button>
                      )
                    })}
                  </div>
                )}
                {/* The permission mode is the most consequential control on
                  * the bar, and read as a label (design review, 2026-09-05).
                  * Boxed like the route and effort chips, with a chevron. */}
                <button
                  type="button"
                  className="lc-control lc-control--boxed"
                  aria-haspopup="menu"
                  aria-expanded={modeOpen}
                  aria-label="Permission mode"
                  title="Permission mode"
                  disabled={running}
                  onClick={() => setModeOpen(!modeOpen)}
                >
                  <Icon name="shield" size={12} />
                  {MODES.find((option) => option.mode === effectiveMode)?.name ?? 'Ask'}
                  <Icon name="chevron-down" size={11} />
                </button>
              </span>
              {/*
                * Which folder this message runs in. Stated on the bar that
                * says what the message will do, because it is the same kind
                * of fact as the mode and the model -- and because an app
                * launched from the Start menu had no folder at all and no
                * surface said so (Colin, 2026-09-05).
                */}
              <button
                type="button"
                className={`lc-control lc-control--folder${workspacePath === undefined ? ' is-missing' : ''}`}
                disabled={running}
                title={
                  workspacePath === undefined
                    ? 'No folder chosen. Every teammate works inside one project folder.'
                    : workspaceMade
                      ? `Teammates work in ${workspacePath}. Locust made this folder; pick any other to work there instead.`
                      : `Teammates work in ${workspacePath}`
                }
                onClick={onChooseFolder}
              >
                <Icon name="folder" size={13} />
                <span className="lc-control__folder">{workspaceName ?? 'No folder'}</span>
              </button>
              {/*
                * The `+`, back as the real thing.
                *
                * It was removed in the 0906 design review because it was a
                * permanently disabled control titled "not built yet" on the
                * most-visited surface in the app -- "a dead plus costs more
                * than a missing one". It only returns now because attaching
                * actually works: the picker is limited to the workspace and
                * the chosen paths are named in the message, which every
                * runtime can act on (docs/ATTACHMENTS-INTAKE-2026-09-08.md).
                */}
              <button
                type="button"
                className="lc-control lc-control--icon"
                aria-label="Attach files from this workspace"
                title="Attach files from this workspace"
                disabled={running || attaching}
                onClick={() => {
                  const bridge = window.desktop
                  if (bridge === undefined) return
                  setAttaching(true)
                  void bridge
                    .attachFiles()
                    .then((answer) => {
                      if (answer.ok) {
                        // Deduplicated and capped: the same file twice is one
                        // reference, and the cap is what keeps a stray
                        // multi-select out of the prompt budget.
                        setAttached((current) => [...new Set([...current, ...answer.paths])].slice(0, MAX_ATTACHMENTS))
                        setRefusal(undefined)
                      } else if (answer.message.length > 0) {
                        setRefusal(answer.message)
                      }
                    })
                    .catch(() => setRefusal('Those files could not be attached.'))
                    .finally(() => setAttaching(false))
                }}
              >
                <Icon name="plus" size={14} />
              </button>
              {attached.length > 0 && (
                <button
                  type="button"
                  className="lc-control lc-control--boxed lc-attachchip"
                  title={`${attached.join(', ')} — click to remove all`}
                  aria-label={`${attachmentLabel(attached.length)} attached; remove`}
                  onClick={() => setAttached([])}
                >
                  <Icon name="attachment" size={12} />
                  <span className="lc-control__mono">{attachmentLabel(attached.length)}</span>
                  <Icon name="close" size={11} />
                </button>
              )}
            </div>
            <div className="lc-composer__group">
              <span className="lc-control__anchor">
                {pickerOpen && (
                  <RoutePicker
                    runtimes={runtimes}
                    limitedRuntimes={limitedRuntimes}
                    models={models}
                    resolvedModels={resolvedModels}
                    recentRoutes={recentRoutes}
                    active={running ? activeChoice : route}
                    onSelect={(choice) => {
                      setPickerOpen(false)
                      if (handoff !== 'available') {
                        onRouteChange(choice)
                        return
                      }
                      // Picking the route the run is already on would stop it
                      // and buy nothing, so it is not an action here.
                      if (choice.runtime === activeChoice.runtime) return
                      onHandOff(choice)
                    }}
                    onClose={() => setPickerOpen(false)}
                    {...(handoff === 'available'
                      ? {
                          notice:
                            'This mission is running. Choosing another runtime stops it, writes a checkpoint, and hands the work over — it cannot be undone.'
                        }
                      : {})}
                  />
                )}
                {/*
                  A running mission CAN change route now: the host stops it,
                  reconciles it, and briefs a continuation. Only an in-flight
                  handoff locks this control, because a second switch would
                  race the first.
                */}
                <button
                  type="button"
                  className={`lc-control lc-control--boxed${usagePressing ? ' is-pressing' : ''}`}
                  title={[`${runtimeLabel} / ${modelLabel}`, handoffTitle(handoff), usageSentence]
                    .filter((part) => part !== undefined && part.length > 0)
                    .join('\n')}
                  onClick={() => {
                    onOpenRoutePicker()
                    setPickerOpen(!pickerOpen)
                  }}
                  disabled={handoff === 'starting' || handoff === 'switching'}
                  aria-haspopup="listbox"
                  aria-expanded={pickerOpen}
                >
                  <span className={`lc-dot ${selectedReady ? 'lc-tone-lime' : 'lc-tone-muted'}`} />
                  {runtimeLabel}
                  <span className="lc-separator">/</span>
                  <span className="lc-control__mono lc-control__model">{modelLabel}</span>
                  {/*
                    * The chevron the mode chip beside it has, and that the
                    * reference draws on this one too: `Codex CLI / gpt-5.6 ·
                    * high ⌄`. Without it nothing said the chip opens
                    * anything, and effort now lives behind it -- so a person
                    * looking for effort had no reason to press here. Colin,
                    * on the reference: "allows the user to see effort and
                    * still has dropdown for it."
                    */}
                  <Icon name="chevron-down" size={11} />
                </button>
              </span>
              {/*
                * Effort, as its own control again.
                *
                * The design review folded it onto the route chip; that made
                * it invisible until chosen and it vanished entirely whenever
                * a model was picked, because choosing a model cleared it.
                * Colin, 2026-09-07: "just go back to effort being separate,
                * completely remove it from the model page". So: a chip that
                * always states a real level, beside the model it belongs to,
                * reading `gpt-5.6` `medium` the way the reference image does.
                *
                * Absent only when the model reports no levels -- there is
                * nothing to choose then, and a control that says so would be
                * the dead chip this replaced.
                */}
              {/*
                * A model with no levels never draws the pickable chip, even if
                * an effort is still set from a previous route. It used to draw
                * one showing that stale level with an empty menu behind it, so
                * there was no way to clear it -- Colin, 2026-09-08: "it has an
                * effort set and wont let me switch out of it". `startRoute`
                * refuses to send it either way; this stops the app offering a
                * choice that does not exist.
                */}
              {shownEffort !== undefined && supportedEfforts.length > 0 && (
                <span className="lc-control__anchor">
                  {effortOpen && (
                    /*
                      * A SLIDER and a switch, not a list.
                      *
                      * Cursor lists eight levels and a menu of eight rows ran
                      * off the window (Colin, 2026-09-08, with a screenshot).
                      * His fix, and the right one: "you could just use claudes
                      * since you already have access to it, and then if there
                      * is a fast option just have a toggle for it." Those eight
                      * are not eight things -- they are four, each with a
                      * faster variant. The stops are whatever THIS model
                      * listed, in the order it listed them, so right is more.
                      */
                    <div className="lc-menu lc-menu--right lc-effortpanel" role="group" aria-label="Reasoning effort">
                      <div className="lc-effortpanel__head">
                        <span className="lc-fieldlabel lc-mono">Effort</span>
                        <span className="lc-effortpanel__now lc-control__mono">{effortBase}</span>
                      </div>
                      {/*
                        * The stops are DRAWN, one dot per level, so the scale
                        * shows how many choices there are and which one this
                        * is without dragging it (Colin, 2026-09-08: "where you
                        * can see the notches brother"). The dots sit behind a
                        * real range input, which keeps the keyboard and screen
                        * reader behaviour a hand-built track would lose.
                        */}
                      <span className="lc-effortpanel__scale">
                        <span className="lc-effortpanel__notches" aria-hidden="true">
                          {effortBases.map((base, index) => (
                            <span
                              key={base}
                              className={`lc-effortpanel__notch${index <= effortIndex ? ' is-passed' : ''}`}
                            />
                          ))}
                        </span>
                      <input
                        className="lc-effortpanel__slider"
                        type="range"
                        min={0}
                        max={Math.max(0, effortBases.length - 1)}
                        step={1}
                        value={effortIndex}
                        aria-label="Reasoning effort"
                        aria-valuetext={effortBase}
                        disabled={effortBases.length < 2}
                        onChange={(event) => {
                          const next = effortBases[Number(event.currentTarget.value)]
                          if (next === undefined) return
                          const level = joinEffort(next, effortIsFast, supportedEfforts)
                          if (level !== undefined) onEffortChange(level)
                        }}
                      />
                      </span>
                      <div className="lc-effortpanel__ends lc-mono">
                        <span>Faster</span>
                        <span>Smarter</span>
                      </div>
                      {effortDescription(effortBase) !== undefined && (
                        <p className="lc-effortpanel__what">{effortDescription(effortBase)}</p>
                      )}
                      {effortHasFast && (
                        <button
                          type="button"
                          role="switch"
                          aria-checked={effortIsFast}
                          className={`lc-effortpanel__fast${effortIsFast ? ' is-on' : ''}`}
                          onClick={() => {
                            const level = joinEffort(effortBase, !effortIsFast, supportedEfforts)
                            if (level !== undefined) onEffortChange(level)
                          }}
                        >
                          <span>Fast variant</span>
                          {/* A switch track, not a filled button: Colin,
                              2026-09-08, "just make the fast variant a simple
                              toggle bar, doesnt need to be so big". */}
                          <span className="lc-switch" aria-hidden="true">
                            <span className="lc-switch__knob" />
                          </span>
                        </button>
                      )}
                      {effortFooter(route.runtime) !== undefined && (
                        <p className="lc-menu__foot">{effortFooter(route.runtime)}</p>
                      )}
                    </div>
                  )}
                  <button
                    type="button"
                    className="lc-control lc-control--boxed"
                    aria-haspopup="menu"
                    aria-expanded={effortOpen}
                    aria-label="Reasoning effort"
                    title={
                      swarm
                        ? `Swarm is holding this at ${swarmEffort ?? 'the model maximum'}`
                        : 'How hard the model thinks'
                    }
                    disabled={running || swarm}
                    onClick={() => setEffortOpen(!effortOpen)}
                  >
                    <span className="lc-control__mono lc-control__effort">{shownEffort}</span>
                    <Icon name="chevron-down" size={11} />
                  </button>
                </span>
              )}
              {/*
                * A model with no levels to choose says so, rather than leaving
                * a gap where the chip was. Taken from Colin's reference image
                * (2026-09-07), which reads `effort - fixed`.
                *
                * Not a disabled control: there is nothing here to press, so it
                * is a label. A DISABLED chip would be the dead plus this
                * composer already removed once -- something that looks like it
                * should work and never does. This one just states a fact about
                * the runtime, which is the same fact the route chip beside it
                * is there to give.
                */}
              {supportedEfforts.length === 0 && (
                <span
                  className="lc-control lc-control--boxed is-static"
                  title="This runtime does not let the effort be chosen; it uses its own."
                >
                  <span className="lc-control__mono lc-control__effort">effort · fixed</span>
                </span>
              )}
              {/*
                * The swarm mark, back on the composer.
                *
                * The design review moved it into the picker's header, and
                * Colin put it back (2026-09-07): "still leave the swarm button
                * though, its a good indicator and a fun part of the build...
                * it just looks cool, its our logo, and feels like something
                * the user should know is on." The review itself called the
                * mark "the best small thing in the app", so as an
                * always-visible state indicator it earns the slot the effort
                * chip vacated.
                *
                * Unlike that chip it is never dead: it stays pressable
                * whatever the route reports, because swarm is a statement
                * about every mission rather than about this one.
                */}
              <button
                type="button"
                className={`lc-swarm${swarm ? ' is-on' : ''}`}
                aria-pressed={swarm}
                aria-label="Swarm mode"
                disabled={running}
                title={
                  swarm
                    ? swarmEffort === undefined
                      ? 'Swarm on — every mission runs at its model maximum'
                      : `Swarm on — every mission runs at ${swarmEffort}`
                    : 'Swarm: run every mission at its model maximum'
                }
                onClick={() => onSwarmChange(!swarm)}
              >
                <img src={mark} alt="" aria-hidden="true" />
              </button>
              {context !== undefined && <ContextRing reading={context} />}
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
