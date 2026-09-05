import { useState } from 'react'
import type { FormEvent, KeyboardEvent, ReactElement } from 'react'

import type {
  MissionMode,
  MissionRouteSummary,
  PublicModel,
  PublicRuntimeStatus
} from '../../../shared/ipc.js'
import { hostCanRunMission, runtimeDisplayName } from '../../../shared/runtimes.js'
import {
  handoffAvailability,
  handoffTitle,
  modeRunsOn,
  modesFor,
  modeUnavailableReason,
  runtimeIsUsable
} from '../status.js'
import mark from '../assets/locust-mark.svg'
import { Icon } from './Icon.js'
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
    mode: 'approve-each',
    name: 'Approve each action',
    consequence: 'Stops and asks before every command or file change.'
  }
]

export interface ComposerProps {
  readonly runtimes: readonly PublicRuntimeStatus[]
  /** Runtimes whose last run ended on the account's usage limit, with its own words. */
  readonly limitedRuntimes: ReadonlyMap<string, string>
  readonly discoveryPhase: 'loading' | 'ready' | 'error'
  readonly running: boolean
  readonly cancelling: boolean
  readonly activeRoute: MissionRouteSummary | undefined
  readonly error: string | undefined
  readonly mode: MissionMode
  readonly onModeChange: (mode: MissionMode) => void
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
  /** Who the next mission is messaged to; the placeholder says so. */
  readonly teammateName: string | undefined
  /**
   * Set when the addressed teammate already has a live mission somewhere.
   * Starting is refused for THEM, not for the workspace: another teammate's
   * run being on screen does not block this one.
   */
  readonly busyWith: string | undefined
  /** What is waiting to be sent when the running mission finishes, if anything. */
  readonly queued: string | undefined
  /** Why a queued message has not gone yet, when it is not simply still running. */
  readonly queuedNote: string | undefined
  readonly onQueue: (text: string) => void
  readonly onUnqueue: () => void
  readonly onSendQueued: () => void
  /** The queued message belongs to a conversation that is NOT the one on screen. */
  readonly queuedElsewhere: boolean
  /** Plan first: the run answers with the steps it would take and changes nothing. */
  readonly planFirst: boolean
  readonly onPlanFirstChange: (planFirst: boolean) => void
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
  runtimes,
  limitedRuntimes,
  discoveryPhase,
  running,
  cancelling,
  activeRoute,
  error,
  mode,
  onModeChange,
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
  queuedElsewhere,
  planFirst,
  onPlanFirstChange
}: ComposerProps): ReactElement {
  const [value, setValue] = useState('')
  const [modeOpen, setModeOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [effortOpen, setEffortOpen] = useState(false)

  // A mode the chosen route cannot run is not the mode a mission would start
  // in, so it is not the mode the control shows either. Switching route used
  // to leave "Approve each action" selected against a runtime that refuses
  // it, and every message was then rejected before it began.
  const effectiveMode: MissionMode = modeRunsOn(mode, route.runtime, platform)
    ? mode
    : modesFor(route.runtime, platform)[0] ?? 'accept-edits'
  const selected = runtimes.find((runtime) => runtime.id === route.runtime)
  const selectedReady = selected !== undefined && runtimeIsUsable(selected)
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
        ? mode === 'approve-each' && route.runtime === 'codex'
          ? 'Describe a mission. You will be asked before each action…'
          : mode === 'accept-edits'
          ? 'Describe a mission. It may edit files in this workspace…'
          : // Claude Code used to be read-only whatever the mode said, and
            // this line said so. It can edit now, so the mode -- not the
            // runtime -- decides what the box promises.
            route.runtime === 'claude'
            ? 'Describe a mission. Claude Code will read, not write, in this mode…'
            : teammateName !== undefined
              ? `Message ${teammateName}, or describe a mission…`
              : 'Describe a mission for this workspace…'
        : discoveryPhase === 'loading'
          ? 'Checking local runtimes…'
          : discoveryPhase === 'error'
            ? 'Runtime discovery is unavailable…'
            : 'Sign in to a local runtime to start a mission…'

  const submit = (submitEvent: FormEvent<HTMLFormElement>): void => {
    submitEvent.preventDefault()
    const prompt = value.trim()
    if (prompt.length === 0) return
    if (canQueue) {
      onQueue(prompt)
      setValue('')
      return
    }
    if (!canStart) return
    void onStart(prompt).then((started) => {
      if (started) setValue('')
    })
  }

  const keyDown = (keyEvent: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (keyEvent.key === 'Enter' && !keyEvent.shiftKey) {
      keyEvent.preventDefault()
      keyEvent.currentTarget.form?.requestSubmit()
    }
  }

  // Effort is offered ONLY where the chosen model says it is supported. The
  // design's rule is that an unsupported effort must show as unsupported
  // rather than be sent as a silent no-op.
  const supportedEfforts =
    models.find((model) => model.runtime === route.runtime && model.id === route.model)?.supportedEfforts ?? []
  // Swarm means "this model's maximum", and the catalog orders efforts lowest
  // to highest, so the maximum is the last one THIS model reported -- not a
  // fixed name that some models do not have.
  const swarmEffort = supportedEfforts[supportedEfforts.length - 1]
  const effectiveEffort = swarm ? swarmEffort : effort

  // While a mission runs, the control states what IT is on. Otherwise it
  // states what the next mission will use -- which is what the person just
  // picked. Reading the live run's model when nothing is running left a
  // finished mission's `account-default` on screen over a chosen model.
  const shownRuntime = running ? activeRoute?.runtime ?? route.runtime : route.runtime
  const shownModel = running ? activeRoute?.model ?? route.model : route.model
  const shownRuntimeStatus = runtimes.find((runtime) => runtime.id === shownRuntime)
  const runtimeLabel = shownRuntimeStatus?.displayName ?? runtimeDisplayName(shownRuntime)
  const modelLabel = shownModel
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
        {queued !== undefined && (
          <div className="lc-queued" role="status" aria-live="polite">
            <span className="lc-queued__label lc-mono">NEXT</span>
            <span className="lc-queued__text">{queued}</span>
            <span className="lc-queued__note lc-mono">
              {queuedNote ?? (workingNow ? 'sends when this finishes' : 'ready to send')}
            </span>
            {!workingNow && (
              <button type="button" className="lc-ghostbutton" onClick={onSendQueued}>
                {/* It always goes into the conversation ON SCREEN, so where
                    that is not the one it was typed at, the button says so
                    rather than reading as "send it where it was going". */}
                {queuedElsewhere ? 'Send here' : 'Send now'}
              </button>
            )}
            <button type="button" className="lc-ghostbutton" onClick={onUnqueue} aria-label="Discard the queued message">
              Discard
            </button>
          </div>
        )}
        <form className="command-dock lc-composer__form" onSubmit={submit}>
          <div className="lc-composer__box">
            <textarea
              value={value}
              onChange={(changeEvent) => setValue(changeEvent.target.value)}
              onKeyDown={keyDown}
              placeholder={placeholder}
              aria-label="Mission instruction"
              rows={1}
              maxLength={MAX_PROMPT_LENGTH}
              disabled={workingNow && queued !== undefined}
            />
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
                            onModeChange(option.mode)
                            setModeOpen(false)
                          }}
                        >
                          <span className="lc-menu__text">
                            <span className="lc-menu__name">{option.name}</span>
                            <span className="lc-menu__desc">{unavailable ?? option.consequence}</span>
                          </span>
                          {mode === option.mode && <Icon name="check" size={13} />}
                        </button>
                      )
                    })}
                  </div>
                )}
                <button
                  type="button"
                  className="lc-control"
                  aria-haspopup="menu"
                  aria-expanded={modeOpen}
                  disabled={running}
                  onClick={() => setModeOpen(!modeOpen)}
                >
                  {MODES.find((option) => option.mode === effectiveMode)?.name ?? 'Ask'}
                </button>
              </span>
              {/*
                * Plan first. Offered only where the sandbox already refuses
                * writes, because a plan that could edit the workspace is a
                * promise the app cannot keep -- so in Accept edits the
                * control says why rather than sitting there doing nothing.
                */}
              <button
                type="button"
                className={`lc-control lc-plan${planFirst && effectiveMode !== 'accept-edits' ? ' is-on' : ''}`}
                aria-pressed={planFirst && effectiveMode !== 'accept-edits'}
                disabled={running || effectiveMode === 'accept-edits'}
                title={
                  effectiveMode !== 'accept-edits'
                    ? 'Answer with the steps it would take, and change nothing'
                    : // "Switch to Ask" is bad advice where Ask cannot be
                      // chosen at all. On Cursor for Windows the sandbox
                      // that would hold a run read-only does not exist, so
                      // the honest line is the runtime's own reason
                      // (steering smoke, 2026-09-05).
                      (modeUnavailableReason('ask', route.runtime, platform)
                        ?? 'Plan first needs a mode that changes nothing — switch to Ask')
                }
                onClick={() => onPlanFirstChange(!planFirst)}
              >
                Plan first
              </button>
              <button type="button" className="lc-control" disabled title="Attachments and slash commands are not built yet">
                <Icon name="plus" size={14} />
              </button>
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
                  className="lc-control"
                  title={handoffTitle(handoff)}
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
                  <span className="lc-control__mono">{modelLabel}</span>
                </button>
              </span>
              <span className="lc-control__anchor">
                {effortOpen && supportedEfforts.length > 0 && (
                  <div className="lc-menu lc-menu--right" role="menu" aria-label="Reasoning effort">
                    {supportedEfforts.map((option) => (
                      <button
                        key={option}
                        type="button"
                        role="menuitemradio"
                        aria-checked={effort === option}
                        className="lc-menu__item"
                        onClick={() => {
                          onEffortChange(option)
                          setEffortOpen(false)
                        }}
                      >
                        <span className="lc-menu__text">
                          <span className="lc-menu__name">{option}</span>
                        </span>
                        {effort === option && <Icon name="check" size={13} />}
                      </button>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  className="lc-control"
                  aria-haspopup="menu"
                  aria-expanded={effortOpen}
                  disabled={running || supportedEfforts.length === 0 || swarm}
                  title={
                    supportedEfforts.length === 0
                      ? 'This route does not report reasoning effort, so none is sent.'
                      : swarm
                        ? 'Swarm mode is holding this at the model maximum.'
                        : 'Reasoning effort'
                  }
                  onClick={() => setEffortOpen(!effortOpen)}
                >
                  <span className="lc-control__mono">
                    {supportedEfforts.length === 0 ? 'no effort' : (effectiveEffort ?? 'default')}
                  </span>
                </button>
              </span>
              <button
                type="button"
                className={`lc-swarm${swarm ? ' is-on' : ''}`}
                aria-pressed={swarm}
                aria-label="Swarm mode"
                disabled={running || swarmEffort === undefined}
                title={
                  swarmEffort === undefined
                    ? 'Swarm needs a model that reports effort levels.'
                    : swarm
                      ? `Swarm on — every mission runs at ${swarmEffort}`
                      : 'Swarm: run every mission at its model maximum'
                }
                onClick={() => onSwarmChange(!swarm)}
              >
                <img src={mark} alt="" aria-hidden="true" />
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
