import { z } from 'zod'

// Fence enums, in a file with no other dependency: agent tool contracts validate against them
// without loading the node schemas.

/**
 * 'guard' — a deck guard built the way the AWC's Deck Construction Guide
 * (DCA 6) draws one: 4x4 posts no more than `postSpacing` apart, a 2x6 cap
 * rail flat on top, a 2x4 top rail on edge under it, and the infill
 * `guardInfill` chooses — 2x2 balusters on a 2x4 bottom rail at a ≤ 4 in
 * clear gap (IRC R312.1.3), ½ in cables `slatGap` apart, or horizontal
 * boards `slatGap` apart. `startPost` / `endPost` false leave that end's
 * post out so the rails die into a post already standing there (a porch's
 * 6x6); `postThrough` runs the posts past the cap with a cap of their own.
 */
export const FenceStyle = z.enum(['slat', 'rail', 'privacy', 'horizontal', 'guard', 'picket'])
/**
 * 'grounded' — a kickboard on the ground; 'floating' — no base, the panel
 * held `groundClearance` up on posts that reach the ground; 'raised' — the
 * base is a BOTTOM RAIL held `groundClearance` above the ground with the
 * infill ending on it, the posts to the ground: a deck guard (IRC R312 —
 * pickets between a top and a bottom rail, the gap under the rail below 4 in).
 */
export const FenceBaseStyle = z.enum(['floating', 'grounded', 'raised'])
