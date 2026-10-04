import { describe, expect, it } from "vitest";

import { createPathExecutableLocator } from "./path-locator.js";

/**
 * A machine with no Node still runs the CLIs Locust installed.
 *
 * MEASURED 2026-09-17, from Ian: Locust did nothing until he installed
 * Node.js. The coding CLIs install through npm, so without Node the first
 * screen disables its own Install buttons -- and an npm-installed CLI is a
 * `.cmd` shim around a node script, which needs a Node to run.
 *
 * The app was carrying one the whole time. An Electron binary started with
 * `ELECTRON_RUN_AS_NODE=1` is Node 24.18.1 (checked against the packaged
 * Locust.exe). These hold the order: a Node the person installed is always
 * preferred, because that is the one their CLIs were built against, and the
 * host's own is the answer only when there is no other.
 */

const SHIM = [
  "@ECHO off",
  "GOTO start",
  ":find_dp0",
  ":start",
  '"%_prog%" "%dp0%\\node_modules\\opencode-ai\\bin\\opencode.js" %*'
].join("\n");

const BUNDLED = { executablePath: "C:\\Program Files\\Locust\\Locust.exe", env: { ELECTRON_RUN_AS_NODE: "1" } };

const locator = (options: { node: boolean; bundled: boolean }) =>
  createPathExecutableLocator({
    platform: "win32",
    environment: { PATH: "C:\\npm" },
    readDirectory: async () => [],
    readFile: async (path) => (path.endsWith("opencode.cmd") ? SHIM : undefined),
    isExecutableFile: async (candidate) => {
      if (candidate === "C:\\npm\\opencode.cmd") return true;
      if (/node\.exe$/i.test(candidate)) return options.node;
      if (/cmd\.exe$/i.test(candidate)) return true;
      return false;
    },
    ...(options.bundled ? { bundledNode: BUNDLED } : {})
  });

describe("running an npm-installed CLI", () => {
  it("prefers the Node the person installed, and carries no environment of its own", async () => {
    const found = await locator({ node: true, bundled: true }).find("opencode");
    expect(found?.kind).toBe("node-shim");
    expect(found?.executablePath).toMatch(/node\.exe$/i);
    expect(found?.executablePath).not.toContain("Locust.exe");
    // Nothing to set: a real node needs no help to behave as one.
    expect(found?.env).toBeUndefined();
  });

  it("falls back to the host's own Node when the machine has none", async () => {
    const found = await locator({ node: false, bundled: true }).find("opencode");
    expect(found?.kind).toBe("node-shim");
    expect(found?.executablePath).toBe(BUNDLED.executablePath);
    expect(found?.prefixArgs).toEqual(["C:\\npm\\node_modules\\opencode-ai\\bin\\opencode.js"]);
    // Without this the same path opens a second copy of the app.
    expect(found?.env).toEqual({ ELECTRON_RUN_AS_NODE: "1" });
  });

  it("finds a CLI the host's own npm installed, in a folder nothing put on PATH", async () => {
    /*
     * Grok, pass 10, on the day after the bundled npm shipped: Install ran,
     * npm said it was done, Locust said "installed, but Locust still cannot
     * find the command". The install had been measured; where it went had
     * not. The host now names the folder, and this is the half that reads
     * it -- with no Node on the machine, so the host's own runs it.
     */
    const found = await createPathExecutableLocator({
      platform: "win32",
      environment: { PATH: "C:\\nothing-here" },
      readDirectory: async () => [],
      readFile: async (path) => (path === "C:\\Users\\ian\\AppData\\Roaming\\Locust\\npm\\opencode.cmd" ? SHIM : undefined),
      isExecutableFile: async (candidate) => {
        if (candidate === "C:\\Users\\ian\\AppData\\Roaming\\Locust\\npm\\opencode.cmd") return true;
        if (/cmd\.exe$/i.test(candidate)) return true;
        return false;
      },
      bundledNode: BUNDLED,
      ownInstallDirectory: "C:\\Users\\ian\\AppData\\Roaming\\Locust\\npm"
    }).find("opencode");
    expect(found?.kind).toBe("node-shim");
    expect(found?.discoveredPath).toBe("C:\\Users\\ian\\AppData\\Roaming\\Locust\\npm\\opencode.cmd");
    expect(found?.executablePath).toBe(BUNDLED.executablePath);
    expect(found?.prefixArgs).toEqual([
      "C:\\Users\\ian\\AppData\\Roaming\\Locust\\npm\\node_modules\\opencode-ai\\bin\\opencode.js"
    ]);
  });

  it("lets a copy on PATH win over the host's own install folder", async () => {
    // The person's terminal would find the PATH copy; the app has to agree
    // with the terminal, or "which one is running" becomes a guess.
    const found = await createPathExecutableLocator({
      platform: "win32",
      environment: { PATH: "C:\\npm" },
      readDirectory: async () => [],
      readFile: async (path) => (path.endsWith("opencode.cmd") ? SHIM : undefined),
      isExecutableFile: async (candidate) =>
        candidate === "C:\\npm\\opencode.cmd"
        || candidate === "C:\\own\\opencode.cmd"
        || /node\.exe$/i.test(candidate)
        || /cmd\.exe$/i.test(candidate),
      bundledNode: BUNDLED,
      ownInstallDirectory: "C:\\own"
    }).find("opencode");
    expect(found?.discoveredPath).toBe("C:\\npm\\opencode.cmd");
  });

  it("still reaches cmd.exe when there is no Node anywhere and none was offered", async () => {
    // The behaviour before this existed, kept: a host that passes no Node of
    // its own must be no worse off than it was.
    const found = await locator({ node: false, bundled: false }).find("opencode");
    expect(found?.kind).toBe("cmd-shim");
    expect(found?.executablePath).toMatch(/cmd\.exe$/i);
    expect(found?.env).toBeUndefined();
  });
});
