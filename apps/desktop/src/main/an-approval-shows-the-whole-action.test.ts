import { describe, expect, it } from 'vitest'

import { MAX_APPROVAL_DETAIL, wholeDetail } from '../shared/approval-detail.js'
import { builtInOrConnector } from './permission-host.js'

/**
 * AN APPROVAL SHOWS THE WHOLE ACTION (QA-2026-09-29 round 2, R14).
 *
 * The card is headed "exact action" and showed 600 characters of a connector
 * call, while Approve let all of it through: a mail whose recipient was
 * written after a long body was approved without the recipient on the card.
 */
describe('an approval card', () => {
  it('shows a connector call whole, down to a recipient written last', () => {
    const body = 'Here is the summary you asked for. '.repeat(26)
    const card = builtInOrConnector('mcp__claude_ai_Gmail__send_message', { subject: 'Weekly summary', body, to: 'someone-else@example.com' }, 'C:/work')
    expect(body.length).toBeGreaterThan(900)
    expect(card.kind).toBe('connector')
    expect(card.detail).toContain('"to": "someone-else@example.com"')
    expect(card.detail).toContain(body.trim())
    // One field to a line, so the fields read as fields.
    expect(card.detail.split('\n').length).toBeGreaterThanOrEqual(5)
  })

  it('keeps a command\'s line breaks, as the command will run', () => {
    const command = "cat > notes.txt <<'EOF'\nfirst line\nsecond line\nEOF\ncurl -X POST https://example.com/upload -d @notes.txt"
    expect(builtInOrConnector('Bash', { command }, 'C:/work').detail).toBe(command)
  })

  it('counts what it cannot show, and never cuts it silently', () => {
    const shown = wholeDetail(`${'a'.repeat(MAX_APPROVAL_DETAIL)}${'b'.repeat(1234)}`)
    expect(shown).toContain('[1,234 more characters not shown here. Deny if you cannot see enough to decide.]')
    expect(shown).not.toContain('b')
  })
})
