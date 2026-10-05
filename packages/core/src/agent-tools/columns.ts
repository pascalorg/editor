import { z } from 'zod'
import { scriptParams } from './add-object'
import { measurement } from './measurement'
import { NodeId } from './node-id'

export const addColumnTool = {
  name: 'add_column',
  title: 'Add column',
  description:
    'Add a structural or decorative column at (x, z), or rebuild one by nodeId. Native fields first; optional code uses the same module and conventions as add_object, with floor mount and its bottom centre at the support point. Params named height, width and depth drive the native size controls. Only add columns when requested.',
  input: {
    x: z.number().optional().describe('X position of the column center (meters)'),
    z: z.number().optional().describe('Z position of the column center (meters)'),
    height: measurement('length', 'm', {
      positive: true,
      description: 'Column height (default: 2.5).',
    }).optional(),
    radius: measurement('length', 'm', {
      positive: true,
      description: 'Radius when crossSection is "round" (default: 0.22).',
    }).optional(),
    width: measurement('length', 'm', {
      positive: true,
      description: 'Width when crossSection is "square" / "rectangular" (default: 0.44).',
    }).optional(),
    depth: measurement('length', 'm', {
      positive: true,
      description: 'Depth when crossSection is "square" / "rectangular" (default: 0.44).',
    }).optional(),
    rotation: measurement('angle', 'deg', {
      description: 'Y-axis rotation (default: 0).',
    }).optional(),
    style: z
      .enum(['plain', 'faceted', 'fluted', 'lathe-turned', 'dravidian-carved', 'cluster'])
      .optional()
      .describe(
        "Visual style: 'plain' (default smooth pillar), 'faceted' (sharp prism faces), 'fluted' (vertical channels — classical), 'lathe-turned' (turned bands — porch / interior), 'dravidian-carved' (heavy carving — temple), 'cluster' (bundled colonnette — gothic).",
      ),
    crossSection: z
      .enum(['round', 'square', 'rectangular', 'octagonal', 'sixteen-sided'])
      .optional()
      .describe(
        "Plan shape: 'round' (default), 'square' (equal width/depth), 'rectangular' (independent width/depth), 'octagonal', 'sixteen-sided'.",
      ),
    level: z
      .string()
      .optional()
      .describe('Level id from list_levels; omitted uses the viewed or lowest level.'),
    y: z
      .number()
      .optional()
      .describe('Support point height above the level, in metres (default 0).'),
    name: z.string().optional(),
    nodeId: NodeId.optional().describe(
      'Rebuild this column with code, params or native size fields; get_source first when changing code.',
    ),
    code: z
      .string()
      .min(1)
      .max(48_000)
      .optional()
      .describe(
        'A three.js module when the native fields cannot express the column. Same module and conventions as add_object; mount floor. Declare height, width and depth params for editable dimensions.',
      ),
    params: scriptParams,
  },
}
