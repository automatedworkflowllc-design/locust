import { describe, expect, it } from "vitest";
import type {
  CapabilityManifest,
  FallbackPolicy,
  ModelRoute,
} from "@teammate/contracts";
import {
  HandoffStateMachine,
  isFallbackEligible,
  resolveFallback,
} from "../src/index.js";

const localCapabilities: CapabilityManifest = {
  toolCalling: true,
  structuredOutput: true,
  filesystem: true,
  terminal: true,
  browser: false,
  computerUse: false,
  mcp: true,
  vision: false,
  maxContextTokens: 128_000,
  dataBoundary: "local-only",
};

const cloudCapabilities: CapabilityManifest = {
  ...localCapabilities,
  vision: true,
  maxContextTokens: 200_000,
  dataBoundary: "approved-cloud",
};

const routes: readonly ModelRoute[] = [
  {
    id: "free-cloud",
    label: "Free cloud model",
    runtime: "native",
    route: "omniroute",
    provider: "approved-free",
    model: "example/free",
    capabilities: cloudCapabilities,
    free: true,
    enabled: true,
    healthy: true,
  },
  {
    id: "local",
    label: "Local model",
    runtime: "native",
    route: "local",
    provider: "ollama",
    model: "example-local",
    capabilities: localCapabilities,
    free: true,
    enabled: true,
    healthy: true,
  },
];

const policy: FallbackPolicy = {
  mode: "automatic",
  triggers: ["temporary-rate-limit", "quota-exhausted", "provider-unavailable"],
  orderedRouteIds: ["free-cloud", "local"],
  dataBoundary: "local-only",
  freeOnly: true,
  verifyAfterSwitch: true,
  maxHops: 3,
};

describe("fallback routing", () => {
  it("never treats authentication or safety failures as fallback eligible", () => {
    expect(isFallbackEligible("authentication-failed", policy)).toBe(false);
    expect(isFallbackEligible("safety-blocked", policy)).toBe(false);
    expect(isFallbackEligible("quota-exhausted", policy)).toBe(true);
  });

  it("rejects routes outside the configured data boundary", () => {
    const result = resolveFallback(routes, policy, {
      terminal: true,
      dataBoundary: "local-only",
    });

    expect(result.selected?.id).toBe("local");
    expect(result.rejected[0]).toEqual({
      routeId: "free-cloud",
      reason: "Policy requires a local-only route",
    });
  });

  it("rejects a fallback that lacks a required capability", () => {
    const result = resolveFallback(routes, { ...policy, orderedRouteIds: ["local"] }, {
      vision: true,
      dataBoundary: "local-only",
    });

    expect(result.selected).toBeUndefined();
    expect(result.rejected[0]?.reason).toBe("Missing capability: vision");
  });
});

describe("handoff state machine", () => {
  it("requires execution to freeze before creating a checkpoint", () => {
    const machine = new HandoffStateMachine();
    machine.transition("limit-classified");
    expect(() => machine.transition("checkpoint-created")).toThrow(
      "Invalid handoff transition",
    );
  });
});
