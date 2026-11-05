import { z } from 'zod'
import { DOOR_STYLES, WINDOW_STYLES } from '../building/opening-style-presets'
import { geometryMetaFields } from '../schema/geometry-metadata'
import { DoorHandleStyle, DoorType, WindowType } from '../schema/nodes/opening-types'
import { achievedOutput } from './achieved'
import { scriptLanguage, scriptParams } from './add-object'
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
      `An optional module (three.js, or bpy with language) for a ${kind} (a fan grille, tracery, carved trim): the same module and conventions as add_object, with mount 'wall'. Its size is what it builds (name params width and height so the ${kind}'s size controls edit them), and its cutout mesh cuts the wall. Make it open like a real ${kind}: add an \`open\` clip (${kind === 'door' ? 'the leaves swinging or sliding' : 'the sash sliding or swinging'}; \`close\` is optional, \`open\` reversed by default) unless it is fixed. Native fields and code are available to express the requested shape.`,
    ),
  language: scriptLanguage,
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

export const doorDetailFields = {
  sidelightLeft: measurement('length', 'm', {
    min: 0,
    description: 'Fixed glazed light left of a swing leaf, metres; absent or 0 means none.',
  }).optional(),
  sidelightRight: measurement('length', 'm', {
    min: 0,
    description: 'Fixed glazed light right of a swing leaf, metres; absent or 0 means none.',
  }).optional(),
  transomHeight: measurement('length', 'm', {
    min: 0,
    description:
      'Fixed light above a swing door and its sidelights, metres; absent or 0 means none. The full cutout must fit under the wall top (wall_too_low).',
  }).optional(),
  leafCount: z
    .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(6), z.literal(8)])
    .optional()
    .describe('Panel count: sliding 2–4; folding 2, 4, 6 or 8.'),
  slidingStyle: z
    .enum(['patio', 'bypass'])
    .optional()
    .describe('Sliding family: patio (default) or two-track bypass closet.'),
  slideDirection: z.enum(['left', 'right']).optional(),
}

export const addDoorTool = {
  name: 'add_door',
  title: 'Add door',
  description:
    'Add a door to an existing straight wall at t (0..1 along it), or a passage with no leaf (openingKind opening: a cased opening, an arch). The door slides to stay on the wall and reports clamped. On a railing (wallType railing) it is a gap in the guard as tall as the railing, with no leaf, casing or threshold. Refused with a code, as in the editor: curved walls, walls shorter than the door, and overlapping another door, window or wall item unless force is set. Match the reference with the outline (rectangle, rounded, arch), doorType and style; what they cannot express (glass strips, a pattern of lites, carved panels) is written as a script in code, never left as not possible. Not available in run_batch: the host opening executor prepares scripted creation and rebuilds, which a batch does not prepare.',
  input: {
    wallId: NodeId.optional().describe('The wall to add the door to.'),
    nodeId: NodeId.optional().describe(
      'Rebuild this door instead of adding one: new code and/or params (get_source provides current code when needed). Its native fields change with update_node.',
    ),
    ...placement,
    ...doorDetailFields,
    width: measurement('length', 'm', {
      positive: true,
      description: 'Door width (default 0.9 m).',
    }).optional(),
    height: measurement('length', 'm', {
      positive: true,
      description: 'Door height (default 2.1 m).',
    }).optional(),
    sillHeight: measurement('length', 'm', {
      description:
        "Rarely needed: the door's bottom above the floor the wall stands on (default 0, on the floor). Negative reaches below that floor, down to the wall's bottom, where the wall goes down beside a floor sunk under it (a garage below the house, a step in the terrain): a garage door filling its doorway down to the garage floor. It stays between the wall's bottom and its ceiling, and reports clamped.",
    }).optional(),
    openingKind: z
      .enum(['door', 'opening'])
      .optional()
      .describe(
        "door (default), or opening: a passage with no leaf, framed or arched by the outline, as the editor's door panel offers.",
      ),
    hingesSide: z.enum(['left', 'right']).optional().describe('Hinge side (default left).'),
    handleStyle: DoorHandleStyle.optional().describe(
      'Door handle: lever (default), lever-curved, knob, bar, or plate.',
    ),
    handleSide: z
      .enum(['left', 'right'])
      .optional()
      .describe('Handle side (default: opposite the hinges).'),
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

/** Native window details shared by every window authoring contract. */
export const windowDetailFields = {
  hingesSide: z
    .enum(['left', 'right'])
    .optional()
    .describe('Casement or tilt-turn side hinges (default left).'),
  openingDirection: z
    .enum(['outward', 'inward'])
    .optional()
    .describe(
      'Casement or awning swing toward exterior or interior, independent of placement (new windows default outward). Ignored by hopper and tilt-turn, which open inward.',
    ),
  tiltTurnMode: z
    .enum(['tilt', 'turn'])
    .optional()
    .describe(
      'Tilt-turn only: tilt inward about the bottom up to 15 degrees (default), or turn inward about the side hinges up to 90 degrees.',
    ),
  rollerShutter: z
    .enum(['none', 'box', 'concealed'])
    .optional()
    .describe(
      'Roller mount (default none): box on the exterior face above the opening, or concealed with a 0.03 m lintel strip and 0.025 x 0.03 m guides inside the reveal. Concealed curtain sits 0.02 m outside the frame plane, width minus 0.05 m.',
    ),
  rollerShutterBoxHeight: measurement('length', 'm', {
    positive: true,
    description: 'Exterior roller box height (default 0.18 m); used only by the box mount.',
  }).optional(),
  rollerShutterOpen: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe(
      'Static roller curtain position: 0 down, 1 fully up (default 1), independent of operationState.',
    ),
  shutterOpen: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe(
      'Exterior shutter position: 0 closed over the window, 1 open (default 1). Leaves over 0.75 m fold into two stacked halves; narrower leaves open flat against the wall.',
    ),
  shutterSides: z
    .enum(['both', 'left', 'right'])
    .optional()
    .describe('Which exterior shutter leaves to build (default both).'),
  sillOverhang: measurement('length', 'm', {
    min: 0,
    description: 'Exterior sill extension on each side; default 0.4 times sillDepth.',
  }).optional(),
  sillInteriorDepth: measurement('length', 'm', {
    positive: true,
    description: 'Interior stool depth (default 0.06 m).',
  }).optional(),
  sillInteriorThickness: measurement('length', 'm', {
    positive: true,
    description: 'Interior stool thickness (default 0.03 m).',
  }).optional(),
  sillInteriorOverhang: measurement('length', 'm', {
    min: 0,
    description: 'Interior stool extension beyond casing on each side (default 0.015 m).',
  }).optional(),
  columns: z
    .number()
    .int()
    .min(1)
    .max(12)
    .optional()
    .describe(
      "Panes across each operable sash (the whole fixed window), equal widths; overrides the style's panes.",
    ),
  rows: z
    .number()
    .int()
    .min(1)
    .max(12)
    .optional()
    .describe(
      "Panes up each operable sash (the whole fixed window), equal heights; overrides the style's panes.",
    ),
  windowHandle: z.boolean().optional().describe('Show the interior sash handle (default true).'),
  sashGrid: z
    .boolean()
    .optional()
    .describe('Pane grid per operable sash (default false; columns or rows enable it).'),
  sillInterior: z
    .boolean()
    .optional()
    .describe('Add a stool board on the room side (default false).'),
  shutters: z
    .enum(['none', 'louvered', 'panel', 'board-batten'])
    .optional()
    .describe(
      'Exterior shutters (default none), with a 10 mm overlap lip on one leaf when both sides are present.',
    ),
  shutterWidth: measurement('length', 'm', {
    positive: true,
    description:
      'Width per side, uncapped: defaults to half the opening for both sides, full opening for left or right only. Widths over 0.75 m form a bifold pair of equal halves.',
  }).optional(),
}

export const addWindowTool = {
  name: 'add_window',
  title: 'Add window',
  description:
    "Add a window to an existing straight wall at t (0..1 along it), centred vertically on the wall, or on sillHeight above the floor when given. It slides to stay on the wall and under the wall's ceiling, and reports clamped. Refused with a code, as in the editor: curved walls, railings (railing_window: a railing takes a door, a gap in its guard), walls shorter than the window, overlapping another door, window or wall item unless force is set, and a style on a window that is not Fixed (style_needs_fixed_window). Match the reference with the outline (rectangle, rounded, arch), windowType and panes (columns × rows, or a style); what they cannot express (glass strips, leaded lites, a feature frame) is written as a script in code, never left as not possible. Not available in run_batch: the host opening executor prepares scripted creation and rebuilds, which a batch does not prepare.",
  input: {
    wallId: NodeId.optional().describe('The wall to add the window to.'),
    nodeId: NodeId.optional().describe(
      'Rebuild this window instead of adding one: new code and/or params (get_source provides current code when needed). Its native fields change with update_node.',
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
      description:
        'Height from the floor to the bottom of the window (default: centred vertically on the wall).',
    }).optional(),
    ...outline('0.35 m'),
    ...script('window'),
    windowType: WindowType.optional().describe('How it opens (default fixed).'),
    ...windowDetailFields,
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

export const addDoorOutput = {
  doorId: z.string(),
  ...openingOutput,
  sillHeight: z.number().optional(),
}

export const addWindowOutput = {
  windowId: z.string(),
  ...openingOutput,
  sillHeight: z.number().optional(),
}
