import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

const PlanPoint = z.tuple([z.number(), z.number()])

/** What a foundation outline pours: the building's own foundation, or a slab or raised floor of its own. */
export const FoundationConstructionChoice = z.enum(['building', 'slab', 'raised'])
export type FoundationConstructionChoice = z.infer<typeof FoundationConstructionChoice>

export const FoundationNode = BaseNode.extend({
  id: objectId('foundation'),
  type: nodeType('foundation'),
  polygon: z.array(PlanPoint).default([]),
  construction: FoundationConstructionChoice.default('building'),
  drop: z.number().min(0).default(0),
}).describe(
  dedent`
  Foundation node - an outline a building's foundation is poured to, on its lowest level, in place
  of the one traced from its exterior walls; every size comes from the building's foundation record
  (metadata.foundation), never stored here
  - polygon: the outline's corners, level-local plan points, at the foundation's outside face
  - construction: 'building' pours what the record says (slab, raised floor, piles); 'slab' or
    'raised' pours that whatever the house stands on (a porch slab beside a raised house)
  - drop: its top this far under the floor of its level, metres (a porch a step down)
  `,
)

export type FoundationNode = z.infer<typeof FoundationNode>
