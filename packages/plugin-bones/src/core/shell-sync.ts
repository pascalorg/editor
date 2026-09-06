/**
 * The numbers the SHELL shares with Bones (Steve, 2026-09-06: "make sure
 * the roof framing and thickness, on this and main roof, syncs with bones,
 * and posts sync with bones — only way to pull this off correctly").
 *
 * A generated roof segment's `deckThickness` is what the viewer draws the
 * roof slab as; Bones frames the same roof as rafters bearing on the plate
 * with the sheathing on their tops. For the two to be the same object the
 * slab must be exactly rafter depth plus sheathing, from the spec Bones
 * frames with — never the schema's placeholder. The generator and the
 * auto-roof panel read it from here; nothing else defines it.
 */

import { LUMBER_CROSS_SECTIONS } from '../lumber'
import { DEFAULT_SPEC, type FramingSpec } from './spec'
import { inches } from './units'

/** 7/16" WSP roof deck (R803.2) — the same sheet roof-framing.ts lays. */
export const ROOF_SHEATHING = inches(7 / 16)

/** The roof slab the shell draws: the rafter's depth plus its sheathing, metres. */
export function roofShellThickness(spec: FramingSpec = DEFAULT_SPEC): number {
  const [, rafterDepth] = LUMBER_CROSS_SECTIONS[spec.rafterSize]
  return rafterDepth + ROOF_SHEATHING
}
