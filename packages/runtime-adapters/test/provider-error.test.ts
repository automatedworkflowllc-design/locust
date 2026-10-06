import { describe, expect, it } from "vitest";
import {
  createAppServerEventNormalizer, createAgyEventNormalizer, createClaudeEventNormalizer,
  createCodexEventNormalizer, createCursorEventNormalizer, providerErrorSentence,
} from "../src/index.js";
import type { RuntimeProcessCompletion } from "../src/index.js";

const modelError = '{"type":"error","error":{"message":"model \'gpt-6.1-sol\' is not enabled in rustponsesapi","type":"invalid_request_error","param":null,"code":null},"status":400}';
const cases = [
  [modelError, "OpenAI refused the model gpt-6.1-sol: it is not enabled here right now. Pick another model and send again."],
  ['{"error":{"message":"Too many requests"},"status":429}', "OpenAI rate limited this request. Wait a while, or pick another model and send again."],
  ['{"message":"Service unavailable","status":503}', "OpenAI is overloaded or unavailable right now. Try again later, or pick another model."],
  ['{"error":{"message":"Unauthorized"},"status":401}', "OpenAI refused this request because of sign-in or access permissions. Check the agent's sign-in and model access, then send again."],
  ["The connection closed before the answer finished.", "The connection closed before the answer finished."],
] as const;

const completion: RuntimeProcessCompletion = {
  exitCode: 1, signal: null, stderr: "", stderrTruncated: false, recordCount: 1,
  cancelled: false, forcedTerminationAttempted: false, terminationUnconfirmed: false,
  inputDeliveryFailed: false, outputLimitExceeded: false,
  startedAt: "2026-10-05T12:00:00.000Z", finishedAt: "2026-10-05T12:00:01.000Z",
};

describe("provider error display sentences", () => {
  it.each(cases)("reads the recorded error %s as a sentence", (raw, expected) => {
    expect(providerErrorSentence(raw, "codex")).toBe(expected);
  });

  it("separates missing models, quota exhaustion and access refusal", () => {
    expect(providerErrorSentence('{"error":{"message":"Model not found","code":"model_not_found"}}', "codex"))
      .toBe("OpenAI refused the model: it could not be found or is not available here. Pick another model and send again.");
    expect(providerErrorSentence('{"error":{"message":"No credits left","code":"insufficient_quota"},"status":429}', "codex"))
      .toBe("OpenAI reported that its usage limit has been reached. Pick another model, or try again when usage is available.");
    expect(providerErrorSentence('{"message":"Access denied","status":403}', "codex"))
      .toBe(cases[3][1]);
  });

  it("quotes unknown JSON messages without dumping their fields", () => {
    expect(providerErrorSentence('{"message":"Request was rejected","debug":{"internal":"detail"}}', "cursor"))
      .toBe("Cursor's provider refused this request: Request was rejected. Check the model and account settings before sending again.");
  });

  it("leaves malformed JSON and JSON without an error message alone", () => {
    for (const raw of ['{"error":', '[]', '{"status":503}', '"plain text"']) {
      expect(providerErrorSentence(raw, "codex")).toBe(raw);
    }
  });

  it("unwraps an encoded provider body without losing its status", () => {
    expect(providerErrorSentence(`Antigravity could not run it: ${cases[1][0]}`, "antigravity"))
      .toBe("Antigravity's provider rate limited this request. Wait a while, or pick another model and send again.");
    expect(providerErrorSentence(JSON.stringify({ message: cases[1][0] }), "codex")).toBe(cases[1][1]);
    expect(providerErrorSentence('{"error":{"message":"Please wait"},"statusCode":429}', "codex")).toBe(cases[1][1]);
  });
});

describe("Codex preserves provider evidence and emits readable error messages", () => {
  it.each(cases)("keeps the evidence for %s", (raw, expected) => {
    const target = createCodexEventNormalizer({ runId: "readable-error" });
    const events = target.accept({ sequence: 1, raw: JSON.stringify({ type: "error", message: raw }) });
    const diagnostic = events.find((event) => event.type === "adapter.diagnostic" && event.payload.code === "codex.runtime_error");
    expect(diagnostic?.payload).toMatchObject({ message: expected, evidence: { raw: { message: raw } } });
    expect(target.finish(completion).find((event) => event.type === "run.failed")?.payload).toMatchObject({ message: expected });
  });

  it("reads the provider's direct JSON event and keeps its original object", () => {
    const target = createCodexEventNormalizer({ runId: "direct-error" });
    const events = target.accept({ sequence: 1, raw: modelError });
    expect(events.find((event) => event.type === "adapter.diagnostic")?.payload)
      .toMatchObject({ message: cases[0][1], evidence: { raw: JSON.parse(modelError) as unknown } });
    expect(target.finish(completion).find((event) => event.type === "run.failed")?.payload).toMatchObject({ message: cases[0][1] });
  });

  it("gives a direct provider rate-limit warning the same sentence as its final failure", () => {
    const target = createCodexEventNormalizer({ runId: "direct-rate-limit" });
    const events = target.accept({ sequence: 1, raw: cases[1][0].replace('{"error"', '{"type":"error","error"') });
    expect(events.find((event) => event.type === "route.limit_detected")?.payload).toMatchObject({ message: cases[1][1] });
    expect(target.finish(completion).find((event) => event.type === "run.failed")?.payload).toMatchObject({ message: cases[1][1] });
  });

  it("reads a direct provider object without an HTTP status and accepts statusCode", () => {
    for (const raw of [modelError.replace(',"status":400', ''), modelError.replace('"status":400', '"statusCode":400')]) {
      const target = createCodexEventNormalizer({ runId: "direct-provider-object" });
      expect(target.accept({ sequence: 1, raw }).find((event) => event.type === "adapter.diagnostic")?.payload)
        .toMatchObject({ message: cases[0][1] });
    }
  });

  it("formats item errors without ending a turn that can still recover", () => {
    const target = createCodexEventNormalizer({ runId: "item-error" });
    const events = target.accept({ sequence: 1, raw: JSON.stringify({ type: "item.completed", item: { id: "e1", type: "error", message: modelError } }) });
    expect(events.find((event) => event.type === "adapter.diagnostic")?.payload).toMatchObject({ message: cases[0][1], terminal: false });
  });

  it("formats a failed turn's own message", () => {
    const target = createCodexEventNormalizer({ runId: "turn-error" });
    const events = target.accept({ sequence: 1, raw: JSON.stringify({ type: "turn.failed", error: { message: modelError } }) });
    expect(events.find((event) => event.type === "step.failed")?.payload).toMatchObject({ message: cases[0][1] });
  });

  it("formats the app-server error without losing the original notification", () => {
    const target = createAppServerEventNormalizer({ runId: "server-error" });
    const events = target.accept({ method: "error", params: { error: { message: modelError }, willRetry: false } });
    expect(events.find((event) => event.type === "run.failed")?.payload).toMatchObject({ message: cases[0][1] });
    expect(JSON.stringify(events)).toContain("rustponsesapi");
  });
});

describe("other failed-result strings use the same provider sentences", () => {
  it("formats Claude and Cursor result errors", () => {
    for (const [runtime, target] of [
      ["claude", createClaudeEventNormalizer({ runId: "claude-error" })],
      ["cursor", createCursorEventNormalizer({ runId: "cursor-error" })],
    ] as const) {
      target.accept({ sequence: 1, raw: JSON.stringify({ type: "result", is_error: true, subtype: "error", result: cases[1][0] }) });
      expect(target.finish(completion).find((event) => event.type === "run.failed")?.payload)
        .toMatchObject({ message: providerErrorSentence(cases[1][0], runtime), evidence: { raw: { result: cases[1][0] } } });
    }
  });

  it("formats Antigravity CLI's result error before adding a runtime prefix", () => {
    const target = createAgyEventNormalizer({ runId: "agy-error" });
    target.accept({ sequence: 1, raw: JSON.stringify({ event: "result", result: { status: "FAILED", error: cases[1][0] } }) });
    expect(target.finish(completion).find((event) => event.type === "run.failed")?.payload)
      .toMatchObject({ message: providerErrorSentence(cases[1][0], "antigravity"), evidence: { raw: { result: { error: cases[1][0] } } } });
  });
});
