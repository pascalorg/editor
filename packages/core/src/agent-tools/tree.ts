import { z } from 'zod'
import { TREE_FORMS, TREE_LIMITS } from '../schema/nodes/tree-limits'
import { measurement } from './measurement'
import { NodeId } from './node-id'

const coordinate = measurement('length', 'm', {
  min: -TREE_LIMITS.maxCoordinate,
  max: TREE_LIMITS.maxCoordinate,
})
const fields = {
  form: z.enum(TREE_FORMS).optional().describe('Crown habit, default round.'),
  heightM: measurement('length', 'm', { min: TREE_LIMITS.minHeight, max: TREE_LIMITS.maxHeight })
    .optional()
    .describe('Mature height, default 8 metres.'),
  spreadM: measurement('length', 'm', { min: TREE_LIMITS.minSpread, max: TREE_LIMITS.maxSpread })
    .optional()
    .describe('Crown width; omitted follows the resolved form and height.'),
  foliage: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional()
    .describe('Foliage colour #rrggbb, default #609343; autumn and blossom tones are allowed.'),
  density: z
    .number()
    .finite()
    .min(0)
    .max(1)
    .optional()
    .describe('Leaf density, default 0.85; zero retains only winter wood.'),
  seed: z
    .number()
    .int()
    .min(-2147483648)
    .max(2147483647)
    .optional()
    .describe('Fixed signed 32-bit seed; shared default 1 derives a distinct seed per tree.'),
}

export const addTreeTool = {
  name: 'add_tree',
  title: 'Add trees',
  description:
    'Add one to forty seeded procedural trees in one call, each stored as a compact Site child. Shared defaults apply unless an individual tree overrides them. at is [x, z] in Site metres; buildingId converts from that building’s plan frame. Bases follow persisted Site terrain and ground-storey slabs. All refusals precede writes: invalid_input, no_site, ambiguous_site, building_not_found, building_site_mismatch, tree_transform_unsupported for a tipped building frame, and tree_inside_building for a trunk anchor inside a building footprint. Crowns may overlap roofs or cross the lot line: these are reports, not refusals. Returns count, heights, sum of nominal crown-disc areas (not their union or leaf area), nearest trunk-anchor distance to a modelled building footprint, and per-tree reports. Roof overlap is tested in plan against native covering surfaces before accessory/inter-roof cuts. No geometry or per-branch nodes are stored.',
  input: {
    siteId: NodeId.optional().describe('Owning Site; omit when the scene has exactly one.'),
    buildingId: NodeId.optional().describe('Read all at points in this building’s plan frame.'),
    name: z.string().min(1).max(120).optional(),
    ...fields,
    trees: z
      .array(
        z.strictObject({
          at: z.tuple([coordinate, coordinate]).describe('Trunk anchor [x, z] in metres.'),
          ...fields,
        }),
      )
      .min(1)
      .max(TREE_LIMITS.maxTrees),
  },
}
