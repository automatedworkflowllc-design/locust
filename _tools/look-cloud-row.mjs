// Local, fake-only look of the app's own cloud components; never starts a CLI.
// node _tools/look-cloud-row.mjs [out.png] [--environment]
import { mkdtemp, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { spawn } from 'node:child_process'
const desktop = resolve('apps/desktop')
const require = createRequire(join(desktop, 'package.json'))
const esbuild = createRequire(require.resolve('vite/package.json'))('esbuild')
const src = (path) => JSON.stringify(join(desktop, 'src/renderer/src', path).replaceAll('\\', '/'))
const work = await mkdtemp(join(tmpdir(), 'locust-cloud-look-'))
const environmentMode = process.argv.includes('--environment')
const out = resolve(process.argv.slice(2).find((arg) => !arg.startsWith('--')) ?? join(tmpdir(), environmentMode ? 'cloud-environment.png' : 'cloud-watch.png'))
await writeFile(join(work, 'entry.jsx'), `
import ${src('tokens.css')}
import ${src('shell.css')}
import { createElement as h, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { CloudTasks } from ${src('components/CloudTasks.tsx')}
import { Composer } from ${src('components/Composer.tsx')}
const props = { tasks: [], where: { repo: 'example/project' }, notes: [], folders: [], onShowChange: async()=>undefined, onApply:()=>{}, onOpen:()=>{}, onClose:()=>{}, onOpenFolder:()=>{}, onChooseFolder:()=>{}, claude: {
 picked: true, sessions: [{id: 'cc_abcdef', sessionId: 'session_0123456789', prompt: 'Review the cart', startedAt: new Date().toISOString()}],
 onHome:()=>{}, onForget:()=>{}, onOpenWeb:()=>{}, onSend:async()=>undefined, onApply:async()=>undefined, onContinue:async()=>undefined,
 onCheck:async()=>({ok:true, exchanges:[{prompt:'Review the cart',answer:'The totals now include every item.',at:new Date().toISOString()}],checkedAt:new Date().toISOString()})
}}
function EnvironmentPage() {
 const [value, setValue] = useState('ccpool_team-1')
 window.setEnvironment = setValue
 return h(Composer, {runtimes:[{id:'claude',displayName:'Claude Code',installed:true,version:'fake',auth:'authenticated',ready:true,status:'ready'}],limitedRuntimes:new Map(),discoveryPhase:'ready',running:false,cancelling:false,
 mode:'accept-edits',onModeChange:()=>{},route:{runtime:'claude',model:'account-default'},onRouteChange:()=>{},models:[],resolvedModels:new Map(),recentRoutes:[],platform:'win32',onEffortChange:()=>{},swarm:false,onSwarmChange:()=>{},
 onStart:async()=>true,onCancel:()=>{},onOpenRoutePicker:()=>{},onHandOff:()=>{},handingOff:false,workspaceName:'Example',workspacePath:'C:/example',onChooseFolder:()=>{},onQueue:()=>{},onUnqueue:()=>{},onSendQueued:()=>{},queuedElsewhere:false,
 cloud:{on:true,where:'claude',onMode:()=>{},environment:{value,onChange:setValue}}})
}
createRoot(document.getElementById('root')).render(h(${environmentMode ? 'EnvironmentPage' : 'CloudTasks'},${environmentMode ? '{}' : 'props'}))
`)
await esbuild.build({entryPoints:[join(work,'entry.jsx')],bundle:true,format:'iife',platform:'browser',jsx:'automatic',outfile:join(work,'page.js'),define:{'process.env.NODE_ENV':'"production"','import.meta.env':'{}'},loader:{'.woff2':'file','.woff':'file','.ttf':'file','.png':'file','.svg':'file','.webp':'file'},nodePaths:[join(desktop,'node_modules')],absWorkingDir:desktop,logLevel:'warning'})
await writeFile(join(work,'page.html'), '<html class="lc-theme-dark"><head><link rel="stylesheet" href="page.css"></head><body style="background:#16181c"><div id="root"></div><script src="page.js"></script></body></html>')
await writeFile(join(work,'main.cjs'), `
const {app,BrowserWindow}=require('electron')
const {writeFileSync}=require('node:fs')
app.whenReady().then(async()=>{
 const w=new BrowserWindow({show:false,width:680,height:800,webPreferences:{backgroundThrottling:false}})
 await w.loadFile(${JSON.stringify(join(work,'page.html'))})
 const sleep=ms=>new Promise(r=>setTimeout(r,ms))
 await sleep(500)
 if (${environmentMode}) {
   const valid=await w.webContents.executeJavaScript("document.querySelector('.lc-cloud-environment input')?.getAttribute('aria-invalid')")
   if(valid!=='false')throw new Error('Valid environment field missing')
   writeFileSync(${JSON.stringify(out)},(await w.webContents.capturePage()).toPNG())
   await w.webContents.executeJavaScript("window.setEnvironment('bad & calc')")
   await sleep(500)
   const invalid=await w.webContents.executeJavaScript("document.querySelector('.lc-cloud-environment input')?.getAttribute('aria-invalid')")
   if(invalid!=='true')throw new Error('Invalid environment was not flagged')
   writeFileSync(${JSON.stringify(out)}.replace(/[.]png$/,'-invalid.png'),(await w.webContents.capturePage()).toPNG())
   console.log('Fake cloud form: valid and invalid environment fields passed.')
 } else {
   await w.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(b=>b.innerText==='Watch').click()")
   await sleep(500)
   const text=await w.webContents.executeJavaScript('document.body.innerText')
   if(!text.includes('Stop watching')||!text.includes('Updated 0 min ago')||!text.includes('The totals now'))throw new Error(text)
   await sleep(200)
   writeFileSync(${JSON.stringify(out)},(await w.webContents.capturePage()).toPNG())
   await w.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(b=>b.innerText==='Hide what it did').click()")
   await sleep(100)
   const closed=await w.webContents.executeJavaScript('document.body.innerText')
   if(closed.includes('Stop watching')||closed.includes('The totals now'))throw new Error(closed)
   console.log('Fake cloud row: Watch, updated reply, and Hide passed.')
 }
 app.quit()
}).catch(e=>{console.error(e);app.exit(1)})`)
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
const child=spawn(require('electron'),[join(work,'main.cjs')],{env,stdio:'inherit',windowsHide:true})
child.on('exit',code=>process.exit(code??1))
