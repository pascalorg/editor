import { z } from 'zod'

/** Opening kinds, in a file with no other dependency: facade units and agent tool contracts
 * validate against them without loading the node schemas. */
export const DoorType = z.enum([
  'hinged',
  'double',
  'french',
  'folding',
  'pocket',
  'barn',
  'sliding',
  'garage-sectional',
  'garage-rollup',
  'garage-tiltup',
])
export type DoorType = z.infer<typeof DoorType>

export const WindowType = z.enum([
  'fixed',
  'sliding',
  'casement',
  'awning',
  'hopper',
  'single-hung',
  'double-hung',
  'bay',
  'bow',
  'louvered',
])
export type WindowType = z.infer<typeof WindowType>
