import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'

import { createApprovalRuleStore, MAX_RULES, type StoredRule } from './approval-rule-store.js'

let root: string | undefined
afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
})

async function savedRules(count: number) {
  root = await mkdtemp(join(tmpdir(), 'locust-rule-cap-'))
  const rules: StoredRule[] = Array.from({ length: count }, (_, i) => ({
    ruleId: `rule_${i}`, effect: 'deny', kind: 'command', pattern: `command_${i}`,
    createdAt: '2026-10-04T00:00:00.000Z'
  }))
  const path = join(root, 'approval-rules.json')
  await writeFile(path, JSON.stringify({ schemaVersion: 1, rules }))
  return { rules, path, store: createApprovalRuleStore({ rootDirectory: root }) }
}

it('refuses the 201st rule with the reason and keeps the first rule and the file intact', async () => {
  const { rules, path, store } = await savedRules(MAX_RULES)
  const before = await readFile(path, 'utf8')
  await expect(store.add({ effect: 'allow', kind: 'read', pattern: 'new-file' }))
    .rejects.toMatchObject({ message: '200 rules is the most Locust keeps; remove one first.' })
  expect(await store.list()).toEqual(rules)
  expect((await store.list())[0]).toEqual(rules[0])
  expect(await readFile(path, 'utf8')).toBe(before)
})

it('returns the existing rule for a duplicate even when the store is full', async () => {
  const { rules, path, store } = await savedRules(MAX_RULES)
  const before = await readFile(path, 'utf8')
  await expect(store.add({ effect: 'deny', kind: 'command', pattern: 'command_0' })).resolves.toEqual(rules[0])
  expect(await readFile(path, 'utf8')).toBe(before)
})

it('reads all 201 rules already on disk without dropping the first one', async () => {
  const { rules, store } = await savedRules(MAX_RULES + 1)
  expect(await store.list()).toEqual(rules)
})
