import { describe, expect, it } from "vitest";

import { failureKind } from "../src/codex-events.js";

/**
 * AN EXPIRED SIGN-IN IS SAID (QA-2026-09-29 round 2, N11). Codex's words when
 * its saved sign-in can no longer be refreshed named no pattern here, so the
 * failure read as "unknown" and the card offered no sign-in. The app-server
 * says `unauthorized` in its error info; `codex exec` gives only the words.
 */
describe("Codex's words for an expired sign-in", () => {
  it("read as a failed sign-in", () => {
    expect(failureKind("Your access token could not be refreshed. Please log out and sign in again.")).toBe("authentication-failed");
    expect(failureKind("Your access token could not be refreshed because your refresh token was already used.")).toBe("authentication-failed");
  });

  it("and other failures do not", () => {
    expect(failureKind("The model returned an unexpected response.")).not.toBe("authentication-failed");
  });
});
