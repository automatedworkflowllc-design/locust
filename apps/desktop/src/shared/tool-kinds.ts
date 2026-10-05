/**
 * WHAT KIND OF THING A TOOL CALL IS, from its own words (0.364).
 *
 * The ONE place the thread and the host read it. These rules lived in the
 * window's missionView, and the host's disk observation kept its own looser
 * one -- "a tool named the file" -- under which a READ of notes.ts, or a
 * Python command that merely mentioned monthly_budget.xlsx, counted as the
 * runtime having reported the change. The change then had no row at all:
 * Penny built a budget workbook with a command and the Artifacts tab said
 * "This reply changed no files" (Research & money drive, packaged 0.363).
 * Two copies of one rule is how they came to disagree; there is one now.
 */

export function isShellTool(name: string, toolKind: string | undefined): boolean {
  // `run_command` is Antigravity's word, and leaving it out cost every one of
  // its runs their commands: MEASURED 2026-09-13 across the recorded ledgers,
  // 76 `run_command` calls, none of them counted as a command. So "Ran N
  // commands" said nothing, the trace line had nothing to trace, and the
  // reviewer's WHAT RAN was empty for a run that had run seventy-six things.
  // `powershell` is Copilot CLI's shell tool (0.587): its calls drew as "Used
  // powershell" rows, were not counted as commands, and never reached the
  // reach classifier -- the Copilot leg of the cross-model pass, 2026-10-04.
  return /^(bash|shell|powershell|pwsh|cmd|run_command|run_terminal_cmd|execute_command)$/i.test(name)
    || toolKind === 'command_execution'
    || toolKind === 'run_command'
}

/** Shell verbs that read as file edits rather than as commands. */
const EDIT_COMMANDS = /^(?:apply_patch|patch|edit|write)\b/

/**
 * Whether a shell command edits a file, as far as its own words say.
 *
 * M24 (the code review): every `sed` counted, so a read-only
 * `sed -n '1,40p' src/app.ts` became an edited file named after the
 * command -- "Edited 1 file" on an Ask run, the command listed as a
 * produced file, and its output never shown. `sed` edits only in place,
 * and `tee` only when it is given a file to write.
 */
export function isEditCommand(command: string): boolean {
  const text = command.trim()
  if (EDIT_COMMANDS.test(text)) return true
  if (/^sed\b/.test(text)) return /\s(?:-[a-zA-Z]*i[a-zA-Z.]*|--in-place\b)/.test(text)
  if (/^tee\b/.test(text)) return /^tee(?:\s+-[a-zA-Z-]+)*\s+[^-\s|]/.test(text)
  return false
}

/**
 * Whether a tool name means "this touched a file".
 *
 * Matching `write` anywhere caught two tools that never touch one: OpenCode's
 * `todowrite`, the model's own to-do list -- offered even to read-only runs --
 * and Copilot's `write_agent`. Each names no path and carries no diff, so the
 * fold counted a changed file on a run that changed nothing (QA, 2026-09-06).
 * Missing `delete` was the same mistake from the other side: Cursor names a
 * removal `delete`, and a run that deleted a file reported a tool call and no
 * file.
 *
 * So the words are matched as whole words rather than as substrings, and the
 * list is the vocabulary the adapters actually produce.
 */
const EDIT_TOOL_WORDS = new Set([
  'file',
  'files',
  'patch',
  'write',
  'edit',
  'delete',
  'remove',
  'create',
  'move',
  'rename'
])
const NOT_EDIT_TOOLS = /^(todowrite|todoread|todo_write|todo_read|write_agent|writeagent)$/i

/**
 * Words that mean the tool LOOKED at something.
 *
 * They beat the nouns below, and they have to, because the noun is the half
 * the two kinds of tool share: `view_file` and `write_to_file` both contain
 * `file`, and matching nouns alone made READING a file count as changing one.
 *
 * MEASURED 2026-09-13 in the recorded ledgers: 38 Antigravity `view_file`
 * calls, every one of them counted as an edit. So an Antigravity run that
 * changed nothing reported changed files -- and since 0.96.0 those files are
 * handed to a reviewer under WHAT CHANGED, which makes it a false claim about
 * the work rather than a miscount.
 */
/*
 * `websearch`, `fetch` and `browse` joined the set so LOOKING THINGS UP ON
 * THE WEB lands on the globe -- Colin, 2026-09-20: "searching for websearch
 * and any type of looking/search". `WebSearch` already matched through the
 * camelCase split; the one-word spellings did not, which is the shape of tool
 * name half the runtimes use.
 */
export const READ_TOOL_WORDS: ReadonlySet<string> = new Set([
  'view', 'read', 'open', 'show', 'list', 'cat', 'search', 'find', 'grep',
  'websearch', 'fetch', 'browse', 'lookup'
])

export function editToolName(name: string): boolean {
  const trimmed = name.trim()
  if (trimmed.length === 0) return false
  if (NOT_EDIT_TOOLS.test(trimmed)) return false
  /*
   * A CONNECTOR'S TOOL IS NEVER A FILE CHANGE (QA-2026-09-29 round 2, R13).
   * `mcp__github__create_issue` read as an edit because it says "create",
   * and so did 17 of 18 real connector tools -- create and delete are their
   * commonest verbs -- so a GitHub issue showed as "1 file", "Changed a
   * file" and a phantom file in Artifacts. Connector tools are named
   * `server__tool` (with or without `mcp__`); no tool that edits this
   * machine's files is.
   */
  if (trimmed.includes('__')) return false
  const words = trimmed
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z]+/)
    .map((word) => word.toLowerCase())
  if (words.some((word) => READ_TOOL_WORDS.has(word))) return false
  // Split on separators AND on camelCase, so `deleteFile`, `delete_file` and
  // `DeleteFile` all read as the two words they are -- and `todowrite`, which
  // is one word, reads as one and matches nothing.
  return words.some((word) => EDIT_TOOL_WORDS.has(word))
}

/**
 * Whether a tool call's OWN row reports that it changed a file: an edit tool,
 * or a shell command whose words are an edit (`apply_patch`, `sed -i`, `tee
 * file`). Never a read, and never a command that only mentions a file -- the
 * thread draws those as a read or a command, and a change they made would
 * otherwise appear nowhere. Disk observation's own rows count as reports.
 */
export function reportsAChange(tool: { readonly name: string; readonly toolKind?: string; readonly command?: string }): boolean {
  if (tool.toolKind === 'observed_edit') return true
  if (isShellTool(tool.name, tool.toolKind)) return tool.command !== undefined && isEditCommand(tool.command)
  return editToolName(tool.name)
}

/**
 * Whether a tool call was made BY A HELPER the teammate sent out rather than
 * by the teammate (ledger v22, helper visibility 2026-10-05). Its row is drawn
 * under the helper's, and it stays out of everything that says what the
 * teammate itself did: the turn's counts, the face, the live line, the rail.
 */
export function byHelper(payload: { readonly parentItemId?: unknown }): boolean {
  return typeof payload.parentItemId === 'string' && payload.parentItemId.length > 0
}
