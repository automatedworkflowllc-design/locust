import { useEffect, useState, type ReactNode } from 'react'
import type { LocustMcpApi, LocustMcpState } from '../../../shared/locust-mcp.js'
import { CopyButton } from './CopyButton.js'

export function LocustMcpSettings({ heading, api = typeof window === 'undefined' ? undefined : window.desktop?.locustMcp }: { readonly heading?: ReactNode; readonly api?: LocustMcpApi }) {
  const [state, setState] = useState<LocustMcpState>()
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  useEffect(() => {
    let alive = true
    void api?.settings().then(value => { if (alive) setState(value) }).catch(() => { if (alive) setFailure('The server setting could not be read. Its previous choice is unchanged.') })
    return () => { alive = false }
  }, [api])
  const toggle = async () => {
    if (!api || !state || busy) return
    setBusy(true); setFailure('')
    try { setState(await api.setEnabled(!state.enabled)) }
    catch { setFailure('The server setting could not be changed. Its previous choice is unchanged.') }
    finally { setBusy(false) }
  }
  return <>
    <div className="lc-settingline">
      <div className="lc-settingline__text">
        {heading}
        <p className="lc-settings__lede">{state?.enabled
          ? 'On. Other apps on this computer can ask teammates and read replies. New turns are Ask mode (read only), with no automatic teammate handoffs. Locust must be running; your AI account usage and monthly limits still apply.'
          : 'Off. No local server is listening.'}</p>
      </div>
      <button type="button" className={`lc-switch${state?.enabled ? ' is-on' : ''}`} role="switch" aria-label="Let your other AI apps use Locust" aria-checked={state?.enabled === true} disabled={!state || busy} onClick={() => { void toggle() }}><span /></button>
    </div>
    {state?.enabled && <div className="lc-settings__note">
      {/* A Copy on each (0.691): the lines run to three paths, and selecting a wrapped block by hand is fiddly. */}
      <p>Claude Code — run this in PowerShell:</p>
      <div className="lc-mcp-setupwrap"><pre className="lc-mcp-setup lc-mono">{state.claudeCommand}</pre>
        {state.claudeCommand !== undefined && <CopyButton className="lc-mcp-setup__copy" label="the Claude Code command" text={state.claudeCommand} />}</div>
      <p>Codex — add this to ~/.codex/config.toml:</p>
      <div className="lc-mcp-setupwrap"><pre className="lc-mcp-setup lc-mono">{state.codexConfig}</pre>
        {state.codexConfig !== undefined && <CopyButton className="lc-mcp-setup__copy" label="the Codex settings" text={state.codexConfig} />}</div>
      <p>Locust never writes another app's configuration. Turning this off stops new requests, not turns already running.</p>
    </div>}
    {(failure || state?.message) && <p className="lc-settings__note" role="status">{failure || state?.message}</p>}
  </>
}
