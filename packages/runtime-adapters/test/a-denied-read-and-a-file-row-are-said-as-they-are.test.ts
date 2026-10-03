import { describe, expect, it } from "vitest";
import { agyDeniedSentence } from "../src/agy-events.js";
import { toolCommandOf } from "../src/app-server-events.js";

/**
 * Two labels the golden thread showed reading wrong (0.572).
 *
 * Antigravity's `read_file` denial (Colin's ledger, an Ask run reading
 * outside its folder) was said as "not allowed to change files" because
 * "file" counted as a write. And a Codex fileChange row read
 * "1 file change(s)" where the files themselves belong.
 */
describe("a denied read is said as a read", () => {
  it("names a read outside the folder, not a change", () => {
    const said = agyDeniedSentence(["read_file"]);
    expect(said).toMatch(/not allowed to read a file outside/);
    expect(said).not.toMatch(/change files/);
  });

  it("still says a write and a command as before", () => {
    expect(agyDeniedSentence(["write_file"])).toMatch(/not allowed to change files/);
    expect(agyDeniedSentence(["command"])).toMatch(/not allowed to run a command/);
    expect(agyDeniedSentence(["read_file", "command"])).toMatch(/\(read_file, command\)/);
  });
});

describe("a Codex file row names its files", () => {
  it("lists each path, one a line", () => {
    expect(toolCommandOf({ type: "fileChange", changes: [{ path: "C:/w/a.ts" }, { path: "C:/w/b.ts" }] })).toBe("C:/w/a.ts\nC:/w/b.ts");
  });

  it("counts files when the paths are not given", () => {
    expect(toolCommandOf({ type: "fileChange", changes: [1] })).toBe("1 file");
    expect(toolCommandOf({ type: "fileChange", changes: [1, 2, 3] })).toBe("3 files");
  });
});
