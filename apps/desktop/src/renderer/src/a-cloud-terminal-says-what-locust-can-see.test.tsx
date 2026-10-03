// Colin: "use fakes only". W5: "say plainly that Locust does not see what happens there".
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { CloudTasks } from './components/CloudTasks.js'
it('A known cloud row offers a terminal copy and explains visibility and phone steering.', () => {
  const html = renderToStaticMarkup(<CloudTasks tasks={[]} where={undefined} notes={[]} problem={undefined} applying={undefined} folders={[]} onShowChange={async () => undefined} onApply={() => undefined} onOpen={() => undefined} onClose={() => undefined} onOpenFolder={() => undefined} onChooseFolder={() => undefined} claude={{
    picked: true, sessions: [{ id: 'cc_abcdef', sessionId: 'session_0123456789', prompt: 'Test', startedAt: '2026-10-03T00:00:00Z' }], note: undefined,
    onHome: () => undefined, onForget: () => undefined, onOpenWeb: () => undefined, onSend: async () => undefined, onCheck: async () => ({ ok: false, message: 'Fake' }), onApply: async () => undefined, onContinue: async () => undefined
  }} />)
  expect(html).toContain('Continue in terminal')
  expect(html).toContain('fresh worktree')
  expect(html).toContain('Locust does not see what happens there')
  expect(html).toContain('/remote-control')
})
