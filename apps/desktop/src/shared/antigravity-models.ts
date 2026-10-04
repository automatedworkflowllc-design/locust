/**
 * ANTIGRAVITY'S TIERS, BY THE MODEL EACH RUNS (0.384).
 *
 * Antigravity's agent command takes a tier and nothing else --
 * `agentapi new-conversation [--model=<flash_lite|flash|pro>]`, read off its
 * own `--help` on 2026-09-26 -- so a tier is all Locust can choose, and a
 * model Antigravity's own window offers (Claude Opus among them) cannot be
 * asked for from here.
 *
 * Which model a tier runs is Antigravity's to decide, and nothing it ships on
 * disk says. The one version known is Flash's, from Colin, 2026-09-26, over a
 * Home card reading "Antigravity · Flash": "flash we can definitely have it
 * there, its 3.8 now". The other two are named without a version rather than
 * given a guessed one.
 *
 * One table, read by both sides: the host lists the tiers in the model
 * catalog with these names, and every surface that names a teammate's route
 * reads them through `routeModelName` -- so the picker and a card cannot say
 * two different things about the same choice.
 */
export const ANTIGRAVITY_TIER_NAMES: Readonly<Record<string, string>> = {
  flash: 'Gemini 3.8 Flash',
  pro: 'Gemini Pro',
  flash_lite: 'Gemini Flash Lite'
}

/** The name of an Antigravity tier, or undefined for anything that is not one. */
export function antigravityTierName(tier: string): string | undefined {
  return Object.hasOwn(ANTIGRAVITY_TIER_NAMES, tier) ? ANTIGRAVITY_TIER_NAMES[tier] : undefined
}
