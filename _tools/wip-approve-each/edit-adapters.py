import io, os, sys
root = sys.argv[1]

def edit(path, pairs):
    p = os.path.join(root, path)
    s = io.open(p, encoding='utf-8').read()
    for a, b in pairs:
        assert a in s, (path, a[:90])
        assert s.count(a) == 1, (path, 'not unique', a[:90])
        s = s.replace(a, b, 1)
    io.open(p, 'w', encoding='utf-8', newline='').write(s)

RUN = 'packages/runtime-adapters/src/codex-app-server-run.ts'
edit(RUN, [
('import type { AppServerNotification, JsonValue } from "./app-server.js";',
 'import type { AppServerNotification, AppServerRequest, JsonValue } from "./app-server.js";'),
("""  /** A prior thread to carry on, which keeps its turns. */
  readonly resumeThreadId?: string;
  readonly signal?: AbortSignal;""",
 """  /** A prior thread to carry on, which keeps its turns. */
  readonly resumeThreadId?: string;
  /**
   * What answers the server when it ASKS -- the approval channel. Only a
   * policy that stops for approval (`untrusted`) ever produces a request;
   * without a handler every request is refused, which under `never` is the
   * same as never being asked.
   */
  readonly onRequest?: (request: AppServerRequest) => Promise<JsonValue>;
  readonly signal?: AbortSignal;"""),
("""    // Nothing asks in these modes -- the policy is `never`, measured to raise
    // no approval request at all. A server that asks anyway is answered with a
    // refusal rather than left waiting, because an unanswered request stalls
    // the turn forever and the person would see a run that never ends.
    onRequest: async () => ({ decision: "reject" }) as JsonValue,""",
 """    // The approval channel, when the mode has one. Under `never` nothing
    // asks -- measured to raise no request at all -- and a server that asks
    // anyway is answered with a refusal rather than left waiting, because an
    // unanswered request stalls the turn forever and the person would see a
    // run that never ends.
    onRequest: options.onRequest ?? (async () => ({ decision: "reject" }) as JsonValue),"""),
("""export function asProcessNormalizer(
  normalizer: AppServerEventNormalizer,
): CodexEventNormalizer {""",
 """/**
 * The notification a record on this transport was written from, or nothing.
 *
 * Shared by the normalizer below and by anyone else reading the stream -- the
 * mission loop reads file changes off the same records, so the parse lives in
 * one place rather than being done twice with two chances to differ.
 */
export function notificationOfRecord(record: RuntimeJsonlRecord): AppServerNotification | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(record.raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const notification = parsed as { method?: unknown; params?: unknown };
  if (typeof notification.method !== "string") return undefined;
  return {
    method: notification.method,
    params: (notification.params ?? undefined) as AppServerNotification["params"],
  };
}

export function asProcessNormalizer(
  normalizer: AppServerEventNormalizer,
): CodexEventNormalizer {"""),
("""    accept(record: RuntimeJsonlRecord): readonly NormalizedRuntimeEvent[] {
      // Every record on this transport is a notification the runner wrote out
      // as a line. A line that is not one -- which nothing here produces --
      // is dropped rather than guessed at.
      let parsed: unknown;
      try {
        parsed = JSON.parse(record.raw);
      } catch {
        return [];
      }
      if (typeof parsed !== "object" || parsed === null) return [];
      const notification = parsed as { method?: unknown; params?: unknown };
      if (typeof notification.method !== "string") return [];
      return normalizer.accept({
        method: notification.method,
        params: (notification.params ?? undefined) as AppServerNotification["params"],
      });
    },""",
 """    accept(record: RuntimeJsonlRecord): readonly NormalizedRuntimeEvent[] {
      // Every record on this transport is a notification the runner wrote out
      // as a line. A line that is not one -- which nothing here produces --
      // is dropped rather than guessed at.
      const notification = notificationOfRecord(record);
      return notification === undefined ? [] : normalizer.accept(notification);
    },"""),
])

IDX = 'packages/runtime-adapters/src/index.ts'
edit(IDX, [
('export { asProcessNormalizer, startCodexAppServerRun } from "./codex-app-server-run.js";',
 'export { asProcessNormalizer, notificationOfRecord, startCodexAppServerRun } from "./codex-app-server-run.js";'),
])

CMD = 'packages/runtime-adapters/src/commands.ts'
edit(CMD, [
("""export function codexAppServerPolicy(
  sandbox: MissionSandbox | undefined,
): CodexAppServerPolicy {
  const chosen = sandboxArgument(sandbox);
  if (chosen === "full-access") {
    return { sandbox: "danger-full-access", approvalPolicy: "never" };
  }
  return { sandbox: chosen, approvalPolicy: "never" };
}""",
 """export function codexAppServerPolicy(
  sandbox: MissionSandbox | undefined,
  mode?: string,
): CodexAppServerPolicy {
  const chosen = sandboxArgument(sandbox);
  // Approve-each is the one mode that STOPS: `untrusted` makes the server ask
  // before every consequential action, and the approval channel answers. It
  // is never paired with full access -- a run that may do anything has
  // nothing to ask -- so the sandbox here is whatever the mode earned, which
  // for Approve-each is workspace-write.
  if (mode === "approve-each") {
    return { sandbox: chosen === "full-access" ? "workspace-write" : chosen, approvalPolicy: "untrusted" };
  }
  if (chosen === "full-access") {
    return { sandbox: "danger-full-access", approvalPolicy: "never" };
  }
  return { sandbox: chosen, approvalPolicy: "never" };
}"""),
])
print('adapters edited')
