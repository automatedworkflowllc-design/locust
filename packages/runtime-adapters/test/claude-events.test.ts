import { describe, expect, it } from "vitest";

import {
  CLAUDE_COMPACTED,
  CLAUDE_COMPACTED_ON_REQUEST,
  createClaudeEventNormalizer,
  claudeToolTarget,
  limitKindFor,
  limitSentence,
  resetsAtIso,
  runtimeCommandsFrom,
  summarizeInit,
  usageWindowText,
} from "../src/claude-events.js";
import type { RuntimeProcessCompletion } from "../src/process-runner.js";

const NOW = "2026-08-31T16:00:00.000Z";

function normalizer() {
  return createClaudeEventNormalizer({
    runId: "run_1",
    missionId: "mission_1",
    cliVersion: "2.1.252",
    now: () => new Date(NOW),
  });
}

let sequence = 0;
function record(value: unknown) {
  sequence += 1;
  return { sequence, raw: JSON.stringify(value) };
}

function completion(overrides: Partial<RuntimeProcessCompletion> = {}): RuntimeProcessCompletion {
  return {
    exitCode: 0,
    signal: null,
    stderr: "",
    stderrTruncated: false,
    recordCount: 5,
    cancelled: false,
    forcedTerminationAttempted: false,
    terminationUnconfirmed: false,
    inputDeliveryFailed: false,
    outputLimitExceeded: false,
    startedAt: NOW,
    finishedAt: NOW,
    ...overrides,
  };
}

/** The real init record, trimmed but structurally as measured. */
const INIT = {
  type: "system",
  subtype: "init",
  cwd: "C:\\work",
  session_id: "33b21513-a4fb-478d-ad84-21cb7ef30571",
  tools: ["Glob", "Grep", "Read"],
  mcp_servers: [
    { name: "claude.ai Gmail", status: "connected" },
    { name: "claude.ai Robinhood", status: "connected" },
  ],
  model: "claude-opus-5",
  permissionMode: "plan",
  slash_commands: ["deep-research", "verify", "debug"],
  claude_code_version: "2.1.252",
  messaging_socket_path: "\\\\.\\pipe\\LOCAL\\cc-msg-474d737129a0",
  powershell_path: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  agents: ["claude", "Explore"],
  skills: ["deep-research"],
};

describe("trap 2: system/init is an environment dump", () => {
  it("keeps only allow-listed fields and replaces name lists with counts", () => {
    const summary = summarizeInit(INIT);
    expect(summary).toMatchObject({
      session_id: "33b21513-a4fb-478d-ad84-21cb7ef30571",
      model: "claude-opus-5",
      permissionMode: "plan",
      claude_code_version: "2.1.252",
      toolCount: 3,
      mcpServerCount: 2,
      slashCommandCount: 3,
    });
  });

  it("lets none of the machine description reach the event", () => {
    const events = normalizer().accept(record(INIT));
    const serialized = JSON.stringify(events);
    // Each of these describes the user's machine, and the ledger this lands in
    // is durable on disk.
    expect(serialized).not.toContain("Gmail");
    expect(serialized).not.toContain("Robinhood");
    expect(serialized).not.toContain("pipe");
    expect(serialized).not.toContain("powershell.exe");
    expect(serialized).not.toContain("deep-research");
    expect(serialized).not.toContain("Explore");
  });

  it("still reports the session id as the runtime thread", () => {
    const claude = normalizer();
    const [event] = claude.accept(record(INIT));
    expect(event?.type).toBe("run.started");
    expect(claude.runtimeThreadId).toBe("33b21513-a4fb-478d-ad84-21cb7ef30571");
  });
});

describe("trap 1: the answer arrives twice", () => {
  it("appends deltas and REPLACES on the complete assistant message", () => {
    const claude = normalizer();
    claude.accept(record(INIT));
    const deltas = ["P", "RO", "BE_OK"].flatMap((text) =>
      claude.accept(
        record({
          type: "stream_event",
          event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
        }),
      ),
    );
    expect(deltas).toHaveLength(3);
    for (const event of deltas) {
      expect(event.type === "message.delta" && event.payload.operation).toBe("append");
    }

    const [complete] = claude.accept(
      record({
        type: "assistant",
        message: { content: [{ type: "text", text: "PROBE_OK" }] },
      }),
    );
    // Appending here would double every answer -- and the checkpoint's
    // assistantSummary rebuilds the buffer this same way, so the bug would
    // reach the resume summary too.
    expect(complete?.type === "message.delta" && complete.payload.operation).toBe("replace");
    expect(complete?.type === "message.delta" && complete.payload.final).toBe(true);
    expect(complete?.type === "message.delta" && complete.payload.text).toBe("PROBE_OK");
  });

  it("replaces the block the text actually streamed into, not an assumed block_0", () => {
    // MEASURED 2026-09-03 by using the app: Claude Code does not always put
    // the answer at index 0. It sent another block first, so the deltas
    // arrived as `block_1` while the completing record replaced `block_0` --
    // two different items, and the finished answer rendered TWICE in full.
    // The test above never caught it because it streams at index 0, which is
    // the one index where the assumption happens to hold.
    const claude = normalizer();
    claude.accept(record(INIT));
    const [delta] = claude.accept(
      record({
        type: "stream_event",
        event: { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "PROBE_OK" } },
      }),
    );
    // The block the text streamed into (index 1), in this message.
    expect(delta?.type === "message.delta" && delta.payload.itemId).toMatch(/block_1$/);

    const [complete] = claude.accept(
      record({
        type: "assistant",
        message: { content: [{ type: "text", text: "PROBE_OK" }] },
      }),
    );
    // The SAME item: the complete record replaces what streamed, wherever it streamed.
    expect(complete?.type === "message.delta" && complete.payload.itemId).toBe(delta?.type === "message.delta" ? delta.payload.itemId : "");
    expect(complete?.type === "message.delta" && complete.payload.operation).toBe("replace");
  });

  it("gives every message its own item, so a later one never replaces an earlier one", () => {
    // A replay of a Bash-heavy Haiku run (2026-09-23): three things Claude
    // said to the person streamed into ONE item, each replacing the last,
    // because the block index restarts in every message.
    const claude = normalizer();
    const say = (id: string, text: string) => {
      claude.accept(record({ type: "stream_event", parent_tool_use_id: null, event: { type: "message_start", message: { id, usage: { input_tokens: 2 } } } }));
      const [streamed] = claude.accept(record({ type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } } }));
      const [complete] = claude.accept(record({ type: "assistant", parent_tool_use_id: null, message: { id, content: [{ type: "text", text }] } }));
      return { streamed, complete };
    };
    const first = say("msg_a", "I'll run these one at a time.");
    const second = say("msg_b", "The subagent is still working.");
    const ids = [first, second].map(({ streamed, complete }) => {
      const a = streamed?.type === "message.delta" ? streamed.payload.itemId : "";
      const b = complete?.type === "message.delta" ? complete.payload.itemId : "";
      expect(a).toBe(b);
      return a;
    });
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("gives each message its own item when the run does not stream", () => {
    const claude = normalizer();
    const [a] = claude.accept(record({ type: "assistant", message: { id: "msg_a", content: [{ type: "text", text: "First." }] } }));
    const [b] = claude.accept(record({ type: "assistant", message: { id: "msg_b", content: [{ type: "text", text: "Second." }] } }));
    expect(a?.type === "message.delta" && b?.type === "message.delta" && a.payload.itemId !== b.payload.itemId).toBe(true);
  });

  it("never speaks a subagent's words as the teammate's", () => {
    // In the same replay the subagent's "The file data/log.txt contains 5
    // lines." replaced the teammate's message, and the teammate's next one
    // then streamed onto the end of it.
    const claude = normalizer();
    expect(claude.accept(record({ type: "assistant", parent_tool_use_id: "toolu_agent", message: { id: "msg_sub", content: [{ type: "text", text: "The file contains 5 lines." }] } }))).toEqual([]);
    expect(claude.accept(record({ type: "stream_event", parent_tool_use_id: "toolu_agent", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "5" } } }))).toEqual([]);
  });

  it("never ends a subagent's own tool as a nameless call of the teammate's (0.543, RUN-01)", () => {
    // MEASURED shape, Haiku, 2026-10-02: the subagent's Read arrives as an
    // assistant tool_use (skipped) and then a user tool_result for that id.
    const claude = normalizer();
    claude.accept(record({ type: "assistant", parent_tool_use_id: "toolu_agent", message: { id: "msg_sub", content: [{ type: "tool_use", id: "toolu_sub_read", name: "Read", input: { file_path: "one.txt" } }] } }));
    expect(claude.accept(record({ type: "user", parent_tool_use_id: "toolu_agent", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_sub_read", content: "a" }] } }))).toEqual([]);
  });
});

describe("an activity row can say what a tool touched", () => {
  it("carries the file a tool acted on, which only arrives once the block is complete", () => {
    // MEASURED 2026-09-03 by reading the card: every Claude row said
    // `Read done` / `Write failed` and nothing else, because a tool's input
    // streams in as JSON deltas after the call opens.
    const claude = normalizer();
    claude.accept(record(INIT));
    claude.accept(
      record({
        type: "stream_event",
        event: {
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "toolu_1", name: "Read" },
        },
      }),
    );
    claude.accept(
      record({
        type: "assistant",
        message: {
          content: [{ type: "tool_use", id: "toolu_1", name: "Read", input: { file_path: "C:/w/src/cli.js" } }],
        },
      }),
    );
    const [done] = claude.accept(
      record({
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "ok" }] },
      }),
    );
    expect(done?.type === "tool.completed" && done.payload.name).toBe("Read");
    expect(done?.type === "tool.completed" && done.payload.command).toBe("C:/w/src/cli.js");
  });

  it("reads each tool's own idea of a target", () => {
    expect(claudeToolTarget("Bash", { command: "npm test" })).toBe("npm test");
    expect(claudeToolTarget("Glob", { pattern: "src/**/*.js" })).toBe("src/**/*.js");
    expect(claudeToolTarget("Write", { file_path: "src/format.js" })).toBe("src/format.js");
    expect(claudeToolTarget("Read", {})).toBeUndefined();
    expect(claudeToolTarget("Read", undefined)).toBeUndefined();
  });
});

describe("trap 3: a rate-limit warning is not exhaustion", () => {
  it("maps allowed_warning to a temporary limit", () => {
    expect(limitKindFor("allowed_warning")).toBe("temporary-rate-limit");
    // `allowed` was ALSO a temporary limit here until a live run put a red
    // "Provider rate limit" card over a mission that had just completed
    // normally. It reports that the request went through: nothing to say.
    expect(limitKindFor("allowed")).toBeUndefined();
    // Falling back to a worse model while the good one still works is the
    // failure this prevents.
    expect(limitKindFor("rejected")).toBe("quota-exhausted");
    expect(limitKindFor("blocked")).toBe("quota-exhausted");
  });

  it("reads resetsAt as epoch seconds, not milliseconds", () => {
    // The measured record carried a seven_day window with this resetsAt, and
    // read as SECONDS it lands a week out -- which is the corroboration that
    // the unit is right, not just that the arithmetic is self-consistent.
    expect(resetsAtIso(1788764400)).toBe("2026-09-07T07:00:00.000Z");
    // Read as milliseconds it would land tens of thousands of years out.
    expect(resetsAtIso(1788764400000)?.startsWith("2026")).toBe(false);
    expect(resetsAtIso("nope")).toBeUndefined();
  });

  it("emits a limit event carrying the window and status, in words", () => {
    const [event] = normalizer().accept(
      record({
        type: "rate_limit_event",
        rate_limit_info: {
          status: "allowed_warning",
          rateLimitType: "seven_day",
          utilization: 0.31,
          resetsAt: 1788764400,
        },
      }),
    );
    expect(event?.type).toBe("route.limit_detected");
    expect(event?.type === "route.limit_detected" && event.payload.kind).toBe("temporary-rate-limit");
    // It read "seven_day limit allowed_warning · resets ...", the record's
    // own keys, in the thread (drive, 2026-09-23).
    expect(event?.type === "route.limit_detected" && event.payload.message).toBe(
      "You've used 31% of your 7-day window · resets 2026-09-07T07:00:00.000Z",
    );
  });

  /*
   * 0.407, Colin: "thats not true, i used claude today and it hadnt updated".
   * His morning runs sent nine warnings at 78-79% of the 7-day window; each
   * was kept as a notice and the usage card stayed on the night before's 66%.
   */
  it("keeps a warning's figures as a usage reading too, beside the notice", () => {
    const events = normalizer().accept(
      record({
        type: "rate_limit_event",
        rate_limit_info: { status: "allowed_warning", rateLimitType: "seven_day", utilization: 0.79, resetsAt: 1788764400 },
      }),
    );
    expect(events.map((event) => event.type)).toEqual(["route.limit_detected", "adapter.diagnostic"]);
    // 0.413: in COUNTING order -- the ledger refuses a batch whose sequences
    // do not count up, and 0.407-0.412 returned N+1 before N, stopping every
    // Claude run at its first usage warning.
    expect(events.map((event) => event.sequence)).toEqual([events[0]!.sequence, events[0]!.sequence + 1]);
    const reading = events[1];
    expect(reading?.type === "adapter.diagnostic" && reading.payload.code).toBe("claude.usage_window");
    expect(reading?.type === "adapter.diagnostic" && reading.payload.message).toBe("7-day window 79% used · resets 2026-09-07T07:00:00.000Z");
  });

  it("prefers every window a warning carries over its own one", () => {
    const events = normalizer().accept(
      record({
        type: "rate_limit_event",
        rate_limit_info: {
          status: "allowed_warning",
          rateLimitType: "seven_day",
          utilization: 0.79,
          resetsAt: 1788764400,
          unifiedWindows: { seven_day: { utilization: 0.79, resetsAt: 1788764400 }, five_hour: { utilization: 0.4, resetsAt: 1788764400 } },
        },
      }),
    );
    const reading = events.find((event) => event.type === "adapter.diagnostic");
    expect(reading?.type === "adapter.diagnostic" && reading.payload.message).toMatch(/7-day window 79% used.* · 5-hour window 40% used/);
  });

  it("words a limit from the window's own reading when the record has no top-level figure, and a rejection without the warning", () => {
    expect(
      limitSentence({
        status: "allowed_warning",
        rateLimitType: "five_hour",
        resetsAt: 1788764400,
        unifiedWindows: { five_hour: { utilization: 0.92, resetsAt: 1788764400 } },
      }),
    ).toBe("You've used 92% of your 5-hour window · resets 2026-09-07T07:00:00.000Z");
    expect(limitSentence({ status: "allowed_warning", rateLimitType: "seven_day" })).toBe("Your 7-day window is running low");
    expect(limitSentence({ status: "rejected", rateLimitType: "seven_day_opus" })).toBe("7-day opus window");
    expect(limitSentence({ status: "rejected" })).toBe("usage window");
  });

  it("says nothing about a snapshot that reports the request was allowed", () => {
    // Claude reports usage on ordinary turns. A live run surfaced one of these
    // as a red "Provider rate limit" card over a mission that had just
    // completed normally; `allowed` means nothing was wrong.
    expect(
      normalizer().accept(
        record({
          type: "rate_limit_event",
          rate_limit_info: { status: "allowed", rateLimitType: "five_hour", resetsAt: 1788764400 },
        }),
      ),
    ).toEqual([]);
    expect(limitKindFor("allowed")).toBeUndefined();
    expect(limitKindFor(undefined)).toBeUndefined();
  });

  it("still reports an approaching limit and a rejection", () => {
    expect(limitKindFor("allowed_warning")).toBe("temporary-rate-limit");
    expect(limitKindFor("rejected")).toBe("quota-exhausted");
  });
});

describe("trap 4: NUL and length at the origin", () => {
  it("strips NUL from provider text before it can reach the ledger", () => {
    const NUL = String.fromCharCode(0);
    const events = normalizer().accept(
      record({
        type: "assistant",
        message: { content: [{ type: "text", text: `clean${NUL}text` }] },
      }),
    );
    const strings: string[] = [];
    const walk = (value: unknown): void => {
      if (typeof value === "string") strings.push(value);
      else if (Array.isArray(value)) value.forEach(walk);
      else if (value !== null && typeof value === "object") Object.values(value).forEach(walk);
    };
    walk(events);
    // Asserted on the actual strings: JSON.stringify escapes NUL, so searching
    // stringified output for one can never fail.
    expect(strings.every((value) => !value.includes(NUL))).toBe(true);
    expect(strings.some((value) => value.includes("cleantext"))).toBe(true);
  });

  it("clamps an over-long tool identity", () => {
    const [event] = normalizer().accept(
      record({
        type: "stream_event",
        event: {
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "x".repeat(4000), name: "y".repeat(4000) },
        },
      }),
    );
    expect(event?.type).toBe("tool.started");
    if (event?.type === "tool.started") {
      expect(event.payload.itemId.length).toBeLessThanOrEqual(512);
      expect(event.payload.name.length).toBeLessThanOrEqual(512);
    }
  });
});

describe("tool pairing and terminal state", () => {
  function withOpenTool() {
    const claude = normalizer();
    claude.accept(
      record({
        type: "stream_event",
        event: {
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "toolu_1", name: "Read" },
        },
      }),
    );
    return claude;
  }

  it("pairs a tool result to its start by block id", () => {
    const [done] = withOpenTool().accept(
      record({
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "toolu_1", is_error: false }] },
      }),
    );
    expect(done?.type).toBe("tool.completed");
    expect(done?.type === "tool.completed" && done.payload.name).toBe("Read");
  });

  it("reports an errored tool result as failed", () => {
    const [failed] = withOpenTool().accept(
      record({
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "toolu_1", is_error: true }] },
      }),
    );
    expect(failed?.type).toBe("tool.failed");
  });

  it("completes only when the provider actually said it finished", () => {
    const claude = normalizer();
    claude.accept(record({ type: "result", subtype: "success", is_error: false, result: "ok" }));
    const [terminal] = claude.finish(completion());
    expect(terminal?.type).toBe("run.completed");
  });

  it("says what the run was refused permission to do, on an otherwise successful result", () => {
    // MEASURED 2026-09-05 by running the app's own accept-edits argv by hand:
    // `--permission-mode acceptEdits` auto-approves edits but NOT Bash, so
    // `node t.mjs` came back as a permission denial WHILE the record said
    // is_error false, subtype success, terminal_reason completed. The mission
    // completed with the person's actual request never attempted, and nothing
    // said so (QA pass, five identical attempts on one mission).
    const claude = normalizer();
    const events = claude.accept(
      record({
        type: "result",
        subtype: "success",
        is_error: false,
        terminal_reason: "completed",
        result: "It looks like running that command requires your approval",
        permission_denials: [
          { tool_name: "Bash", tool_use_id: "toolu_01", tool_input: { command: "node t.mjs", description: "Run t.mjs" } },
        ],
      }),
    );
    const said = events.find((event) => event.type === "adapter.diagnostic");
    expect(said?.payload.level).toBe("warning");
    expect(String(said?.payload.message)).toContain("Bash");
    expect(String(said?.payload.message)).toContain("node t.mjs");
    // NOT a failure: the run did what it was allowed to do.
    const [terminal] = claude.finish(completion());
    expect(terminal?.type).toBe("run.completed");
  });

  it("stays quiet when nothing was refused", () => {
    const claude = normalizer();
    const events = claude.accept(
      record({ type: "result", subtype: "success", is_error: false, result: "ok", permission_denials: [] }),
    );
    expect(events.some((event) => event.type === "adapter.diagnostic")).toBe(false);
  });

  it("refuses to call a clean exit a success when no result record arrived", () => {
    // Exit 0 is not the provider saying it finished. Treating it as success is
    // how a truncated run gets recorded as a completed one.
    const [terminal] = normalizer().finish(completion());
    expect(terminal?.type).toBe("run.failed");
    expect(terminal?.type === "run.failed" && terminal.payload.runtimeTerminal).toBe("missing");
  });

  it("reports a provider error result as a failure", () => {
    const claude = normalizer();
    claude.accept(
      record({ type: "result", subtype: "error_max_turns", is_error: true, result: "too many turns" }),
    );
    const [terminal] = claude.finish(completion());
    expect(terminal?.type).toBe("run.failed");
    expect(terminal?.type === "run.failed" && terminal.payload.message).toContain("too many turns");
  });

  it("reports cancellation as cancelled, not failed", () => {
    const [terminal] = normalizer().finish(completion({ cancelled: true }));
    expect(terminal?.type).toBe("run.cancelled");
  });

  it("stamps every event with the claude adapter", () => {
    const claude = normalizer();
    const events = [...claude.accept(record(INIT)), ...claude.finish(completion({ cancelled: true }))];
    expect(events.every((event) => event.sourceAdapter === "claude")).toBe(true);
    expect(events.every((event) => event.runId === "run_1")).toBe(true);
  });

  it("survives a malformed record without throwing", () => {
    const events = normalizer().accept({ sequence: 1, raw: "{not json" });
    expect(events[0]?.type).toBe("adapter.diagnostic");
  });
});

describe("what the run cost, as Claude Code priced it", () => {
  it("names the model an alias turned out to mean", () => {
    // Claude Code takes `sonnet` and resolves it to whichever model is
    // newest in that family. Its START record repeats the alias, so only the
    // result can say what actually ran.
    const claude = normalizer();
    claude.accept(
      record({
        type: "result",
        subtype: "success",
        is_error: false,
        usage: { input_tokens: 10, output_tokens: 47 },
        modelUsage: { "claude-sonnet-5": { canonicalModel: "claude-sonnet-5", contextWindow: 1000000 } },
      }),
    );
    const [done] = claude.finish(completion({ exitCode: 0 }));
    expect((done?.payload as { resolvedModel?: string }).resolvedModel).toBe("claude-sonnet-5");
  });

  it("names none when a run used more than one model", () => {
    // There is no single answer then, and picking one would be picking a
    // favourite.
    const claude = normalizer();
    claude.accept(
      record({
        type: "result",
        subtype: "success",
        is_error: false,
        usage: { input_tokens: 10, output_tokens: 47 },
        modelUsage: {
          "claude-sonnet-5": { canonicalModel: "claude-sonnet-5" },
          "claude-haiku-4-5-20251001": { canonicalModel: "claude-haiku-4-5-20251001" },
        },
      }),
    );
    const [done] = claude.finish(completion({ exitCode: 0 }));
    expect((done?.payload as { resolvedModel?: string }).resolvedModel).toBeUndefined();
  });

  it("carries the model's own context window, so a reading has a real denominator", () => {
    // MEASURED 2026-09-06: `modelUsage` states `contextWindow` per model --
    // 1,000,000 for claude-sonnet-5. It is the only denominator the app will
    // use; a runtime that reports none gets no percentage invented for it.
    const claude = normalizer();
    claude.accept(
      record({
        type: "result",
        subtype: "success",
        is_error: false,
        usage: { input_tokens: 2, output_tokens: 5, cache_read_input_tokens: 23997, cache_creation_input_tokens: 15080 },
        modelUsage: { "claude-sonnet-5": { contextWindow: 1000000, maxOutputTokens: 64000 } },
      }),
    );
    const [done] = claude.finish(completion({ exitCode: 0 }));
    const usage = (done?.payload as { usage?: Record<string, number> }).usage;
    expect(usage?.contextWindow).toBe(1000000);
    expect(usage?.cacheReadTokens).toBe(23997);
    expect(usage?.cacheWriteTokens).toBe(15080);
  });

  it("reports no window when the result names none", () => {
    const claude = normalizer();
    claude.accept(
      record({
        type: "result",
        subtype: "success",
        is_error: false,
        usage: { input_tokens: 10, output_tokens: 47 },
        modelUsage: { "some-model": { costUSD: 0.01 } },
      }),
    );
    const [done] = claude.finish(completion({ exitCode: 0 }));
    const usage = (done?.payload as { usage?: Record<string, number> }).usage;
    expect(usage?.contextWindow).toBeUndefined();
  });

  it("carries the dollar figure and the token counts from the result record onto the receipt", () => {
    const claude = normalizer();
    claude.accept(
      record({
        type: "result",
        subtype: "success",
        is_error: false,
        total_cost_usd: 0.0297808,
        usage: { input_tokens: 10, output_tokens: 47, cache_read_input_tokens: 17648 },
        modelUsage: { "claude-haiku-4-5-20251001": { costUSD: 0.0297808 } },
      }),
    );
    const [done] = claude.finish(completion({ exitCode: 0 }));
    expect(done?.type).toBe("run.completed");
    const usage = (done?.payload as { usage?: Record<string, number> }).usage;
    // The cache count travels too: a resumed turn sends almost nothing new
    // and reads the rest from cache, so input alone would say a long
    // conversation is occupying nothing.
    expect(usage).toEqual({ usd: 0.0297808, inputTokens: 10, outputTokens: 47, cacheReadTokens: 17648 });
    // The per-model table names the account's models; it does not travel.
    expect(JSON.stringify(done)).not.toContain("modelUsage");
  });

  it("says nothing about cost when the result record carried none", () => {
    const claude = normalizer();
    claude.accept(record({ type: "result", subtype: "success", is_error: false }));
    const [done] = claude.finish(completion({ exitCode: 0 }));
    expect((done?.payload as { usage?: unknown }).usage).toBeUndefined();
  });
});

describe("how full the conversation is, and who paid for the run", () => {
  // MEASURED 2026-09-23 off Colin's ledger, which is where these shapes come
  // from: a 23-call Opus 5.5 run whose result `usage` summed to 4,978,743
  // tokens against a 1,000,000 window -- the ring read "5M of 1M" -- while no
  // single call's prompt passed 240k. Every call re-reads the conversation
  // from cache, so the sum counts it once per call.
  const call = (id: string, cacheWrite: number, cacheRead: number, extra: Record<string, unknown> = {}) =>
    record({
      type: "stream_event",
      parent_tool_use_id: null,
      event: {
        type: "message_start",
        message: { id, model: "claude-opus-5-5", usage: { input_tokens: 2, cache_creation_input_tokens: cacheWrite, cache_read_input_tokens: cacheRead, output_tokens: 1 } },
      },
      ...extra,
    });
  const ended = (output: number) =>
    record({ type: "stream_event", parent_tool_use_id: null, event: { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: output } } });
  const window = (overage: boolean) =>
    record({
      type: "rate_limit_event",
      rate_limit_info: {
        status: "allowed",
        resetsAt: 1790141400,
        rateLimitType: "five_hour",
        overageStatus: "rejected",
        isUsingOverage: overage,
        unifiedWindows: { five_hour: { utilization: 0.65, resetsAt: 1790141400 }, seven_day: { utilization: 0.45, resetsAt: 1790578800 } },
      },
    });
  const result = record({
    type: "result",
    subtype: "success",
    is_error: false,
    total_cost_usd: 3.06,
    usage: { input_tokens: 46, output_tokens: 31_000, cache_read_input_tokens: 4_796_000, cache_creation_input_tokens: 151_697 },
    modelUsage: { "claude-opus-5-5": { contextWindow: 1_000_000 } },
  });
  const receipt = (claude: ReturnType<typeof normalizer>) =>
    (claude.finish(completion({ exitCode: 0 }))[0]?.payload as { usage?: Record<string, unknown> }).usage;

  it("reads the context off the last call, never off the run's sum", () => {
    const claude = normalizer();
    claude.accept(call("msg_1", 191_411, 0));
    claude.accept(ended(59));
    claude.accept(call("msg_2", 3_333, 191_411));
    claude.accept(ended(54));
    claude.accept(call("msg_3", 2_347, 233_702));
    claude.accept(ended(706));
    claude.accept(result);
    const usage = receipt(claude);
    // What the conversation holds after its last call: that call's prompt,
    // cached or not, and what it wrote.
    expect(usage?.contextTokens).toBe(2 + 2_347 + 233_702 + 706);
    // The run's own totals stay what Claude Code said they were.
    expect(usage?.cacheReadTokens).toBe(4_796_000);
    expect(usage?.contextWindow).toBe(1_000_000);
  });

  it("leaves a subagent's calls out: its context is its own", () => {
    const claude = normalizer();
    claude.accept(call("msg_1", 2_347, 233_702));
    claude.accept(ended(706));
    claude.accept(call("msg_sub", 40_000, 0, { parent_tool_use_id: "toolu_agent" }));
    claude.accept(record({ type: "assistant", parent_tool_use_id: "toolu_agent", message: { id: "msg_sub", content: [], usage: { input_tokens: 5, cache_read_input_tokens: 90_000, output_tokens: 300 } } }));
    claude.accept(result);
    expect(receipt(claude)?.contextTokens).toBe(2 + 2_347 + 233_702 + 706);
  });

  it("reads the complete message's usage when the run does not stream", () => {
    const claude = normalizer();
    claude.accept(record({ type: "assistant", parent_tool_use_id: null, message: { id: "msg_1", content: [{ type: "text", text: "a" }], usage: { input_tokens: 2, cache_creation_input_tokens: 916, cache_read_input_tokens: 204_276, output_tokens: 59 } } }));
    claude.accept(record({ type: "assistant", parent_tool_use_id: null, message: { id: "msg_2", content: [{ type: "text", text: "b" }], usage: { input_tokens: 2, cache_creation_input_tokens: 1_783, cache_read_input_tokens: 212_934, output_tokens: 54 } } }));
    claude.accept(result);
    expect(receipt(claude)?.contextTokens).toBe(2 + 1_783 + 212_934 + 54);
  });

  it("says no context at all when no call stated one", () => {
    const claude = normalizer();
    claude.accept(result);
    expect(receipt(claude)?.contextTokens).toBeUndefined();
  });

  it("marks a run a subscription's windows covered, and keeps Claude Code's dollar figure as it wrote it", () => {
    const claude = normalizer();
    claude.accept(call("msg_1", 2_347, 233_702));
    claude.accept(window(false));
    claude.accept(result);
    const usage = receipt(claude);
    expect(usage?.billing).toBe("subscription");
    expect(usage?.usd).toBe(3.06);
  });

  it("does not, where any of the run spent paid extra usage, or where no window was reported", () => {
    // A key source of "none" alone is not the evidence: a cloud-billed setup
    // reports the same, and that one is paying.
    const extra = normalizer();
    extra.accept(window(false));
    extra.accept(window(true));
    extra.accept(result);
    expect(receipt(extra)?.billing).toBeUndefined();
    const keyed = normalizer();
    keyed.accept(record({ ...INIT, apiKeySource: "none" }));
    keyed.accept(result);
    expect(receipt(keyed)?.billing).toBeUndefined();
  });
});

describe("the signals Claude Code gives a person about what is happening (measured 2026-09-05)", () => {
  it("passes a notification through as a diagnostic, immediate ones as warnings, without the ctrl+o hint", () => {
    const n = normalizer();
    const events = n.accept(record({ type: "system", subtype: "notification", key: "stop-hook-error", text: "Stop hook error occurred · ctrl+o to see", priority: "immediate" }));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "adapter.diagnostic", payload: { code: "claude.notification", level: "warning", message: "Stop hook error occurred", terminal: false } });
    const quiet = n.accept(record({ type: "system", subtype: "notification", text: "Plugins updated", priority: "normal" }));
    expect(quiet[0]).toMatchObject({ payload: { level: "info", message: "Plugins updated" } });
  });

  it("follows a subagent's life as steps, and hands its type and summary to the Agent call that started it", () => {
    const n = normalizer();
    n.accept(record({ type: "system", subtype: "init", session_id: "s1" }));
    n.accept(record({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "Agent" } } }));
    const started = n.accept(record({ type: "system", subtype: "task_started", task_id: "t1", tool_use_id: "toolu_1", description: "Count README.md lines", subagent_type: "Explore", task_type: "local_agent" }));
    expect(started[0]).toMatchObject({ type: "step.started", payload: { stepKind: "item", itemId: "subagent:t1", itemType: "subagent", message: "Explore · Count README.md lines" } });
    const progress = n.accept(record({ type: "system", subtype: "task_progress", task_id: "t1", tool_use_id: "toolu_1", description: "Reading README.md", subagent_type: "Explore", last_tool_name: "Read", usage: { total_tokens: 4092, tool_uses: 1 } }));
    expect(progress[0]).toMatchObject({ type: "step.started", payload: { itemId: "subagent:t1", message: "Explore · Reading README.md · last tool Read" } });
    expect(n.accept(record({ type: "system", subtype: "task_updated", task_id: "t1", patch: { status: "completed" } }))).toEqual([]);
    expect(n.accept(record({ type: "system", subtype: "thinking_tokens", estimated_tokens: 50, estimated_tokens_delta: 50 }))).toEqual([]);
    const done = n.accept(record({ type: "system", subtype: "task_notification", task_id: "t1", tool_use_id: "toolu_1", status: "completed", summary: "3", usage: { total_tokens: 6787, tool_uses: 1 } }));
    expect(done[0]).toMatchObject({ type: "step.completed", payload: { stepKind: "item", itemId: "subagent:t1", status: "completed" } });
    const result = n.accept(record({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "3" }] } }));
    expect(result[0]).toMatchObject({ type: "tool.completed", payload: { itemId: "toolu_1", name: "Agent", status: "Explore", output: "3" } });
  });

  it("marks a subagent that failed as a failed step, and the launcher's failure stays the runtime's word", () => {
    const n = normalizer();
    n.accept(record({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_2", name: "Agent" } } }));
    const failed = n.accept(record({ type: "system", subtype: "task_notification", task_id: "t2", tool_use_id: "toolu_2", status: "failed", summary: "no such file" }));
    expect(failed[0]).toMatchObject({ type: "step.failed", payload: { itemId: "subagent:t2" } });
    const result = n.accept(record({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolu_2", is_error: true, content: "boom" }] } }));
    expect(result[0]).toMatchObject({ type: "tool.failed", payload: { status: "error", output: "no such file" } });
  });
});

describe("a running tool's heartbeat", () => {
  // The shapes Claude Code 2.1.280 writes, from its own emitter: a heartbeat
  // for a long tool, and a subagent's API retry.
  it("is not a thread item, and never an unhandled record", () => {
    const n = normalizer();
    n.accept(record({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_9", name: "Bash" } } }));
    expect(n.accept(record({ type: "tool_progress", tool_use_id: "toolu_9", tool_name: "Bash", parent_tool_use_id: null, elapsed_time_seconds: 31, heartbeat: true, session_id: "s1", uuid: "u1" }))).toEqual([]);
    expect(n.accept(record({ type: "tool_progress", tool_use_id: "toolu_9", tool_name: "Agent", parent_tool_use_id: null, elapsed_time_seconds: 0, subagent_type: "Explore", subagent_retry: { agent_id: "a1", attempt: 2, max_retries: 10 }, session_id: "s1", uuid: "u2" }))).toEqual([]);
    // The tool still finishes as itself.
    const result = n.accept(record({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolu_9", content: "ok" }] } }));
    expect(result[0]).toMatchObject({ type: "tool.completed", payload: { itemId: "toolu_9", name: "Bash" } });
  });
});

describe("a still-allowed rate limit is a usage window", () => {
  it("words the windows, fullest first, with when they reset", () => {
    expect(usageWindowText({ five_hour: { utilization: 0.35, resetsAt: 1788660600 }, seven_day: { utilization: 0.5, resetsAt: 1788764400 } })).toMatch(/^7-day window 50% used · resets .+ · 5-hour window 35% used · resets .+$/);
    expect(usageWindowText({})).toBeUndefined();
    expect(usageWindowText("no")).toBeUndefined();
  });

  it("becomes a usage_window diagnostic, not a limit, while the status is allowed", () => {
    const n = normalizer();
    const events = n.accept(record({ type: "rate_limit_event", rate_limit_info: { status: "allowed", rateLimitType: "five_hour", resetsAt: 1788660600, unifiedWindows: { five_hour: { utilization: 0.35, resetsAt: 1788660600 } } } }));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "adapter.diagnostic", payload: { code: "claude.usage_window", level: "info", terminal: false } });
    expect((events[0]!.payload as { message: string }).message).toMatch(/5-hour window 35% used/);
  });
});

describe("a run the host stopped for output volume", () => {
  // Locust caps a single line of runtime output at 256 KB and kills the
  // process past it. Codex has said so since 0.38.4; the other adapters share
  // the same runner and the same cap and said nothing, so an outside tester
  // forcing a huge output concluded "Locust did not name a 256 KB cap"
  // (2026-09-07). Saying "ended without a terminal result record" for a kill
  // we performed is the vaguest possible account of the one thing we know.
  it("says so instead of reporting a missing result record", () => {
    const target = normalizer();
    const events = target.finish(
      completion({ exitCode: null, signal: "SIGINT", outputLimitExceeded: true }),
    );
    const failed = events.find((entry) => entry.type === "run.failed")?.payload as
      | { readonly message: string }
      | undefined;
    expect(failed?.message).toContain("faster than Locust could record it");
    expect(failed?.message).not.toContain("without a terminal result record");
  });
});

describe("a long call is named while it runs", () => {
  // Colin, 2026-09-23, with a frame of a Claude run eight minutes in: the live
  // line read "Using a tool... Bash" for the whole call. The start goes out
  // when the block opens, with the tool's name only; the command and Claude
  // Code's description of it arrive with the complete message.
  it("announces the call again once its command and description are known", () => {
    const n = normalizer();
    n.accept(record({ type: "stream_event", event: { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_long", name: "Bash" } } }));
    const events = n.accept(record({
      type: "assistant",
      parent_tool_use_id: null,
      message: { id: "msg_1", content: [{ type: "tool_use", id: "toolu_long", name: "Bash", input: { command: "cd C:/work && npm test", description: "Run the test suite" } }] },
    }));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "tool.started", payload: { itemId: "toolu_long", name: "Bash", command: "cd C:/work && npm test", title: "Run the test suite", phase: "started" } });
    // Said once: the same message again restates nothing.
    expect(n.accept(record({ type: "assistant", message: { id: "msg_1", content: [{ type: "tool_use", id: "toolu_long", name: "Bash", input: { command: "cd C:/work && npm test", description: "Run the test suite" } }] } }))).toEqual([]);
  });
});

describe("a call Claude Code refused", () => {
  // Claude Code 2.1.280 says so when it refuses (`system` / `permission_denied`,
  // with the call and the reason), then returns the call as an error. Read as
  // an error it counted as a command that ran and exited non-zero.
  it("is reported as refused, with the reason, not as failed", () => {
    const n = normalizer();
    n.accept(record({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_loop", name: "Bash" } } }));
    expect(n.accept(record({ type: "system", subtype: "permission_denied", tool_name: "Bash", tool_use_id: "toolu_loop", decision_reason_type: "other", decision_reason: "Contains simple_expansion", message: "Contains simple_expansion" }))).toEqual([]);
    const [done] = n.accept(record({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolu_loop", is_error: true, content: "Contains simple_expansion" }] } }));
    expect(done).toMatchObject({ type: "tool.failed", payload: { itemId: "toolu_loop", status: "refused", output: "Contains simple_expansion" } });
  });

  it("leaves an ordinary failure a failure", () => {
    const n = normalizer();
    n.accept(record({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_x", name: "Bash" } } }));
    const [done] = n.accept(record({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolu_x", is_error: true, content: "exit code 1" }] } }));
    expect(done).toMatchObject({ type: "tool.failed", payload: { status: "error" } });
  });
});

/*
 * A2.5: a compaction, and the command list. Shaped as MEASURED 2026-09-24 on
 * Claude Code 2.1.281 (a two-turn Haiku session, then `/compact`); the
 * capture itself stays out of the repo, since its init and command records
 * describe the machine it ran on.
 */
describe("Claude Code compacting its conversation", () => {
  const boundary = (trigger: string) => ({
    type: "system",
    subtype: "compact_boundary",
    session_id: "ses_1",
    uuid: "u1",
    compact_metadata: { trigger, pre_tokens: 35420, post_tokens: 7635 },
  });

  it("says so once, as a line the host can read, and not as an empty step", () => {
    const events = normalizer().accept(record(boundary("auto")));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "adapter.diagnostic",
      payload: { code: "claude.context_compacted", level: "info", message: CLAUDE_COMPACTED },
    });
    expect(normalizer().accept(record(boundary("manual")))[0]?.payload).toMatchObject({ message: CLAUDE_COMPACTED_ON_REQUEST });
  });

  it("keeps the person's command list out of the run's record", () => {
    // Twice a run, 44 KB each, measured: every slash command and skill with
    // its description.
    const listed = {
      type: "system",
      subtype: "commands_changed",
      commands: [{ name: "deliver", description: "a person's own skill", argumentHint: "" }],
    };
    expect(normalizer().accept(record(listed))).toEqual([]);
  });

  it("hands the command list to the host for the / menu, and still keeps it out of the record (0.426)", () => {
    const heard: (readonly { name: string; description: string; argumentHint: string }[])[] = [];
    const listening = createClaudeEventNormalizer({
      runId: "run_1",
      missionId: "mission_1",
      cliVersion: "2.1.283",
      now: () => new Date(NOW),
      onCommands: (commands) => heard.push(commands),
    });
    const listed = {
      type: "system",
      subtype: "commands_changed",
      commands: [
        { name: "compact", description: "Clear conversation history but keep a summary in context", argumentHint: "<optional custom summarization instructions>" },
        { name: "/security-review", description: "Complete a security review\n  of the pending changes" },
        { name: "plugin:skill", description: "", argumentHint: "" },
        // Not a command name: refused rather than drawn in the menu.
        { name: "rm -rf /", description: "x" },
        { name: "", description: "x" },
        { description: "no name" },
        "compact",
      ],
    };
    expect(listening.accept(record(listed))).toEqual([]);
    expect(heard).toEqual([
      [
        { name: "compact", description: "Clear conversation history but keep a summary in context", argumentHint: "<optional custom summarization instructions>" },
        // A leading slash dropped, and the text on one line.
        { name: "security-review", description: "Complete a security review of the pending changes", argumentHint: "" },
        { name: "plugin:skill", description: "", argumentHint: "" },
      ],
    ]);
  });

  it("bounds what a command list can put in the menu", () => {
    const many = Array.from({ length: 900 }, (_, index) => ({ name: `c${String(index)}`, description: "d".repeat(5000), argumentHint: "h".repeat(500) }));
    const commands = runtimeCommandsFrom(many);
    expect(commands).toHaveLength(400);
    expect(commands[0]?.description).toHaveLength(240);
    expect(commands[0]?.argumentHint).toHaveLength(80);
    expect(runtimeCommandsFrom({ not: "a list" })).toEqual([]);
    expect(runtimeCommandsFrom([{ name: "x".repeat(65) }])).toEqual([]);
  });
});
