import { describe, expect, it, vi } from "vitest";

import { createAppServerClient } from "../src/app-server.js";
import type { AppServerDiagnostic, AppServerNotification, AppServerRequest, JsonValue } from "../src/app-server.js";

function harness(
  overrides: {
    onRequest?: (request: AppServerRequest) => Promise<JsonValue>;
    options?: Record<string, number>;
  } = {},
) {
  const sent: string[] = [];
  const notifications: AppServerNotification[] = [];
  const diagnostics: AppServerDiagnostic[] = [];
  let closed = false;
  const client = createAppServerClient({
    transport: {
      send: (line) => sent.push(line),
      close: () => {
        closed = true;
      },
    },
    onNotification: (notification) => notifications.push(notification),
    onRequest: overrides.onRequest ?? (async () => ({ decision: "reject" })),
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    ...overrides.options,
  });
  return {
    client,
    sent,
    notifications,
    diagnostics,
    parsedSent: () => sent.map((line) => JSON.parse(line) as Record<string, unknown>),
    isClosed: () => closed,
  };
}

describe("framing", () => {
  it("reassembles messages split across arbitrary chunks", () => {
    const h = harness();
    // A transport hands over bytes, not messages. Splitting mid-token is
    // normal, and losing a message to it would be a silent data loss.
    h.client.accept('{"jsonrpc":"2.0","meth');
    h.client.accept('od":"thread/started","params":{"a":1}}\n{"jsonrpc":"2.0","method":"turn/');
    h.client.accept('completed","params":{}}\n');

    expect(h.notifications.map((n) => n.method)).toEqual(["thread/started", "turn/completed"]);
    expect(h.notifications[0]?.params).toEqual({ a: 1 });
  });

  it("ignores blank lines and keeps a trailing partial buffered", () => {
    const h = harness();
    h.client.accept("\n\n");
    h.client.accept('{"jsonrpc":"2.0","method":"a"}');
    expect(h.notifications).toEqual([]);
    h.client.accept("\n");
    expect(h.notifications.map((n) => n.method)).toEqual(["a"]);
  });

  it("reports an unparsable line instead of throwing", () => {
    const h = harness();
    h.client.accept("{not json\n");
    expect(h.diagnostics.map((d) => d.code)).toEqual(["unparsable-line"]);
    // And the stream keeps working afterwards.
    h.client.accept('{"jsonrpc":"2.0","method":"a"}\n');
    expect(h.notifications.map((n) => n.method)).toEqual(["a"]);
  });

  it("drops a buffer that grows without a newline rather than growing forever", () => {
    const h = harness({ options: { maxBufferedBytes: 64 } });
    h.client.accept("x".repeat(200));
    expect(h.diagnostics.map((d) => d.code)).toEqual(["buffer-overflow"]);
    // Resynchronizes on the next complete line.
    h.client.accept('\n{"jsonrpc":"2.0","method":"after"}\n');
    expect(h.notifications.map((n) => n.method)).toEqual(["after"]);
  });

  it("drops an oversized single line but keeps the connection usable", () => {
    const h = harness({ options: { maxLineBytes: 32 } });
    h.client.accept(`{"jsonrpc":"2.0","method":"${"x".repeat(200)}"}\n`);
    expect(h.diagnostics.map((d) => d.code)).toEqual(["line-too-long"]);
    h.client.accept('{"jsonrpc":"2.0","method":"ok"}\n');
    expect(h.notifications.map((n) => n.method)).toEqual(["ok"]);
  });
});

describe("request correlation", () => {
  it("resolves a request with its own response", async () => {
    const h = harness();
    const promise = h.client.request("model/list");
    const id = h.parsedSent()[0]?.id;
    h.client.accept(`${JSON.stringify({ jsonrpc: "2.0", id, result: { data: [1] } })}\n`);
    await expect(promise).resolves.toEqual({ data: [1] });
    expect(h.client.pendingCount).toBe(0);
  });

  it("matches responses to the right request when they arrive out of order", async () => {
    const h = harness();
    const first = h.client.request("a");
    const second = h.client.request("b");
    const [idA, idB] = h.parsedSent().map((message) => message.id);
    h.client.accept(`${JSON.stringify({ jsonrpc: "2.0", id: idB, result: "second" })}\n`);
    h.client.accept(`${JSON.stringify({ jsonrpc: "2.0", id: idA, result: "first" })}\n`);
    await expect(first).resolves.toBe("first");
    await expect(second).resolves.toBe("second");
  });

  it("rejects with the server's message when the response is an error", async () => {
    const h = harness();
    const promise = h.client.request("thread/start");
    const id = h.parsedSent()[0]?.id;
    h.client.accept(
      `${JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32_000, message: "no such thread" } })}\n`,
    );
    await expect(promise).rejects.toThrow("no such thread");
  });

  it("reports a response nobody asked for rather than dropping it silently", () => {
    const h = harness();
    h.client.accept(`${JSON.stringify({ jsonrpc: "2.0", id: 999, result: {} })}\n`);
    // Silently ignoring this would hide a desynchronized stream.
    expect(h.diagnostics.map((d) => d.code)).toEqual(["unknown-response"]);
  });

  it("times out a request the server never answers", async () => {
    vi.useFakeTimers();
    try {
      const h = harness({ options: { requestTimeoutMs: 1_000 } });
      const promise = h.client.request("turn/start");
      vi.advanceTimersByTime(1_001);
      await expect(promise).rejects.toThrow(/did not answer/);
      expect(h.diagnostics.map((d) => d.code)).toContain("request-timeout");
      expect(h.client.pendingCount).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses to queue beyond its in-flight limit", async () => {
    const h = harness({ options: { maxPendingRequests: 2 } });
    void h.client.request("a").catch(() => undefined);
    void h.client.request("b").catch(() => undefined);
    await expect(h.client.request("c")).rejects.toThrow(/in flight/);
    expect(h.diagnostics.map((d) => d.code)).toContain("too-many-pending");
  });

  it("fails every in-flight request on dispose instead of hanging", async () => {
    const h = harness();
    const promise = h.client.request("turn/start");
    h.client.dispose("The runtime went away.");
    await expect(promise).rejects.toThrow("The runtime went away.");
    expect(h.isClosed()).toBe(true);
  });
});

describe("server requests -- the approval channel", () => {
  it("answers a server request with the handler's result", async () => {
    const seen: AppServerRequest[] = [];
    const h = harness({
      onRequest: async (request) => {
        seen.push(request);
        return { decision: "accept" };
      },
    });

    h.client.accept(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: "srv-1",
        method: "item/commandExecution/requestApproval",
        params: { command: "echo hello", threadId: "t1" },
      })}\n`,
    );
    await vi.waitFor(() => {
      expect(h.sent.length).toBe(1);
    });

    expect(seen[0]?.method).toBe("item/commandExecution/requestApproval");
    expect(seen[0]?.params).toMatchObject({ command: "echo hello" });
    const reply = h.parsedSent()[0];
    expect(reply).toMatchObject({ id: "srv-1", result: { decision: "accept" } });
  });

  it("still answers when the handler throws", async () => {
    // An unanswered approval request stalls the run forever, which is a worse
    // failure than a refused one.
    const h = harness({
      onRequest: async () => {
        throw new Error("no UI attached");
      },
    });

    h.client.accept(
      `${JSON.stringify({ jsonrpc: "2.0", id: 7, method: "item/fileChange/requestApproval", params: {} })}\n`,
    );
    await vi.waitFor(() => {
      expect(h.sent.length).toBe(1);
    });

    const reply = h.parsedSent()[0];
    expect(reply?.id).toBe(7);
    expect(reply).toHaveProperty("error");
    expect(h.diagnostics.map((d) => d.code)).toContain("request-handler-failed");
  });

  it("does not confuse a server request with a response", async () => {
    // Both carry an id. Only the method distinguishes them, and getting this
    // wrong would resolve one of our own requests with an approval prompt.
    const h = harness();
    const promise = h.client.request("model/list");
    const ourId = h.parsedSent()[0]?.id;
    h.client.accept(
      `${JSON.stringify({ jsonrpc: "2.0", id: ourId, method: "item/tool/requestUserInput", params: {} })}\n`,
    );
    expect(h.client.pendingCount).toBe(1);
    h.client.accept(`${JSON.stringify({ jsonrpc: "2.0", id: ourId, result: "real" })}\n`);
    await expect(promise).resolves.toBe("real");
  });
});

describe("outgoing framing", () => {
  it("writes newline-delimited JSON-RPC with an incrementing id", () => {
    const h = harness();
    void h.client.request("a", { x: 1 }).catch(() => undefined);
    void h.client.request("b").catch(() => undefined);
    expect(h.sent.every((line) => line.endsWith("\n"))).toBe(true);
    const messages = h.parsedSent();
    expect(messages[0]).toMatchObject({ jsonrpc: "2.0", method: "a", params: { x: 1 } });
    expect(Number(messages[1]?.id)).toBe(Number(messages[0]?.id) + 1);
  });

  it("sends notifications without an id", () => {
    const h = harness();
    h.client.notify("initialized");
    expect(h.parsedSent()[0]).toMatchObject({ jsonrpc: "2.0", method: "initialized" });
    expect(h.parsedSent()[0]).not.toHaveProperty("id");
  });

  it("goes quiet after dispose", () => {
    const h = harness();
    h.client.dispose("closed");
    h.client.notify("late");
    h.client.accept('{"jsonrpc":"2.0","method":"late"}\n');
    expect(h.sent).toEqual([]);
    expect(h.notifications).toEqual([]);
  });
});
