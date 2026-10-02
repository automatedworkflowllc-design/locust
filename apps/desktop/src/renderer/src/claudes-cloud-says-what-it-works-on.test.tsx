import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { CloudTasks } from './components/CloudTasks.js'

/**
 * CLAUDE'S CLOUD SAYS WHAT IT WORKS ON (0.545). Colin's first send went from
 * `.claude`, which is not on GitHub; the session answered that /home/user
 * "isn't a git repository". The panel now says so before a send, with his
 * folders that are on GitHub, and no longer sends him to a window that has
 * already closed.
 */
const base = {
  tasks: [],
  notes: [],
  problem: undefined,
  applying: undefined,
  onShowChange: async () => undefined,
  onApply: () => undefined,
  onOpen: () => undefined,
  onClose: () => undefined,
  onOpenFolder: () => undefined,
  onChooseFolder: () => undefined
}
const claude = (sessions: readonly { readonly id: string; readonly task: string; readonly startedAt: string }[] = []) => ({
  picked: true,
  sessions,
  note: undefined,
  onHome: () => undefined,
  onForget: () => undefined,
  onOpenWeb: () => undefined
})

describe("Claude's cloud panel", () => {
  it('says a folder not on GitHub starts with no project, and offers the folders that are', () => {
    const props = {
      ...base,
      where: { folderName: '.claude' },
      folders: [{ id: 'f1', name: 'locust-astra', repo: 'owner/repo', environment: 'missing' }],
      claude: claude()
    } as unknown as Parameters<typeof CloudTasks>[0]
    const html = renderToStaticMarkup(<CloudTasks {...props} />)
    expect(html).toContain('Claude’s cloud works on a copy of a')
    expect(html).toContain('starts with no project')
    expect(html).not.toContain('Codex Cloud, not on this computer')
    expect(html).toContain('locust-astra')
    // Codex's environment is not Claude's concern.
    expect(html).not.toContain('no cloud environment')
  })
})
