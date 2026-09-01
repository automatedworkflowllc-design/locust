import { useState } from 'react'
import type { FormEvent, KeyboardEvent, ReactElement } from 'react'

import type { MissionMode, MissionRouteSummary, PublicRuntimeStatus } from '../../../shared/ipc.js'
import { runtimeIsUsable } from '../status.js'
import { Icon } from './Icon.js'

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
  onStart,
  onCancel,
  onOpenRoutePicker
}: ComposerProps): ReactElement {
  const [value, setValue] = useState('')
  const [modeOpen, setModeOpen] = useState(false)

  const codex = runtimes.find((runtime) => runtime.id === 'codex')
  const codexReady = codex !== undefined && runtimeIsUsable(codex)
  const canStart = codexReady && !running && value.trim().length > 0

  const placeholder = running
    ? 'A mission is running — stop it before starting another…'
    : codexReady
      ? 'Describe a mission for this workspace…'
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

  const runtimeLabel = activeRoute?.runtime === 'claude' ? 'Claude Code' : 'Codex CLI'
  const modelLabel = activeRoute?.model ?? (codex?.version === null ? 'account default' : 'account default')

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
              <button
                type="button"
                className="lc-control"
                onClick={onOpenRoutePicker}
                disabled={running}
                aria-haspopup="listbox"
              >
                <span className={`lc-dot ${codexReady ? 'lc-tone-lime' : 'lc-tone-muted'}`} />
                {runtimeLabel}
                <span className="lc-separator">/</span>
                <span className="lc-control__mono">{modelLabel}</span>
              </button>
              <button
                type="button"
                className="lc-control"
                disabled
                title="Effort routing arrives with the route layer, once a route reports whether it honors effort"
              >
                Balanced
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
