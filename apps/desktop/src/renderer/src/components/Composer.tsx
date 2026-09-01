import { useState } from 'react'
import type { FormEvent, KeyboardEvent, ReactElement } from 'react'

import type {
  MissionMode,
  MissionRouteSummary,
  PublicModel,
  PublicRuntimeStatus
} from '../../../shared/ipc.js'
import { runtimeIsUsable } from '../status.js'
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
  readonly effort: string | undefined
  readonly onEffortChange: (effort: string | undefined) => void
  readonly onStart: (prompt: string) => Promise<boolean>
  readonly onCancel: () => void
  readonly onOpenRoutePicker: () => void
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
  effort,
  onEffortChange,
  onStart,
  onCancel,
  onOpenRoutePicker
}: ComposerProps): ReactElement {
  const [value, setValue] = useState('')
  const [modeOpen, setModeOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [effortOpen, setEffortOpen] = useState(false)

  const selected = runtimes.find((runtime) => runtime.id === route.runtime)
  const selectedReady = selected !== undefined && runtimeIsUsable(selected)
  // Both runtimes can own a mission now. Readiness still comes from discovery,
  // so a route that is installed but signed out cannot be started.
  const routeCanRun = route.runtime === 'codex' || route.runtime === 'claude'
  const canStart = selectedReady && routeCanRun && !running && value.trim().length > 0

  const placeholder = running
    ? 'A mission is running — stop it before starting another…'
    : !routeCanRun
      ? `The ${selected?.displayName ?? 'selected'} adapter is not finished — switch the route to run a mission…`
      : selectedReady
        ? mode === 'approve-each' && route.runtime === 'codex'
          ? 'Describe a mission. You will be asked before each action…'
          : mode === 'accept-edits' && route.runtime === 'codex'
          ? 'Describe a mission. It may edit files in this workspace…'
          : route.runtime === 'claude'
            ? 'Describe a mission. Claude Code runs read-only for now…'
            : 'Describe a mission for this workspace…'
        : discoveryPhase === 'loading'
          ? 'Checking local runtimes…'
          : discoveryPhase === 'error'
            ? 'Runtime discovery is unavailable…'
            : 'Sign in to a local runtime to start a mission…'

  const submit = (submitEvent: FormEvent<HTMLFormElement>): void => {
    submitEvent.preventDefault()
    const prompt = value.trim()
    if (!canStart || prompt.length === 0) return
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
  const supportedEfforts = models.find((model) => model.id === route.model)?.supportedEfforts ?? []

  const runtimeLabel = selected?.displayName ?? (route.runtime === 'claude' ? 'Claude Code' : 'Codex CLI')
  const modelLabel = activeRoute?.model ?? route.model

  return (
    <div className="lc-composer">
      <div className="lc-composer__inner">
        {error !== undefined && (
          <div className="lc-notice" role="status" aria-live="polite">
            <Icon name="shield" size={13} />
            {error}
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
              disabled={running}
            />
            {running ? (
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
                    {MODES.map((option) => (
                      <button
                        key={option.mode}
                        type="button"
                        role="menuitemradio"
                        aria-checked={mode === option.mode}
                        className="lc-menu__item"
                        onClick={() => {
                          onModeChange(option.mode)
                          setModeOpen(false)
                        }}
                      >
                        <span className="lc-menu__text">
                          <span className="lc-menu__name">{option.name}</span>
                          <span className="lc-menu__desc">{option.consequence}</span>
                        </span>
                        {mode === option.mode && <Icon name="check" size={13} />}
                      </button>
                    ))}
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
                  {MODES.find((option) => option.mode === mode)?.name ?? 'Ask'}
                </button>
              </span>
              <button type="button" className="lc-control" disabled title="Attachments and slash commands are not built yet">
                <Icon name="plus" size={14} />
              </button>
            </div>
            <div className="lc-composer__group">
              <span className="lc-control__anchor">
                {pickerOpen && (
                  <RoutePicker
                    runtimes={runtimes}
                    models={models}
                    active={route}
                    onSelect={onRouteChange}
                    onClose={() => setPickerOpen(false)}
                  />
                )}
                <button
                  type="button"
                  className="lc-control"
                  onClick={() => {
                    onOpenRoutePicker()
                    setPickerOpen(!pickerOpen)
                  }}
                  disabled={running}
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
                  disabled={running || supportedEfforts.length === 0}
                  title={
                    supportedEfforts.length === 0
                      ? 'This route does not report reasoning effort, so none is sent.'
                      : 'Reasoning effort'
                  }
                  onClick={() => setEffortOpen(!effortOpen)}
                >
                  <span className="lc-control__mono">
                    {supportedEfforts.length === 0 ? 'no effort' : (effort ?? 'default')}
                  </span>
                </button>
              </span>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
