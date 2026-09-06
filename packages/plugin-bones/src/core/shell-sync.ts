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

import { LUMBER_CROSS_SECTIONS, type LumberSize } from '../lumber'
import { DEFAULT_SPEC, type FramingSpec } from './spec'
import { inches } from './units'

/** 7/16" WSP roof deck (R803.2) — the same sheet roof-framing.ts lays. */
export const ROOF_SHEATHING = inches(7 / 16)

/** The roof slab the shell draws: the rafter's depth plus its sheathing, metres. */
export function roofShellThickness(spec: FramingSpec = DEFAULT_SPEC): number {
  const [, rafterDepth] = LUMBER_CROSS_SECTIONS[spec.rafterSize]
  return rafterDepth + ROOF_SHEATHING
}

/**
 * PlanCrafters porchWall: the porch cover bears on a 6x8 beam under a
 * single 2x6 plate, on 6x6 posts (Steve, 2026-09-06: "literally bring the
 * framing in — just major posts, not studs — into the view and use those").
 * The porch engine frames these sizes; the generator's beam band and posts
 * are drawn from the same table, so the shell and the framing are one
 * object.
 */
export const PORCH_BEAM_SIZE: LumberSize = '6x8'
export const PORCH_PLATE_SIZE: LumberSize = '2x6'
export const PORCH_POST_SIZE: LumberSize = '6x6'

/** The porch beam band the shell draws: the beam's width and depth, its plate, and the band (beam + plate), metres. */
export function porchBeam(): { width: number; depth: number; plate: number; band: number } {
  const [width, depth] = LUMBER_CROSS_SECTIONS[PORCH_BEAM_SIZE]
  const [plate] = LUMBER_CROSS_SECTIONS[PORCH_PLATE_SIZE]
  return { width, depth, plate, band: depth + plate }
}

/** The porch post's square section, metres. */
export function porchPostSize(): number {
  return LUMBER_CROSS_SECTIONS[PORCH_POST_SIZE][0]
}
