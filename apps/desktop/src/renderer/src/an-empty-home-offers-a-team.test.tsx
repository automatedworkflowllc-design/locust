import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { LocalRuntimeId, PublicRuntimeStatus } from '../../shared/ipc.js'
import { seedAvatar } from '../../shared/avatar.js'
import { FirstLaunch } from './components/FirstLaunch.js'
import type { HomeTeammate } from './components/HomeTeam.js'

/*
 * AN EMPTY HOME OFFERS A TEAM (0.354). With nobody on the team, Home offered
 * one button and a sentence, and the button was not the chat bar's chip that
 * the populated Home's "New teammate" is (Colin, 0.351: "a proper button like
 * the ones in the chatbar"). Now it offers three teams in the section and
 * grid the team will fill, with that chip in the head.
 */
const ready = (id: LocalRuntimeId, name: string): PublicRuntimeStatus => ({ id, displayName: name, installed: true, version: '1.0.0', auth: 'authenticated', ready: true, status: 'ready' })

function home(team: readonly HomeTeammate[], templates = true, rosterUnreadable = false): string {
  return renderToStaticMarkup(
    <FirstLaunch
      runtimes={[ready('codex', 'Codex CLI')]}
      limitedRuntimes={new Map()}
      discoveryPhase="ready"
      workspacePath="C:\\work"
      teammateCount={team.length}
      team={team}
      onMessageTeammate={() => undefined}
      onNewTeammate={() => undefined}
      {...(templates ? { onUseTemplate: async () => undefined } : {})}
      onChooseFolder={() => undefined}
      onInstall={() => undefined}
      rosterUnreadable={rosterUnreadable}
    />
  )
}

describe('an empty Home', () => {
  it('offers three teams, each with who is on it', () => {
    const html = home([])
    expect(html).toContain('Start with a team')
    for (const title of ['Build software', 'Research &amp; money', 'Write &amp; design']) expect(html).toContain(title)
    expect(html).toContain('Wren · Juno · Atlas')
    expect(html).toContain('Sable · Penny · Rook')
    expect(html).toContain('Quill · Iris · Moss')
    expect(html).toContain('They run on the model you pick.')
  }, 10_000)

  it("keeps New teammate beside them, as the chat bar's own chip", () => {
    const html = home([])
    expect(html).toContain('class="lc-control lc-control--boxed lc-chipbutton"')
    expect(html).not.toContain('lc-firstteammate')
  }, 10_000)

  it('is the team itself once there is one', () => {
    const html = home([{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', avatar: seedAvatar('tm_wren'), role: 'Code & Migrations', working: false }])
    expect(html).toContain('Your team')
    expect(html).not.toContain('Start with a team')
  }, 10_000)
})

// QA-2026-09-29 round 2, R26: a teammates file that would not read looked
// exactly like this first launch, and the team read as gone.
describe('a Home whose teammates file would not read', () => {
  it('says so, and offers no team to start over with', () => {
    const html = home([], true, true)
    expect(html).toContain('Your teammates file could not be read, so your team is not shown.')
    expect(html).toContain('Nothing was changed.')
    expect(html).not.toContain('Start with a team')
  }, 10_000)
})
