import type { PluginAgentTools } from '@pascal-app/core/agent-tools'
import { z } from 'zod'

const metres = (label: string, positive = false) =>
  (positive ? z.number().finite().positive() : z.number().finite()).describe(`${label} in metres.`)

export const wallFeatureAgentTools = {
  pluginId: 'pascal:core',
  apiVersion: 1,
  version: '1.0.0',
  tools: [
    {
      name: 'pascal_create_wall_feature',
      title: 'Create wall niche or bump',
      description:
        'Create a rectangular niche or bump on a straight solid wall, or a niche hosted by a wall-owned bump. Coordinates and dimensions are metres: u is measured from wall.start on a wall host, or from the bump lower-u edge on a bump host. A wall host defaults to face a; a bump host inherits its face. Refused when the feature does not fit, overlaps an unrelated feature, or leaves less than 0.02 m of wall backing.',
      input: {
        hostId: z.string().min(1).describe('ID of the wall or bump that will own the feature.'),
        mode: z.enum(['niche', 'bump']),
        face: z.enum(['a', 'b']).optional().describe('Wall face; omitted for a bump host.'),
        u: metres('Horizontal centre station from the host start'),
        bottom: z
          .number()
          .finite()
          .min(0)
          .describe('Bottom elevation above the host base in metres.'),
        width: metres('Feature width', true),
        height: metres('Feature height', true),
        depth: metres('Feature depth', true),
        finishRef: z
          .string()
          .min(1)
          .optional()
          .describe('Optional scene or library finish reference.'),
      },
      runsIn: 'operation',
    },
    {
      name: 'pascal_update_wall_feature',
      title: 'Update wall niche or bump',
      description:
        'Update a wall feature using the same fit, overlap, nesting, and backing rules as manual editing. Omitted fields stay unchanged; set finishRef to null to clear its finish override and inherit from the nearest host.',
      input: {
        featureId: z.string().min(1),
        mode: z.enum(['niche', 'bump']).optional(),
        face: z.enum(['a', 'b']).optional(),
        u: metres('Horizontal centre station from the host start').optional(),
        bottom: z
          .number()
          .finite()
          .min(0)
          .describe('Bottom elevation above the host base in metres.')
          .optional(),
        width: metres('Feature width', true).optional(),
        height: metres('Feature height', true).optional(),
        depth: metres('Feature depth', true).optional(),
        finishRef: z.string().min(1).nullable().optional(),
      },
      runsIn: 'operation',
    },
  ],
} satisfies PluginAgentTools
