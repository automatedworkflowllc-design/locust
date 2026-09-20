// A Windows machine that has never seen Locust, driven the way every other
// surface in this repo is driven.
//
//   node _tools/clean-machine.mjs build     make the VM, once, from the ISO
//   node _tools/clean-machine.mjs reset     restore the clean snapshot
//   node _tools/clean-machine.mjs install   copy the installer in and run it
//   node _tools/clean-machine.mjs drive     launch the installed app and look
//   node _tools/clean-machine.mjs off       power the VM off
//
// WHY THIS EXISTS. The installer, SmartScreen, the Start-menu shortcut, the
// first launch after a real install, uninstall: none of it has ever been
// tested by anybody, on any machine, and it is the exact path a first user
// takes. Two outside testers have said so in every pass for a week, and the
// answer was always "nobody has a clean Windows box".
//
// `bare-machine-frame.mjs` is NOT this. It launches the packaged build with a
// bare PATH and empty APPDATA, which is a good approximation of "nothing
// installed" and no approximation at all of "nothing installed AND the app
// arrived through its own installer on a machine with its own Defender,
// SmartScreen and registry".
//
// WHAT IT COSTS. Nothing per run. The VM is a free Microsoft evaluation image
// (90 days, re-buildable), VirtualBox is free, and the snapshot makes every
// run after the first one a restore rather than an install.
//
// HOW THE EYES WORK. Guest Additions give `VBoxManage guestcontrol`, so the
// host can copy a file in and start a process. NAT forwards the guest's
// remote-debugging port to the host, so the SAME CDP code every drive in this
// repo uses reaches a renderer running inside the VM. Screenshots come back
// as they always do, through `Page.captureScreenshot`.

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const VBOX = 'C:\\Program Files\\Oracle\\VirtualBox\\VBoxManage.exe'
const VM = 'LocustCleanMachine'
const SNAPSHOT = 'clean'
const VM_DIR = 'C:\\Users\\<home>\\VMs'
const ISO = join(VM_DIR, 'Win11Eval.iso')
/** Inside the guest. The eval image's own user, made by the unattended install. */
const GUEST_USER = 'locust'
const GUEST_PASSWORD = 'locust'
/** Guest 9222 -> host 9222, so the CDP client below is the ordinary one. */
const CDP_PORT = 9222

const say = (line) => console.error(line)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function vbox(args, { quiet = false } = {}) {
  const result = spawnSync(VBOX, args, { encoding: 'utf8' })
  const out = `${result.stdout ?? ''}${result.stderr ?? ''}`
  if (!quiet && out.trim().length > 0) say(`   ${out.trim().split('\n').slice(0, 6).join('\n   ')}`)
  return { ok: result.status === 0, out }
}

const exists = () => vbox(['showvminfo', VM, '--machinereadable'], { quiet: true }).ok

/**
 * The VM, once.
 *
 * Windows 11 wants TPM 2.0 and Secure Boot, and VirtualBox 7 provides both --
 * `--tpm-type 2.0` with EFI. Getting this wrong is the "This PC can't run
 * Windows 11" dead end, which is worth naming because it costs a whole
 * download to discover.
 *
 * The disk is a growing image: a clean Windows 11 settles near 25GB and this
 * machine has about 64 free, so a fixed 40GB allocation would fit and a
 * second VM would not.
 */
async function build() {
  if (!existsSync(ISO)) {
    say(`no ISO at ${ISO}`)
    say('download the free evaluation image first; see the header of this file')
    process.exitCode = 1
    return
  }
  if (exists()) {
    say(`${VM} already exists. Use reset, or delete it first with:`)
    say(`   "${VBOX}" unregistervm ${VM} --delete`)
    return
  }
  await mkdir(VM_DIR, { recursive: true })

  say('1. creating the machine')
  vbox(['createvm', '--name', VM, '--ostype', 'Windows11_64', '--register', '--basefolder', VM_DIR])
  vbox([
    'modifyvm', VM,
    '--memory', '6144',
    '--cpus', '4',
    '--firmware', 'efi',
    '--tpm-type', '2.0',
    '--secure-boot', 'on',
    '--graphicscontroller', 'vboxsvga',
    '--vram', '128',
    '--nic1', 'nat',
    // The whole point: the guest's debugging port, reachable from here.
    '--nat-pf1', `cdp,tcp,127.0.0.1,${String(CDP_PORT)},,${String(CDP_PORT)}`,
    '--clipboard-mode', 'bidirectional'
  ])

  say('2. disk and drives')
  const disk = join(VM_DIR, VM, `${VM}.vdi`)
  vbox(['createmedium', 'disk', '--filename', disk, '--size', '40960', '--format', 'VDI'])
  vbox(['storagectl', VM, '--name', 'SATA', '--add', 'sata', '--controller', 'IntelAhci', '--portcount', '2'])
  vbox(['storageattach', VM, '--storagectl', 'SATA', '--port', '0', '--device', '0', '--type', 'hdd', '--medium', disk])
  vbox(['storageattach', VM, '--storagectl', 'SATA', '--port', '1', '--device', '0', '--type', 'dvddrive', '--medium', ISO])

  say('3. unattended install -- VirtualBox writes the answer file itself')
  /*
   * `unattended` rather than a hand-written autounattend.xml: VirtualBox 7
   * generates one for the detected image, which is one fewer thing to be
   * subtly wrong about. `--install-additions` is not optional here -- Guest
   * Additions are how the host copies the installer in and starts it.
   */
  vbox([
    'unattended', 'install', VM,
    `--iso=${ISO}`,
    `--user=${GUEST_USER}`,
    `--password=${GUEST_PASSWORD}`,
    '--full-user-name=Locust Tester',
    '--install-additions',
    '--locale=en_US',
    '--time-zone=EST',
    '--start-vm=gui'
  ])

  say('')
  say('   Windows is installing. It reboots itself a few times and takes')
  say('   roughly 20 minutes. Nothing to click.')
  say('')
  say('   When the desktop is up, snapshot it:')
  say(`     "${VBOX}" snapshot ${VM} take ${SNAPSHOT} --pause`)
  say('   Every run after that is a restore, which takes seconds.')
}

function reset() {
  say(`restoring ${SNAPSHOT}`)
  vbox(['controlvm', VM, 'poweroff'], { quiet: true })
  vbox(['snapshot', VM, 'restore', SNAPSHOT])
  vbox(['startvm', VM, '--type', 'headless'])
}

/** Wait for Guest Additions to answer, which means the desktop is really up. */
async function waitForGuest(seconds = 300) {
  for (let i = 0; i < seconds / 5; i += 1) {
    const probe = vbox(['guestproperty', 'get', VM, '/VirtualBox/GuestInfo/OS/LoggedInUsers'], { quiet: true })
    if (/Value: [1-9]/.test(probe.out)) return true
    await sleep(5000)
  }
  return false
}

const guest = (args) =>
  vbox(['guestcontrol', VM, '--username', GUEST_USER, '--password', GUEST_PASSWORD, ...args])

/**
 * The real installer, run the way a person runs it.
 *
 * `/S` is NSIS's silent switch, which is what an unattended test wants -- but
 * it also SKIPS the SmartScreen prompt, which is half of what has never been
 * tested. So this does the silent install for the repeatable part, and the
 * header says plainly that the SmartScreen warning itself still wants a human
 * looking at the screen once.
 */
async function install() {
  const setup = join('C:\\Users\\<home>\\Documents\\Codex\\ai-teammate-platform\\apps\\desktop\\release', 'Locust-Setup.exe')
  if (!existsSync(setup)) {
    say(`no installer at ${setup}; run the package step first`)
    process.exitCode = 1
    return
  }
  if (!(await waitForGuest())) {
    say('the guest never reported a logged-in user; is the snapshot taken after the desktop was up?')
    process.exitCode = 1
    return
  }
  say('copying the installer in')
  guest(['copyto', '--target-directory', `C:\\Users\\${GUEST_USER}\\Desktop\\`, setup])
  say('running it silently')
  guest(['run', '--exe', `C:\\Users\\${GUEST_USER}\\Desktop\\Locust-Setup.exe`, '--', 'Locust-Setup.exe', '/S'])
  await sleep(20_000)
  say('what landed:')
  guest(['run', '--exe', 'C:\\Windows\\System32\\cmd.exe', '--wait-stdout', '--', 'cmd.exe', '/c', 'dir /b "%LOCALAPPDATA%\\Programs\\Locust" 2>nul || echo NOTHING IN LOCALAPPDATA'])
}

/** Launch the INSTALLED app with the debugging port open, and take a frame. */
async function drive() {
  say('launching the installed Locust inside the VM')
  guest([
    'run', '--exe', `C:\\Users\\${GUEST_USER}\\AppData\\Local\\Programs\\Locust\\Locust.exe`,
    '--', 'Locust.exe', `--remote-debugging-port=${String(CDP_PORT)}`
  ])
  say('waiting for the renderer through the forwarded port')
  let page
  for (let attempt = 0; attempt < 60 && page === undefined; attempt += 1) {
    await sleep(2000)
    try {
      const list = await (await fetch(`http://127.0.0.1:${String(CDP_PORT)}/json/list`)).json()
      page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl && !t.url.includes('#splash'))
    } catch { /* not up yet */ }
  }
  if (page === undefined) {
    say('no renderer answered. The port forward or the launch failed.')
    process.exitCode = 1
    return
  }
  say(`reached it: ${page.url}`)
  say('from here the ordinary CDP drives apply -- same client, same frames.')
  await writeFile(
    new URL('../docs/chain-measure/clean-machine-target.json', import.meta.url),
    `${JSON.stringify(page, null, 2)}\n`,
    'utf8'
  )
}

const what = process.argv[2] ?? 'help'
if (what === 'build') await build()
else if (what === 'reset') reset()
else if (what === 'install') await install()
else if (what === 'drive') await drive()
else if (what === 'off') vbox(['controlvm', VM, 'poweroff'])
else {
  say('node _tools/clean-machine.mjs build|reset|install|drive|off')
  say('')
  say('See the header: what this tests that bare-machine-frame.mjs cannot.')
}
