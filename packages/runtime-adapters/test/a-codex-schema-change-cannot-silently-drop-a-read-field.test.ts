// Colin: "Add one test, skipped unless LOCUST_CODEX_SCHEMA=1, that fails when
// a field app-server-events.ts reads disappears from codex app-server generate-json-schema."
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { createPathExecutableLocator } from '../src/path-locator.js'
import { spawnShape } from '../src/cmd-line.js'
import { missingReadFields, missingErrorVariants, type Schema } from './codex-schema-read-fields.js'

it('A disappeared field cannot be masked by the same spelling on a different item type.', () => {
  const schema: Schema = { definitions: { ThreadItem: { oneOf: [
    { properties: { type: { enum: ['fileChange'] }, id: {}, status: {} } },
    { properties: { type: { enum: ['commandExecution'] }, id: {}, command: {} } }
  ] } } }
  const reads = [['ThreadItem', 'commandExecution', ['id', 'command']]] as const
  expect(missingReadFields(schema, reads)).toEqual([])
  const broken: Schema = { definitions: { ThreadItem: { oneOf: [
    { properties: { type: { enum: ['fileChange'] }, id: {}, command: {} } },
    { properties: { type: { enum: ['commandExecution'] }, id: {} } }
  ] } } }
  expect(missingReadFields(broken, reads)).toEqual(['ThreadItem.commandExecution.command'])
})
it('A disappeared definition or tagged variant fails distinctly from an absent property.', () => {
  expect(missingReadFields({}, [['RateLimitWindow', '', ['usedPercent']]])).toEqual(['RateLimitWindow: missing definition'])
  expect(missingReadFields({ definitions: { ThreadItem: { oneOf: [] } } }, [['ThreadItem', 'fileChange', ['changes']]])).toEqual(['ThreadItem.fileChange: missing variant'])
})
it('References and allOf fields are followed, and absent fields still fail.', () => {
  const schema: Schema = { definitions: { Base: { properties: { delta: {} } }, Message: { allOf: [{ $ref: '#/definitions/Base' }, { properties: { itemId: {} } }] } } }
  expect(missingReadFields(schema, [['Message', '', ['delta', 'itemId']]])).toEqual([])
  expect(missingReadFields(schema, [['Message', '', ['threadId']]])).toEqual(['Message.threadId'])
})
it('Removing a classified error variant is schema drift too.', () => {
  const enumValues = ['usageLimitExceeded', 'rateLimitExceeded', 'unauthorized', 'cyberPolicy', 'misalignmentPolicyViolation']
  expect(missingErrorVariants({ definitions: { CodexErrorInfo: { oneOf: [{ enum: enumValues }] } } })).toEqual([])
  expect(missingErrorVariants({ definitions: { CodexErrorInfo: { enum: enumValues.slice(1) } } })).toEqual(['CodexErrorInfo.usageLimitExceeded'])
})

it.skipIf(process.env.LOCUST_CODEX_SCHEMA !== '1')('The pinned installed Codex schema still contains every canonical field the app-server normalizer reads.', async () => {
  const launch = await createPathExecutableLocator().find('codex')
  expect(launch, 'Install the fixture-pinned Codex 0.160.0; this check never installs or authenticates anything.').toBeDefined()
  if (launch === undefined) return
  const run = (args: readonly string[]) => {
    const shape = spawnShape(launch.executablePath, [...launch.prefixArgs, ...args])
    return spawnSync(launch.executablePath, [...shape.args], { encoding: 'utf8', timeout: 30_000, windowsHide: true, env: { ...process.env, ...launch.env }, ...(shape.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}) })
  }
  const version = run(['--version'])
  expect(version.status, version.stderr).toBe(0)
  expect(version.stdout.trim()).toBe('codex-cli 0.160.0')
  const directory = await mkdtemp(join(tmpdir(), 'locust-codex-schema-'))
  try {
    const generated = run(['app-server', 'generate-json-schema', '--out', directory])
    expect(generated.status, generated.stderr).toBe(0)
    const schema = JSON.parse(await readFile(join(directory, 'codex_app_server_protocol.v2.schemas.json'), 'utf8')) as Schema
    const missing = [...missingReadFields(schema), ...missingErrorVariants(schema)]
    expect(missing, 'A generated wire field read by app-server-events.ts disappeared; inspect the parser before changing this inventory.').toEqual([])
  } finally { await rm(directory, { recursive: true, force: true }) }
}, 90_000)
