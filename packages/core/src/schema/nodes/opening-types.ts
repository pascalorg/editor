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

/** A new door's leaf, two raised panels stacked: the Panel style, fresh on every call. */
export const defaultDoorSegments = () => [
  {
    type: 'panel' as const,
    heightRatio: 0.4,
    columnRatios: [1],
    dividerThickness: 0.03,
    panelDepth: 0.01,
    panelInset: 0.04,
  },
  {
    type: 'panel' as const,
    heightRatio: 0.6,
    columnRatios: [1],
    dividerThickness: 0.03,
    panelDepth: 0.01,
    panelInset: 0.04,
  },
]

/** A new door's leaf margin [x, y] (m). */
export const DEFAULT_DOOR_CONTENT_PADDING: [number, number] = [0.04, 0.04]

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
