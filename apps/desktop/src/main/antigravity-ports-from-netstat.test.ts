import { describe, expect, it } from 'vitest'

import { listeningPortsIn } from './antigravity-host.js'

/**
 * Antigravity's ports, from `netstat -ano` rather than `Get-NetTCPConnection`
 * (724 ms against 48 ms, measured 2026-09-22 -- most of a 1.7 s check that
 * ran on every launch).
 *
 * The shape below is this machine's real output, CRLF and all. The German
 * row is the reason the reader goes by shape: netstat translates its state
 * column, and a reader that looked for the word LISTENING would find nothing
 * on a German Windows.
 */
const CRLF = String.fromCharCode(13, 10)
const NETSTAT = [
  '',
  'Active Connections',
  '',
  '  Proto  Local Address          Foreign Address        State           PID',
  '  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1452',
  '  TCP    127.0.0.1:57058        0.0.0.0:0              LISTENING       6256',
  '  TCP    127.0.0.1:57059        0.0.0.0:0              ABHÖREN         6256',
  '  TCP    127.0.0.1:57059        127.0.0.1:61234        ESTABLISHED     6256',
  '  TCP    [::]:57060             [::]:0                 LISTENING       6256',
  '  TCP    127.0.0.1:57061        0.0.0.0:0              LISTENING       62560',
  ''
].join(CRLF)

describe('Antigravity ports from netstat', () => {
  it('reads every port the process listens on, in any language', () => {
    expect(listeningPortsIn(NETSTAT, 6256)).toEqual([57058, 57059, 57060])
  })

  it('does not count a connection, or another process whose pid starts the same', () => {
    // The controls: an ESTABLISHED row on a listening port, and pid 62560
    // beside 6256. Either leaking in would hand the probe a wrong port.
    expect(listeningPortsIn(NETSTAT, 62560)).toEqual([57061])
    expect(listeningPortsIn(NETSTAT, 9999)).toEqual([])
  })

  it('reads nothing from nothing', () => {
    expect(listeningPortsIn('', 6256)).toEqual([])
  })
})
