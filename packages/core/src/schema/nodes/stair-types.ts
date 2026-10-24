import { z } from 'zod'

// Stair railing enums, in a file with no other dependency: agent tool contracts validate against
// them without loading the node schemas.

export const StairRailingMode = z.enum(['none', 'left', 'right', 'both'])
export type StairRailingMode = z.infer<typeof StairRailingMode>

/**
 * How a straight flight's guard is built: 'balusters' — the round baluster
 * at every nosing with two round rails (the original); 'post-and-rail' —
 * the way a deck stair is built: 4x4 posts no more than 4 ft apart (two on a
 * short flight), a top rail and a bottom rail following the flight, 1½ in
 * pickets between them at a 4 in-sphere gap (IRC R312.1.3); 'cable' — slim 2 in
 * posts spaced by run under a flat cap rail, with slender round cables 3 in
 * apart pulled as straight spans from post to post and a swage sleeve at each
 * terminal post (the modern cable rail; the cap follows a curve but the taut
 * cables span straight between the posts).
 */
export const StairRailingStyle = z.enum([
  'balusters',
  'post-and-rail',
  'cable',
  'boards',
  'glass',
  'metal',
])
export type StairRailingStyle = z.infer<typeof StairRailingStyle>
