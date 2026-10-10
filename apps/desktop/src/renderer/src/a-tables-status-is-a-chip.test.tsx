import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { statusAsk } from './components/StatusChip.js'
import { AgentText } from './components/ThreadItems.js'
import { ThreadImagesContext } from './threadImages.js'
import { statusColumnOf, statusToneOf } from './statusChips.js'

/*
 * A TABLE'S STATUS, AS CHIPS (0.728). A teammate's tracker is a table with a Status column; its values it knows
 * are drawn in their tone, and everything else stays the words it was.
 */
describe('a table’s status column', () => {
  it('is found by its header, marks and all', () => {
    expect(statusColumnOf(['Task', 'Owner', 'Status'])).toBe(2)
    expect(statusColumnOf(['**State**', 'Item'])).toBe(0)
    expect(statusColumnOf(['Task', 'Owner'])).toBeUndefined()
    expect(statusColumnOf(['Status of the build'])).toBeUndefined()
  })

  it('knows a value by its first words, and nothing it does not know', () => {
    expect(statusToneOf('Done')).toBe('green')
    expect(statusToneOf('✅ Done')).toBe('green')
    expect(statusToneOf('**Merged** (#41)')).toBe('green')
    expect(statusToneOf('In progress')).toBe('blue')
    expect(statusToneOf('Blocked: waiting on the API key')).toBe('red')
    expect(statusToneOf('Waiting')).toBe('amber')
    expect(statusToneOf('Not started')).toBe('quiet')
    // "Done" inside other words is not a status; neither is a sentence.
    expect(statusToneOf('Doneness check')).toBeUndefined()
    expect(statusToneOf('The second half of the build is still running on the old machine')).toBeUndefined()
    expect(statusToneOf('')).toBeUndefined()
  })

  it('draws as chips in a reply, and leaves other columns and unknown values alone', () => {
    const html = renderToStaticMarkup(
      <AgentText
        text={['| Task | Status |', '| --- | --- |', '| Login fix | Done |', '| Signup form | In progress |', '| Billing | Blocked |', '| Docs | Halfway, see notes |'].join('\n')}
        streaming={false}
      />
    )
    expect(html).toContain('<span class="lc-status lc-status--green"><span>Done</span></span>')
    expect(html).toContain('<span class="lc-status lc-status--blue"><span>In progress</span></span>')
    expect(html).toContain('<span class="lc-status lc-status--red"><span>Blocked</span></span>')
    expect(html).toContain('<td><span>Halfway, see notes</span></td>')
    expect(html).toContain('<td><span>Login fix</span></td>')
  })

  it('is a chip you can change where the thread has a box, naming its row (0.733)', () => {
    const html = renderToStaticMarkup(
      <ThreadImagesContext.Provider value={{ folder: undefined, onOpenFile: undefined, onDraft: () => undefined }}>
        <AgentText text={['| Task | Status |', '| --- | --- |', '| **Billing** rename | Blocked |'].join('\n')} streaming={false} />
      </ThreadImagesContext.Provider>
    )
    expect(html).toContain('<button type="button" class="lc-status lc-status--red is-button" aria-haspopup="menu" aria-expanded="false" title="Change the status of Billing rename">')
    expect(statusAsk('Billing rename', 'Done')).toBe('Mark "Billing rename" as Done in the tracker, and say what that changes.')
  })
})
