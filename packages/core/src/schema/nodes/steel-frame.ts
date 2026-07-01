import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

export const SteelFrameStyle = z.enum([
  'pipe-rack',
  'equipment-platform',
  'portal-frame',
  'tower-frame',
])

export const SteelFrameBraceStyle = z.enum(['single-diagonal', 'knee', 'none'])

export const SteelFrameNode = BaseNode.extend({
  id: objectId('steel-frame'),
  type: nodeType('steel-frame'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  style: SteelFrameStyle.default('pipe-rack'),
  braceStyle: z.preprocess(
    (value) => (value === 'x' ? 'single-diagonal' : value),
    SteelFrameBraceStyle.default('single-diagonal'),
  ),
  length: z.number().default(6),
  width: z.number().default(2.4),
  height: z.number().default(4.5),
  levels: z.number().int().min(1).max(8).default(2),
  columns: z.number().int().min(2).max(12).default(4),
  rows: z.number().int().min(2).max(6).default(2),
  memberSize: z.number().default(0.14),
  braceSize: z.number().default(0.06),
  deckThickness: z.number().default(0.08),
  color: z.string().default('#ffffff'),
  deckColor: z.string().default('#f8fafc'),
}).describe(
  dedent`
  Steel frame node - editable industrial outdoor steel frame.
  - style: pipe rack, equipment platform, portal frame, or tower frame.
  - levels/columns/rows control the repeated vertical tiers and column grids.
  - length/width/height/memberSize/braceSize/deckThickness reuse the positioned parametric-item editing pattern.
  `,
)

export type SteelFrameNode = z.infer<typeof SteelFrameNode>
export type SteelFrameStyle = z.infer<typeof SteelFrameStyle>
export type SteelFrameBraceStyle = z.infer<typeof SteelFrameBraceStyle>
