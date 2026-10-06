import assert from 'node:assert/strict'
import { test } from 'vitest'
import { requiredPathArgument } from './required-path-argument.mjs'

test('a one-off record path must be supplied explicitly', () => {
  for (const argv of [[], ['--fixture'], ['--fixture', '--workspace', 'project'], ['--fixture', '  ']]) {
    assert.throws(() => requiredPathArgument('--fixture', argv), /Give --fixture <path>/)
  }
})

test('the caller can name a path with spaces without changing it', () => {
  const path = 'C:/test records/original.jsonl'
  assert.equal(requiredPathArgument('--fixture', ['--keep', '--fixture', path]), path)
})

test('each original record and its workspace are required independently', () => {
  const argv = ['--fixture', 'record.jsonl']
  assert.equal(requiredPathArgument('--fixture', argv), 'record.jsonl')
  assert.throws(() => requiredPathArgument('--workspace', argv), /Give --workspace <path>/)
  assert.throws(() => requiredPathArgument('--handoff', argv), /Give --handoff <path>/)
})
