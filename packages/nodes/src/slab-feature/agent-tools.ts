import type { PluginAgentTools } from '@pascal-app/core/agent-tools'
import { z } from 'zod'

const scalar = z.number().finite()
const dimension = scalar.positive()
export const slabFeatureAgentTools = {
  pluginId: 'pascal:core',
  apiVersion: 1,
  version: '1.0.0',
  tools: [
    {
      name: 'pascal_create_slab_feature',
      title: 'Create slab niche or bump',
      description:
        'Create a rectangular top-face niche or bump, or a niche inside a slab bump. x/z are centre offsets in metres from the slab first polygon vertex, or from the centre of a parent bump. Width is along X, length along Z, depth is vertical. Requires full slab containment, no unrelated overlap, and 0.02 m of backing. Pool shells are unsupported.',
      input: {
        hostId: z.string().min(1),
        mode: z.enum(['niche', 'bump']),
        x: scalar,
        z: scalar,
        width: dimension,
        length: dimension,
        depth: dimension,
        finishRef: z.string().min(1).optional(),
      },
      runsIn: 'operation',
    },
    {
      name: 'pascal_update_slab_feature',
      title: 'Update slab niche or bump',
      description:
        'Update a slab feature using the same placement and backing rules as manual edits. Omitted fields stay unchanged; finishRef null restores inherited paint.',
      input: {
        featureId: z.string().min(1),
        mode: z.enum(['niche', 'bump']).optional(),
        x: scalar.optional(),
        z: scalar.optional(),
        width: dimension.optional(),
        length: dimension.optional(),
        depth: dimension.optional(),
        finishRef: z.string().min(1).nullable().optional(),
      },
      runsIn: 'operation',
    },
  ],
} satisfies PluginAgentTools
