import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

const finiteNumber = z.number().finite()
const vector3Array = z
  .array(finiteNumber)
  .refine((values) => values.length % 3 === 0, 'Expected XYZ triples')

export const ImportedMeshPrimitive = z.object({
  positions: vector3Array,
  normals: vector3Array.optional(),
  indices: z.array(z.number().int().nonnegative()).default([]),
  color: z.string().default('#94a3b8'),
  opacity: z.number().min(0).max(1).default(1),
})

export type ImportedMeshPrimitive = z.infer<typeof ImportedMeshPrimitive>

/** Triangle geometry retained when an import has no native Pascal shape. */
export const ImportedMeshNode = BaseNode.extend({
  id: objectId('imesh'),
  type: nodeType('imported-mesh'),
  position: z.tuple([finiteNumber, finiteNumber, finiteNumber]).default([0, 0, 0]),
  rotation: z.tuple([finiteNumber, finiteNumber, finiteNumber]).default([0, 0, 0]),
  primitives: z.array(ImportedMeshPrimitive).default([]),
}).describe(
  dedent`
  Imported mesh node - triangle geometry preserved from an external model
  - position / rotation: transform in the parent coordinate system
  - primitives: indexed triangle buffers in meters with source display colors
  - metadata: source-format identity and properties
  `,
)

export type ImportedMeshNode = z.infer<typeof ImportedMeshNode>
