import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
 * 0.598. The card hides "Always allow this session" and the rule offer when a
 * command reaches other programs (0.579). Behind the card, the main process
 * took any `approve-always` the window sent: the permission host remembered
 * it for every later Bash call of the run, and the rule handler saved an allow
 * rule for the same command, with no check on either path (review 10/04,
 * S1). The window is not the guard; the host is. This keeps the two handlers
 * wired to the shared decision, so a renderer regression cannot widen a grant.
 */
const INDEX = new URL('./index.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const lines = readFileSync(INDEX, 'utf8').split('\n')
const within = (marker: string, span: number): string => {
  const at = lines.findIndex((line) => line.includes(marker))
  expect(at, marker).toBeGreaterThan(-1)
  return lines.slice(at, at + span).join('\n')
}

describe('the host itself refuses Always and a rule for a command that reaches', () => {
  it("passes every answer from the window through enforcedAnswer before it reaches a holder", () => {
    // 32 lines: since 0.616 the handler also keeps an Always under its host's key.
    const handler = within('ipcMain.handle(MISSION_APPROVAL_DECIDE_CHANNEL', 32)
    expect(handler).toContain('enforcedAnswer(raised.request, decided)')
    expect(handler).toContain('answerApproval(enforced.answer')
    expect(handler).not.toMatch(/answerApproval\(decided\)/)
  })

  it('refuses a rule from a card before any rule is built or saved', () => {
    const handler = within('ipcMain.handle(APPROVAL_RULE_FROM_CARD_CHANNEL', 14)
    const refusal = handler.indexOf('ruleRefusalFor(raised.request)')
    const built = handler.indexOf('ruleCandidateOf(')
    expect(refusal).toBeGreaterThan(-1)
    expect(built).toBeGreaterThan(refusal)
  })
})
