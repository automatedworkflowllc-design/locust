import { describe, expect, it } from "vitest";

import { cursorConnectorSentence, parseCursorMcpList } from "../src/connectors.js";

/*
 * Colin, 2026-09-14: "i literally have robinhood working on the cli but cursor
 * still cant call it." Days of this, and the CLI answers it in one line:
 *
 *     robinhood-trading: requires_authentication
 *
 * Not an approval problem. Locust passes `--approve-mcps` and the flag still
 * exists; approval was never what refused the call. The CLI has no token, so
 * that server's tools reach no run at all. The Cursor IDE app keeps separate
 * credentials, which is why the same connector works there and nowhere else.
 */
const lines = (...rows: readonly string[]): string => rows.join(String.fromCharCode(10));

describe("what the Cursor CLI says about its connectors", () => {
  it("reads a server and its status", () => {
    expect(parseCursorMcpList("robinhood-trading: requires_authentication")).toEqual([
      { name: "robinhood-trading", status: "requires_authentication", needsAuthentication: true },
    ]);
  });

  it("keeps a working server, and does not call it unauthenticated", () => {
    const read = parseCursorMcpList(lines("github: connected", "robinhood-trading: requires_authentication"));
    expect(read.map((entry) => entry.name)).toEqual(["github", "robinhood-trading"]);
    expect(read.map((entry) => entry.needsAuthentication)).toEqual([false, true]);
  });

  it("ignores blank lines and prose", () => {
    expect(parseCursorMcpList(lines("", "No MCP servers configured.", "   "))).toEqual([]);
  });

  it("says nothing when every connector is fine", () => {
    expect(cursorConnectorSentence(parseCursorMcpList("github: connected"))).toBeUndefined();
    expect(cursorConnectorSentence([])).toBeUndefined();
  });

  it("names the server and stops short of prescribing a fix", () => {
    const said = cursorConnectorSentence(parseCursorMcpList("robinhood-trading: requires_authentication"));
    expect(said).toContain("robinhood-trading");
    // The distinction that cost the most time.
    expect(said).toContain("Cursor app does not cover the CLI");
    /*
     * It used to end with `cursor-agent mcp login <name>`. Colin ran it, more
     * than once, and it does nothing -- MEASURED 2026-09-14: that command
     * persists no credential anywhere on this machine. An app that prescribes
     * a command which cannot work spends a person's evening for them.
     */
    expect(said).not.toContain("mcp login");
    expect(said).not.toMatch(/run this|in a terminal/i);
  });

  it("names every waiting server when there are several", () => {
    const said = cursorConnectorSentence(
      parseCursorMcpList(lines("a: requires_authentication", "b: connected", "c: requires_authentication")),
    );
    expect(said).toContain("a and c");
    expect(said).not.toContain("b,");
  });
});
