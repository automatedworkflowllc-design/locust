import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * L11 (the code review): the permission bridge decoded each stdin chunk on
 * its own, so a character split across two reads -- a connector's input in
 * any language but plain ASCII -- reached the approval card as replacement
 * characters. The real bridge, fed one tools/call line in two pieces split
 * inside "é", must hand the window the input it was given.
 */
const BRIDGE = fileURLToPath(new URL('../../resources/locust-permission-bridge.mjs', import.meta.url))

describe('the permission bridge', () => {
  it('keeps a character split across two reads whole', async () => {
    let received = ''
    const server = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => {
        received = Buffer.concat(chunks).toString('utf8')
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ behavior: 'allow', updatedInput: {} }))
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    const bridge = spawn(process.execPath, [BRIDGE], {
      env: { ...process.env, LOCUST_PERMISSION_URL: `http://127.0.0.1:${String(port)}/approve`, LOCUST_PERMISSION_TOKEN: 'tok' },
      stdio: ['pipe', 'pipe', 'ignore']
    })
    const answered = new Promise<void>((resolve) => bridge.stdout.on('data', () => resolve()))
    const line = Buffer.from(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'approve', arguments: { tool_name: 'mcp__notes__save', input: { title: 'café 🦗' } } } })}\n`, 'utf8')
    const cut = line.indexOf(0xc3) + 1
    bridge.stdin.write(line.subarray(0, cut))
    await new Promise((resolve) => setTimeout(resolve, 150))
    bridge.stdin.write(line.subarray(cut))
    await answered
    bridge.stdin.end()
    server.close()
    expect(JSON.parse(received).input).toEqual({ title: 'café 🦗' })
  }, 20_000)
})
