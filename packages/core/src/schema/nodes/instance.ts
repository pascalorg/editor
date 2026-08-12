import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import type { DefinitionId } from '../definitions'

export const InstanceNode = BaseNode.extend({
  id: objectId('instance'),
  type: nodeType('instance'),
  definitionId: z.custom<DefinitionId>(
    (value) => typeof value === 'string' && value.startsWith('definition_'),
    'Instance definition id must start with "definition_"',
  ),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  scale: z.tuple([z.number(), z.number(), z.number()]).default([1, 1, 1]),
})

export type InstanceNode = z.infer<typeof InstanceNode>
export type InstanceNodeId = InstanceNode['id']
