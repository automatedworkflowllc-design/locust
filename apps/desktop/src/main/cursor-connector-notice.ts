import { execFile } from 'node:child_process'

import {
  createPathExecutableLocator,
  cursorConnectorSentence,
  parseCursorMcpList
} from '@teammate/runtime-adapters'

/**
 * Say when a Cursor connector has no credential, because nothing else will.
 *
 * Colin, 2026-09-14, after days of it: "i literally have robinhood working on
 * the cli but cursor still cant call it." The CLI answers it in one line --
 * `cursor-agent mcp list` prints `robinhood-trading: requires_authentication`
 * -- and nobody is going to run that to find out.
 *
 * It was never an approval problem. Locust passes `--approve-mcps`, the flag
 * still exists, and approval was not what refused the call: with no token the
 * server's tools are not offered to the model AT ALL, so there is no failure
 * to react to. The run simply behaves as though the connector does not exist,
 * which is indistinguishable from a model choosing not to use it. That is why
 * this is proactive where the `.cursorignore` notice is reactive -- there is
 * nothing to wait for.
 *
 * And the fact that cost the most time: the Cursor IDE app keeps its own
 * credentials. Signing in there does not sign the CLI in, which is exactly how
 * a connector can work in one and be missing in the other.
 */

/** Long enough that a run never pays for it twice; short enough to notice a login. */
const TTL_MS = 5 * 60_000
/** A reading that has not answered by here is not going to help this run. */
const TIMEOUT_MS = 8_000

let held: { readonly at: number; readonly sentence: string | undefined } | undefined

export type McpLister = () => Promise<string>

const runCursorMcpList: McpLister = async () => {
  /*
   * Resolve the launcher; do not assume the name works as a program.
   *
   * MEASURED 2026-09-13 on Colin's machine, and it is why the notice this
   * module exists for had never once appeared: Cursor installs `cursor-agent`
   * as a `.cmd` shim, and `execFile` without a shell cannot start a `.cmd` at
   * all -- `spawn cursor-agent ENOENT`, every time, on the one platform this
   * app ships to. The reading failed, the catch below swallowed it as "no
   * answer", and the app said nothing about a connector it could see was
   * waiting. A whole feature, silent, for the oldest Windows reason there is.
   *
   * The locator is the same one discovery uses, so a machine where Cursor
   * runs at all can also be asked about its connectors. Its `npmBinDirectory`
   * is not threaded through here on purpose: Cursor's installer writes to
   * %LOCALAPPDATA%, never npm's prefix, and PATH is still searched first.
   */
  const launch = await createPathExecutableLocator({}).find('cursor-agent')
  if (launch === undefined) return ''
  return await new Promise((resolve) => {
    execFile(
      launch.executablePath,
      [...launch.prefixArgs, 'mcp', 'list'],
      { timeout: TIMEOUT_MS, windowsHide: true },
      (_error, stdout) => resolve(typeof stdout === 'string' ? stdout : '')
    )
  })
}

/**
 * The sentence to show, or undefined when there is nothing to say.
 *
 * Never throws and never waits long: a connector reading that fails is a
 * reading this app does not have, not a reason to hold up a mission. Cached
 * across missions, because the answer is about the machine rather than the
 * run.
 */
export async function cursorConnectorsNeedingLogin(
  lister: McpLister = runCursorMcpList,
  now: () => number = Date.now
): Promise<string | undefined> {
  const at = now()
  if (held !== undefined && at - held.at < TTL_MS) return held.sentence
  try {
    const sentence = cursorConnectorSentence(parseCursorMcpList(await lister()))
    held = { at, sentence }
    return sentence
  } catch {
    // A CLI that is missing or refuses to answer says nothing about
    // connectors, which is different from saying they are fine -- so nothing
    // is cached and the next run asks again.
    return undefined
  }
}

/** Test seam: forget the held reading. */
export function forgetCursorConnectorReading(): void {
  held = undefined
}
