import { describe, expect, it } from 'vitest'

import { startAppServerProcess } from './app-server-process.js'
import type { AppServerChild } from './app-server-process.js'

/**
 * M8 (the code review): each stdout chunk was decoded on its own, so a UTF-8
 * character split across two pipe reads became two replacement characters.
 * The JSON line still parsed, and the damaged text went into the ledger.
 */
describe('the app-server output', () => {
  it('keeps a character split across two reads whole', () => {
    let emit: (chunk: Buffer | string) => void = () => undefined
    const child: AppServerChild = {
      pid: 1,
      stdin: { write: () => true },
      stdout: { on: (_event, listener) => { emit = listener } },
      on: () => undefined,
      kill: () => true
    }
    const server = startAppServerProcess('codex', ['app-server'], { spawn: () => child, releaseTree: async () => true, platform: 'linux' })
    const seen: string[] = []
    server.onData((text) => seen.push(text))
    const line = Buffer.from('{"text":"café 🦗"}', 'utf8')
    // Split inside "é" (two bytes) and inside the four-byte emoji.
    const e = line.indexOf(0xc3)
    const emoji = line.indexOf(0xf0)
    emit(line.subarray(0, e + 1))
    emit(line.subarray(e + 1, emoji + 2))
    emit(line.subarray(emoji + 2))
    expect(seen.join('')).toBe('{"text":"café 🦗"}')
    expect(seen.join('')).not.toContain('�')
  })
})
