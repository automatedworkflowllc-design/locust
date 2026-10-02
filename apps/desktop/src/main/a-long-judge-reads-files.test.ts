import { describe, expect, it } from 'vitest'

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { judgePrompt } from './compare-judge.js'
import { MAX_PROMPT_LENGTH } from './codex-mission.js'

/*
 * Colin, 2026-10-02: "ask a judge not working for antigravity". Three
 * answers that were whole HTML games, each quoted up to 6,000 characters,
 * made a judge's message of about 18,000 -- past the 8,000 any run takes,
 * so every judge was refused ("Enter a mission between 1 and 8,000
 * characters"), whichever model. Now the answers are written whole to
 * files and the judge reads them (0.553).
 */
const APP_MAIN = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8')
const game = '<!DOCTYPE html>\n<html><body><canvas></canvas><script>' + 'x();'.repeat(2_000) + '</script></body></html>'
const answers = ['A', 'B', 'C'].map((letter) => ({ letter, text: game }))

describe('a judge of long answers reads them from files', () => {
  it('three long answers quoted do not fit one message', () => {
    expect(judgePrompt({ ask: 'make a small arcade game', answers }).length).toBeGreaterThan(MAX_PROMPT_LENGTH)
  })

  it('named as files, they do, and the judge is told to read each one', () => {
    const filed = answers.map((answer) => ({ ...answer, file: `.locust/attachments/judge-cmp_x-${answer.letter}.md` }))
    const brief = judgePrompt({ ask: 'make a small arcade game', answers: filed, criteria: 'fun to play' })
    expect(brief.length).toBeLessThan(MAX_PROMPT_LENGTH)
    expect(brief).toContain('Answer B is in the file .locust/attachments/judge-cmp_x-B.md')
    expect(brief).toContain('Read each answer\'s file below in full')
    expect(brief).not.toContain('x();')
    // Still blind: letters, never models.
    expect(brief).toContain('Do not guess which model wrote which.')
  })

  it('the host switches to files only when the quoted message is too long', () => {
    expect(APP_MAIN).toContain('if (brief.length > MAX_PROMPT_LENGTH) {')
  })
})
