// A Plan-mode turn, which is the one surface whose whole job is to answer.
//
//   node _tools/drive-plan-answer.mjs
//
// Plan mode's contract is "answers with the steps it would take, and changes
// nothing", so a successful run has no file rows and no command rows -- which
// means its steps are the entire output of the mode. That surface was drawn as
// a bordered card with a PLAN label, a `0 of 5 done` counter and one grey dot
// per step, all three of them reporting on a run that by contract never
// happened. It read as a run stalled at step one.
//
// It is now the teammate's answer: no box, beside the face, ordinals instead
// of state dots, at reading size, with one standing line saying why nothing
// changed.
//
// What this asks:
//   does a plan render beside the face rather than in a card
//   are the steps numbered rather than dotted
//   is there no PLAN label and no 0-of-N counter
//   does the standing line name the mode and point at the composer
//
// IT NEEDS CODEX, and that is a property of the app rather than of this drive.
//
// The plan item only exists when a runtime reports a STRUCTURED plan, and
// `plan.updated` is emitted by exactly two adapters -- codex-events and
// app-server-events -- both of which are Codex. Every other runtime answers a
// planning question in prose, which is an ordinary agent message and draws
// none of this.
//
// Measured the hard way: a free OpenCode run against this exact prompt
// produced four paragraphs with inline numbers, two tool calls and no plan
// item at all. That is not a defect; it is the mode's surface being reported
// by one provider.
//
// So this spends real quota and is gated accordingly. Run it deliberately:
//
//   LOCUST_SPEND=1 node _tools/drive-plan-answer.mjs
//
// Second surface in a week with the same constraint -- command output is the
// other -- which is worth knowing when planning what can be verified for free.

import { assertMaySpend, pickRouteScript, say, scratchRepository, startDrive, teammateFace } from './drive-lib.mjs'

assertMaySpend('drive-plan-answer')

const seed = {
  schemaVersion: 1,
  teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' }],
  missionOwners: {},
  settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
}

const workspace = await scratchRepository('locust-plan-ws-')
const drive = await startDrive({ name: 'plan-answer', port: 9413, workspace, seed, spends: true })

try {
  await drive.capture('ask for a plan, in Plan mode', async () => {
    await drive.ready()
    await drive.evaluate(`(async () => { ${teammateFace('Wren')}?.click(); await new Promise(r => setTimeout(r, 600)) })()`)
    // Codex, at the cheapest setting available, because only Codex reports a
    // structured plan. Effort is the only cost lever: model/list reports one
    // Codex model.
    await drive.evaluate(pickRouteScript({ group: '/codex/i', search: 'astra', row: '/astra/i' }))
    /*
     * Plan mode, through the menu a person uses -- and ASSERTED.
     *
     * A first version matched the menu item with a loose regex over every
     * button, and the click never landed: the run went in Accept edits, the
     * model answered in prose, and the drive reported "no plan rendered" as
     * though the feature were missing. The screenshot showed the menu still
     * open with the tick beside Accept edits.
     *
     * So it selects by the menu's own class and then reads the chip back. A
     * drive that quietly tests the wrong mode is worse than one that fails.
     */
    const mode = await drive.evaluate(`(async () => {
      const chip = [...document.querySelectorAll('button.lc-control')].find(b => /accept edits|ask|plan|approve|auto/i.test(b.textContent ?? ''))
      chip?.click()
      await new Promise(r => setTimeout(r, 500))
      const item = [...document.querySelectorAll('.lc-menu__item')]
        .find(el => (el.querySelector('.lc-menu__name')?.textContent ?? '').trim() === 'Plan')
      if (item === undefined) return 'NO PLAN ITEM IN THE MENU'
      item.click()
      await new Promise(r => setTimeout(r, 500))
      const now = [...document.querySelectorAll('button.lc-control')].find(b => /accept edits|ask|plan|approve|auto/i.test(b.textContent ?? ''))
      return (now?.textContent ?? '').trim()
    })()`)
    if (!/plan/i.test(String(mode))) {
      throw new Error(`the composer is not in Plan mode, it reads ${JSON.stringify(String(mode))} -- nothing below would mean anything`)
    }
    return drive.evaluate(`(async () => {
      const box = document.querySelector('textarea[aria-label="Message"]')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
      setter.call(box, 'How would you add a nullable currency column to invoices without downtime? Answer with numbered steps only.')
      box.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise(r => setTimeout(r, 200))
      box.focus()
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await new Promise(r => setTimeout(r, 45000))
      return 'sent'
    })()`)
  })

  await drive.capture('how the plan is drawn', async () => {
    return drive.evaluate(`(async () => {
      /*
       * The plan's own element, by its own classes. Reading the whole body for
       * the word PLAN has already produced false findings in this repo -- the
       * Missions filter chips once matched every state at once.
       *
       * No backticks in here: this comment is inside a template literal.
       */
      const list = document.querySelector('ol.lc-plan.is-answer')
      const legacyCard = [...document.querySelectorAll('.lc-card')].find(el => /^\\s*PLAN/m.test(el.innerText ?? ''))
      const standing = document.querySelector('.lc-planmode')
      return JSON.stringify({
        planIsAnOrderedList: list !== null,
        steps: list === null ? 0 : list.children.length,
        // Beside the face, in the register the teammate's prose uses.
        insideAgentLine: list !== null && list.closest('.lc-agentline') !== null,
        ordinals: document.querySelectorAll('.lc-plan__ordinal').length,
        stateDots: document.querySelectorAll('ol.lc-plan.is-answer .lc-dot').length,
        stillACard: legacyCard !== undefined,
        saysPlanLabel: /\\bPLAN\\b/.test(list === null ? '' : (list.closest('.lc-agentline')?.innerText ?? '')),
        standingLine: standing === null ? null : (standing.innerText ?? '').replace(/\\s+/g, ' ')
      })
    })()`)
  })
} finally {
  await drive.finish({
    intro: 'A Plan-mode turn: the steps ARE the answer, so they are drawn where the teammate speaks rather than in a box.'
  })
}

say('done')
