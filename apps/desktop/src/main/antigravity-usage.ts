import { execFile } from 'node:child_process'
import type { RuntimeDiscovery } from '@teammate/runtime-adapters'

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Read only the CLI's built-in usage command, never a prompt or a login file. */
export function readAntigravityUsage(executable: NonNullable<RuntimeDiscovery['executable']>): Promise<unknown> {
  return new Promise((resolve) => {
    execFile(executable.executablePath, [...executable.prefixArgs, '-p', '/usage', '--output-format', 'json'], {
      windowsHide: true,
      shell: false,
      timeout: 10_000,
      maxBuffer: 256 * 1024,
      env: { ...process.env, ...executable.env }
    }, (error, stdout) => {
      if (error !== null) { resolve(undefined); return }
      try { resolve(JSON.parse(stdout)) } catch { resolve(undefined) }
    })
  })
}

/** Short window first; other models are included when their remaining limit is lower. */
export function antigravityUsageText(answer: unknown): string | undefined {
  if (!object(answer) || answer.status !== 'SUCCESS' || answer.num_turns !== 0
    || !object(answer.command) || answer.command.name !== 'usage' || !object(answer.command.data)
    || !Array.isArray(answer.command.data.groups)) return undefined

  const groups = new Map<string, { text: string; remaining: number }>()
  for (const group of answer.command.data.groups) {
    if (!object(group) || !Array.isArray(group.buckets)) return undefined
    const label = group.name === 'Gemini Models' ? 'Gemini' : group.name === 'Claude and GPT models' ? 'Claude and GPT' : undefined
    if (label === undefined || groups.has(label)) return undefined
    const buckets = new Map<string, { remaining: number; reset?: string }>()
    for (const bucket of group.buckets) {
      if (!object(bucket) || (bucket.window !== '5h' && bucket.window !== 'weekly')
        || typeof bucket.remaining_fraction !== 'number' || !Number.isFinite(bucket.remaining_fraction)
        || bucket.remaining_fraction < 0 || bucket.remaining_fraction > 1 || buckets.has(bucket.window)) return undefined
      const reset = typeof bucket.reset_time === 'string' && Number.isFinite(Date.parse(bucket.reset_time))
        ? new Date(bucket.reset_time).toISOString() : undefined
      // A full bucket's moving "now + window" is not a scheduled refresh.
      buckets.set(bucket.window, { remaining: bucket.remaining_fraction, ...(bucket.remaining_fraction === 1 || reset === undefined ? {} : { reset }) })
    }
    if (buckets.size !== 2) return undefined
    const text = ['5h', 'weekly'].map((window) => {
      const bucket = buckets.get(window)!
      return `${label}: ${window === '5h' ? '5-hour' : 'weekly'} window ${String(Math.round(bucket.remaining * 100))}% left${bucket.reset === undefined ? '' : ` · resets ${bucket.reset}`}`
    }).join(' · ')
    groups.set(label, { text, remaining: Math.min(...[...buckets.values()].map((bucket) => bucket.remaining)) })
  }
  const gemini = groups.get('Gemini')
  const other = groups.get('Claude and GPT')
  if (gemini === undefined || other === undefined) return undefined
  return gemini.text + (other.remaining < gemini.remaining ? ` · ${other.text}` : '')
}
