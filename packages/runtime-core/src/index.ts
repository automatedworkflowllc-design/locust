import type {
  CapabilityRequirement,
  FallbackPolicy,
  HandoffState,
  ModelRoute,
  RouteDecision,
  RuntimeFailureKind,
} from "@teammate/contracts";

const BOOLEAN_CAPABILITIES = [
  "toolCalling",
  "structuredOutput",
  "filesystem",
  "terminal",
  "browser",
  "computerUse",
  "mcp",
  "vision",
] as const;

export function routeSatisfies(
  route: ModelRoute,
  requirement: CapabilityRequirement,
): { ok: true } | { ok: false; reason: string } {
  for (const capability of BOOLEAN_CAPABILITIES) {
    if (requirement[capability] === true && !route.capabilities[capability]) {
      return { ok: false, reason: `Missing capability: ${capability}` };
    }
  }

  if (
    requirement.minimumContextTokens !== undefined &&
    route.capabilities.maxContextTokens < requirement.minimumContextTokens
  ) {
    return {
      ok: false,
      reason: `Context ${route.capabilities.maxContextTokens} is below required ${requirement.minimumContextTokens}`,
    };
  }

  if (
    requirement.dataBoundary === "local-only" &&
    route.capabilities.dataBoundary !== "local-only"
  ) {
    return { ok: false, reason: "Route crosses the local-only data boundary" };
  }

  return { ok: true };
}

export function isFallbackEligible(
  failure: RuntimeFailureKind,
  policy: FallbackPolicy,
): boolean {
  if (policy.mode === "off") return false;

  return policy.triggers.some((trigger) => trigger === failure);
}

export function resolveFallback(
  routes: readonly ModelRoute[],
  policy: FallbackPolicy,
  requirement: CapabilityRequirement,
  excludedRouteIds: ReadonlySet<string> = new Set(),
): RouteDecision {
  const routeById = new Map(routes.map((route) => [route.id, route]));
  const rejected: Array<{ routeId: string; reason: string }> = [];

  for (const routeId of policy.orderedRouteIds.slice(0, policy.maxHops)) {
    const route = routeById.get(routeId);

    if (!route) {
      rejected.push({ routeId, reason: "Route does not exist" });
      continue;
    }
    if (excludedRouteIds.has(routeId)) {
      rejected.push({ routeId, reason: "Route was already attempted" });
      continue;
    }
    if (!route.enabled) {
      rejected.push({ routeId, reason: "Route is disabled" });
      continue;
    }
    if (!route.healthy) {
      rejected.push({ routeId, reason: "Route is unhealthy" });
      continue;
    }
    if (policy.freeOnly && !route.free) {
      rejected.push({ routeId, reason: "Policy requires a free route" });
      continue;
    }
    if (
      policy.dataBoundary === "local-only" &&
      route.capabilities.dataBoundary !== "local-only"
    ) {
      rejected.push({ routeId, reason: "Policy requires a local-only route" });
      continue;
    }

    const compatibility = routeSatisfies(route, requirement);
    if (!compatibility.ok) {
      rejected.push({ routeId, reason: compatibility.reason });
      continue;
    }

    return { selected: route, rejected };
  }

  return { rejected };
}

const NEXT_STATES: Readonly<Record<HandoffState, readonly HandoffState[]>> = {
  running: ["limit-classified", "paused"],
  "limit-classified": ["execution-frozen", "paused"],
  "execution-frozen": ["action-reconciled", "paused"],
  "action-reconciled": ["checkpoint-created", "paused"],
  "checkpoint-created": ["fallback-selected", "paused"],
  "fallback-selected": ["approval-required", "destination-rehydrated", "paused"],
  "approval-required": ["destination-rehydrated", "paused"],
  "destination-rehydrated": ["state-verified", "paused"],
  "state-verified": ["running", "paused"],
  paused: ["running"],
};

export class HandoffStateMachine {
  #state: HandoffState = "running";

  get state(): HandoffState {
    return this.#state;
  }

  transition(next: HandoffState): HandoffState {
    if (!NEXT_STATES[this.#state].includes(next)) {
      throw new Error(`Invalid handoff transition: ${this.#state} -> ${next}`);
    }

    this.#state = next;
    return this.#state;
  }
}
