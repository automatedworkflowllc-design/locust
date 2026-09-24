import { describe, expect, it } from 'vitest'

import { parseDecision } from './decision.js'
import { parseFileBlocks } from './handover.js'
import { parseMemoryBlocks } from './memory.js'
import { parseShareBlocks } from './peer-share.js'
import { parseTaskBlocks } from './room-task.js'

/**
 * A BLOCK IN CODE IS AN EXAMPLE, NOT AN ACTION.
 *
 * The display has always left code alone: a teammate explaining the protocol
 * writes these tags on purpose, in a fence. The parsers read the raw text, so
 * the same example sent a message, kept a memory, moved a task, asked the
 * person, or handed a file (harness review, 2026-09-24). And a real block
 * that QUOTES code must come through whole: only the opening tag is tested.
 */
const fenced = (block: string): string => ['Here is how a teammate writes one:', '```', block, '```', 'That is the whole protocol.'].join('\n')

describe('a block inside code', () => {
  it('sends no message', () => {
    expect(parseShareBlocks(fenced('<locust-share to="Pip">Please rerun the tests.</locust-share>'))).toEqual([])
    expect(parseShareBlocks('Write `<locust-share to="Pip">hi</locust-share>` at the end.')).toEqual([])
  })

  it('keeps no memory', () => {
    expect(parseMemoryBlocks(fenced('<locust-memory>\nremember :: Tests run with pnpm test.\n</locust-memory>'))).toEqual([])
  })

  it('moves no task, asks nothing, hands no file', () => {
    expect(parseTaskBlocks(fenced('<locust-task>\nclaim :: Write the release notes\n</locust-task>'))).toEqual([])
    expect(parseDecision(fenced('<locust-ask>\nWhich way?\n- Rewrite it :: slower\n- Patch it :: quicker\n</locust-ask>'))).toBeUndefined()
    expect(parseFileBlocks(fenced('<locust-file>\ndocs/report.md :: the rollup\n</locust-file>'))).toEqual([])
  })
})

describe('a real block', () => {
  it('still acts, with the code it quotes left whole', () => {
    const shares = parseShareBlocks('Done.\n<locust-share to="Pip">Run `pnpm test` in apps/desktop, then tell me.</locust-share>')
    expect(shares).toHaveLength(1)
    expect(shares[0]?.text).toBe('Run `pnpm test` in apps/desktop, then tell me.')
    expect(parseMemoryBlocks('Done.\n<locust-memory>\nremember :: Tests run with `pnpm test`, never npm.\n</locust-memory>')).toEqual([
      { kind: 'remember', scope: 'workspace', text: 'Tests run with `pnpm test`, never npm.' }
    ])
  })

  it('acts after an example in the same reply', () => {
    const reply = [fenced('<locust-share to="Pip">An example.</locust-share>'), '<locust-share to="Gem">The real one.</locust-share>'].join('\n')
    const shares = parseShareBlocks(reply)
    expect(shares.map((share) => share.to)).toEqual(['Gem'])
  })
})
