import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * A link the host refuses says so.
 *
 * Grok's second beta drive, 2026-09-14, finding 3. `openLink` answers
 * `{ok: false, message}` for every address the host will not hand to a
 * browser -- `file:`, `javascript:` and `ftp:` all came back with "Locust
 * does not open that address." -- and every caller in the renderer was
 * written `void window.desktop?.openLink(url)`. The answer went straight on
 * the floor. A refused link and a link that opened looked identical: nothing
 * moved on screen either way.
 *
 * This is the shape that has cost this project more than any other, and it
 * is worth naming again: A FEATURE SILENTLY DEAD RATHER THAN WRONG. The
 * sibling guard `no-dead-links` exists because three links shipped dead and
 * an outside tester found them on 0.55.0. This is that defect one layer in
 * -- the link is no longer dead, but its refusal is.
 *
 * So the rule is mechanical, because judgement is what failed here: the
 * renderer may not DISCARD what `openLink` answers. Await it, chain it, or
 * hand it to something that shows it -- but `void` in front of a call whose
 * answer is never read is the one spelling that cannot possibly display a
 * message, and it is banned.
 */

const RENDERER = fileURLToPath(new URL('../renderer/src/', import.meta.url))

function sources(directory: string): readonly string[] {
  const found: string[] = []
  for (const name of readdirSync(directory)) {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) found.push(...sources(path))
    else if ((name.endsWith('.tsx') || name.endsWith('.ts')) && !name.includes('.test.')) found.push(path)
  }
  return found
}

/**
 * One line that asks the host to open a link and then reads nothing back.
 *
 * Spelled with plain string work rather than a regex on purpose: the escape
 * levels in this repo's shell tooling have silently eaten `\n` out of a
 * pattern more than once, and a guard that quietly stops matching is worse
 * than no guard. This also states the rule in the words the rule is in --
 * `void` before it, nothing reading it after it.
 */
export function discardsTheAnswer(line: string): boolean {
  const at = line.indexOf('openLink(')
  if (at === -1) return false
  // A comment QUOTING the banned spelling is how a fix explains itself --
  // the note above this very function does it. Code only.
  const code = line.trimStart()
  if (code.startsWith('*') || code.startsWith('//') || code.startsWith('/*')) return false
  const before = line.slice(0, at)
  if (!before.includes('void') || before.includes('await')) return false
  // Something downstream reads it: the answer is not on the floor.
  return !line.slice(at).includes('.then') && !line.slice(at).includes('.catch')
}

describe('what the window does with a refused address', () => {
  it('never throws away what openLink answered', () => {
    const guilty: string[] = []
    for (const path of sources(RENDERER)) {
      for (const line of readFileSync(path, 'utf8').split(String.fromCharCode(10))) {
        if (discardsTheAnswer(line)) guilty.push(path.slice(RENDERER.length) + ': ' + line.trim())
      }
    }
    expect(guilty).toEqual([])
  })

  it("shows the host's own sentence where the link was pressed", () => {
    // Not a paraphrase and not a generic apology: the host already knows why
    // it refused, and that is the sentence a person needs. Beside the link,
    // because a person pressing one citation among several needs to know
    // WHICH one did not open.
    const thread = readFileSync(join(RENDERER, 'components', 'ThreadItems.tsx'), 'utf8')
    expect(thread).toContain('answer.ok ? undefined : answer.message')
    expect(thread).toContain('lc-link__refusal')
  })

  it('covers the welcome screen too, where the dead links were found the first time', () => {
    const first = readFileSync(join(RENDERER, 'components', 'FirstLaunch.tsx'), 'utf8')
    expect(first).toContain('onRefused(answer.message)')
  })

  it('is a real control: it catches the spelling that actually shipped', () => {
    // The exact lines from ThreadItems.tsx and FirstLaunch.tsx before this
    // fix. A guard that cannot fail against the code it was written for is
    // decoration, so both are asserted here as text.
    expect(discardsTheAnswer('                void window.desktop?.openLink(span.href)')).toBe(true)
    expect(discardsTheAnswer('  void window.desktop?.openLink(url)')).toBe(true)
    // And it leaves an honest caller alone, however it is spelled.
    expect(discardsTheAnswer('void bridge.openLink(href).then((answer) => setRefused(answer))')).toBe(false)
    expect(discardsTheAnswer('const answer = await bridge.openLink(href)')).toBe(false)
    expect(discardsTheAnswer('openLink: (url: string) => ipcRenderer.invoke(OPEN_LINK_CHANNEL, url)')).toBe(false)
  })
})
