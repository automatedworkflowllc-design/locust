import { describe, expect, it } from 'vitest'

import { ledgerFailureRows, ledgerFailureSentence } from './ledgerFailure.js'

/**
 * The card about broken records is the last place to be loose with a claim.
 */
describe('what is safe and what is at risk when the ledger cannot be written', () => {
  it('never says a run was held, because it was stopped', () => {
    // The card used to title itself "Mission held" and then say the run was
    // stopped, in the next sentence. The host aborts the process and clears
    // the mission; stopping is right, calling it holding is not.
    const said = ledgerFailureSentence('The disk reports no space.')
    expect(said).toMatch(/stopped/i)
    expect(said).not.toMatch(/\bheld\b|\bpaused\b/i)
  })

  it('quotes the host rather than guessing at a cause', () => {
    expect(ledgerFailureSentence('The disk reports no space.')).toContain('The disk reports no space.')
    // And when the host said nothing, it does not invent one.
    const blank = ledgerFailureSentence(undefined)
    expect(blank).toMatch(/could not write/i)
    expect(blank).not.toMatch(/disk|permission|space/i)
  })

  it('states the safe half without inventing a checkpoint number', () => {
    // The design mock says "paused at ck_14". The renderer does not have that
    // number during a live failure, and a made-up one on THIS card would be
    // the worst possible invention.
    const rows = ledgerFailureRows(undefined)
    const safe = rows.find((row) => row.tone === 'safe')
    expect(safe?.text).toMatch(/only ever appends/i)
    expect(safe?.text).not.toMatch(/[0-9]/)
  })

  it('uses the checkpoint count when it genuinely has one', () => {
    expect(ledgerFailureRows(14).find((row) => row.tone === 'safe')?.text).toContain('14 checkpoints')
    // Singular, not '1 checkpoints'.
    const one = ledgerFailureRows(1).find((row) => row.tone === 'safe')?.text ?? ''
    expect(one).toContain('1 checkpoint ')
    expect(one).not.toContain('1 checkpoints')
  })

  it('says plainly that stopping did not undo the files already changed', () => {
    // The thing a person will actually get wrong. "The run was stopped" reads
    // as "nothing happened", and files on disk say otherwise.
    const rows = ledgerFailureRows(3)
    expect(rows.some((row) => /still changed/i.test(row.text))).toBe(true)
  })

  it('does not offer to reopen a mission that was never written', () => {
    /*
     * Caught the first time this card was ever put on a screen
     * (`drive-ledger-failure`, 2026-09-08): its own first line said "The
     * mission could not be created in the durable local ledger" and the SAFE
     * row underneath said "this mission can be reopened from it". There was no
     * record to reopen.
     *
     * `codex-mission.ts` writes the record BEFORE starting the process, so a
     * creation failure means nothing ran -- which is better news than a
     * mid-run failure, and the card should say so rather than warn about work
     * to check.
     */
    const rows = ledgerFailureRows(undefined, true)
    const safe = rows.find((row) => row.tone === 'safe')
    expect(safe?.text).not.toMatch(/reopened/i)
    expect(safe?.text).toMatch(/nothing ran/i)
    expect(rows.find((row) => row.label === 'At risk')?.text).toMatch(/never began/i)
    // And it does not tell them to go and check a folder for work that never
    // happened, which the mid-run copy correctly does.
    expect(rows.some((row) => /check the folder yourself/i.test(row.text))).toBe(false)
  })

  it('still offers the mid-run copy when something WAS written', () => {
    // The control. Without it, the branch above could swallow every case and
    // the card would under-warn on the failure that actually loses work.
    const rows = ledgerFailureRows(3, false)
    expect(rows.find((row) => row.tone === 'safe')?.text).toMatch(/reopened/i)
    expect(rows.some((row) => /still changed/i.test(row.text))).toBe(true)
  })

  it('admits the app cannot say what was lost', () => {
    const risk = ledgerFailureRows(3).find((row) => row.label === 'At risk')
    expect(risk?.text).toMatch(/cannot tell you what it was/i)
  })
})
