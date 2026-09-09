import { runtimeInstallFacts } from './runtime-install.js'

/**
 * Every address this app is allowed to open in a browser, named here.
 *
 * The host denies `window.open` outright and cancels any navigation away
 * from the app's own URL, because `shell.openExternal` hands a URL to the
 * operating system where none of the packaged build's egress rules apply --
 * anything running in the renderer could otherwise have posted the mission
 * ledger to a host of its choosing, one browser launch at a time.
 *
 * The note beside that policy in `index.ts` said "Nothing in this shell
 * links out, so nothing is opened", and asked that a feature which needs a
 * link name the exact URL in the host. That stopped being true and nobody
 * did: the first-run panel grew `<a target="_blank">` links for the two
 * runtimes that are not npm packages, and one for Node.js itself. Every one
 * of them was dead, silently, in every build that shipped them -- reported
 * by the first outside tester on 0.55.0, who had no Node and whose only
 * offered way out was the link that did nothing.
 *
 * So: this list, checked in the host. The renderer asks for a URL and the
 * host opens it only if it is one of these exactly. A renderer that has been
 * turned against the person can reach these three addresses and nowhere
 * else, which is the same guarantee the deny-everything policy gave.
 *
 * The runtime addresses are read from `runtime-install.ts` rather than
 * copied, so a vendor URL that changes there cannot leave a dead link here.
 */
const RUNTIME_LINKS: readonly string[] = ['cursor', 'antigravity', 'codex', 'claude', 'copilot', 'opencode', 'gemini']
  .map((id) => runtimeInstallFacts(id))
  .flatMap((facts) => (facts !== undefined && facts.install.kind === 'vendor' ? [facts.install.url] : []))

/** Node.js itself: what four of the five runtimes install through. */
const NODE_LINK = 'https://nodejs.org'

export const OUTBOUND_LINKS: readonly string[] = [...new Set([...RUNTIME_LINKS, NODE_LINK])]

/** Whether the host may open this, asked of the host's own list. */
export function isOutboundLink(url: unknown): url is string {
  return typeof url === 'string' && OUTBOUND_LINKS.includes(url)
}
