import { describe, expect, it } from "vitest";

import { allowRuleFor, parseClaudeConnectors, toolPrefixFor } from "../src/connectors.js";

/**
 * The names have to be RIGHT, because an allow rule that names the wrong
 * server is silently no rule at all: the CLI ignores it, the tool prompts,
 * and a printed run denies the prompt. The failure looks exactly like the
 * feature not existing.
 *
 * So the derivation is checked against ten real tool names, copied from a
 * live Claude Code session's own tool list on 2026-09-09, rather than against
 * itself.
 */

/** `claude mcp list` on claude 2.1.267, verbatim. */
const REAL_OUTPUT = [
  "Checking MCP server health…",
  "",
  "claude.ai Anthropic Economic Index: https://econ-index.mcp.claude.com/mcp - ✔ Connected",
  "claude.ai Google Calendar: https://calendarmcp.googleapis.com/mcp/v1 - ✔ Connected",
  "claude.ai Notion: https://mcp.notion.com/mcp - ! Needs authentication",
  "claude.ai Zapier: https://mcp.zapier.com/api/v1/connect - ✔ Connected",
  "claude.ai Clay: https://api.clay.com/v3/mcp - ✔ Connected",
  "claude.ai Canva: https://mcp.canva.com/mcp - ! Needs authentication",
  "claude.ai Robinhood: https://agent.robinhood.com/mcp/trading - ✔ Connected",
  "claude.ai Gmail: https://gmailmcp.googleapis.com/mcp/v1 - ✔ Connected",
  "claude.ai Figma: https://mcp.figma.com/mcp - ✔ Connected",
  "claude.ai Google Drive: https://drivemcp.googleapis.com/mcp/v1 - ✔ Connected",
].join("\n");

/**
 * Real tool names from the same account, one per connector above. Ground
 * truth: these are the strings an allow rule has to match a prefix of.
 */
const REAL_TOOL_NAMES: readonly string[] = [
  "mcp__claude_ai_Anthropic_Economic_Index__econ_index_list_countries",
  "mcp__claude_ai_Google_Calendar__list_calendars",
  "mcp__claude_ai_Notion__authenticate",
  "mcp__claude_ai_Zapier__list_zapier_skills",
  "mcp__claude_ai_Clay__get-current-workspace",
  "mcp__claude_ai_Canva__authenticate",
  "mcp__claude_ai_Robinhood__get_watchlists",
  "mcp__claude_ai_Gmail__list_labels",
  "mcp__claude_ai_Figma__whoami",
  "mcp__claude_ai_Google_Drive__list_recent_files",
];

describe("the connectors a person has", () => {
  it("are read off `claude mcp list`, names and health both", () => {
    const found = parseClaudeConnectors(REAL_OUTPUT);
    expect(found).toHaveLength(10);
    expect(found[6]).toEqual({
      name: "claude.ai Robinhood",
      location: "https://agent.robinhood.com/mcp/trading",
      status: "connected",
    });
    // Not hidden: a server the person half signed into is a server they have,
    // and "it is not there" would be the wrong thing to tell them.
    expect(found.filter((entry) => entry.status === "needs-auth").map((entry) => entry.name)).toEqual([
      "claude.ai Notion",
      "claude.ai Canva",
    ]);
  });

  it("survive the header, blanks and anything else the CLI prints", () => {
    expect(parseClaudeConnectors("")).toEqual([]);
    expect(parseClaudeConnectors("No MCP servers configured. Use `claude mcp add`")).toEqual([]);
    expect(parseClaudeConnectors("Checking MCP server health…")).toEqual([]);
    // A local server: a command rather than a URL, and colons in the middle.
    const local = parseClaudeConnectors("robinhood-trading: node C:\srv\rh.js --port 1 - ✔ Connected");
    expect(local).toEqual([
      { name: "robinhood-trading", location: "node C:\srv\rh.js --port 1", status: "connected" },
    ]);
  });

  it("derive the prefix every one of their tools really carries", () => {
    // THE control. A prefix that is merely self-consistent is worthless: the
    // rule has to match the strings the runtime actually emits.
    const derived = parseClaudeConnectors(REAL_OUTPUT).map((entry) => toolPrefixFor(entry.name));
    expect(derived).toHaveLength(REAL_TOOL_NAMES.length);
    for (const [index, prefix] of derived.entries()) {
      expect(REAL_TOOL_NAMES[index]?.startsWith(prefix), `${prefix} vs ${REAL_TOOL_NAMES[index] ?? ""}`).toBe(true);
    }
  });

  it("become an allow rule shaped the way the CLI demands", () => {
    // MEASURED 2026-09-09: `mcp__*` is refused -- "An allow pattern must name
    // the scope it widens; globs are permitted only in the tool position
    // after a literal mcp__<server>__ prefix" -- and this shape is accepted.
    expect(allowRuleFor("claude.ai Robinhood")).toBe("mcp__claude_ai_Robinhood__*");
    for (const rule of parseClaudeConnectors(REAL_OUTPUT).map((entry) => allowRuleFor(entry.name))) {
      expect(rule).toMatch(/^mcp__[A-Za-z0-9_]+__\*$/);
      expect(rule).not.toBe("mcp__*");
    }
    expect(parseClaudeConnectors(REAL_OUTPUT).every((entry) => allowRuleFor(entry.name) !== undefined)).toBe(true);
  });

  it("refuse to make a rule at all from a name that sanitises to nothing", () => {
    // `mcp____*` would be accepted by the CLI -- it is not the bare `mcp__*`
    // that gets refused -- so it would widen something nobody chose, with
    // nothing anywhere to notice. Fail closed: no rule, and the call prompts.
    for (const hostile of ["", "   ", "...", "___", "!!!", "•"]) {
      expect(toolPrefixFor(hostile)).toBe("mcp____");
      expect(allowRuleFor(hostile), hostile).toBeUndefined();
    }
  });
});
