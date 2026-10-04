import { describe, expect, it } from 'vitest'

import { MAX_MAILTO_URL, REPORT_DESTINATION, SUPPORT_ADDRESS, reportFileText, reportSubject, supportMailtoUrl } from './report-problem.js'

/*
 * A REPORT CAN REACH SUPPORT BY EMAIL OR AS A FILE (0.593, PRD R23). The
 * GitHub issue is public and needs an account. The email is private and goes
 * to one address, which must be a real one -- a placeholder fails here, so
 * the box can never offer an address nobody reads. A mailto is cut by the
 * mail client at about 2,000 characters, so the conversation rides in it
 * only while it fits, and the file carries everything.
 */

const FACTS = { version: '0.593.0', release: '10.0.26100', arch: 'x64', platform: 'win32' as const }

describe('the support address', () => {
  it('is a real address on the project domain, not a placeholder', () => {
    expect(SUPPORT_ADDRESS).toMatch(/^[a-z][a-z0-9._-]*@locust\.lol$/)
    expect(SUPPORT_ADDRESS).not.toMatch(/example|placeholder|todo|changeme|someone|your/i)
    // And the file names both ways, so a report saved and sent later still knows where to go.
    const file = reportFileText(FACTS, { description: 'It froze.' })
    expect(file).toContain(`Send it to ${SUPPORT_ADDRESS}`)
    expect(file).toContain(REPORT_DESTINATION)
  })
})

describe('the email', () => {
  it('carries the subject, the words, the version and the system, and the conversation when it fits', () => {
    const url = supportMailtoUrl(FACTS, { description: 'The thread stopped drawing after a long run.', conversation: 'Wren: starting\nWren: done' })
    expect(url.startsWith(`mailto:${SUPPORT_ADDRESS}?subject=`)).toBe(true)
    const subject = decodeURIComponent(/subject=([^&]*)/.exec(url)![1]!)
    const body = decodeURIComponent(/body=(.*)$/.exec(url)![1]!)
    expect(subject).toBe('Locust 0.593.0: The thread stopped drawing after a long run.')
    expect(body).toContain('The thread stopped drawing after a long run.')
    expect(body).toContain('Locust 0.593.0 on Windows 11, build 26100 (x64)')
    expect(body).toContain('Wren: done')
    expect(url.length).toBeLessThanOrEqual(MAX_MAILTO_URL)
  })

  it('keeps the END of a long conversation while it fits, and when none fits says the file carries it', () => {
    const long = Array.from({ length: 400 }, (_, i) => `line ${String(i)}: the teammate said something here`).join('\n')
    const url = supportMailtoUrl(FACTS, { description: 'Slow.', conversation: long })
    expect(url.length).toBeLessThanOrEqual(MAX_MAILTO_URL)
    const body = decodeURIComponent(/body=(.*)$/.exec(url)![1]!)
    expect(body).toContain('line 399:')
    expect(body).not.toContain('line 0:')
    expect(body).toContain('(its latest part)')
    // A description that nearly fills the email leaves no room for any of the conversation.
    const full = 'The composer stopped taking keys after the third run. '.repeat(34)
    const none = decodeURIComponent(/body=(.*)$/.exec(supportMailtoUrl(FACTS, { description: full, conversation: long }))![1]!)
    expect(none).toContain('did not fit in an email')
    expect(none).not.toContain('line 399:')
  })

  it('subjects a long description by its first words, and a blank one as a problem', () => {
    expect(reportSubject(FACTS, 'A'.repeat(100))).toBe(`Locust 0.593.0: ${'A'.repeat(57)}...`)
    expect(reportSubject(FACTS, '   ')).toBe('Locust 0.593.0: a problem')
  })
})

describe('the file', () => {
  it('is whole: the words, the facts, the conversation uncut, and the log line', () => {
    const long = Array.from({ length: 400 }, (_, i) => `line ${String(i)}`).join('\n')
    const file = reportFileText(FACTS, { description: 'Slow.', conversation: long })
    expect(file).toContain('line 0')
    expect(file).toContain('line 399')
    expect(file).not.toContain('(its latest part)')
    expect(file).toContain('To add the log:')
  })
})
