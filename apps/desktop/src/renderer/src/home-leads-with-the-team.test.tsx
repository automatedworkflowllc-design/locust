import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { LocalRuntimeId, PublicRuntimeStatus } from '../../shared/ipc.js'
import { seedAvatar } from '../../shared/avatar.js'
import { FirstLaunch } from './components/FirstLaunch.js'
import type { HomeTeammate } from './components/HomeTeam.js'

/*
 * Home, after the first-impressions pass (Colin, 2026-09-26: Claude's UI "and
 * beyond" is the standard). It led with a table of coding-tool versions and
 * showed the teammates nowhere. Now it leads with the team, and the table
 * folds to one line -- but ONLY when it has nothing to ask of the person.
 */
const ready = (id: LocalRuntimeId, name: string): PublicRuntimeStatus => ({ id, displayName: name, installed: true, version: '1.0.0', auth: 'authenticated', ready: true, status: 'ready' })
const signedOut = (id: LocalRuntimeId, name: string): PublicRuntimeStatus => ({ id, displayName: name, installed: true, version: '1.0.0', auth: 'unauthenticated', ready: false, status: 'auth-required' })
const absent = (id: LocalRuntimeId, name: string): PublicRuntimeStatus => ({ id, displayName: name, installed: false, version: null, auth: 'unknown', ready: false, status: 'not-installed' })

const TEAM: readonly HomeTeammate[] = [
  { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', avatar: seedAvatar('tm_wren'), role: 'Code & Migrations', route: 'Codex · Account default', working: false },
  { teammateId: 'tm_penny', name: 'Penny', hue: 'butter', avatar: seedAvatar('tm_penny'), role: 'Money', working: true }
]

function home(runtimes: readonly PublicRuntimeStatus[], team: readonly HomeTeammate[] = TEAM): string {
  return renderToStaticMarkup(
    <FirstLaunch
      runtimes={runtimes}
      limitedRuntimes={new Map()}
      discoveryPhase="ready"
      workspacePath="C:\\work"
      teammateCount={team.length}
      team={team}
      onMessageTeammate={() => undefined}
      onNewTeammate={() => undefined}
      onChooseFolder={() => undefined}
      onInstall={() => undefined}
    />
  )
}

describe('Home', () => {
  it('leads with the team: a card per teammate, and who is working', () => {
    const html = home([ready('codex', 'Codex CLI'), ready('claude', 'Claude Code')])
    expect(html).toContain('Your team')
    expect(html).toContain('Message Wren, Code &amp; Migrations')
    expect(html).toContain('Codex · Account default')
    expect(html).toContain('Message Penny, Money, working now')
    expect(html).toContain('New teammate')
  }, 10_000)

  it('folds the agent list to one line when every installed agent is ready', () => {
    const html = home([ready('codex', 'Codex CLI'), ready('claude', 'Claude Code'), absent('gemini', 'Gemini CLI')])
    expect(html).toContain('lc-agenthead is-folded')
    expect(html).toContain('Codex CLI · Claude Code')
    expect(html).toContain('Show all')
    // An agent that is not installed is an offer, not a problem: it does not
    // hold the list open.
    expect(html).not.toContain('lc-runtimepanel')
  }, 10_000)

  it('keeps the whole list when an installed agent needs the person', () => {
    const html = home([ready('codex', 'Codex CLI'), signedOut('claude', 'Claude Code')])
    expect(html).not.toContain('is-folded')
    expect(html).toContain('lc-runtimepanel')
  }, 10_000)

  it('keeps the whole list on a first run, with no team yet', () => {
    const html = home([ready('codex', 'Codex CLI'), ready('claude', 'Claude Code')], [])
    expect(html).not.toContain('Your team')
    expect(html).not.toContain('is-folded')
    expect(html).toContain('lc-runtimepanel')
  }, 10_000)
})
