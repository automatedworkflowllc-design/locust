/**
 * What would leave this machine, said only where it can be known.
 *
 * The approval card answers what would happen, where, and whether it can be
 * undone. It never said what DATA the action sends — which the design pass
 * names as the row it is missing, and which is the one question a person
 * cannot work out for themselves. A file write they can reason about; whether
 * a shell command phones somewhere they cannot, because the command may be a
 * script whose contents are not on screen.
 *
 * So the rule here is asymmetric, deliberately:
 *
 *   - A file change sends NOTHING, and that is provable. The bytes are written
 *     to a path on this disk. Say so plainly.
 *   - A command that names a network tool CAN reach the network. Say that it
 *     can, and say that Locust cannot see what it would send — because it
 *     cannot.
 *   - Any other command is UNKNOWN. Never say "nothing leaves this machine"
 *     about a command, however harmless it looks: `./deploy.sh` is two words
 *     and can do anything.
 *
 * The dangerous direction is the false negative — telling someone nothing is
 * sent when something is. So the negative is only ever claimed for the one
 * kind where it is a fact, and the positive is a capability ("can reach"),
 * never a prediction ("will send").
 */

/**
 * Programs that reach the network as their ordinary purpose. Matched as whole
 * words so `curling` and a file called `wget-notes.md` do not trip it.
 *
 * Under-matching here is safe by construction: an unmatched command falls to
 * "Locust cannot tell", which is the honest answer anyway. Over-matching would
 * be noise, not danger.
 */
const NETWORK_TOOLS = [
  'curl',
  'wget',
  'ssh',
  'scp',
  'sftp',
  'rsync',
  'nc',
  'netcat',
  'telnet',
  'ftp',
  'npm',
  'pnpm',
  'yarn',
  'pip',
  'pip3',
  'cargo',
  'gem',
  'go',
  'brew',
  'apt',
  'docker',
  'kubectl',
  'aws',
  'gcloud',
  'az',
  'gh',
  'git'
]

const TOOL_PATTERN = new RegExp(`(^|[\\s|&;(<>])(${NETWORK_TOOLS.join('|')})([\\s]|$)`, 'i')
/** A bare URL in the command is as good as naming a tool. */
const URL_PATTERN = /\bhttps?:\/\//i

/** Whether this command text names something that reaches the network. */
export function commandReachesNetwork(command: string): boolean {
  return TOOL_PATTERN.test(command) || URL_PATTERN.test(command)
}

/**
 * The `Data sent` row's text, or undefined when the row should not be drawn.
 *
 * `undefined` for a question: answering sends nothing anywhere, and a row
 * saying so on a card that is only asking would be noise on the one surface
 * that must stay short.
 */
export function dataSentLine(kind: string, command: string): string | undefined {
  if (kind === 'file-change') {
    return 'Nothing. The change is written to this machine and sent nowhere.'
  }
  if (kind !== 'command') return undefined
  return commandReachesNetwork(command)
    ? 'This command can reach the network. Locust cannot see what it would send — read it above.'
    : 'Unknown. Locust cannot tell what a command sends; a script can do anything the sandbox allows.'
}
