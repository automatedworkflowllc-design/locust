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
 * **Chromatic at 0.35, and that is Colin's call over the brief's.** The
 * design document asks for `silver` at `0.55` and says chromatic is "plainly
 * foreign to this palette". Colin, 2026-09-20: *"metal on hover/chromatic/try
 * .35 strength at first and we can see if we want to boost it."* Both halves
 * of that are deliberate — a weaker effect than the brief wanted, in the
 * preset the brief argued against — so it is recorded as a disagreement to
 * look at on a real screen rather than settled here.
 *
 * `silver` and `gold` are the other two the library ships; `PRESETS` has
 * exactly those three.
 */
export const METAL_PRESET: MetalFxPreset = 'chromatic'

/** Colin's starting point. The brief wanted 0.55; 1.0 is the glow to avoid. */
export const METAL_STRENGTH = 0.35

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
export const METAL_BEND: Partial<BendConfig> = {
  ...BEND_DEFAULTS,
  enabled: true,
  applyTo: 'ring',
  strength: METAL_STRENGTH
}
