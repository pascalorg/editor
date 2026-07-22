import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

export const StructuralGridNode = BaseNode.extend({
  id: objectId('structural-grid'),
  type: nodeType('structural-grid'),
  start: z.tuple([z.number(), z.number()]).default([0, 0]),
  end: z.tuple([z.number(), z.number()]).default([0, 5]),
  label: z.string().trim().min(1).max(12).default('1'),
  showStartBubble: z.boolean().default(true),
  showEndBubble: z.boolean().default(true),
}).describe(
  dedent`
  Structural grid node - a persistent floor-plan datum axis with identification bubbles
  - start/end: level-local plan coordinates defining the grid axis extent
  - label: axis identifier, commonly numeric in one direction and alphabetic in the other
  - showStartBubble/showEndBubble: independently control the two endpoint identifiers
  `,
)

export type StructuralGridNode = z.infer<typeof StructuralGridNode>
