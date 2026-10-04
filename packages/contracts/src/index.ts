export type RuntimeKind = "codex" | "claude" | "native";

export type RouteKind =
  | "codex-account"
  | "claude-account"
  | "api-key"
  | "omniroute"
  | "local";

export type FallbackMode = "off" | "ask" | "automatic";

export type FallbackTrigger =
  | "temporary-rate-limit"
  | "quota-exhausted"
  | "provider-unavailable";

export type RuntimeFailureKind =
  | FallbackTrigger
  | "context-exhausted"
  | "authentication-failed"
  | "billing-required"
  | "safety-blocked"
  | "approval-denied"
  | "unknown";

export type DataBoundary = "local-only" | "approved-cloud" | "any-enabled";

export interface CapabilityManifest {
  readonly toolCalling: boolean;
  readonly structuredOutput: boolean;
  readonly filesystem: boolean;
  readonly terminal: boolean;
  readonly browser: boolean;
  readonly computerUse: boolean;
  readonly mcp: boolean;
  readonly vision: boolean;
  readonly maxContextTokens: number;
  readonly dataBoundary: Exclude<DataBoundary, "any-enabled">;
}

export interface CapabilityRequirement {
  readonly toolCalling?: boolean;
  readonly structuredOutput?: boolean;
  readonly filesystem?: boolean;
  readonly terminal?: boolean;
  readonly browser?: boolean;
  readonly computerUse?: boolean;
  readonly mcp?: boolean;
  readonly vision?: boolean;
  readonly minimumContextTokens?: number;
  readonly dataBoundary?: DataBoundary;
}

export interface ModelRoute {
  readonly id: string;
  readonly label: string;
  readonly runtime: RuntimeKind;
  readonly route: RouteKind;
  readonly provider: string;
  readonly model: string;
  readonly capabilities: CapabilityManifest;
  readonly free: boolean;
  readonly enabled: boolean;
  readonly healthy: boolean;
}

export interface FallbackPolicy {
  readonly mode: FallbackMode;
  readonly triggers: readonly FallbackTrigger[];
  readonly orderedRouteIds: readonly string[];
  readonly dataBoundary: DataBoundary;
  readonly freeOnly: boolean;
  readonly verifyAfterSwitch: boolean;
  readonly maxHops: number;
}

export interface TeammateProfile {
  readonly id: string;
  readonly name: string;
  readonly primaryRouteId: string;
  readonly fallback: FallbackPolicy;
  readonly requirements: CapabilityRequirement;
}

export interface RouteDecision {
  readonly selected?: ModelRoute;
  readonly rejected: ReadonlyArray<{
    readonly routeId: string;
    readonly reason: string;
  }>;
}

export interface SideEffectReceipt {
  readonly actionId: string;
  readonly idempotencyKey: string;
  readonly status: "confirmed" | "failed" | "unknown";
  readonly providerReference?: string;
}

/**
 * The checkpoint type lives in `@teammate/mission-store` as
 * `ReconciledCheckpoint`, not here.
 *
 * A design sketch of it used to sit at this spot, written before there was a
 * ledger to derive one from, and nothing ever consumed it. Two definitions of
 * one concept agree only until someone edits either, and a checkpoint is the
 * record a provider fallback trusts -- so it has exactly one definition, beside
 * the durable store that is the only thing allowed to produce one.
 */

export type HandoffState =
  | "running"
  | "limit-classified"
  | "execution-frozen"
  | "action-reconciled"
  | "checkpoint-created"
  | "fallback-selected"
  | "approval-required"
  | "destination-rehydrated"
  | "state-verified"
  | "paused";

export interface MissionEvent<TPayload = unknown> {
  readonly id: string;
  readonly missionId: string;
  readonly sequence: number;
  readonly type: string;
  readonly occurredAt: string;
  readonly requestedRouteId?: string;
  readonly resolvedRouteId?: string;
  readonly payload: TPayload;
}
