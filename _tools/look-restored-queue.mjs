// Draw the real Composer with its own CSS in a hidden Electron window; sends nothing.
// node _tools/look-restored-queue.mjs <output-directory>
import './scratch-root.mjs'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
const desktop = fileURLToPath(new URL('../apps/desktop/', import.meta.url))
const require = createRequire(join(desktop, 'package.json'))
const esbuild = createRequire(require.resolve('vite/package.json'))('esbuild')
const electron = require('electron')
const out = resolve(process.argv[2] ?? join(tmpdir(), 'locust-restored-queue-look'))
await mkdir(out, { recursive: true })
const work = await mkdtemp(join(tmpdir(), 'locust-queue-look-'))
const src = (name) => JSON.stringify(join(desktop, 'src/renderer/src', name).replaceAll('\\', '/'))
// The same neutral fixture as the component test, rendered rather than copied HTML.
const test = await readFile(join(desktop, 'src/renderer/src/a-restored-queue-offers-its-actions.test.tsx'), 'utf8')
const fixture = test.match(/const props: ComposerProps = \{[\s\S]*?\n\}/)?.[0].replace(': ComposerProps', '')
if (!fixture) throw new Error('Composer fixture missing')
await writeFile(join(work, 'entry.jsx'), `
import ${src('tokens.css')}; import ${src('shell.css')};
import { createElement as h, useState } from 'react'; import { createRoot } from 'react-dom/client';
import { Composer } from ${src('components/Composer.tsx')};
import { QUEUE_RESTORED_NOTE } from ${src('conversationQueue.ts')};
${fixture}
function Page() {
  const [error, setError] = useState(false); window.setError = setError;
  return h('main', { style: { width: 830, padding: 20 } }, h(Composer, {
    ...props, queued: error ? undefined : props.queued,
    queueError: error ? 'Saved messages could not be read. Reopen Locust to try again; the saved file has been kept.' : undefined,
    runtimes: [{ id: 'opencode', displayName: 'OpenCode', installed: true, ready: true, auth: 'not-required', status: 'ready' }]
  }));
}
createRoot(document.getElementById('root')).render(h(Page));
`, 'utf8')
await esbuild.build({ entryPoints: [join(work, 'entry.jsx')], bundle: true, format: 'iife', platform: 'browser', target: 'es2022', jsx: 'automatic', outfile: join(work, 'page.js'), define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' }, loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file', '.png': 'file', '.svg': 'file', '.webp': 'file' }, nodePaths: [join(desktop, 'node_modules')], absWorkingDir: desktop, logLevel: 'warning' })
await writeFile(join(work, 'page.html'), '<html class="lc-theme-dark"><head><link rel="stylesheet" href="page.css"></head><body style="background:#16181c;margin:0"><div id="root"></div><script src="page.js"></script></body></html>')
await writeFile(join(work, 'main.cjs'), `
const { app, BrowserWindow } = require('electron'); const { writeFileSync } = require('node:fs');
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 890, height: 330, webPreferences: { backgroundThrottling: false } });
  await win.loadFile(${JSON.stringify(join(work, 'page.html'))});
  for (const [error, name] of [[false, 'held'], [true, 'read-error']]) {
    await win.webContents.executeJavaScript('window.setError(' + error + ')');
    await new Promise(r => setTimeout(r, 700));
    writeFileSync(${JSON.stringify(out)} + '/' + name + '.png', (await win.webContents.capturePage()).toPNG());
  }
  app.quit();
}).catch(e => { console.error(e); app.exit(1) });
`)
const code = await new Promise((resolve) => { const child = spawn(electron, [join(work, 'main.cjs')], { windowsHide: true, stdio: 'inherit' }); child.on('exit', resolve); child.on('error', () => resolve(1)) })
console.log(`Composer frames: ${out}`)
process.exitCode = code ?? 1
