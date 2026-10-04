/**
 * Workspace path -> Antigravity project id, read out of
 * `~/.gemini/antigravity/agyhub_summaries_proto.pb`. EXPERIMENTAL, and
 * REVERSE-ENGINEERED: Google publishes no schema for this file.
 *
 * Why it exists at all: `agentapi new-conversation` refuses to start without
 * `ANTIGRAVITY_PROJECT_ID` set to the project the workspace belongs to, and
 * nothing in Antigravity prints that id. The only place it was found is this
 * protobuf, which the IDE keeps as its list of past conversations.
 *
 * The layout below was recovered by hand from the wire bytes on 2026-09-03 and
 * confirmed against the file kept at `test/fixtures/antigravity/summaries.pb`
 * (17 conversation records). Each record holds a submessage in which:
 *
 *   field 7  (`0x3a`, length-delimited) is the workspace as a `file:///` URI
 *   field 18 (`0x92 0x01`, length-delimited, 36 bytes) is the project id
 *
 * Protobuf serialises fields in tag order, so field 18 always follows field 7
 * inside the same record; the pairing here is "the first field-18 id after this
 * field-7 URI", and it stops at the next URI so a record that carries no id
 * cannot borrow the next record's. One record in the fixture -- a conversation
 * the IDE labels `outside-of-project` -- has neither field, and is skipped.
 *
 * Two encodings of the same workspace were seen and both must normalize to one
 * key: `file:///c:/Users/…/antigravtest` and the percent-and-backslash form
 * `file:///c%3A%5CUsers%5C…%5Cantigravtest`.
 *
 * What is NOT known: what any other field means, whether a project id is ever
 * absent from a record that does have a workspace, and whether a machine with
 * more than one project keeps them in one file at all -- every record in the
 * only file ever captured names the same project. Read failures return an
 * empty map rather than a guess.
 */

/** Field 18, length-delimited: `0x92 0x01` then a 36-byte length. */
const PROJECT_ID_TAG = [0x92, 0x01, 0x24] as const;
const PROJECT_ID_LENGTH = 36;
/** Field 7, length-delimited. */
const WORKSPACE_TAG = 0x3a;

interface VarInt {
  readonly value: number;
  readonly bytes: number;
}

function readVarint(bytes: Uint8Array, offset: number): VarInt | undefined {
  let value = 0;
  let shift = 0;
  for (let index = 0; index < 5; index += 1) {
    const byte = bytes[offset + index];
    if (byte === undefined) return undefined;
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value: value >>> 0, bytes: index + 1 };
    shift += 7;
  }
  return undefined;
}

const decoder = new TextDecoder("utf-8", { fatal: false });

/**
 * A workspace path in the one form both encodings collapse to: forward slashes,
 * a lower-case drive letter, no trailing slash. Only the DRIVE is lower-cased;
 * the rest of a Windows path is case-insensitive on disk but case-preserving,
 * and rewriting it would make the key stop resembling what the user sees.
 */
export function normalizeAntigravityWorkspace(value: string): string {
  let path = value;
  if (path.startsWith("file:///")) path = path.slice("file:///".length);
  else if (path.startsWith("file://")) path = path.slice("file://".length);
  try {
    path = decodeURIComponent(path);
  } catch {
    // A stray `%` that is not an escape. The undecoded text is still a better
    // key than nothing, and it simply will not match a caller's path.
  }
  path = path.replace(/\\/g, "/");
  while (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return /^[A-Za-z]:/.test(path) ? path[0]!.toLowerCase() + path.slice(1) : path;
}

function readWorkspaceUri(bytes: Uint8Array, offset: number): string | undefined {
  const length = readVarint(bytes, offset + 1);
  if (length === undefined || length.value === 0) return undefined;
  const start = offset + 1 + length.bytes;
  const end = start + length.value;
  if (end > bytes.length) return undefined;
  const text = decoder.decode(bytes.subarray(start, end));
  return text.startsWith("file:") ? text : undefined;
}

function readProjectId(bytes: Uint8Array, offset: number): string | undefined {
  for (let index = 0; index < PROJECT_ID_TAG.length; index += 1) {
    if (bytes[offset + index] !== PROJECT_ID_TAG[index]) return undefined;
  }
  const start = offset + PROJECT_ID_TAG.length;
  const end = start + PROJECT_ID_LENGTH;
  if (end > bytes.length) return undefined;
  const text = decoder.decode(bytes.subarray(start, end));
  return /^[0-9a-fA-F-]{36}$/.test(text) ? text : undefined;
}

export function parseAntigravityProjects(bytes: Uint8Array): ReadonlyMap<string, string> {
  const projects = new Map<string, string>();
  let pendingWorkspace: string | undefined;
  for (let offset = 0; offset < bytes.length; offset += 1) {
    if (bytes[offset] === WORKSPACE_TAG) {
      const uri = readWorkspaceUri(bytes, offset);
      // A record with no id of its own must not inherit the next record's, so
      // a second workspace replaces the first rather than queueing behind it.
      if (uri !== undefined) pendingWorkspace = normalizeAntigravityWorkspace(uri);
      continue;
    }
    if (pendingWorkspace === undefined) continue;
    const projectId = readProjectId(bytes, offset);
    if (projectId === undefined) continue;
    projects.set(pendingWorkspace, projectId);
    pendingWorkspace = undefined;
  }
  return projects;
}

export function projectIdForWorkspace(
  projects: ReadonlyMap<string, string>,
  absolutePath: string,
): string | undefined {
  return projects.get(normalizeAntigravityWorkspace(absolutePath));
}
