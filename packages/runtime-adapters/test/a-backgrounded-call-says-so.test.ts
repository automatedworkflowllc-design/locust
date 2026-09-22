import { describe, expect, it } from "vitest";

import { claudeToolBackgrounded, createClaudeEventNormalizer } from "../src/index.js";
import type { NormalizedRuntimeEvent } from "../src/codex-events.js";

/**
 * A CALL SENT TO THE BACKGROUND IS NOT A CALL THAT WAS WAITED ON.
 *
 * Colin, 2026-09-21: he ran something that went to the background and "when
 * it finished we never got the follow up reply", and guessed there was no UI
 * for a background task anywhere in Locust. There was not.
 *
 * On 2026-09-22 I told him Copilot CLI was the only runtime that reports
 * them. That was wrong, and wrongly reasoned: I had searched this repo's
 * adapters and fixtures, and there are no Claude or Codex fixtures at all,
 * so the search could not have answered the question I used it to answer.
 * He said he was "90% sure claude code and codex also report background
 * tasks".
 *
 * He was right about Claude. Its Bash tool takes `run_in_background`, so the
 * fact arrives on the tool call's own input -- the same input the adapter
 * already opened for the command and the description, and read neither of
 * those from until each was separately noticed missing.
 *
 * Codex is still unestablished: no capture of its stream exists here, so
 * nothing in this file claims anything about it either way.
 */
const NOW = "2026-09-22T10:00:00.000Z";

function normalizer() {
  return createClaudeEventNormalizer({ runId: "run_1", now: () => new Date(NOW) });
}

let line = 0;
const record = (value: unknown) => {
  line += 1;
  return { sequence: line, raw: JSON.stringify(value) };
};

/**
 * A Bash call, in the three records Claude Code actually sends for one.
 *
 * `content_block_start` OPENS the tool with its name and no input; the
 * `assistant` record that follows carries the filled-in input; the `user`
 * record closes it with the result. The first version of this test sent
 * only the last two, so the tool was never opened, the fill loop skipped it,
 * and the assertion failed against working code.
 *
 * Reconstructed from the adapter rather than from a capture, and that is
 * worth stating: when this was written the repo held no Claude fixture. It
 * is the shape the adapter was built against, which is not the same as a
 * recording. There is one now (`fixtures/claude/`, 2026-09-22), and it
 * showed the adapter half of this was right and the thread never read it --
 * see `background-work-ends-with-the-run.test.ts`.
 */
function bashCall(input: Record<string, unknown>): readonly NormalizedRuntimeEvent[] {
  const claude = normalizer();
  const events: NormalizedRuntimeEvent[] = [];
  events.push(
    ...claude.accept(
      record({
        type: "stream_event",
        event: {
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "tool_1", name: "Bash" },
        },
      }),
    ),
  );
  events.push(
    ...claude.accept(
      record({
        type: "assistant",
        message: { content: [{ type: "tool_use", id: "tool_1", name: "Bash", input }] },
      }),
    ),
  );
  events.push(
    ...claude.accept(
      record({
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "tool_1", content: "ok" }] },
      }),
    ),
  );
  return events;
}

const completed = (events: readonly NormalizedRuntimeEvent[]) =>
  events.find((event) => event.type === "tool.completed" || event.type === "tool.failed");

describe("a backgrounded call says so", () => {
  it("reads the flag off the Bash input", () => {
    expect(claudeToolBackgrounded("Bash", { command: "pnpm test", run_in_background: true })).toBe(true);
    expect(claudeToolBackgrounded("Bash", { command: "pnpm test" })).toBe(false);
    expect(claudeToolBackgrounded("Bash", { command: "pnpm test", run_in_background: false })).toBe(false);
  });

  it("invents the field on no other tool", () => {
    // Only Bash takes it. Reading it off everything would make up a field on
    // tools that do not have one -- and a row that says "in the background"
    // about a file read is worse than a row that says nothing.
    expect(claudeToolBackgrounded("Read", { file_path: "a.ts", run_in_background: true })).toBe(false);
    expect(claudeToolBackgrounded("Task", { run_in_background: true })).toBe(false);
  });

  it("carries it onto the finished tool event", () => {
    const event = completed(bashCall({ command: "pnpm test", run_in_background: true }));
    expect(event).toBeDefined();
    expect((event?.payload as { background?: boolean }).background).toBe(true);
    // The command is still there: the flag describes how the call was made,
    // it does not replace what ran.
    expect((event?.payload as { command?: string }).command).toContain("pnpm test");
  });

  it("says nothing about an ordinary call", () => {
    /*
     * The control, and the one that would catch this going wrong. Almost
     * every Bash call is NOT backgrounded, so a field that leaked onto the
     * ordinary case would put "in the background" on nearly every command
     * row in the app.
     */
    const event = completed(bashCall({ command: "pnpm test" }));
    expect((event?.payload as { background?: boolean }).background).toBeUndefined();
  });
});
