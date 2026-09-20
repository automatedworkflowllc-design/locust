// The metal send button: visible at rest, awake on hover, and still a button.
//
//   node _tools/metal-send-drive.mjs [--keep]
//
// THE RISK THIS EXISTS FOR. `MetalFx` reveals on its first shader copy, and
// the design agent's own write-up records three ways to end up with a control
// that is invisible forever -- mounting paused, an unstable ref that remounts
// it before a cold shader lands, and overlaying instead of wrapping. The
// button in question is the one a person sends with. A quiet failure here is
// not a missing flourish, it is an app you cannot use.
//
// So the first two checks are about the plain button, not the effect: it has
// a box, and it still sends. The effect is checked after that.
//
// Free: one turn on the free OpenCode model.

import { FREE_ROUTE, pickRouteScript, say, scratchRepository, sendAndWaitScript, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-metal-ws-')
const T0 = '2026-09-20T05:00:00.000Z'

let failures = 0
const check = (label, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 200)}`}`)
}

const drive = await startDrive({
  name: 'metal-send',
  port: 9526,
  workspace,
  spends: false,
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: T0, route: { ...FREE_ROUTE } }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' }
  }
})

/** Everything about the send control that a person would notice. */
const LOOK = `(() => {
  const button = document.querySelector('form.command-dock .lc-send')
  if (!button) return JSON.stringify({ error: 'no send button' })
  const box = button.getBoundingClientRect()
  const root = document.querySelector('form.command-dock .metal-fx-root')
  const canvas = root ? root.querySelector('canvas') : null
  const style = getComputedStyle(button)
  return JSON.stringify({
    width: Math.round(box.width),
    height: Math.round(box.height),
    visible: box.width > 8 && box.height > 8 && style.visibility !== 'hidden' && style.display !== 'none',
    hasIcon: button.querySelector('svg') !== null,
    // The element the eye lands on: whichever of the two is on top at the
    // button's own centre. If metal ever covers the control this is what says so.
    onTop: (() => {
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
      return hit === null ? 'nothing' : (hit.tagName + '.' + (hit.getAttribute('class') || '')).slice(0, 48)
    })(),
    metalMounted: root !== null,
    metalOpacity: root ? getComputedStyle(root).opacity : null,
    metalPaused: root ? root.getAttribute('data-paused') : null,
    canvasPx: canvas ? canvas.width + 'x' + canvas.height : null
  })
})()`

try {
  await drive.capture('launch', () => drive.ready())

  await drive.capture('the send button at rest', async () => {
    const seen = JSON.parse(await drive.waitFor(LOOK, { what: 'the send control', timeoutMs: 15_000 }))
    check('the send button has a real box', seen.visible === true, JSON.stringify(seen))
    check('its arrow is still drawn', seen.hasIcon === true)
    check('nothing covers it at its own centre', !/canvas/i.test(String(seen.onTop)), seen.onTop)
    return JSON.stringify(seen)
  })

  await drive.capture('the shader revealed, then went quiet', async () => {
    // Finding 1: a paused mount never paints, so the reveal has to happen
    // first and the pause after. Both halves are asserted.
    const revealed = JSON.parse(await drive.waitFor(
      `(() => { const s = ${LOOK}; const v = JSON.parse(s); return v.metalOpacity === '1' ? s : false })()`,
      { what: 'the metal root to reveal', timeoutMs: 20_000 }
    ))
    check('the shader painted at least one frame', revealed.canvasPx !== null && revealed.canvasPx !== '0x0', revealed.canvasPx)
    const quiet = JSON.parse(await drive.waitFor(
      `(() => { const s = ${LOOK}; const v = JSON.parse(s); return v.metalPaused === 'true' ? s : false })()`,
      { what: 'it to pause at rest', timeoutMs: 10_000 }
    ))
    check('it is paused at rest, so nothing shimmers on an idle screen', quiet.metalPaused === 'true', quiet.metalPaused)
    return `opacity ${String(revealed.metalOpacity)}, canvas ${String(revealed.canvasPx)}, paused ${String(quiet.metalPaused)}`
  })

  await drive.capture('hover wakes it, leaving puts it back', async () => {
    /*
     * TYPE FIRST. With an empty box the send button is `disabled`, and a
     * disabled button fires no pointer events at all -- so the first version
     * of this step hovered a dead control and reported the app broken. That
     * is also the right behaviour to have: an invitation that cannot be
     * accepted should not shimmer when you point at it.
     */
    await drive.evaluate(`(() => {
      const field = document.querySelector('form.command-dock textarea')
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      set.call(field, 'hello')
      field.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`)
    await drive.waitFor(`document.querySelector('form.command-dock .lc-send')?.disabled === false`, { what: 'the send button to become pressable', timeoutMs: 5_000 })
    const at = JSON.parse(await drive.evaluate(`(() => { const b = document.querySelector('form.command-dock .lc-send').getBoundingClientRect(); return JSON.stringify({ x: Math.round(b.left + b.width/2), y: Math.round(b.top + b.height/2) }) })()`))
    /*
     * A real pointer, through CDP, because React's enter/leave is delegated
     * from pointerover and a synthetic dispatch would not prove the wiring.
     *
     * Parked somewhere else FIRST: an "enter" is a transition, and a page
     * whose pointer has never been anywhere has nothing to transition from.
     */
    await drive.evaluate(`(() => {
      const b = document.querySelector('form.command-dock .lc-send')
      window.__nativeOver = false
      b.addEventListener('pointerover', () => { window.__nativeOver = true })
      return true
    })()`)
    await drive.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 10, y: 10, buttons: 0 })
    await new Promise((r) => setTimeout(r, 200))
    await drive.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y, buttons: 0 })
    /*
     * WAIT FOR THE VALUE, NOT FOR THE ATTRIBUTE.
     *
     * `data-paused` is "true" WHEN PAUSED AND ABSENT OTHERWISE -- the library
     * writes `l ? "true" : void 0`, so there is no "false" to wait for. Two
     * wrong predicates came out of that one attribute: first waiting on the
     * attribute itself, which is a truthy string the instant it is read, and
     * then waiting for "false", which never arrives. Both reported the app
     * broken while it was working. **Read the library, not the drawing's
     * prose, for the shape of a value you are asserting on.**
     */
    const awake = await drive.waitFor(
      `document.querySelector('form.command-dock .metal-fx-root')?.hasAttribute('data-paused') === false`,
      { what: 'the shader to wake on hover', timeoutMs: 6_000 }
    ).catch(() => false)
    if (awake !== true) {
      // Why not. Native events, the element under the cursor, and what the
      // library put around the button -- rather than a third guess.
      const why = await drive.evaluate(`(() => {
        const b = document.querySelector('form.command-dock .lc-send')
        const box = b.getBoundingClientRect()
        const hit = document.elementFromPoint(box.left + box.width/2, box.top + box.height/2)
        let chain = []
        for (let el = hit; el && chain.length < 6; el = el.parentElement) chain.push(el.tagName + '.' + (el.getAttribute('class') || ''))
        const host = document.querySelector('.lc-metalsend')
        return JSON.stringify({ disabled: b.disabled, sawNative: window.__nativeOver === true, awake: host?.getAttribute('data-awake'), warm: host?.getAttribute('data-warm'), chain })
      })()`)
      say(`     why not: ${String(why)}`)
    }
    check('hovering wakes it', awake === true, awake)
    await drive.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 10, y: 10, buttons: 0 })
    const back = await drive.waitFor(
      `document.querySelector('form.command-dock .metal-fx-root')?.getAttribute('data-paused') === 'true'`,
      { what: 'it to go quiet again', timeoutMs: 6_000 }
    ).catch(() => false)
    check('leaving puts it back to sleep', back === true)
    return `hover ${String(awake)} → leave ${String(back)}`
  })

  await drive.capture('it is still the send button', async () => {
    await drive.evaluate(pickRouteScript({ group: '/opencode/i', search: 'muse', row: '/free/i' }))
    const answer = await drive.evaluate(sendAndWaitScript('Reply with the single word METAL and nothing else.'))
    check('a message still sends', /metal/i.test(String(answer)), String(answer).slice(0, 120))
    return String(answer).slice(0, 140)
  })
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  const threw = drive.record.filter((row) => /^threw: /.test(String(row.note)))
  threw.forEach((row) => check(`step ${String(row.step)} (${row.title}) completed`, false, row.note))
  say(failures === 0 ? '\nall checks passed' : `\n${String(failures)} check(s) failed`)
  await drive.finish({ intro: 'The metal send button: visible at rest, awake on hover, and still able to send.' })
  process.exitCode = failures === 0 ? 0 : 1
}
