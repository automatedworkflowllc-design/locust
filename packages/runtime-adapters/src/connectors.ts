/**
 * The connectors a person has, and the one rule that lets a teammate use one.
 *
 * BACKGROUND, because two wrong explanations shipped before this one.
 * `--restricted` never kept a person's MCP servers out of a mission -- the
 * CLI's help names `--strict-mcp-config` as the flag that would. Locust's own
 * `--disallowedTools mcp__*` was the block, and removing it only got as far
 * as the tools being OFFERED: Claude Code asks before using one, and a
 * printed run has nowhere to put that question, so the call is denied.
 *
 * The way to actually let a teammate use a connector, without handing it the
 * whole machine in Auto, is an allow rule. And an allow rule must NAME its
 * server. MEASURED 2026-09-09:
 *
 *   --allowedTools "mcp__claude_ai_Robinhood__*"   accepted
 *   --allowedTools "mcp__*"                        refused, with:
 *     Wildcard tool name "mcp__*" is not supported in allow rules. An allow
 *     pattern must name the scope it widens -- globs are permitted only in
 *     the tool position after a literal mcp__<server>__ prefix.
 *
 * So the app has to know the person's servers by name. `claude mcp list`
 * prints them, including the account connectors from claude.ai that never
 * appear in `~/.claude.json` and so could not be read off disk.
 */

/** One MCP server the CLI reported, as it reported it. */
export interface ClaudeConnector {
  /** The name the CLI prints, which is also what the person recognises. */
  readonly name: string;
  /** Where it lives. A URL for a remote connector; a command for a local one. */
  readonly location: string;
  /**
   * What the health check said. `connected` is usable now; `needs-auth` is a
   * real server the person has not finished signing into, which is worth
   * showing rather than hiding; `failed` is anything else it said.
   */
  readonly status: "connected" | "needs-auth" | "failed";
}

/**
 * The tool-name prefix a connector's tools carry.
 *
 * Every run of characters that is not a letter or a digit becomes one
 * underscore, so `claude.ai Anthropic Economic Index` becomes
 * `claude_ai_Anthropic_Economic_Index`. Case is kept: the tool names are
 * case-sensitive and the CLI's own are mixed.
 *
 * This is a DERIVATION and derivations drift, so `connectors.test.ts` checks
 * it against ten real tool names taken from a live session rather than
 * against itself.
 */
export function toolPrefixFor(name: string): string {
  return `mcp__${name.trim().replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}__`;
}

/**
 * The allow rule that lets a run use every tool one connector offers, or
 * nothing when the name cannot make one.
 *
 * Fails closed. A name that sanitises to nothing would yield `mcp____*`,
 * which is not the bare `mcp__*` the CLI refuses and would therefore be
 * accepted -- widening something nobody chose, with nothing to notice it.
 * Better to send no rule and have the call prompt.
 */
export function allowRuleFor(name: string): string | undefined {
  const prefix = toolPrefixFor(name);
  return prefix === "mcp____" ? undefined : `${prefix}*`;
}

/**
 * Read `claude mcp list` as it prints.
 *
 * MEASURED 2026-09-09 on claude 2.1.267:
 *
 *   Checking MCP server health…
 *
 *   claude.ai Robinhood: https://agent.robinhood.com/mcp/trading - ✔ Connected
 *   claude.ai Notion: https://mcp.notion.com/mcp - ! Needs authentication
 *
 * A name may contain spaces and dots, and the location may contain colons, so
 * the split is on the LAST ` - ` rather than the first, and the name is taken
 * up to the first `: ` that is followed by something location-shaped. Lines
 * that do not have that shape -- the header, blank lines, a "No MCP servers
 * configured" notice -- are skipped rather than guessed at.
 */
export function parseClaudeConnectors(text: string): readonly ClaudeConnector[] {
  const found: ClaudeConnector[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0) continue;
    const cut = line.lastIndexOf(" - ");
    if (cut < 0) continue;
    const head = line.slice(0, cut);
    const health = line.slice(cut + 3).trim();
    const colon = head.indexOf(": ");
    if (colon <= 0) continue;
    const name = head.slice(0, colon).trim();
    const location = head.slice(colon + 2).trim();
    if (name.length === 0 || name.length > 120 || location.length === 0) continue;
    if (found.some((entry) => entry.name === name)) continue;
    found.push({
      name,
      location,
      status: /needs? authentication|authenticate/i.test(health)
        ? "needs-auth"
        : /connected/i.test(health)
          ? "connected"
          : "failed",
    });
  }
  return found;
}

/**
 * What `cursor-agent mcp list` says about each server this machine has.
 *
 * Colin, 2026-09-14, after days of this: "is there really no way to fix the
 * mcp tools working for our app for cursor, i literally have robinhood
 * working on the cli but cursor still cant call it."
 *
 * The CLI answers it in one line:
 *
 *     robinhood-trading: requires_authentication
 *
 * That is not an approval problem and never was. Locust passes
 * `--approve-mcps`, the flag still exists, and approval was never what
 * refused the call -- the CLI has no token for that server, so its tools do
 * not reach ANY run, headless or not. The Cursor IDE app keeps its own
 * credentials, which is why the same connector can work there and nowhere
 * else, and is exactly the confusion this parses to end.
 *
 * A person cannot be expected to run `cursor-agent mcp list` to find that
 * out. The app can.
 */
export interface CursorConnector {
  readonly name: string
  /** The CLI's own word, kept verbatim. */
  readonly status: string
  /** Whether the CLI says it has no credential for this server yet. */
  readonly needsAuthentication: boolean
}

/** `name: status` per line. Anything that is not that shape is not a server. */
export function parseCursorMcpList(text: string): readonly CursorConnector[] {
  const out: CursorConnector[] = [];
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const match = /^\s*([A-Za-z0-9][\w .-]*?)\s*:\s*(\S.*?)\s*$/.exec(line);
    if (match === null) continue;
    const name = match[1] ?? "";
    const status = match[2] ?? "";
    if (name.length === 0 || status.length === 0) continue;
    out.push({
      name,
      status,
      // The CLI's own token for "no credential yet". Matched loosely on the
      // word rather than the exact string, because the surrounding wording is
      // the CLI's to change and the meaning is not.
      needsAuthentication: /requires?[_\s-]*auth/i.test(status),
    });
  }
  return out;
}

/**
 * What is true about a connector the CLI has no credential for.
 *
 * This used to end "Run this in a terminal: cursor-agent mcp login <name>",
 * shown once per Cursor run in the conversation. Colin, 2026-09-14, after
 * trying it: "that doesnt work we have tried that in the terminal" -- and
 * "this doesnt need to be in the chat".
 *
 * Both complaints are right and the first is the serious one. MEASURED on his
 * machine the same evening: `cursor-agent mcp login` persists NOTHING. There
 * is no MCP credential in `~/.cursor/cli-config.json` (its `authInfo` is the
 * Cursor account), no credential file anywhere under `~/.cursor` or the
 * cursor-agent install, and nothing in Windows Credential Manager. Meanwhile
 * the Cursor IDE connects to the SAME url from the SAME `mcp.json` and logs
 * "Successfully connected to streamableHttp server" -- because it holds a
 * token in its own store. The sign-ins were landing in the app, every time,
 * and the CLI has nowhere to receive one.
 *
 * So the sentence no longer prescribes a fix. An app that tells a person to
 * run a command that cannot work spends their evening for them, which is
 * worse than saying nothing -- and it did, repeatedly. It states what is
 * true and stops there.
 */
export function cursorConnectorSentence(
  connectors: readonly CursorConnector[],
): string | undefined {
  const waiting = connectors.filter((connector) => connector.needsAuthentication);
  if (waiting.length === 0) return undefined;
  const names = waiting.map((connector) => connector.name);
  const list = names.length === 1
    ? names[0]
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1] ?? ""}`;
  return `The Cursor CLI has no credential for ${String(list)}, so a Cursor teammate cannot call ${
    names.length === 1 ? "it" : "them"
  }. Signing in inside the Cursor app does not cover the CLI; they keep separate credentials.`;
}
