/**
 * WHICH BUILDS AN INSTALLED LOCUST TAKES (0.307).
 *
 * The beta handover, 2026-09-23: "Every release puts the update banner in
 * front of a tester, and the build they're reporting on is gone within the
 * hour. Testers should get at most one new build a day. Colin's machine can
 * stay on the fast lane." About a hundred releases in four days.
 *
 * So every build is published as a GitHub PRERELEASE, and one a day is
 * promoted to the release GitHub calls latest (_tools/promote-release.mjs).
 * electron-updater takes only `latest` unless `allowPrerelease` is on; with
 * it on and a plain version like 0.307.0, it takes the newest release in the
 * feed, prerelease or not (GitHubProvider, electron-updater 6.8.9). That is
 * the whole mechanism: `everyBuild` is `allowPrerelease`, and it is off
 * unless the person turned it on in Settings > Updates.
 *
 * The site downloads releases/latest too, so a new tester installs the day's
 * build, not the last hour's.
 */
export interface UpdateLane {
  /** Take every build as it is published, not just the one a day testers get. */
  readonly everyBuild: boolean
}

export const TESTER_LANE: UpdateLane = { everyBuild: false }

/** A saved lane, read defensively: anything unreadable is the tester lane. */
export function updateLaneFrom(value: unknown): UpdateLane {
  if (typeof value !== 'object' || value === null) return TESTER_LANE
  const everyBuild = (value as Record<string, unknown>).everyBuild
  return typeof everyBuild === 'boolean' ? { everyBuild } : TESTER_LANE
}
