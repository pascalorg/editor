import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import {
  CASTABLE_FIELD_DOCS,
  CastableFields,
  SHUTTERING_FIELD_DOCS,
  ShutteringFields,
} from '../formwork'
import { MaterialSchema } from '../material'
import { ConstructionJointNode } from './construction-joint'
import { FormworkAssemblyNode } from './formwork-assembly'

export const BeamNode = BaseNode.extend({
  id: objectId('beam'),
  type: nodeType('beam'),
  children: z
    .array(z.union([FormworkAssemblyNode.shape.id, ConstructionJointNode.shape.id]))
    .default([]),
  material: MaterialSchema.optional(),
  // Centreline, in the level's X/Z plane — the same convention a wall runs on,
  // because a beam's two side shutters are a short wall lying on its side.
  start: z.tuple([z.number(), z.number()]),
  end: z.tuple([z.number(), z.number()]),
  /** The horizontal dimension across the centreline, m — the core the side shutters span. */
  width: z.number().positive().default(0.3),
  /** The vertical dimension, m — the height of the two side shutters. */
  depth: z.number().positive().default(0.6),
  /** The soffit's height above the floor it is propped off, m — the prop length driver. */
  elevation: z.number().nonnegative().default(3),
  ...ShutteringFields,
  ...CastableFields,
}).describe(
  dedent`
  Beam node - a horizontal castable element: two side shutters tied across the width, a soffit under it propped off the floor below, and a stop-end at each end
  - start/end: centreline endpoints in the level's X/Z plane, the wall convention
  - width: the dimension across the centreline, m
  - depth: the vertical dimension, m — how tall the side shutters are
  - elevation: the soffit's height above the floor it is propped off, m
  ${SHUTTERING_FIELD_DOCS}
  ${CASTABLE_FIELD_DOCS}
`,
)

export type BeamNode = z.infer<typeof BeamNode>
