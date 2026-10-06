/** Provider facts become display sentences; callers retain the original evidence. */
interface ProviderErrorFacts {
  readonly message: string;
  readonly status?: number;
  readonly kind?: string;
}

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function factsOf(value: unknown, status?: number, kind?: string, depth = 0): ProviderErrorFacts | undefined {
  if (depth > 5) return undefined;
  if (typeof value === "string") {
    const body = value.replace(/^(?:OpenCode stopped:|Antigravity could not run it:|Error:)\s*/, "");
    try { return factsOf(JSON.parse(body) as unknown, status, kind, depth + 1); }
    catch { return undefined; }
  }
  if (!object(value)) return undefined;
  const code = value.status ?? value.statusCode;
  const nextStatus = typeof code === "number" ? code : status;
  const nextKind = typeof value.code === "string" ? value.code : typeof value.type === "string" ? value.type : kind;
  if (object(value.error) || typeof value.error === "string") {
    const inner = factsOf(value.error, nextStatus, nextKind, depth + 1);
    if (inner !== undefined) return inner;
  }
  if (object(value.data)) {
    const inner = factsOf(value.data, nextStatus, nextKind, depth + 1);
    if (inner !== undefined) return inner;
  }
  if (typeof value.message !== "string" || value.message.trim() === "") return undefined;
  return factsOf(value.message, nextStatus, nextKind, depth + 1) ?? {
    message: value.message.trim(),
    ...(nextStatus === undefined ? {} : { status: nextStatus }),
    ...(nextKind === undefined ? {} : { kind: nextKind }),
  };
}

/** Non-JSON messages are deliberately unchanged, including malformed JSON. */
export function providerErrorSentence(message: string, runtime?: string): string {
  const facts = factsOf(message);
  if (facts === undefined) return message;
  const provider = runtime === "codex" ? "OpenAI"
    : runtime === "claude" ? "Anthropic"
    : runtime === "cursor" ? "Cursor's provider"
    : runtime === "antigravity" ? "Antigravity's provider"
    : runtime === "copilot" ? "Copilot's provider"
    : runtime === "opencode" ? "OpenCode's provider" : "The provider";
  const said = facts.message;
  const candidate = /\bmodel\s+['"]?([^'"\s:]+)['"]?/i.exec(said)?.[1];
  const model = candidate !== undefined && !/^(not|is|was|does|unavailable)$/i.test(candidate) ? candidate : undefined;
  if ((/\bmodel\b/i.test(said) || facts.kind === "model_not_found") && /not enabled|not found|does not exist|unknown model|model_not_found/i.test(`${said} ${facts.kind ?? ""}`)) {
    const reason = /not enabled/i.test(said) ? "it is not enabled here right now" : "it could not be found or is not available here";
    return `${provider} refused ${model === undefined ? "the model" : `the model ${model}`}: ${reason}. Pick another model and send again.`;
  }
  if (/insufficient_quota|quota.*exhausted|usage limit|quota.*exceeded/i.test(`${facts.kind ?? ""} ${said}`)) {
    return `${provider} reported that its usage limit has been reached. Pick another model, or try again when usage is available.`;
  }
  if (facts.status === 429 || /rate[_ -]?limit|too many requests/i.test(`${facts.kind ?? ""} ${said}`)) {
    return `${provider} rate limited this request. Wait a while, or pick another model and send again.`;
  }
  if (facts.status === 503 || /overloaded|service unavailable|temporarily unavailable/i.test(said)) {
    return `${provider} is overloaded or unavailable right now. Try again later, or pick another model.`;
  }
  if (facts.status === 401 || facts.status === 403 || /authentication|unauthorized|invalid api key/i.test(`${facts.kind ?? ""} ${said}`)) {
    return `${provider} refused this request because of sign-in or access permissions. Check the agent's sign-in and model access, then send again.`;
  }
  return `${provider} refused this request: ${said.replace(/[.!?]+$/, "")}. Check the model and account settings before sending again.`;
}
