import { describe, expect, it, vi } from 'vitest'

/**
 * A ledger that is busy for a moment does not cost a mission.
 *
 * Colin, 2026-09-15, on a live Cursor run: *"Stopped — the mission ledger
 * could not be written."* His file was perfectly intact afterwards — 449
 * records, every one parsing, sequence contiguous 1 to 449, 454KB against a
 * 64MB cap, on a disk with 78GB free. Nothing was wrong with the ledger. The
 * moment was wrong.
 *
 * On Windows a file refuses to open for a few milliseconds all the time: a
 * virus scanner reading it as it grows, an indexer, a backup agent. There
 * was no retry, so one of those moments ended the run and the app showed its
 * "stopped rather than continue without a durable record" card — which is
 * the right card for a real failure and the wrong outcome for a transient
 * one.
 *
 * WHY ONLY THE OPEN IS RETRIED. Nothing has been written when `open` fails,
 * so trying again cannot tear a record. A failure during the write or the
 * sync still throws at once, because there the on-disk state is genuinely
 * uncertain and stopping is correct.
 */

const busy = (code: string): NodeJS.ErrnoException =>
  Object.assign(new Error(`${code}: busy`), { code })

/** The retry, lifted out of the store so its policy can be tested directly. */
async function openForAppend(open: () => Promise<string>): Promise<string> {
  const BUSY = new Set(['EBUSY', 'EPERM', 'EACCES'])
  const WAITS = [25, 50, 100]
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await open()
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? ''
      const wait = WAITS[attempt]
      if (!BUSY.has(code) || wait === undefined) throw error
      await new Promise((resolve) => setTimeout(resolve, wait))
    }
  }
}

describe('waiting out a lock', () => {
  it('succeeds when the file frees up on the second try', async () => {
    const open = vi.fn<() => Promise<string>>()
      .mockRejectedValueOnce(busy('EBUSY'))
      .mockResolvedValue('handle')
    await expect(openForAppend(open)).resolves.toBe('handle')
    expect(open).toHaveBeenCalledTimes(2)
  })

  it('tries the codes Windows actually uses for a held file', async () => {
    for (const code of ['EBUSY', 'EPERM', 'EACCES']) {
      const open = vi.fn<() => Promise<string>>().mockRejectedValueOnce(busy(code)).mockResolvedValue('handle')
      await expect(openForAppend(open)).resolves.toBe('handle')
      expect(open).toHaveBeenCalledTimes(2)
    }
  })

  it('gives up rather than retrying for ever', async () => {
    const open = vi.fn<() => Promise<string>>().mockRejectedValue(busy('EBUSY'))
    await expect(openForAppend(open)).rejects.toThrow('EBUSY')
    // Four attempts: the first, then one per wait.
    expect(open).toHaveBeenCalledTimes(4)
  })
})

describe('what it must NOT wait for', () => {
  it('fails a full disk immediately', async () => {
    /*
     * `ENOSPC` is a fact that will not change while we wait. Retrying it
     * turns a clear failure into a slow one, and the person still loses the
     * run -- later, and with less explanation.
     */
    const open = vi.fn<() => Promise<string>>().mockRejectedValue(busy('ENOSPC'))
    await expect(openForAppend(open)).rejects.toThrow('ENOSPC')
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('fails a read-only filesystem immediately', async () => {
    const open = vi.fn<() => Promise<string>>().mockRejectedValue(busy('EROFS'))
    await expect(openForAppend(open)).rejects.toThrow('EROFS')
    expect(open).toHaveBeenCalledTimes(1)
  })
})
