// Eyes and hands on the clean-Windows beta VM, without Guest Additions.
//
//   node _tools/beta-vm.mjs state
//   node _tools/beta-vm.mjs look <name>          screenshot, kept with the others
//   node _tools/beta-vm.mjs type "some text"     typed into the guest
//   node _tools/beta-vm.mjs press enter|win|tab|esc|down|up
//   node _tools/beta-vm.mjs run "<powershell>"   Win+R, type, Enter
//   node _tools/beta-vm.mjs forward              guest 9222 -> host 9222
//
// WHY THIS EXISTS RATHER THAN `clean-machine.mjs`. That tool drove a VM built
// with Guest Additions, so it could copy a file in and start a process. This
// VM was built without them on purpose (the handoff of 2026-09-20), and
// installing them is itself something you would have to do from inside the
// guest -- which is the thing you cannot do. The way out is that VirtualBox
// will type for you: `keyboardputstring` and `keyboardputscancode` go to the
// guest's keyboard whether anything is installed in it or not.
//
// AND IT IS THE BETTER TEST ANYWAY. Copying the installer in over a shared
// folder skips the first two things a real user meets: the download, and
// what Windows says about running it. The guest has NAT, so it fetches the
// published installer from the internet like anybody else.
//
// THE ONE RULE: never power-cycle this VM while Windows is installing. Two
// earlier machines were lost that way -- setup leaves no bootable disk until
// it finishes, so the next boot either finds nothing or re-runs setup from
// the ISO. There is no resume, only starting again.

import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const VBOX = 'C:\\Program Files\\Oracle\\VirtualBox\\VBoxManage.exe'
const VM = 'LocustBetaFresh-20260920'
const SHOTS = new URL('../docs/beta-vm/', import.meta.url).pathname.slice(1)
const CDP_PORT = 9222

const say = (line) => console.error(line)

function vbox(args) {
  const result = spawnSync(VBOX, args, { encoding: 'utf8' })
  return { ok: result.status === 0, out: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() }
}

/*
 * Scancodes, make and break. A key that is pressed and never released stays
 * down in the guest, and everything typed afterwards arrives with that
 * modifier held -- which looks exactly like the guest ignoring you.
 */
const KEYS = {
  enter: ['1c', '9c'],
  tab: ['0f', '8f'],
  esc: ['01', '81'],
  down: ['e0', '50', 'e0', 'd0'],
  up: ['e0', '48', 'e0', 'c8'],
  win: ['e0', '5b', 'e0', 'db'],
  // Win held, R pressed and released, Win released. The Run box.
  'win-r': ['e0', '5b', '13', '93', 'e0', 'db']
}

const command = process.argv[2]
const argument = process.argv[3]

if (command === 'state') {
  const info = vbox(['showvminfo', VM, '--machinereadable'])
  const line = (key) => info.out.split('\n').find((row) => row.startsWith(`${key}=`)) ?? `${key}=?`
  say([line('VMState'), line('memory'), line('cpus'), line('Forwarding(0)')].join('\n'))
} else if (command === 'look') {
  mkdirSync(SHOTS, { recursive: true })
  const name = (argument ?? 'now').replace(/[^a-z0-9-]+/gi, '-')
  const file = join(SHOTS, `${name}.png`)
  const shot = vbox(['controlvm', VM, 'screenshotpng', file])
  say(shot.ok ? file : `could not photograph the guest: ${shot.out}`)
  if (!shot.ok) process.exitCode = 1
} else if (command === 'type') {
  if (argument === undefined) { say('nothing to type'); process.exit(1) }
  const typed = vbox(['controlvm', VM, 'keyboardputstring', argument])
  say(typed.ok ? `typed ${String(argument.length)} characters` : typed.out)
  if (!typed.ok) process.exitCode = 1
} else if (command === 'press') {
  const codes = KEYS[String(argument).toLowerCase()]
  if (codes === undefined) { say(`no such key; known: ${Object.keys(KEYS).join(', ')}`); process.exit(1) }
  const pressed = vbox(['controlvm', VM, 'keyboardputscancode', ...codes])
  say(pressed.ok ? `pressed ${String(argument)}` : pressed.out)
  if (!pressed.ok) process.exitCode = 1
} else if (command === 'run') {
  if (argument === undefined) { say('nothing to run'); process.exit(1) }
  /*
   * Win+R, then the line, then Enter. Deliberately NOT one call: the Run box
   * needs a moment to exist, and a string typed into a desktop that has not
   * drawn it yet goes to whatever has focus -- on a fresh Windows, nothing,
   * silently.
   */
  vbox(['controlvm', VM, 'keyboardputscancode', ...KEYS['win-r']])
  await new Promise((r) => setTimeout(r, 1200))
  const typed = vbox(['controlvm', VM, 'keyboardputstring', argument])
  if (!typed.ok) { say(typed.out); process.exit(1) }
  await new Promise((r) => setTimeout(r, 400))
  vbox(['controlvm', VM, 'keyboardputscancode', ...KEYS.enter])
  say(`ran: ${argument.slice(0, 120)}`)
} else if (command === 'forward') {
  /*
   * The guest's debugging port, out to this machine, so the ordinary CDP
   * drives in this repository reach a renderer running inside the VM. Added
   * to a RUNNING machine, which VirtualBox allows for NAT rules.
   */
  const added = vbox(['controlvm', VM, 'natpf1', `cdp,tcp,127.0.0.1,${String(CDP_PORT)},,${String(CDP_PORT)}`])
  say(added.ok ? `guest ${String(CDP_PORT)} -> host ${String(CDP_PORT)}` : added.out)
  if (!added.ok) process.exitCode = 1
} else if (command === 'wait') {
  /*
   * Wait until the guest stops showing a Windows setup screen.
   *
   * THE PROXY, STATED PLAINLY: setup's screens are almost entirely black, so
   * their PNG compresses to a few tens of kilobytes. A desktop, an OOBE page
   * or a sign-in screen is full of colour and compresses to several hundred.
   * So this watches the SIZE of the screenshot, which is a proxy for "the
   * screen got busy", not a reading of what it says.
   *
   * It is a proxy and it is allowed to be, for one reason: it never decides
   * anything. It only says when to come and look, and every sample it keeps
   * is a real photograph of the guest that a person reads with their eyes.
   * A waiter that concluded "installed" from a file size would be the thing
   * this repository keeps calling a measurement of nothing.
   */
  mkdirSync(SHOTS, { recursive: true })
  const busyBytes = 120_000
  const everyMs = 120_000
  const deadline = Date.now() + 90 * 60 * 1000
  const { statSync } = await import('node:fs')
  let sample = 0
  let busyRuns = 0
  for (;;) {
    sample += 1
    const file = join(SHOTS, `wait-${String(sample).padStart(3, '0')}.png`)
    const shot = vbox(['controlvm', VM, 'screenshotpng', file])
    if (!shot.ok) {
      // A VM that stopped answering is news, not something to keep polling.
      say(`the guest stopped answering at sample ${String(sample)}: ${shot.out}`)
      process.exitCode = 1
      break
    }
    const bytes = statSync(file).size
    busyRuns = bytes >= busyBytes ? busyRuns + 1 : 0
    say(`${new Date().toISOString().slice(11, 19)}  sample ${String(sample)}: ${String(Math.round(bytes / 1024))}KB${busyRuns > 0 ? '  (busy)' : ''}`)
    if (busyRuns >= 2) {
      say(`the screen has been busy twice running. Look at ${file}`)
      break
    }
    if (Date.now() >= deadline) {
      say('ninety minutes and the screen is still a setup screen. Look before assuming it is stuck.')
      process.exitCode = 1
      break
    }
    await new Promise((r) => setTimeout(r, everyMs))
  }
} else {
  say('commands: state, look <name>, wait, type "text", press <key>, run "<line>", forward')
  process.exitCode = 1
}
