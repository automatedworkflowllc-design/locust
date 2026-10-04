import { describe, expect, it } from "vitest";

import {
  antigravityBackgroundTask,
  antigravityTaskEnding,
  antigravityToolCommand,
  antigravityToolTitle,
  createAntigravityEventNormalizer,
} from "../src/antigravity-events.js";
import type { NormalizedRuntimeEvent } from "../src/codex-events.js";

/**
 * ANTIGRAVITY'S BACKGROUND WORK (0.487). Shapes from Colin's transcripts,
 * 2026-09-30, anonymised: a command that goes to the background writes its
 * result line `status: RUNNING`, "running as a background task with task id:
 * <conv>/task-N" (N = that line's step), and is never rewritten DONE; its
 * outcome arrives as a SYSTEM_MESSAGE from `sender=<conv>/task-N`. Read as
 * DONE-only, every one said "did not report", and an answer while the task was
 * out ended a turn the agent then carried on for 18 minutes.
 */
const CONV = "11111111-2222-3333-4444-555555555555";
const at = (fields: Record<string, unknown>) =>
  JSON.stringify({ source: "MODEL", status: "DONE", created_at: "2026-09-21T20:22:22Z", ...fields });
const user = JSON.stringify({ step_index: 0, source: "USER_EXPLICIT", type: "USER_INPUT", status: "DONE", created_at: "2026-09-21T20:22:00Z", content: "run the probe" });
const planner = at({
  step_index: 9,
  type: "PLANNER_RESPONSE",
  tool_calls: [{
    name: "run_command",
    args: { CommandLine: JSON.stringify("node _tools/probe.mjs --dev"), toolAction: JSON.stringify("Running the picker probe"), WaitMsBeforeAsync: JSON.stringify(500) },
  }],
});
const running = at({
  step_index: 10,
  type: "GENERIC",
  status: "RUNNING",
  content: `Created At: 2026-09-21T16:22:22-04:00\nTool is running as a background task with task id: ${CONV}/task-10\nTask Description: node _tools/probe.mjs --dev\nTask logs are available at: file:///c:/logs/task-10.log`,
});
const waiting = at({ step_index: 11, type: "PLANNER_RESPONSE", content: "Waiting for task completion." });
const notice = (step: number, body: string) => JSON.stringify({
  step_index: step,
  source: "SYSTEM",
  type: "SYSTEM_MESSAGE",
  status: "DONE",
  created_at: "2026-09-21T20:23:15Z",
  content: `The following is a <SYSTEM_MESSAGE> not actually sent by the user.\n\n<SYSTEM_MESSAGE>\n[Message] timestamp=2026-09-21T20:23:13Z sender=${CONV}/task-10 priority=MESSAGE_PRIORITY_HIGH content=${body}`,
});
const finished = notice(12, `Task id "${CONV}/task-10" finished with result:\n\nThe command exited with code 0.\nOutput:\nprobing the DEV build`);
const after = at({ step_index: 13, type: "PLANNER_RESPONSE", content: "The probe passed." });

const feed = (lines: readonly string[]) => {
  const normalizer = createAntigravityEventNormalizer({ runId: "run_1", missionId: "mission_1", conversationId: CONV, now: () => new Date("2026-09-21T20:22:00Z") });
  const events: NormalizedRuntimeEvent[] = [];
  const states: { pending: number; final: boolean }[] = [];
  lines.forEach((raw, index) => {
    events.push(...normalizer.accept({ sequence: index + 1, raw }));
    states.push({ pending: normalizer.pendingBackground, final: normalizer.latestFinal });
  });
  return { events, states };
};
const payloadOf = <T>(event: NormalizedRuntimeEvent | undefined): T => (event as unknown as { payload: T }).payload;

describe("a command Antigravity puts in the background", () => {
  it("closes the call as backgrounded and opens a background step, not 'did not report'", () => {
    const { events } = feed([user, planner, running]);
    const done = events.find((event) => event.type === "tool.completed");
    expect(payloadOf<{ background?: boolean; command?: string; title?: string }>(done)).toMatchObject({
      background: true,
      command: "node _tools/probe.mjs --dev",
      title: "Running the picker probe",
    });
    const step = events.find((event) => event.type === "step.started");
    expect(payloadOf<{ itemType: string; status: string }>(step)).toMatchObject({ itemType: "background", status: "running" });
  });

  it("holds the turn open while it runs, and settles its row from the task's own notice", () => {
    const { events, states } = feed([user, planner, running, waiting, finished, after]);
    // The answer while the task is out is final-looking, but work is pending.
    expect(states[3]).toEqual({ pending: 1, final: true });
    expect(states[4]).toEqual({ pending: 0, final: false });
    expect(states[5]).toEqual({ pending: 0, final: true });
    const settled = events.find((event) => event.type === "step.completed");
    expect(payloadOf<{ itemType: string; status: string; message?: string }>(settled)).toMatchObject({
      itemType: "background",
      status: "completed",
      message: "exited with code 0",
    });
  });

  it("reads a non-zero exit as failed, and a cancel as stopped", () => {
    const failedRun = feed([user, planner, running, notice(12, `Task id "${CONV}/task-10" finished with result:\n\nThe command exited with code 1.`)]);
    expect(failedRun.events.at(-1)?.type).toBe("step.failed");
    const cancelled = feed([user, planner, running, notice(12, `Task id "${CONV}/task-10" was canceled with result:\nTool execution was canceled`)]);
    expect(payloadOf<{ status: string }>(cancelled.events.at(-1))).toMatchObject({ status: "stopped" });
  });

  it("ignores a notice for a task it never saw start", () => {
    const { events, states } = feed([user, finished]);
    expect(events.filter((event) => event.type === "step.completed")).toEqual([]);
    expect(states.at(-1)?.pending).toBe(0);
  });
});

describe("what the pieces read", () => {
  it("finds the task and what it is doing", () => {
    expect(antigravityBackgroundTask(`Tool is running as a background task with task id: ${CONV}/task-757\nTask Description: node _tools/drive-room.mjs`))
      .toEqual({ taskId: `${CONV}/task-757`, doing: "node _tools/drive-room.mjs" });
    expect(antigravityBackgroundTask("plain output")).toBeUndefined();
    expect(antigravityTaskEnding("an unrelated system message")).toBeUndefined();
  });

  it("names a command row by the command, with the model's phrase as its title", () => {
    const args = { CommandLine: JSON.stringify("git log -1"), toolAction: JSON.stringify("Checking recent commits") };
    expect(antigravityToolCommand(args)).toBe("git log -1");
    expect(antigravityToolTitle(args, "git log -1")).toBe("Checking recent commits");
    // No title when it would only repeat the command.
    expect(antigravityToolTitle({ toolAction: JSON.stringify("git log -1") }, "git log -1")).toBeUndefined();
  });
});

/**
 * A FILE THAT QUOTES ANOTHER TASK IS NOT A TASK (0.537). Colin's run,
 * 2026-10-02: the agent read its subagents' transcripts with view_file, and
 * their text quotes other lines' "running as a background task" results. Each
 * read was counted as background work that never ended, so the run never
 * finished and its final answer sat under a turn still "working".
 */
describe("a file read that quotes a background task", () => {
  const readsTranscript = at({
    step_index: 20,
    type: "PLANNER_RESPONSE",
    tool_calls: [{ name: "view_file", args: { AbsolutePath: JSON.stringify("C:/brain/other/transcript.jsonl") } }],
  });
  const fileText = at({
    step_index: 21,
    type: "GENERIC",
    content: `File Path: C:/brain/other/transcript.jsonl\n{"content":"Tool is running as a background task with task id: ${CONV}/task-7\nTask Description: npm test"}`,
  });
  const answer = at({ step_index: 22, type: "PLANNER_RESPONSE", content: "The review is done." });

  it("is an ordinary finished read, nothing waits on it, and the answer ends the turn", () => {
    const { events, states } = feed([user, readsTranscript, fileText, answer]);
    expect(events.some((event) => event.type === "step.started" && payloadOf<{ itemType?: string }>(event).itemType === "background")).toBe(false);
    expect(payloadOf<{ background?: boolean }>(events.find((event) => event.type === "tool.completed")).background).toBeUndefined();
    expect(states.at(-1)).toEqual({ pending: 0, final: true });
  });
});
