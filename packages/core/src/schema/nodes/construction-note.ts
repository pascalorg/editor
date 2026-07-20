import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

export const ConstructionNoteTerminator = z.enum(['arrow', 'dot', 'none'])
export const ConstructionNoteLeaderStyle = z.enum(['straight', 'curved'])

export const ConstructionNoteNode = BaseNode.extend({
  id: objectId('construction-note'),
  type: nodeType('construction-note'),
  anchor: z.tuple([z.number(), z.number()]).default([0, 0]),
  textPosition: z.tuple([z.number(), z.number()]).default([1.5, 0.75]),
  text: z.string().trim().min(1).default('CONSTRUCTION NOTE'),
  terminator: ConstructionNoteTerminator.default('arrow'),
  leaderStyle: ConstructionNoteLeaderStyle.default('straight'),
  curveControl: z.tuple([z.number().min(0.1).max(0.9), z.number()]).default([0.5, 0.35]),
  shoulderLength: z.number().min(0.15).max(3).default(0.55),
  targetId: z.string().nullable().default(null),
  targetOffset: z.tuple([z.number(), z.number()]).default([0, 0]),
}).describe(
  dedent`
  Construction note node - a floor-plan annotation with an associative straight or curved leader
  - anchor: absolute fallback/free target in level-local plan coordinates
  - textPosition: plan position of the multiline note block
  - targetId/targetOffset: optional attachment that follows a referenced scene node
  - terminator: arrow, dot, or no leader terminator
  - leaderStyle: straight or quadratic curved leader
  - curveControl: chord fraction and perpendicular offset for the on-curve leader handle
  `,
)

export type ConstructionNoteLeaderStyle = z.infer<typeof ConstructionNoteLeaderStyle>
export type ConstructionNoteTerminator = z.infer<typeof ConstructionNoteTerminator>
export type ConstructionNoteNode = z.infer<typeof ConstructionNoteNode>
