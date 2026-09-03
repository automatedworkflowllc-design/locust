import type { ParsedRuntimeVersion } from "./types.js";

// The trailing `\.(?![0-9])` is there because GitHub Copilot CLI ends its
// version line with a full stop -- "GitHub Copilot CLI 1.0.82." -- and without
// it that sentence read as no version at all. A period followed by a digit is
// still part of a longer number and still does not match.
const SEMVER_PATTERN =
  /(?:^|[^0-9A-Za-z])v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?=$|\.(?![0-9])|[^0-9A-Za-z.+-])/;

export function parseRuntimeVersion(output: string): ParsedRuntimeVersion | undefined {
  const normalized = output.trim();
  const match = SEMVER_PATTERN.exec(normalized);
  if (!match) return undefined;

  const majorText = match[1];
  const minorText = match[2];
  const patchText = match[3];
  if (majorText === undefined || minorText === undefined || patchText === undefined) {
    return undefined;
  }

  const core = `${majorText}.${minorText}.${patchText}`;
  const prerelease = match[4];
  const build = match[5];
  const version = `${core}${prerelease ? `-${prerelease}` : ""}${build ? `+${build}` : ""}`;
  const parsed: ParsedRuntimeVersion = {
    raw: normalized.slice(0, 256),
    version,
    major: Number.parseInt(majorText, 10),
    minor: Number.parseInt(minorText, 10),
    patch: Number.parseInt(patchText, 10),
  };

  if (prerelease === undefined && build === undefined) return parsed;
  if (prerelease !== undefined && build === undefined) return { ...parsed, prerelease };
  if (prerelease === undefined && build !== undefined) return { ...parsed, build };
  return { ...parsed, prerelease, build } as ParsedRuntimeVersion;
}
