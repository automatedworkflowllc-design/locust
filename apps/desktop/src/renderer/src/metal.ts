import type { MetalStrength } from '../../shared/ipc.js'
import type { BendConfig, MetalFxPreset } from 'metal-fx'
import { BEND_DEFAULTS } from 'metal-fx'

/**
 * The one place the send button's metal is tuned.
 *
 * Here rather than inline so the numbers can be argued about without reading
 * a component, and so there is one answer when the question "how strong is
 * it" is asked again — which it will be, because this is the kind of setting
 * people iterate on by eye.
 *
 * **Silver at 0.55 — and the disagreement resolved itself by being looked
 * at.** The design document asked for `silver` at `0.55` and called chromatic
 * "plainly foreign to this palette". Colin started at chromatic · 0.35 sight
 * unseen, then after seeing both on a real screen: *"i think silver standard
 * is a good preset btw"* (2026-09-20) — which is the brief's own answer,
 * arrived at independently. That is the strongest kind of agreement there is,
 * so it is the default now.
 *
 * `chromatic` and `gold` are the other two the library ships; `PRESETS` has
 * exactly those three, and all of them are one click away in Settings.
 */
export const METAL_PRESET: MetalFxPreset = 'silver'

/**
 * What each named strength is worth.
 *
 * The three numbers anybody actually named: 0.35 was Colin's starting point,
 * 0.55 the design agent's recommendation, and 1.0 the "aggressive glow to
 * avoid" — so `strong` stops short of it rather than offering the one value
 * the brief ruled out.
 */
export const METAL_STRENGTHS: Readonly<Record<MetalStrength, number>> = {
  subtle: 0.35,
  standard: 0.55,
  strong: 0.8
}

/** Where both Colin and the brief landed. 1.0 is the glow to avoid. */
export const METAL_STRENGTH = METAL_STRENGTHS.standard

/**
 * The "gooey" half — metal-fx's own cursor bend, not another library.
 *
 * Colin spotted it on the library's page and asked for it. The design
 * document does not mention it and separately rejected the Gooey package
 * ("no objects that merge"), which is a different thing: this is
 * `BendConfig`, a displacement field the metal shader already carries.
 *
 * `applyTo: 'ring'` deliberately. The library's other option deforms the
 * whole root including the arrow, and a send button whose icon squashes under
 * the cursor feels unreliable at the exact moment a person is committing to
 * press it. The metal ring can bend; the thing you are aiming at should not.
 */
export function metalBendConfig(enabled: boolean, strength: number): Partial<BendConfig> {
  return { ...BEND_DEFAULTS, enabled, applyTo: 'ring', strength }
}
