import { constants as fsConstants } from "node:fs";
import { access, readdir, stat } from "node:fs/promises";
import { posix, win32 } from "node:path";
import type { ExecutableLaunch, ExecutableLocator } from "./types.js";

export interface PathExecutableLocatorOptions {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly platform?: NodeJS.Platform;
  readonly isExecutableFile?: (candidate: string, platform: NodeJS.Platform) => Promise<boolean>;
  /** Test seam for the versioned-install search; defaults to reading the directory. */
  readonly readDirectory?: (directory: string) => Promise<readonly string[]>;
}

/**
 * Where a CLI installs itself when it does not put itself on PATH.
 *
 * A terminal finds `codex` because the shell's own profile adds it; an app
 * launched from the Start menu inherits no such thing, and reported the CLI as
 * missing on a machine where it was plainly installed. These are the official
 * per-user install roots, read-only and by exact command name -- nothing here
 * searches the disk, guesses at names, or looks at anything but directories a
 * runtime's own installer creates.
 *
 * `versioned` roots hold one directory per installed version, so the newest by
 * modification time is the one a person would get from a terminal.
 */
interface InstallRoot {
  readonly command: string;
  /** Environment variable naming the base directory, e.g. LOCALAPPDATA. */
  readonly base: string;
  readonly segments: readonly string[];
  readonly versioned: boolean;
}

const WINDOWS_INSTALL_ROOTS: readonly InstallRoot[] = [
  // Codex installs into %LOCALAPPDATA%\OpenAI\Codex\bin\<version hash>\.
  { command: "codex", base: "LOCALAPPDATA", segments: ["OpenAI", "Codex", "bin"], versioned: true },
  { command: "codex", base: "APPDATA", segments: ["npm"], versioned: false },
  { command: "claude", base: "APPDATA", segments: ["npm"], versioned: false },
  { command: "claude", base: "LOCALAPPDATA", segments: ["Programs", "claude"], versioned: false },
  // Cursor's installer copies the launchers to %LOCALAPPDATA%\cursor-agent and
  // appends that directory to the USER PATH -- which a packaged app started
  // from the shell does not see until the next sign-in.
  { command: "cursor-agent", base: "LOCALAPPDATA", segments: ["cursor-agent"], versioned: false },
  { command: "gemini", base: "APPDATA", segments: ["npm"], versioned: false },
  // Windows PowerShell's own home. Claude Code installs as a `.ps1` shim, and
  // running it needs a host; on a PATH that does not name one, the shim was
  // found and then discarded for want of an interpreter that is always there.
  { command: "powershell", base: "SystemRoot", segments: ["System32", "WindowsPowerShell", "v1.0"], versioned: false },
];

const SAFE_COMMAND_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

async function defaultIsExecutableFile(
  candidate: string,
  platform: NodeJS.Platform,
): Promise<boolean> {
  try {
    const details = await stat(candidate);
    if (!details.isFile()) return false;
    if (platform !== "win32") await access(candidate, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function environmentValue(
  environment: Readonly<Record<string, string | undefined>>,
  key: string,
  platform: NodeJS.Platform,
): string | undefined {
  if (platform !== "win32") return environment[key];
  const entry = Object.entries(environment).find(
    ([candidate]) => candidate.toLowerCase() === key.toLowerCase(),
  );
  return entry?.[1];
}

function pathDirectories(
  environment: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform,
): readonly string[] {
  const pathApi = platform === "win32" ? win32 : posix;
  const value = environmentValue(environment, "PATH", platform) ?? "";
  const seen = new Set<string>();
  const directories: string[] = [];

  for (const rawEntry of value.split(pathApi.delimiter)) {
    const trimmed = rawEntry.trim();
    const entry =
      trimmed.startsWith('"') && trimmed.endsWith('"')
        ? trimmed.slice(1, -1)
        : trimmed;
    // Empty and relative PATH entries implicitly target the current directory.
    // Discovery skips them so its behavior cannot be changed by process cwd.
    if (!entry || !pathApi.isAbsolute(entry)) continue;
    const normalized = pathApi.normalize(entry);
    const key = platform === "win32" ? normalized.toLowerCase() : normalized;
    if (seen.has(key)) continue;
    seen.add(key);
    directories.push(normalized);
  }

  return directories;
}

async function locateNativeWindowsCommand(
  commandName: string,
  directories: readonly string[],
  isExecutableFile: (candidate: string, platform: NodeJS.Platform) => Promise<boolean>,
): Promise<string | undefined> {
  const hasExtension = win32.extname(commandName) !== "";
  const names = hasExtension
    ? [commandName]
    : [`${commandName}.exe`, `${commandName}.com`];

  for (const directory of directories) {
    for (const name of names) {
      const candidate = win32.join(directory, name);
      if (await isExecutableFile(candidate, "win32")) return candidate;
    }
  }
  return undefined;
}

async function defaultReadDirectory(directory: string): Promise<readonly string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

/**
 * Directories a given command is known to install into, newest version first.
 * Returns nothing when the base variable is unset or the root does not exist,
 * so a machine without that runtime simply contributes no candidates.
 */
async function installDirectories(
  commandName: string,
  environment: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform,
  readDirectory: (directory: string) => Promise<readonly string[]>,
): Promise<readonly string[]> {
  if (platform !== "win32") return [];
  const found: string[] = [];
  for (const root of WINDOWS_INSTALL_ROOTS) {
    if (root.command !== commandName) continue;
    const base = environmentValue(environment, root.base, platform);
    if (base === undefined || base.length === 0 || !win32.isAbsolute(base)) continue;
    const directory = win32.join(base, ...root.segments);
    if (!root.versioned) {
      found.push(directory);
      continue;
    }
    const versions = await readDirectory(directory);
    // Newest first. The names are opaque version hashes, so their order says
    // nothing; when several are installed, the one a terminal would run is the
    // most recently written.
    const stamped = await Promise.all(
      versions.map(async (name) => {
        const candidate = win32.join(directory, name);
        try {
          return { candidate, at: (await stat(candidate)).mtimeMs };
        } catch {
          return { candidate, at: 0 };
        }
      }),
    );
    stamped.sort((left, right) => right.at - left.at);
    for (const entry of stamped) found.push(entry.candidate);
  }
  return found;
}

export function createPathExecutableLocator(
  options: PathExecutableLocatorOptions = {},
): ExecutableLocator {
  const environment = options.environment ?? process.env;
  const platform = options.platform ?? process.platform;
  const isExecutableFile = options.isExecutableFile ?? defaultIsExecutableFile;
  const readDirectory = options.readDirectory ?? defaultReadDirectory;
  const pathOnly = pathDirectories(environment, platform);

  return {
    async find(commandName): Promise<ExecutableLaunch | undefined> {
      if (!SAFE_COMMAND_NAME.test(commandName)) return undefined;

      // PATH first: what a terminal would run wins over anything inferred.
      const directories = [
        ...pathOnly,
        ...(await installDirectories(commandName, environment, platform, readDirectory)),
      ];

      if (platform !== "win32") {
        for (const directory of directories) {
          const candidate = posix.join(directory, commandName);
          if (await isExecutableFile(candidate, platform)) {
            return {
              commandName,
              discoveredPath: candidate,
              executablePath: candidate,
              prefixArgs: [],
              kind: "native",
            };
          }
        }
        return undefined;
      }

      const native = await locateNativeWindowsCommand(
        commandName,
        directories,
        isExecutableFile,
      );
      if (native) {
        return {
          commandName,
          discoveredPath: native,
          executablePath: native,
          prefixArgs: [],
          kind: "native",
        };
      }

      for (const directory of directories) {
        const script = win32.join(directory, `${commandName}.ps1`);
        if (!(await isExecutableFile(script, "win32"))) continue;

        // The interpreter comes from where Windows keeps it FIRST, and only
        // then from PATH. `pwsh` is not a component Windows ships, so a
        // planted one earlier on PATH would face no competitor -- and it
        // would run the shim with this process's environment and the
        // mission's workspace as its working directory.
        const hostDirectories = [
          ...(await installDirectories("powershell", environment, platform, readDirectory)),
          ...directories,
        ];
        const powershell =
          (await locateNativeWindowsCommand("pwsh", hostDirectories, isExecutableFile)) ??
          (await locateNativeWindowsCommand("powershell", hostDirectories, isExecutableFile));
        if (!powershell) continue;

        return {
          commandName,
          discoveredPath: script,
          executablePath: powershell,
          prefixArgs: ["-NoProfile", "-NonInteractive", "-File", script],
          kind: "powershell-shim",
        };
      }

      return undefined;
    },
  };
}
