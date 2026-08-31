import { constants as fsConstants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { posix, win32 } from "node:path";
import type { ExecutableLaunch, ExecutableLocator } from "./types.js";

export interface PathExecutableLocatorOptions {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly platform?: NodeJS.Platform;
  readonly isExecutableFile?: (candidate: string, platform: NodeJS.Platform) => Promise<boolean>;
}

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

export function createPathExecutableLocator(
  options: PathExecutableLocatorOptions = {},
): ExecutableLocator {
  const environment = options.environment ?? process.env;
  const platform = options.platform ?? process.platform;
  const isExecutableFile = options.isExecutableFile ?? defaultIsExecutableFile;
  const directories = pathDirectories(environment, platform);

  return {
    async find(commandName): Promise<ExecutableLaunch | undefined> {
      if (!SAFE_COMMAND_NAME.test(commandName)) return undefined;

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

        const powershell =
          (await locateNativeWindowsCommand("pwsh", directories, isExecutableFile)) ??
          (await locateNativeWindowsCommand("powershell", directories, isExecutableFile));
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
