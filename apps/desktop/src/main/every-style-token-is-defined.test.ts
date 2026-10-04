import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/*
 * A style token that does not exist fails SILENTLY: `var(--lc-text-caption)`
 * resolves to nothing, the rule falls back to whatever it inherits, and no
 * build, type check or test says a word. It happened on 2026-09-26, in the
 * first-impressions pass -- caught by reading the token list, not by anything
 * that ran. Now something runs.
 */
const read = (name: string): string => readFileSync(fileURLToPath(new URL(`../renderer/src/${name}`, import.meta.url)), 'utf8')

describe('the stylesheets', () => {
  it('use only tokens that are defined', () => {
    const sheets = ['tokens.css', 'shell.css'].map(read).join('\n')
    const defined = new Set([...sheets.matchAll(/(--lc-[a-z0-9-]+)\s*:/g)].map((match) => match[1]))
    const used = new Set([...read('shell.css').matchAll(/var\((--lc-[a-z0-9-]+)/g)].map((match) => match[1]))
    expect([...used].filter((token) => !defined.has(token))).toEqual([])
  }, 10_000)
})
