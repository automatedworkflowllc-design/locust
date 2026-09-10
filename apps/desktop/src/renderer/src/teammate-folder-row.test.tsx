import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { seedAvatar } from '../../shared/avatar.js'
import type { PublicTeammate } from '../../shared/ipc.js'
import { NewTeammateDialog } from './components/NewTeammateDialog.js'

/**
 * The folder ONE teammate works in, said in the dialog.
 *
 * Colin, 2026-09-09: "switching work folder resets and closes the entire app.
 * and also just double checking it should only change the folder for that
 * chat/teammate not the entire app." The project-folder switch in Settings
 * genuinely does reopen Locust -- the ledger, the memory store and the
 * worktrees are all bound to it at launch -- so the answer is a narrower
 * control that moves one teammate and closes nothing.
 *
 * Two things this guards. First that the row exists at all, because the last
 * time a feature shipped with a passing test and no way to reach it was the
 * same day. Second that the row says WHICH folder rather than showing an
 * empty field: a teammate with no folder of its own is not misconfigured, it
 * is in the project folder, and the row has to read as that sentence.
 */

const WREN: PublicTeammate = {
  teammateId: 'tm_wren',
  name: 'Wren',
  hue: 'lime',
  role: 'Code & Migrations',
  avatar: seedAvatar('tm_wren'),
  createdAt: '2026-09-05T05:00:00.000Z'
}

const draw = (teammate: PublicTeammate | undefined, folder: boolean): string =>
  renderToStaticMarkup(
    <NewTeammateDialog
      error={undefined}
      mode="auto"
      onCancel={() => undefined}
      onCreate={() => undefined}
      {...(teammate === undefined ? {} : { initial: teammate })}
      {...(folder ? { onChooseFolder: () => undefined } : {})}
    />
  )

describe('the folder a teammate works in', () => {
  it('is named in the dialog, and reads as the project folder when it has none', () => {
    const html = draw(WREN, true)
    // The label exactly, not the substring: the Own branch hint one row up
    // opens with "Works in its own copy of the folder", and matching that
    // would let this pass with no folder row at all.
    expect(html).toContain('lc-field--folder')
    expect(html).toContain('>Works in<')
    expect(html).toContain('The project folder')
    expect(html).toContain('Choose folder')
    // Nothing to put back when it is already there.
    expect(html).not.toContain('Use the project folder')
  })

  it('shows the folder it was pointed at, and the way back', () => {
    const html = draw({ ...WREN, folder: '/home/<home>/claude' }, true)
    expect(html).toContain('/home/<home>/claude')
    expect(html).toContain('Use the project folder')
    expect(html).toContain('Change')
    expect(html).not.toContain('The project folder<')
  })

  it('says why the folder is worth setting, in the person\'s terms', () => {
    // The reason this exists at all is that Claude Code registers a local MCP
    // server under a PROJECT KEY, so a connector declared for one folder is
    // unreachable from any other. A row that only said "Works in" would leave
    // the person to discover that themselves.
    const html = draw(WREN, true)
    expect(html).toContain('MCP server')
    expect(html).toContain('History and memory stay with the project')
  })

  it('is absent while a teammate is being created, because there is nothing to write it onto', () => {
    expect(draw(undefined, true)).not.toContain('lc-field--folder')
    // And absent when the host offers no way to choose one, rather than
    // drawing a control that does nothing.
    expect(draw(WREN, false)).not.toContain('lc-field--folder')
  })
})
