import { describe, expect, it } from "vitest";

import { antigravityQuestion } from "../src/antigravity-events.js";

/*
 * The two payloads below are VERBATIM from real transcripts under
 * `~/.gemini/antigravity/brain/`, captured 2026-09-08 -- one from the run
 * Colin screenshotted when he reported the hang. They are kept exactly as
 * Antigravity wrote them, double encoding and all, because the double encoding
 * is the thing most likely to be got wrong: every value in an Antigravity
 * `args` is a JSON-ENCODED string, so `args.questions` is a string containing
 * an array, not an array.
 */

const COLIN_SCREENSHOT_ARGS = {
  questions:
    '[{"is_multi_select":false,"options":["(Recommended) Run performance benchmark tests","Inspect codebase architecture","Execute automated unit tests","Review system environment settings"],"question":"Which test option would you like to select?"}]',
  toolAction: '"Prompting user with options"',
  toolSummary: '"Interactive option selection"',
};

const FOLDER_ARGS = {
  questions:
    '[{"is_multi_select":false,"options":["Organise by file type (e.g., docs/ for markdown and text/ for plain text)","Organise by functional role (e.g., docs/ for documentation and src/ for working/source files)","Organise by topic or workflow (e.g., notes/ and scratch/ folders)","Maintain a flat root layout (keep all files in the root directory with consistent naming prefixes)"],"question":"How would you like to organise the files in this folder?"}]',
  toolAction: '"Asking folder organisation options"',
  toolSummary: '"Folder organisation options"',
};

describe("reading Antigravity's ask_question", () => {
  it("reads the question Colin was shown, and its four options", () => {
    const asked = antigravityQuestion(COLIN_SCREENSHOT_ARGS);
    expect(asked?.question).toBe("Which test option would you like to select?");
    expect(asked?.options).toHaveLength(4);
    expect(asked?.options[0]).toBe("(Recommended) Run performance benchmark tests");
    expect(asked?.multiSelect).toBe(false);
  });

  it("reads a second real payload the same way", () => {
    const asked = antigravityQuestion(FOLDER_ARGS);
    expect(asked?.question).toMatch(/^How would you like to organise/);
    expect(asked?.options).toHaveLength(4);
  });

  it("sees through the double encoding rather than around it", () => {
    // THE trap. `questions` is a STRING containing an array. A reader that
    // treated it as an array would find nothing and draw the bare tool row
    // this exists to replace.
    expect(typeof COLIN_SCREENSHOT_ARGS.questions).toBe("string");
    expect(antigravityQuestion(COLIN_SCREENSHOT_ARGS)).toBeDefined();
  });

  it("says nothing rather than something wrong for a tool that is not asking", () => {
    expect(antigravityQuestion({ TargetFile: '"c:/x/y.txt"' })).toBeUndefined();
    expect(antigravityQuestion(undefined)).toBeUndefined();
    expect(antigravityQuestion({ questions: "not json at all" })).toBeUndefined();
    expect(antigravityQuestion({ questions: "[]" })).toBeUndefined();
    expect(antigravityQuestion({ questions: '[{"options":["a"]}]' })).toBeUndefined();
  });

  it("keeps a question that carries no options", () => {
    // The options are what is optional, not the asking. A free-text question
    // should still be shown, with no buttons under it.
    const asked = antigravityQuestion({ questions: '[{"question":"What should I call it?"}]' });
    expect(asked?.question).toBe("What should I call it?");
    expect(asked?.options).toEqual([]);
  });

  it("carries multi-select through, since it changes what an answer means", () => {
    const asked = antigravityQuestion({
      questions: '[{"is_multi_select":true,"question":"Which ones?","options":["a","b"]}]',
    });
    expect(asked?.multiSelect).toBe(true);
  });
});
