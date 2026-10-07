import { z } from 'zod'
import { DOOR_STYLES, WINDOW_STYLES } from '../building/opening-style-presets'
import { geometryMetaFields } from '../schema/geometry-metadata'
import { DoorType, WindowType } from '../schema/nodes/opening-types'
import { achievedOutput } from './achieved'
import { scriptParams } from './add-object'
import { measurement } from './measurement'
import { NodeId } from './node-id'

const placement = {
  t: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe('Position along the wall, 0..1: 0 = start, 0.5 = centre, 1 = end.'),
  position: z.number().min(0).max(1).optional().describe('Same as t.'),
  force: z
    .boolean()
    .optional()
    .describe(
      'Place it even where it overlaps another door, window or wall item, like holding Alt in the editor. Only when the person asks for the overlap.',
    ),
}

const script = (kind: string) => ({
  code: z
    .string()
    .min(1)
    .max(48_000)
    .optional()
    .describe(
      `A three.js module for a ${kind} the fields cannot express (a fan grille, tracery, carved trim): the same module and conventions as add_object, with mount 'wall'. Its size is what it builds (name params width and height so the ${kind}'s size controls edit them), and its cutout mesh cuts the wall. Make it open like a real ${kind}: add an \`open\` clip (${kind === 'door' ? 'the leaves swinging or sliding' : 'the sash sliding or swinging'}; \`close\` is optional, \`open\` reversed by default) unless it is fixed. Fields first; code only beyond them.`,
    ),
  params: scriptParams,
  ...geometryMetaFields,
})

const outline = (archDefault: string) => ({
  openingShape: z
    .enum(['rectangle', 'rounded', 'arch'])
    .optional()
    .describe(
      'Outline of the opening: rectangle (default), rounded top corners, or arch (round top).',
    ),
  archHeight: measurement('length', 'm', {
    positive: true,
    description: `Rise of the arch above its straight sides, within height (arch only; default ${archDefault}).`,
  }).optional(),
  cornerRadius: measurement('length', 'm', {
    positive: true,
    description: 'Radius of the rounded top corners (rounded only; default 0.15 m).',
  }).optional(),
})

export const addDoorTool = {
  name: 'add_door',
  title: 'Add door',
  description:
    'Add a door to an existing straight wall at t (0..1 along it), or a passage with no leaf (openingKind opening: a cased opening, an arch). The door slides to stay on the wall and reports clamped. Refused with a code, as in the editor: curved walls, walls shorter than the door, and overlapping another door, window or wall item unless force is set. Match the reference with the outline (rectangle, rounded, arch), doorType and style; what they cannot express (glass strips, a pattern of lites, carved panels) is written as a script in code, never left as not possible.',
  input: {
    wallId: NodeId.optional().describe('The wall to add the door to.'),
    nodeId: NodeId.optional().describe(
      'Rebuild this door instead of adding one: new code and/or params (get_source first to change its code). Its native fields change with update_node.',
    ),
    ...placement,
    width: measurement('length', 'm', {
      positive: true,
      description: 'Door width (default 0.9 m).',
    }).optional(),
    height: measurement('length', 'm', {
      positive: true,
      description: 'Door height (default 2.1 m).',
    }).optional(),
    openingKind: z
      .enum(['door', 'opening'])
      .optional()
      .describe(
        "door (default), or opening: a passage with no leaf, framed or arched by the outline, as the editor's door panel offers.",
      ),
    hingesSide: z.enum(['left', 'right']).optional().describe('Hinge side (default left).'),
    swingDirection: z
      .enum(['inward', 'outward'])
      .optional()
      .describe('Which way the door opens (default inward).'),
    ...outline('0.45 m'),
    ...script('door'),
    doorType: DoorType.optional().describe(
      'How it opens (default hinged); garage types for garage doors.',
    ),
    style: z
      .enum(DOOR_STYLES)
      .optional()
      .describe(
        'Visual preset (panels only, never the size); same presets as create_room doors[].',
      ),
  },
}

export const addWindowTool = {
  name: 'add_window',
  title: 'Add window',
  description:
    "Add a window to an existing straight wall at t (0..1 along it), on sillHeight above the floor. It slides to stay on the wall and under the wall's ceiling, and reports clamped. Refused with a code, as in the editor: curved walls, walls shorter than the window, overlapping another door, window or wall item unless force is set, and a style on a window that is not Fixed (style_needs_fixed_window). Match the reference with the outline (rectangle, rounded, arch), windowType and panes (columns × rows, or a style); what they cannot express (glass strips, leaded lites, a feature frame) is written as a script in code, never left as not possible.",
  input: {
    wallId: NodeId.optional().describe('The wall to add the window to.'),
    nodeId: NodeId.optional().describe(
      'Rebuild this window instead of adding one: new code and/or params (get_source first to change its code). Its native fields change with update_node.',
    ),
    ...placement,
    width: measurement('length', 'm', {
      positive: true,
      description: 'Window width (default 1.5 m).',
    }).optional(),
    height: measurement('length', 'm', {
      positive: true,
      description: 'Window height (default 1.5 m).',
    }).optional(),
    sillHeight: measurement('length', 'm', {
      min: 0,
      description: 'Height from the floor to the bottom of the window (default 0.9 m).',
    }).optional(),
    ...outline('0.35 m'),
    ...script('window'),
    windowType: WindowType.optional().describe('How it opens (default fixed).'),
    columns: z
      .number()
      .int()
      .min(1)
      .max(12)
      .optional()
      .describe("Panes across, equal widths; overrides the style's panes."),
    rows: z
      .number()
      .int()
      .min(1)
      .max(12)
      .optional()
      .describe("Panes up, equal heights; overrides the style's panes."),
    style: z
      .enum(WINDOW_STYLES)
      .optional()
      .describe(
        "Visual preset of a Fixed window's panes (never the size); same presets as create_room windows[]. Fixed windows only: an operable window draws its own sashes.",
      ),
  },
}

/**
 * What add_door and add_window answer, on every surface: one result from the core operation, which
 * the MCP and the chat pass through as it is. `localX` is metres along the wall from its start.
 */
const openingOutput = {
  ok: z.literal(true),
  wallId: z.string(),
  localX: z.number(),
  t: z.number(),
  wallLength: z.number(),
  clamped: z.boolean(),
  coordinateSystem: z.literal('wall-local-meters'),
  message: z.string(),
  achieved: achievedOutput,
}

export const addDoorOutput = { doorId: z.string(), ...openingOutput }

export const addWindowOutput = {
  windowId: z.string(),
  ...openingOutput,
  sillHeight: z.number().optional(),
}
