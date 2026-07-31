// The verb→colour mapping, shared by the brush ring on the canvas and the verb
// picker in the panel.
//
// Its own module because the two consumers cannot import each other: the ring is an
// R3F component (`useFrame`, `three`) and the panel is a plain sidebar surface that
// must not drag a render loop into its module graph. Duplicating four hex strings
// across them would be the version that silently drifts — and drift here is not
// cosmetic, since the whole point is that the two surfaces agree.

import type { TerrainVerb } from '@pascal-app/core'

/**
 * One colour per verb, because the brush ring's geometry is identical for all four.
 *
 * A single colour made raise and lower visually indistinguishable: same circle, same
 * amber, opposite effect — so the only way to know which way the next drag moves the
 * ground was to look away from the cursor at the panel. The verb is also the one piece
 * of sculpt state a user loses track of between strokes, since the mode is sustained
 * and an intent set a minute ago is still armed.
 *
 * Values are the repo's existing palette (`ui/primitives/color-dot.tsx`) used with its
 * established meanings — green for additive, red for destructive (`#ef4444` is already
 * the delete cursor badge and the 2D delete stroke), blue and violet for the two
 * operations that move ground neither up nor down. Amber is deliberately retired rather
 * than kept for one verb: reusing the old colour for `raise` alone would leave every
 * existing screenshot ambiguous.
 *
 * All four differ, including flatten vs smooth. Giving those two the same blue would
 * reproduce the gap this closes, one pair over: both are "neither up nor down", but one
 * drives ground to a *target height* you can set wrongly and the other only softens
 * what is already there — confusing them costs a stroke.
 */
export const TERRAIN_VERB_COLOR: Record<TerrainVerb, string> = {
  raise: '#22c55e',
  lower: '#ef4444',
  flatten: '#3b82f6',
  smooth: '#a855f7',
}

/**
 * Picking a height, not applying a verb — so the ring must not read as any of them.
 * The eyedropper is a one-shot arm whose UI lives in the panel; the cursor is the only
 * thing at the point of action that can say "this click samples rather than sculpts".
 */
export const TERRAIN_SAMPLING_COLOR = '#f59e0b'

/**
 * The brush ring's colour for a given brush state.
 *
 * A function rather than a lookup at the call site because sampling *outranks* the
 * verb — while the eyedropper is armed the click does not apply the verb at all, so
 * showing the verb's colour would promise the wrong action. Keeping that precedence in
 * one place also makes it assertable: "no two states look alike" is a property, and one
 * worth checking rather than re-eyeballing every time a verb is added.
 */
export function brushRingColor(verb: TerrainVerb, sampling: boolean): string {
  return sampling ? TERRAIN_SAMPLING_COLOR : TERRAIN_VERB_COLOR[verb]
}
