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
