/** Canonical generated-schema fields read by src/app-server-events.ts.
 * Keep the type/variant context: a field elsewhere must not mask its loss.
 * The older rate-window snake_case/windowMinutes/utilization/resetsInSeconds
 * aliases and turn.threadId fallback have no canonical v2 schema location;
 * they remain compatibility reads, not assertions of a current wire field. */
export const READ_FIELDS = [
  ['ThreadStartedNotification', '', ['thread']],
  ['Thread', '', ['id']],
  ['TurnStartedNotification', '', ['threadId', 'turn']],
  ['TurnCompletedNotification', '', ['threadId']],
  ['ItemStartedNotification', '', ['threadId', 'item']],
  ['ItemCompletedNotification', '', ['threadId', 'item']],
  ['AgentMessageDeltaNotification', '', ['threadId', 'itemId', 'delta']],
  ['TurnPlanUpdatedNotification', '', ['threadId', 'turnId', 'plan']],
  ['ThreadTokenUsageUpdatedNotification', '', ['threadId', 'tokenUsage']],
  ['ThreadTokenUsage', '', ['total', 'last']],
  ['TokenUsageBreakdown', '', ['inputTokens', 'outputTokens', 'cachedInputTokens', 'cacheWriteInputTokens']],
  ['AccountRateLimitsUpdatedNotification', '', ['rateLimits']],
  ['RateLimitWindow', '', ['usedPercent', 'windowDurationMins', 'resetsAt']],
  ['ErrorNotification', '', ['threadId', 'error', 'willRetry']],
  ['TurnError', '', ['message', 'codexErrorInfo']],
  ['WarningNotification', '', ['message']],
  ['GuardianWarningNotification', '', ['message']],
  ['ConfigWarningNotification', '', ['summary', 'details']],
  ['ThreadItem', 'agentMessage', ['type', 'id', 'text']],
  ['ThreadItem', 'reasoning', ['type', 'id', 'summary']],
  ['ThreadItem', 'commandExecution', ['type', 'id', 'command', 'status', 'exitCode', 'aggregatedOutput']],
  ['ThreadItem', 'fileChange', ['type', 'id', 'changes', 'status']],
  ['ThreadItem', 'mcpToolCall', ['type', 'id', 'server', 'tool', 'status']],
  ['ThreadItem', 'dynamicToolCall', ['type', 'id', 'tool', 'status']],
  ['ThreadItem', 'collabAgentToolCall', ['type', 'id', 'tool', 'status']],
  ['ThreadItem', 'webSearch', ['type', 'id', 'query']],
  ['ThreadItem', 'imageGeneration', ['type', 'id', 'status']],
  ['ThreadItem', 'contextCompaction', ['type', 'id']],
  ['ThreadItem', 'userMessage', ['type', 'id']]
] as const
export const ERROR_VARIANTS = ['usageLimitExceeded', 'rateLimitExceeded', 'unauthorized', 'cyberPolicy', 'misalignmentPolicyViolation'] as const
export interface Schema {
  readonly definitions?: Readonly<Record<string, Schema>>
  readonly properties?: Readonly<Record<string, Schema>>
  readonly oneOf?: readonly Schema[]
  readonly anyOf?: readonly Schema[]
  readonly allOf?: readonly Schema[]
  readonly enum?: readonly unknown[]
  readonly $ref?: string
}
type ReadField = readonly [definition: string, variant: string, fields: readonly string[]]
function resolve(schema: Schema, root: Schema): Schema {
  if (schema.$ref?.startsWith('#/definitions/')) return root.definitions?.[schema.$ref.slice('#/definitions/'.length)] ?? {}
  return schema
}
function fields(schema: Schema, root: Schema): Readonly<Record<string, Schema>> {
  const held = resolve(schema, root)
  return Object.assign({}, ...(held.allOf ?? []).map((part) => fields(part, root)), held.properties ?? {})
}
function enumValues(schema: Schema, root: Schema): readonly unknown[] {
  const held = resolve(schema, root)
  return [...held.enum ?? [], ...[...held.oneOf ?? [], ...held.anyOf ?? []].flatMap((part) => enumValues(part, root))]
}
export function missingReadFields(root: Schema, reads: readonly ReadField[] = READ_FIELDS): readonly string[] {
  const missing: string[] = []
  for (const [definition, variant, names] of reads) {
    const schema = root.definitions?.[definition]
    if (schema === undefined) { missing.push(`${definition}: missing definition`); continue }
    const target = variant === '' ? schema : [...schema.oneOf ?? [], ...schema.anyOf ?? []].find((part) => enumValues(fields(part, root).type ?? {}, root).includes(variant))
    if (target === undefined) { missing.push(`${definition}.${variant}: missing variant`); continue }
    const properties = fields(target, root)
    for (const name of names) if (!(name in properties)) missing.push(`${definition}${variant === '' ? '' : `.${variant}`}.${name}`)
  }
  return missing
}
export function missingErrorVariants(root: Schema): readonly string[] {
  const variants = enumValues(root.definitions?.CodexErrorInfo ?? {}, root)
  return ERROR_VARIANTS.filter((variant) => !variants.includes(variant)).map((variant) => `CodexErrorInfo.${variant}`)
}
