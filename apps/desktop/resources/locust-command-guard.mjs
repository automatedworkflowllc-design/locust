// Locust's command guard: the check Claude Code makes before every command a
// teammate runs (0.717).
//
// Arena round 4, 2026-10-09: two of five models on Auto tidied up a test
// browser with `taskkill //F //IM msedge.exe` and `taskkill //F //IM
// chrome.exe`. That ends EVERY window of that browser on the computer, the
// person's own included. Auto runs as the person without asking, and that is
// the person's choice; ending what the person has open is part of no job a
// teammate is given.
//
// So one kind of command is refused, in every mode: one that ends programs BY
// NAME, when the name is one the person or another teammate is running -- a
// browser, the web view other apps draw their windows in, Node, Locust itself,
// the Windows desktop, an editor, an agent's CLI. Ending a process by its id
// -- the test browser the teammate started itself -- still works, and the
// refusal says how. Starting a browser, or anything else, is never refused.
//
// Claude Code runs this as a PreToolUse hook (`--settings`, command-guard.ts),
// under its own shell -- Git Bash on Windows -- with Electron's binary as
// node. MEASURED 2026-10-10 on Claude Code 2.1.296, Haiku, `bypassPermissions`:
// the deny below stopped the command before the shell saw it, the model read
// the reason word for word, and a capitalised TASKKILL was stopped too. About
// 90 ms a command.
//
// Deliberately tiny and dependency-free, like the permission bridge beside it.
// What it cannot read it lets through, saying nothing: it is a guard against
// one mistake, not a sandbox.
//
// Ships beside app.asar via extraResources (electron-builder.yml).

import { pathToFileURL } from 'node:url'

/** What ending each of these by name would end besides the teammate's own. */
const ENDS = [
  { names: ['google chrome', 'chrome', 'chromium'], what: 'Chrome', harm: 'windows' },
  { names: ['msedgewebview2'], what: 'Edge web view', harm: 'apps' },
  { names: ['microsoft edge', 'msedge'], what: 'Edge', harm: 'windows' },
  { names: ['firefox'], what: 'Firefox', harm: 'windows' },
  { names: ['brave browser', 'brave'], what: 'Brave', harm: 'windows' },
  { names: ['opera'], what: 'Opera', harm: 'windows' },
  { names: ['vivaldi'], what: 'Vivaldi', harm: 'windows' },
  { names: ['iexplore'], what: 'Internet Explorer', harm: 'windows' },
  { names: ['safari'], what: 'Safari', harm: 'windows' },
  { names: ['node'], what: 'Node', harm: 'work' },
  { names: ['electron'], what: 'Electron', harm: 'work' },
  { names: ['locust'], what: 'Locust', harm: 'work' },
  { names: ['explorer'], what: 'File Explorer', harm: 'desktop' },
  { names: ['code'], what: 'VS Code', harm: 'windows' },
  { names: ['cursor-agent', 'cursor'], what: 'Cursor', harm: 'work' },
  { names: ['claude'], what: 'Claude Code', harm: 'work' },
  { names: ['codex'], what: 'Codex', harm: 'work' },
  { names: ['gemini'], what: 'Gemini CLI', harm: 'work' },
  { names: ['copilot'], what: 'Copilot CLI', harm: 'work' },
  { names: ['opencode'], what: 'OpenCode', harm: 'work' },
  { names: ['agy', 'antigravity'], what: 'Antigravity', harm: 'work' }
]

const HARM = {
  windows: "the person's own windows",
  apps: "other apps' windows, which draw in it",
  work: "the person's own programs and other teammates' work",
  desktop: "the person's desktop and taskbar"
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// Longest first, so "google chrome" is read before "chrome".
const ALL = ENDS.flatMap((entry) => entry.names.map((name) => ({ name, entry }))).sort((a, b) => b.name.length - a.name.length)
/** A protected name as a word of its own, with or without `.exe`: never "codex" for "code", never "locust-scratch". */
const NAME = `(?<![\\w-])(${ALL.map(({ name }) => escape(name).replace(/ /g, '\\s+')).join('|')})(?:\\.exe|\\.app)?(?![\\w-])`
/** Within one command: up to the next `;`, `&`, `|` or line. */
const SAME = '[^\\n;&|]*?'
/** Within one pipeline: up to the next `;`, `&` or line. */
const PIPE = '[^\\n;&]*?'

// Each, a way to end processes by NAME. By id is never among them.
const BY_NAME = [
  // taskkill / tskill with an image-name selector: /IM, -IM, //IM (Git Bash), /FI "IMAGENAME eq ..."
  `\\b(?:taskkill|tskill)(?:\\.exe)?\\b(?=${SAME}(?:[\\/-]{1,2}(?:im|fi)\\b))${SAME}${NAME}`,
  `\\btskill(?:\\.exe)?\\s+['"]?${NAME}`,
  // PowerShell: Stop-Process -Name / -ProcessName (or its aliases)
  `\\b(?:stop-process|spps|kill)\\b${SAME}-(?:processname|name|n)\\b${SAME}${NAME}`,
  // Get-Process <name> piped to Stop-Process, or .Kill() on what it found
  `\\b(?:get-process|gps|ps)\\b${SAME}${NAME}${PIPE}(?:\\|\\s*(?:stop-process|spps|kill)\\b|\\.kill\\s*\\(|foreach-object\\s+kill\\b)`,
  // pkill / killall <name>
  `\\b(?:pkill|killall)\\b${SAME}${NAME}`,
  // pgrep / pidof / grep <name> ... | xargs kill
  `\\b(?:pgrep|pidof|grep)\\b${SAME}${NAME}${PIPE}\\|\\s*(?:xargs\\s+(?:-\\S+\\s+)*)?(?:kill|taskkill)\\b`,
  // kill $(pgrep <name>) / kill \`pidof <name>\`
  `\\bkill\\b${SAME}(?:\\$\\(|\`)\\s*(?:pgrep|pidof)\\b[^)\`]*?${NAME}`,
  // wmic process where name='<name>' delete / call terminate
  `\\bwmic\\b${SAME}${NAME}${SAME}\\b(?:delete|terminate)\\b`,
  // Win32_Process ... <name> ... Terminate / Remove-CimInstance
  `\\bwin32_process\\b${PIPE}${NAME}${PIPE}\\b(?:terminate|remove-ciminstance)\\b`,
  // macOS: quit an app by name
  `\\bosascript\\b${SAME}(?:quit\\s+app(?:lication)?\\s+['"\\\\]*${NAME}|tell\\s+app(?:lication)?\\s+['"\\\\]*${NAME}['"\\\\]*\\s+to\\s+quit)`
].map((pattern) => new RegExp(pattern, 'i'))

/**
 * Why a command is refused, in words the model reads, or undefined when it
 * may run. Exported for the tests; the hook below is the only other caller.
 */
export function stoppedBecause(command) {
  if (typeof command !== 'string' || command.length === 0) return undefined
  for (const pattern of BY_NAME) {
    const found = pattern.exec(command)
    if (found === null) continue
    const named = found.slice(1).find((group) => group !== undefined)?.toLowerCase().replace(/\s+/g, ' ')
    const entry = ALL.find(({ name }) => name === named)?.entry
    if (entry === undefined) continue
    return (
      `Locust stopped this command before it ran: it ends ${entry.what} by name, which ends every ${entry.what} ` +
      `on this computer, ${HARM[entry.harm]} too. End only what you started yourself, by its process id: ` +
      'taskkill /PID <id> /F on Windows, or kill <id>.'
    )
  }
  return undefined
}

/** The hook: one PreToolUse event on stdin; a deny on stdout, or nothing. */
async function main() {
  let input = ''
  process.stdin.setEncoding('utf8')
  for await (const chunk of process.stdin) input += chunk
  let event
  try {
    event = JSON.parse(input)
  } catch {
    return
  }
  const reason = stoppedBecause(event?.tool_input?.command)
  if (reason === undefined) return
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }))
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    () => process.exit(0),
    () => process.exit(0)
  )
}
