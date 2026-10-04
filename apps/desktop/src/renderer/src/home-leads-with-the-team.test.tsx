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
    // Named from the person's side of the screen (0.607): these are their accounts, signed in here.
    expect(html).toContain('Connected accounts')
    expect(html).not.toContain('>AI agents<')
    // The ready agents as their marks (0.383), each a thing to point at that
    // names itself and its state (AgentMark, 0.389) -- not a sentence of names.
    expect(html).toContain('aria-label="Codex CLI. Ready · 1.0.0"')
    expect(html).toContain('aria-label="Claude Code. Ready · 1.0.0"')
    expect(html).not.toContain('Codex CLI · Claude Code')
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

  it('keeps the whole list on a first run while another agent could still be added', () => {
    const html = home([ready('codex', 'Codex CLI'), ready('claude', 'Claude Code'), absent('cursor', 'Cursor Agent')], [])
    expect(html).not.toContain('Your team')
    expect(html).not.toContain('is-folded')
    expect(html).toContain('lc-runtimepanel')
  }, 10_000)

  /*
   * NOTHING TO ADD, NOTHING TO FIX: ONE LINE, TEAM OR NOT (0.360).
   *
   * With every agent ready and nobody on the team, the seven rows beside the
   * team templates pushed Home past a 1440x900 window and cut the cover's
   * middle bot at the top (probe-home-fits, packaged 0.359).
   */
  it('folds on a first run too, once every agent is ready', () => {
    const html = home([ready('codex', 'Codex CLI'), ready('claude', 'Claude Code')], [])
    expect(html).toContain('lc-agenthead is-folded')
    expect(html).not.toContain('lc-runtimepanel')
    // And a signed-out one opens it again, team or not.
    expect(home([ready('codex', 'Codex CLI'), signedOut('claude', 'Claude Code')], [])).toContain('lc-runtimepanel')
  }, 10_000)
})

  it('says where each teammate stands, beside the name, and reads it aloud with the card (0.606)', () => {
    const html = home([ready('codex', 'Codex CLI')], [
      { ...TEAM[0]!, working: false, lastWorked: 'last worked 2 hours ago' },
      { ...TEAM[1]!, working: true, state: { word: 'replying', tone: 'live', spoken: 'replying now' } },
      { teammateId: 'tm_sable', name: 'Sable', hue: 'clay', avatar: seedAvatar('tm_sable'), role: 'Data', working: false, state: { word: 'waiting on you', tone: 'amber', spoken: 'waiting on you' } }
    ])
    // Idle says nothing beside the name (0.609); what they last did is the card's hover.
    expect(html).not.toContain('is-muted')
    expect(html).toContain('title="last worked 2 hours ago"')
    expect(html).toContain('<span class="lc-hometeam__state is-live">replying</span>')
    expect(html).toContain('<span class="lc-hometeam__state is-amber">waiting on you</span>')
    expect(html).toContain('Message Wren, Code &amp; Migrations, on Codex')
    expect(html).toContain('Message Penny, Money, replying now')
    expect(html).toContain('Message Sable, Data, waiting on you')
    // The old "working" tag is gone: the state says it.
    expect(html).not.toContain('lc-hometeam__working')
  }, 10_000)
