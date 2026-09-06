// A person opens Locust on a machine with no runtime installed.
//
//   node _tools/drive-first-run.mjs
//
// Discovery is told to find nothing (LOCUST_HIDE_RUNTIMES=1, a seam on this
// machine which has everything). What a beta user with a fresh laptop
// sees: the home screen, the composer, a message they try to send, the
// New teammate dialog, Settings' runtime list. Nothing runs; no quota.

import { say, scratchRepository, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-drive-firstrun-ws-')
const drive = await startDrive({ name: 'first-run-no-runtimes', port: 9307, workspace, env: { LOCUST_HIDE_RUNTIMES: '1' } })

try {
  await drive.capture('launch with nothing installed', () => drive.ready())
  await drive.capture('the home screen in words', () => drive.evaluate(`(document.querySelector('.lc-empty')?.innerText ?? document.body.innerText).replace(/\\s+/g, ' ').slice(0, 400)`))
  await drive.capture('the composer: placeholder, route chip, send button', () => drive.evaluate(`JSON.stringify({
    placeholder: document.querySelector('form.command-dock textarea')?.placeholder ?? null,
    disabled: document.querySelector('form.command-dock textarea')?.disabled ?? null,
    controls: [...document.querySelectorAll('.lc-control')].map(c => c.innerText.replace(/\\s+/g, ' ').trim()).filter(Boolean),
    send: document.querySelector('button[aria-label="Start mission"]')?.disabled ?? 'no button',
    footer: document.querySelector('.lc-connected')?.innerText ?? null
  })`))
  await drive.capture('try to send a message anyway', () => drive.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    if (!field || field.disabled) return 'the field is disabled: ' + (field?.placeholder ?? '')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, 'hello'); field.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 300))
    const button = document.querySelector('button[aria-label="Start mission"]')
    if (!button) return 'no send button'
    if (button.disabled) return 'send disabled; title: ' + (button.title || 'none')
    button.click()
    await new Promise(r => setTimeout(r, 1200))
    return 'sent; screen: ' + document.body.innerText.replace(/\\s+/g, ' ').slice(0, 300)
  })()`))
  await drive.capture('open the New teammate dialog', () => drive.evaluate(`(async () => {
    document.querySelector('button[aria-label="New teammate"]')?.click()
    await new Promise(r => setTimeout(r, 500))
    const dialog = document.querySelector('[role=dialog]')
    return dialog ? dialog.innerText.replace(/\\s+/g, ' ').slice(0, 400) : 'no dialog'
  })()`))
  await drive.capture('Settings: the runtime list', () => drive.evaluate(`(async () => {
    const cancel = [...document.querySelectorAll('[role=dialog] button')].find(b => b.innerText.trim() === 'Cancel'); cancel?.click()
    await new Promise(r => setTimeout(r, 300))
    document.querySelector('button[title="Settings (Ctrl 3)"]').click()
    await new Promise(r => setTimeout(r, 900))
    const heading = [...document.querySelectorAll('.lc-settings__heading')].find(h => /Runtimes/.test(h.textContent))
    heading?.scrollIntoView({ block: 'start' })
    await new Promise(r => setTimeout(r, 300))
    return [...document.querySelectorAll('.lc-runtimerow')].map(r => r.innerText.replace(/\\s+/g, ' ').slice(0, 120)).join(' | ')
  })()`))
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Build: whatever `pnpm build` last wrote to out/. Discovery told to find nothing (LOCUST_HIDE_RUNTIMES=1): a fresh laptop with no runtime installed.' })
}
