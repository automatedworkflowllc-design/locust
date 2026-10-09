// Compare on a free teammate stays free, and the kept answer is what carries on (0.515).
//
//   node _tools/drive-compare-keep-carries-on.mjs [--packaged <exe>] [--tag <name>]
//
// A pass on 0.512, office work on a free teammate: Compare put model B on a
// paid model nobody chose; keeping B left the chat box on the teammate's own
// model, and the next message went there as "a fresh session". Wren is on a
// free model. Compare starts on two free ones; B is kept; the chat box must
// say B's model; the next message must carry on with no fresh-session note.
// Free models only.

import { join } from 'node:path'
import { openTeammateScript, recordRoot, say, scratchRepository, sendAndWaitScript, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
// Wren on the catalogue's first free model, so Compare's B is another free one, and B is kept:
// the kept model is then never Wren's own. (Ling was down on 2026-10-01; B answers either way.)
const WREN_MODEL = process.env.LOCUST_FREE_MODEL ?? 'opencode/ling-3.0-flash-fin-free'
const workspace = await scratchRepository('locust-drive-compare-keep-ws-')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `compare-keep-carries-on-${tag}`,
  port: 9823,
  workspace,
  outPath: join(recordRoot('compare-keep-carries-on-2026-10-01'), tag),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'violet', role: 'Research & Briefs', createdAt: '2026-09-28T01:00:00.000Z', route: { runtime: 'opencode', model: WREN_MODEL, mode: 'ask' } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' }
  }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 260)}`}`)
}
// In Compare each model has its own dropdown; one model, one. Read as 'A vs B' either way.
const chip = `[...document.querySelectorAll('.lc-control')].filter((b) => b.getAttribute('aria-haspopup') === 'listbox').map((b) => b.innerText.replace(/\\s+/g, ' ').trim()).join(' vs ')`

try {
  await drive.capture('launch', () => drive.ready())
  await drive.evaluate(openTeammateScript('Wren'))
  const picked = String(await drive.capture('Compare picked on a free teammate', () => drive.evaluate(`(async () => {
    document.querySelector('.lc-control--chatmode')?.click()
    await new Promise((r) => setTimeout(r, 400))
    ;[...document.querySelectorAll('.lc-menu [role="menuitemradio"]')].find((el) => /^Compare/.test(el.innerText.trim()))?.click()
    await new Promise((r) => setTimeout(r, 1500))
    document.querySelector('.lc-picker') && document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await new Promise((r) => setTimeout(r, 400))
    return ${chip}
  })()`)))
  const [a, b] = picked.split(' vs ')
  check('Compare starts on two models', a !== undefined && b !== undefined, picked)
  check('both free, on a free teammate: no paid model nobody chose', /free/i.test(picked) && !/GPT|Claude|Opus|Sonnet|Fable|Grok|Codex/i.test(picked), picked)
  await drive.capture('asked both', () => drive.evaluate(sendAndWaitScript('Reply with one short sentence about the sea.')))
  /*
   * B's provider down (0.711): Ling 3.0 said "Model is unavailable" for over twelve hours over 2026-10-08/09, and as
   * the first free model listed it is B in a fresh profile -- the 0.710 and 0.711 sweeps both failed here on a column
   * that never answered, while Locust was fine. A person would do what the comparison offers under it: ASK ANOTHER
   * MODEL, a third column asked the same question. So does this, on another free model, and keeps THAT column -- still
   * a free model that is not Wren's own, which is what this drive is about. Locust itself passes over a free model it
   * has seen down (missionView.downFreeModels); a fresh profile has seen nothing.
   */
  const bDown = JSON.parse(String(await drive.evaluate(`(async () => {
    const settled = () => [...document.querySelectorAll('.lc-compare__head:not(.is-rail)')].every((el) => !/working|starting/i.test(el.innerText))
    for (let i = 0; i < 480 && !settled(); i += 1) await new Promise((r) => setTimeout(r, 500))
    const bFoot = [...document.querySelectorAll('.lc-compare__foot:not(.is-rail)')][1]?.innerText ?? ''
    return JSON.stringify({ down: /(?:model|endpoint) is unavailable/i.test(document.querySelector('.lc-compare')?.innerText ?? '') && !/Keep this one/.test(bFoot), foot: bFoot.replace(/\s+/g, ' ').slice(0, 120) })
  })()`)))
  let keepAt = 1
  if (bDown.down === true) {
    say(`  B's provider is down (${bDown.foot}); asking another free model too, as the comparison offers`)
    const added = JSON.parse(String(await drive.evaluate(`(async () => {
      const pick = document.querySelector('.lc-compare__judgepick[aria-label="The model to ask too"]')
      if (!pick) return JSON.stringify({ asked: false, why: 'no Ask another model' })
      const names = [...document.querySelectorAll('.lc-compare__head:not(.is-rail) .lc-compare__name')].map((el) => el.innerText.split(' · ')[0].trim().toLowerCase())
      // Another maker than any column's: Ling 3.1 was down with Ling 3.0 (0.711 drive), and a comparison holds three.
      const maker = (text) => text.replace(/^OpenCode \\/ /i, '').split(/\\s+/)[0].toLowerCase()
      const makers = names.map(maker)
      const option = [...pick.options].find((one) => /free/i.test(one.text) && !/exo/i.test(one.text) && !makers.includes(maker(one.text)))
      if (!option) return JSON.stringify({ asked: false, why: 'no other free model offered', options: [...pick.options].map((one) => one.text).slice(0, 12) })
      const setSelect = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
      setSelect.call(pick, option.value)
      pick.dispatchEvent(new Event('change', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 300))
      const ask = [...pick.parentElement.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Ask it too')
      if (!ask || ask.disabled) return JSON.stringify({ asked: false, why: 'Ask it too not pressable', chose: option.text })
      ask.click()
      for (let i = 0; i < 40 && document.querySelectorAll('.lc-compare__head:not(.is-rail)').length < 3; i += 1) await new Promise((r) => setTimeout(r, 250))
      return JSON.stringify({ asked: true, chose: option.text, columns: document.querySelectorAll('.lc-compare__head:not(.is-rail)').length })
    })()`)))
    say(`  asked too: ${JSON.stringify(added)}`)
    if (added.asked !== true || added.columns < 3) throw new Error(`B's provider was down and no other model could be asked: ${JSON.stringify(added)}`)
    keepAt = 2
  }
  const kept = String(await drive.capture('kept B', () => drive.evaluate(`(async () => {
    // Every column settled, and the kept one's Keep pressable (B's, or the model asked too when B was down): a column still working cannot be kept.
    const settled = () => {
      const heads = [...document.querySelectorAll('.lc-compare__head:not(.is-rail)')].map((el) => el.innerText)
      // B's OWN Keep, in B's foot (the second column): the last Keep on the page was A's whenever B had none
      // to offer, and A was kept while this drive thought B was (0.697, found with a debug build).
      const keep = [...([...document.querySelectorAll('.lc-compare__foot:not(.is-rail)')][${keepAt}]?.querySelectorAll('button') ?? [])].find((b) => b.innerText.trim() === 'Keep this one')
      return heads.length >= 2 && !heads.some((text) => /working|starting/i.test(text)) && keep !== undefined && !keep.disabled
    }
    for (let i = 0; i < 480 && !settled(); i += 1) await new Promise((r) => setTimeout(r, 500))
    const name = [...document.querySelectorAll('.lc-compare__head:not(.is-rail) .lc-compare__name')].map((el) => el.innerText.trim())[${keepAt}] ?? ''
    const bKeep = [...([...document.querySelectorAll('.lc-compare__foot:not(.is-rail)')][${keepAt}]?.querySelectorAll('button') ?? [])].find((b) => b.innerText.trim() === 'Keep this one')
    if (!bKeep || bKeep.disabled) return JSON.stringify({ name, chip: ${chip}, gone: false, noKeepForB: true })
    bKeep.click()
    for (let i = 0; i < 40 && document.querySelector('.lc-compare'); i += 1) await new Promise((r) => setTimeout(r, 250))
    await new Promise((r) => setTimeout(r, 1200))
    return JSON.stringify({ name, chip: ${chip}, gone: document.querySelector('.lc-compare') === null })
  })()`)))
  const k = JSON.parse(kept)
  // B with nothing to keep (its provider failed) is not this drive's question: said, and stopped.
  if (k.noKeepForB === true) throw new Error(`B offered no Keep (its answer did not come): ${kept}`)
  const word = (k.name.split(/\s+/)[0] ?? '').toLowerCase()
  check('keeping B leaves an ordinary conversation', k.gone === true, kept)
  check('and the chat box is on B\'s model, the one kept', word.length > 0 && k.chip.toLowerCase().includes(word), kept)
  await drive.capture('a follow-up after keeping', () => drive.evaluate(sendAndWaitScript('Reply with just the word NEXT.')))
  // The reply is what comes AFTER the words asked: they say NEXT too.
  const after = JSON.parse(String(await drive.evaluate(`(async () => {
    const asked = 'Reply with just the word NEXT.'
    const replied = () => {
      const all = (document.querySelector('.lc-thread')?.innerText ?? '').replace(/\\s+/g, ' ')
      return all.slice(all.lastIndexOf(asked) + asked.length)
    }
    for (let i = 0; i < 240 && !/NEXT/.test(replied()); i += 1) await new Promise((r) => setTimeout(r, 500))
    return JSON.stringify({
      notes: [...document.querySelectorAll('.lc-thread .lc-thread__note')].map((el) => el.innerText.replace(/\\s+/g, ' ').trim()),
      tail: replied().slice(0, 160)
    })
  })()`)))
  check('the next message carries the kept answer on, with no "fresh session"', /NEXT/.test(after.tail) && !after.notes.some((note) => /fresh session/i.test(note)), JSON.stringify(after))
  // What the follow-up RAN on, from the record: the chat box's word is only a promise (0.697).
  const ran = JSON.parse(String(await drive.evaluate(`window.desktop.getMissionHistory().then((h) => JSON.stringify(h.ok ? h.data.missions.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 4).map((m) => ({ model: m.model, prompt: String(m.prompt).slice(0, 30) })) : []))`)))
  say(`  newest runs: ${JSON.stringify(ran)}`)
  const followUp = ran.find((m) => /Reply with just the word NEXT/.test(m.prompt))
  check("and that next message ran on B's model", word.length > 0 && String(followUp?.model ?? '').toLowerCase().includes(word), JSON.stringify(followUp))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Wren on a free model.`, extra: `Checks failed: ${String(failures)}` })
}
if (failures > 0) process.exitCode = 1
