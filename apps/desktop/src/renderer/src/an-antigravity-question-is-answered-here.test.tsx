import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { MissionApprovalRequest } from '../../shared/ipc.js'
import { ApprovalCard } from './components/ApprovalCard.js'

/**
 * AN ANTIGRAVITY QUESTION, ON LOCUST'S CARD.
 *
 * Yurt's beta run (2026-09-23) hung on a question Antigravity drew only in
 * its own window. It now arrives as the question card Codex's questions use,
 * answered through Antigravity's server -- with the Skip Antigravity's own
 * card has. And where Locust could not find the waiting step, the card still
 * shows the question and says where to answer it, with no buttons that would
 * pretend the answer can go from here.
 */

const question: MissionApprovalRequest = {
  approvalId: 'ap_1',
  runId: 'run_1',
  missionId: 'mission_1',
  runtime: 'antigravity',
  kind: 'question',
  summary: 'Asking folder organization preference',
  detail: '',
  cwd: 'C:\\work\\pebble',
  requestedAt: '2026-09-23T04:43:04.000Z',
  blocking: true,
  questions: [
    {
      id: '0',
      header: null,
      question: 'How would you like to organize this folder (currently containing README.md and hello.txt)?',
      options: [
        { label: 'Standard Project Layout — Move documentation to `docs/` and data/source files to `src/`', description: null },
        { label: 'Flat Minimalist Layout — Retain all files at the root directory', description: null }
      ],
      isOther: true,
      isSecret: false
    }
  ]
}

const draw = (request: MissionApprovalRequest): string =>
  renderToStaticMarkup(<ApprovalCard request={request} onDecide={() => undefined} onAnswer={() => undefined} busy={false} />)

describe('a question Locust can answer', () => {
  it('names Antigravity, offers every option and a written answer, and sends -- or skips', () => {
    const html = draw({ ...question, skippable: true })
    expect(html).toContain('Antigravity')
    expect(html).toContain('Asking folder organization preference')
    expect(html).toContain('Standard Project Layout')
    expect(html).toContain('Something else')
    expect(html).toContain('Send answer')
    expect(html).toMatch(/<button[^>]*>Skip<\/button>/)
  })

  it('offers no Skip where the runtime takes none', () => {
    expect(draw(question)).not.toMatch(/>Skip</)
  })
})

describe('a question that has to be answered in Antigravity', () => {
  it('shows the question and its options, says where to answer, and has no buttons', () => {
    const html = draw({ ...question, answerIn: 'Antigravity' })
    expect(html).toContain('How would you like to organize this folder')
    expect(html).toContain('Flat Minimalist Layout')
    expect(html).toContain('Answer it in Antigravity')
    expect(html).not.toContain('<button')
  })
})
