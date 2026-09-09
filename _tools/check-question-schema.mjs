// Read generated official schema only. Never start app-server or a model turn.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { isAbsolute, join } from 'node:path'

function inspect(server, response) {
  assert.ok(Array.isArray(server.oneOf) && server.oneOf.length >= 3, 'INCONCLUSIVE: no server request inventory')
  const request = server.oneOf.find((entry) => entry.properties?.method?.enum?.includes('item/tool/requestUserInput'))
  assert.ok(request, 'INCONCLUSIVE: question method absent')
  assert.equal(request.properties.params.$ref, '#/definitions/ToolRequestUserInputParams')
  const question = server.definitions.ToolRequestUserInputQuestion
  assert.ok(question.required.includes('id'))
  assert.equal(question.properties.id.type, 'string')
  const option = server.definitions.ToolRequestUserInputOption
  assert.deepEqual(Object.keys(option.properties).sort(), ['description', 'label'])
  assert.equal(option.properties.label.type, 'string')
  assert.equal(response.type, 'object')
  assert.deepEqual(response.required, ['answers'])
  assert.equal(response.properties.answers.type, 'object')
  assert.equal(response.properties.answers.additionalProperties.$ref, '#/definitions/ToolRequestUserInputAnswer')
  const answer = response.definitions.ToolRequestUserInputAnswer
  assert.deepEqual(answer.required, ['answers'])
  assert.equal(answer.properties.answers.type, 'array')
  assert.equal(answer.properties.answers.items.type, 'string')
}

const directory = process.argv[2]
assert.ok(directory && isAbsolute(directory), 'Supply an absolute generated JSON-schema directory; never infer it from cwd')
const serverText = await readFile(join(directory, 'ServerRequest.json'), 'utf8')
const responseText = await readFile(join(directory, 'ToolRequestUserInputResponse.json'), 'utf8')
const server = JSON.parse(serverText)
const response = JSON.parse(responseText)
inspect(server, response)

// Reject no data AND plausible-looking wrong data before printing a verdict.
// These are schema mutations, not a home-grown substitute for server validation.
assert.throws(() => inspect({}, {}), /INCONCLUSIVE/)
const absent = structuredClone(server)
absent.oneOf = absent.oneOf.filter((entry) => !entry.properties?.method?.enum?.includes('item/tool/requestUserInput'))
assert.throws(() => inspect(absent, response), /question method absent/)
const decisionOnly = structuredClone(response)
decisionOnly.required = ['decision']
assert.throws(() => inspect(server, decisionOnly), /AssertionError/)
const numeric = structuredClone(response)
numeric.definitions.ToolRequestUserInputAnswer.properties.answers.items.type = 'integer'
assert.throws(() => inspect(server, numeric), /AssertionError/)

console.log(JSON.stringify({
  method: 'item/tool/requestUserInput', serverRequests: server.oneOf.length,
  result: 'answers maps question IDs to objects whose answers field is a string array',
  controls: 'empty inventory, absent method, decision-only schema, numeric answers all rejected',
  responseSchemaSha256: createHash('sha256').update(responseText).digest('hex'),
  limitation: 'Schema inspection only; does not execute server deserialization or model behavior.'
}, null, 2))
