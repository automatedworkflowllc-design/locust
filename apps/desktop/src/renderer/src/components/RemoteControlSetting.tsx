import { useEffect, useState } from 'react'
import { REMOTE_CONTROL_LABEL, type RemoteControlState } from '../../../shared/claude-remote-control.js'

export function RemoteControlSetting() {
  const [state, setState] = useState<RemoteControlState>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  useEffect(() => {
    let alive = true
    let asking = false
    const read = async () => {
      if (asking) return
      asking = true
      try { const next = await window.desktop?.getRemoteControl(); if (alive) setState(next) }
      catch (cause) { if (alive) setError(cause instanceof Error ? cause.message : String(cause)) }
      finally { asking = false }
    }
    void read()
    const timer = setInterval(() => { void read() }, 500)
    return () => { alive = false; clearInterval(timer) }
  }, [])
  return <RemoteControlView state={state} busy={busy} error={error} onToggle={async (enabled) => {
    setBusy(true); setError(undefined)
    try { setState(await window.desktop?.setRemoteControl(enabled)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }} />
}

export function RemoteControlView({ state, busy, error, onToggle }: {
  readonly state?: RemoteControlState
  readonly busy: boolean
  readonly error?: string
  readonly onToggle: (enabled: boolean) => Promise<void>
}) {
  return <div className="lc-settingrows">
    <div className="lc-settingrow">
      <div className="lc-settingline__text">
        <div>{REMOTE_CONTROL_LABEL}</div>
        <p className="lc-settings__lede">Start Claude Code sessions in this folder from claude.ai while Locust is open. Requires your claude.ai sign-in; API keys do not work. Team and Enterprise owners must allow Remote Control.</p>
      </div>
      <button type="button" className={`lc-switch${state?.enabled ? ' is-on' : ''}`} role="switch" aria-label={REMOTE_CONTROL_LABEL} aria-checked={state?.enabled ?? false} disabled={busy || state === undefined || state.phase === 'stopping'} onClick={() => { void onToggle(!state?.enabled) }}><span className="lc-switch__knob" /></button>
    </div>
    <div className="lc-settingrow" style={{ display: 'block' }}>
      {state !== undefined && <p role="status">{state.phase === 'needs-person'
        ? 'Complete setup in the Claude Code terminal, then enable this switch again.'
        : state.phase === 'starting' ? 'Starting Claude Code…'
        : state.phase === 'running' ? 'Claude Code is running. Its connection information appears below.'
        : state.phase === 'stopping' ? 'Waiting for Claude Code to end…'
        : state.phase === 'ended' ? 'Claude Code ended.' : state.phase === 'error' ? `Claude Code reported a problem${state.exitCode === undefined ? '.' : ` (exit ${state.exitCode ?? 'unknown'}).`}`
        : 'Off. Enabling this lasts until you switch it off or quit Locust.'}</p>}
      {state?.stdout && <><div>Claude Code output</div><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 240, overflow: 'auto' }}>{state.stdout}</pre></>}
      {state?.stderr && <><div>Claude Code errors</div><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 240, overflow: 'auto' }}>{state.stderr}</pre></>}
      {(error ?? state?.error) && <pre role="alert" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{error ?? state?.error}</pre>}
      {state?.truncated && <p>The first 64 Ki characters of each stream are shown. Later output was omitted.</p>}
    </div>
  </div>
}
