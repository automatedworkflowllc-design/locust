import type { FeedbackReport } from '../shared/ipc.js'

/**
 * WHERE FEEDBACK GOES -- one address, named here, in the host.
 *
 * Settings' Report a problem showed the log and said "this is the file to
 * send", and said nowhere where to send it (the beta handover, 2026-09-23).
 * A tester who got stuck left without a trace, and there is no telemetry, by
 * design, so what testers send is the only signal there is.
 *
 * Colin: "for bug reporting we can use what claude code does" -- its Send
 * feedback box: describe the issue, a line saying exactly what goes with it,
 * Cancel and Send. Claude Code sends to its makers' own service; Locust has
 * none. So Send builds the report and opens it on GitHub, filled in, and the
 * person sends it there (it needs a GitHub account). The destination is this
 * one constant: whether it stays GitHub issues or becomes Discord or GitHub
 * Discussions is Colin's call, and it changes this line only.
 *
 * What goes: the person's own words, the Locust version and the Windows
 * build, and -- when it was sent from a conversation -- that conversation's
 * text, the latest of it if it is long. Never the log, never a path, never
 * a file: the person attaches the log themselves, and the report says how.
 *
 * The renderer names no address here (see OPEN_LINK_CHANNEL in index.ts):
 * it hands over the words, and the host builds the address itself.
 */
export const REPORT_DESTINATION = 'https://github.com/automatedworkflowllc-design/locust-releases/issues/new'

/** Kept well under the length a browser and GitHub take in one address. */
export const MAX_REPORT_URL = 7_500

/** The person's own words, at most this long. */
export const MAX_DESCRIPTION = 2_000

export interface ReportFacts {
  /** The running Locust's own version. */
  readonly version: string
  /** `os.release()`: "10.0.<build>" on Windows 10 and 11 alike. */
  readonly release: string
  /** `process.arch`. */
  readonly arch: string
  /** `process.platform`; absent reads as Windows, which it was until the first macOS build. */
  readonly platform?: NodeJS.Platform
}

/** The system in words, on each platform Locust runs on (the first macOS build, 2026-09-29). */
export function systemName(facts: Pick<ReportFacts, 'release' | 'arch' | 'platform'>): string {
  if (facts.platform === 'darwin') return `macOS (Darwin ${facts.release.trim()}, ${facts.arch})`
  if (facts.platform !== undefined && facts.platform !== 'win32') return `${facts.platform} ${facts.release.trim()} (${facts.arch})`
  return windowsName(facts.release, facts.arch)
}

/** Windows 10 and 11 both say "10.0"; 11 is build 22000 and later. */
export function windowsName(release: string, arch: string): string {
  const build = /^10\.0\.(\d+)/.exec(release.trim())?.[1]
  if (build === undefined) return `Windows ${release.trim()} (${arch})`
  return `${Number(build) >= 22000 ? 'Windows 11' : 'Windows 10'}, build ${build} (${arch})`
}

const FENCE = '`'.repeat(4)
const NEWLINE = String.fromCharCode(10)

function body(facts: ReportFacts, description: string, conversation: string | undefined, trimmed: boolean): string {
  const lines = [description, '', '---', `Locust ${facts.version} on ${systemName(facts)}`]
  if (conversation !== undefined && conversation.length > 0) {
    lines.push(
      '',
      '<details><summary>The conversation it was sent from' + (trimmed ? ' (its latest part)' : '') + '</summary>',
      '',
      FENCE + 'text',
      conversation,
      FENCE,
      '',
      '</details>'
    )
  }
  lines.push('', 'Nothing else was attached. To add the log: Settings > Report a problem > Show the log, then drag the file into this box.')
  return lines.join(NEWLINE)
}

function urlWith(text: string): string {
  const url = new URL(REPORT_DESTINATION)
  url.searchParams.set('body', text)
  return url.toString()
}

/**
 * The new-report page, filled in. A long conversation keeps its END -- where
 * the trouble usually is -- cut to fit MAX_REPORT_URL once encoded.
 */
export function feedbackUrl(facts: ReportFacts, report: FeedbackReport): string {
  const description = report.description.trim().slice(0, MAX_DESCRIPTION)
  const conversation = report.conversation?.trim()
  const whole = urlWith(body(facts, description, conversation, false))
  if (conversation === undefined || whole.length <= MAX_REPORT_URL) return whole
  // Keep less of the start until it fits; the ending stays whole.
  let keep = conversation.length
  let url = whole
  while (keep > 0) {
    keep = Math.floor(keep * 0.8)
    url = urlWith(body(facts, description, `...${conversation.slice(conversation.length - keep)}`, true))
    if (url.length <= MAX_REPORT_URL) return url
  }
  return urlWith(body(facts, description, undefined, false))
}
