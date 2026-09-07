import { describe, expect, it } from "vitest";

import { openCodeErrorFacts, openCodeErrorSentence } from "../src/opencode-error.js";

/**
 * The record below is not invented. It is what OpenCode actually emitted on
 * 2026-09-07, captured in `mission_dd66e48a.jsonl` while Locust was working on
 * its own source on the free model, trimmed only of headers that carry nothing.
 *
 * At the time, this arrived and the person was told the run "ended without a
 * step that reported it had stopped."
 */
const MEASURED = {
  type: "error",
  timestamp: 1788821984477,
  sessionID: "ses_f81e7dca6ffeAO77Dba1KsKE0g",
  error: {
    name: "APIError",
    data: {
      message: "Error from provider (Console): Rate limit exceeded. Please try again later.",
      statusCode: 429,
      isRetryable: true,
      responseBody: JSON.stringify({
        type: "error",
        error: { type: "FreeUsageLimitError", message: "Error from provider (Console): Rate limit exceeded." },
      }),
    },
  },
};

describe("reading what OpenCode said went wrong", () => {
  it("pulls the provider's own error type out of the response body", () => {
    // The whole point. The outer message says "Rate limit exceeded", which is
    // also what a paid account going too fast gets -- a different situation
    // with a different answer. Only the body says which one this is.
    const facts = openCodeErrorFacts(MEASURED);
    expect(facts?.kind).toBe("FreeUsageLimitError");
    expect(facts?.statusCode).toBe(429);
    expect(facts?.retryable).toBe(true);
    expect(facts?.message).toContain("Rate limit exceeded");
  });

  it("falls back to the error's name when there is no body to read", () => {
    expect(openCodeErrorFacts({ type: "error", error: { name: "APIError", data: {} } })?.kind).toBe("APIError");
  });

  it("survives a response body that is not JSON", () => {
    // A truncated or half-written body must cost the extra detail and nothing
    // else -- an exception here would lose the whole event, which is how this
    // failed in the first place.
    const facts = openCodeErrorFacts({
      type: "error",
      error: { name: "APIError", data: { message: "boom", statusCode: 500, responseBody: '{"type":"err' } },
    });
    expect(facts?.kind).toBe("APIError");
    expect(facts?.message).toBe("boom");
  });

  it("answers nothing for a record carrying no error at all", () => {
    expect(openCodeErrorFacts({ type: "error" })).toBeUndefined();
  });
});

describe("what the person is told", () => {
  it("names the free usage limit in plain words, and what to do", () => {
    // THE test. The sentence this replaces was "OpenCode ended without a step
    // that reported it had stopped", on a run that failed because the free
    // model was out. Someone reading that has no reason to think the app is
    // working correctly.
    const said = openCodeErrorSentence(openCodeErrorFacts(MEASURED)!);
    expect(said).toMatch(/free model/i);
    expect(said).toMatch(/no usage left/i);
    expect(said).toMatch(/another model/i);
    expect(said).not.toMatch(/without a step/i);
  });

  it("says rate limited, and quotes the provider, for a 429 that is not the free tier", () => {
    const said = openCodeErrorSentence({
      message: "Too many requests in 1 minute.",
      statusCode: 429,
      kind: "RateLimitError",
      retryable: true,
    });
    expect(said).toMatch(/rate limited/i);
    expect(said).toContain("Too many requests in 1 minute.");
  });

  it("points at sign-in when the provider refused the credentials", () => {
    for (const statusCode of [401, 403]) {
      const said = openCodeErrorSentence({ message: "Unauthorized", statusCode, kind: undefined, retryable: false });
      expect(said).toMatch(/refused/i);
      expect(said).toMatch(/auth login/i);
    }
  });

  it("quotes the runtime rather than paraphrasing it, for anything else", () => {
    // A paraphrase of an error is a claim about a system this app cannot see.
    const said = openCodeErrorSentence({
      message: "The model gpt-9 does not exist.",
      statusCode: 404,
      kind: "NotFoundError",
      retryable: false,
    });
    expect(said).toContain("The model gpt-9 does not exist.");
  });

  it("admits it does not know, rather than inventing a cause", () => {
    const said = openCodeErrorSentence({ message: undefined, statusCode: undefined, kind: undefined, retryable: undefined });
    expect(said).toMatch(/without saying what it was/i);
  });

  it("never tells anyone a run simply stopped for no reason", () => {
    // The control for the whole file: every branch has to say something. A
    // sentence that went back to the old shrug would pass the specific tests
    // above by accident of ordering.
    for (const facts of [
      openCodeErrorFacts(MEASURED)!,
      { message: "Too many requests.", statusCode: 429, kind: undefined, retryable: true },
      { message: "Unauthorized.", statusCode: 401, kind: undefined, retryable: false },
      { message: "Internal server error.", statusCode: 500, kind: undefined, retryable: false },
      { message: undefined, statusCode: undefined, kind: undefined, retryable: undefined },
    ]) {
      expect(openCodeErrorSentence(facts).length).toBeGreaterThan(20);
      expect(openCodeErrorSentence(facts)).not.toMatch(/without a step that reported/i);
    }
  });
});
