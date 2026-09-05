import { describe, expect, it } from "vitest";

import {
  createClaudeEventNormalizer,
  claudeToolTarget,
  limitKindFor,
  resetsAtIso,
  summarizeInit,
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
    expect(delta?.type === "message.delta" && delta.payload.itemId).toBe("block_1");

    const [complete] = claude.accept(
      record({
        type: "assistant",
        message: { content: [{ type: "text", text: "PROBE_OK" }] },
      }),
    );
    expect(complete?.type === "message.delta" && complete.payload.itemId).toBe("block_1");
    expect(complete?.type === "message.delta" && complete.payload.operation).toBe("replace");
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

  it("emits a limit event carrying the window and status", () => {
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
    expect(event?.type === "route.limit_detected" && event.payload.message).toContain("seven_day");
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
    expect(usage).toEqual({ usd: 0.0297808, inputTokens: 10, outputTokens: 47 });
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
