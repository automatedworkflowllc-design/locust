import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createApprovalRuleStore, parsedRuleFile } from './approval-rule-store.js'

/*
 * EVERY SAVED RULE CAN GO AT ONCE (0.587, QA's Q7).
 *
 * Locust's stance is that no rules means ask, so the reset is "remove all":
 * the file is left readable and empty, every card asks again, and the next
 * rule saves as before. The host clears it through its own channel, like
 * every other write to this file.
 */

let root: string | undefined
afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
})

describe('removing every saved rule', () => {
  it('leaves zero rules, a readable file, and room for the next one', async () => {
    root = await mkdtemp(join(tmpdir(), 'locust-rules-'))
    const store = createApprovalRuleStore({ rootDirectory: root })
    await store.add({ effect: 'allow', kind: 'command', pattern: 'git status' })
    await store.add({ effect: 'deny', kind: 'edit', pattern: 'package.json', teammateId: 'tm_wren' })
    expect(await store.list()).toHaveLength(2)

    expect(await store.removeAll()).toBe(2)
    expect(await store.list()).toEqual([])
    // Readable, and empty: the same shape the first run finds, not a missing file.
    expect(parsedRuleFile(await readFile(join(root, 'approval-rules.json'), 'utf8')).rules).toEqual([])

    const next = await store.add({ effect: 'allow', kind: 'read', pattern: 'README.md' })
    expect((await store.list()).map((rule) => rule.ruleId)).toEqual([next.ruleId])
  })

  it('is nothing to do on an empty store (control)', async () => {
    root = await mkdtemp(join(tmpdir(), 'locust-rules-'))
    const store = createApprovalRuleStore({ rootDirectory: root })
    expect(await store.removeAll()).toBe(0)
    expect(await store.list()).toEqual([])
  })
})
