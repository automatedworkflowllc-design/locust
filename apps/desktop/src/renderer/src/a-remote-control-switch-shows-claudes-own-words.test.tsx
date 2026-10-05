// Colin: "Build the Settings switch and its process handling with unit tests only
// (arguments; process ended when the switch goes off or Locust quits;
// first lines and errors shown verbatim)."
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { RemoteControlView } from './components/RemoteControlSetting.js'
import { pageMatches, SETTINGS_PAGES } from './settingsPages.js'
import type { RemoteControlState } from '../../shared/claude-remote-control.js'
const off: RemoteControlState = { enabled: false, phase: 'off', stdout: '', stderr: '', truncated: false }
const view = (state: RemoteControlState) => renderToStaticMarkup(<RemoteControlView state={state} busy={false} onToggle={async () => undefined} />)
it('The off switch explains its lifetime and account requirements.', () => {
  const html = view(off)
  expect(html).toContain('Let me start sessions on this computer from claude.ai')
  expect(html).toContain('role="switch"'); expect(html).toContain('aria-checked="false"')
  expect(html).toContain('quit Locust'); expect(html).toContain('API keys do not work'); expect(html).toContain('Team and Enterprise owners')
})
// 0.619 (Colin, 2026-10-04: "whats going on here? ive never noticed this"): the Off line had a
// row of its own under the switch, in the label's colour, and read as a second setting.
it('Off, it reads as one switch: its state opens its own line, and nothing sits under it.', () => {
  const html = view(off)
  // The row itself, not the card around it (lc-settingrows).
  expect(html.match(/class="lc-settingrow[" ]/g)).toHaveLength(1)
  expect(html).toMatch(/<p class="lc-settings__lede"><span role="status">Off\. When on, you can start Claude Code sessions in this folder from claude\.ai/)
})
it('A running switch shows Claude output and errors without summarizing or trimming them.', () => {
  const html = view({ ...off, enabled: true, phase: 'running', stdout: '  first\r\nhttps://claude.ai/code/session_fake\n', stderr: ' exact error\r\n', error: 'spawn ENOENT: exact' })
  expect(html).toContain('aria-checked="true"'); expect(html).toContain('  first\r\nhttps://claude.ai/code/session_fake\n</pre>')
  expect(html).toContain(' exact error\r\n</pre>'); expect(html).toContain('spawn ENOENT: exact</pre>')
})
it('A trust handoff stays off and asks the person to finish setup and deliberately enable again.', () => {
  const html = view({ ...off, phase: 'needs-person' })
  expect(html).toContain('aria-checked="false"'); expect(html).toContain('Complete setup in the Claude Code terminal, then enable this switch again.')
})
it('The switch is disabled while ending and states when later output was omitted.', () => {
  const html = view({ ...off, phase: 'stopping', truncated: true })
  expect(html).toContain('disabled=""'); expect(html).toContain('Waiting for Claude Code to end'); expect(html).toContain('the rest was left out')
})
it('Settings search finds Remote Control, phone, and claude.ai under AI agents.', () => {
  const page = SETTINGS_PAGES.find((page) => page.id === 'runtimes')!
  for (const word of ['remote control', 'phone', 'claude.ai']) expect(pageMatches(page, word)).toBe(true)
})
