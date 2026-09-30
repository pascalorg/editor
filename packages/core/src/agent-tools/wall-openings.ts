import { z } from 'zod'
import { DOOR_STYLES, WINDOW_STYLES } from '../building/opening-style-presets'
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
      'Place it even where it overlaps another door, window or wall item, like holding Alt in the editor.',
    ),
}

export const addDoorTool = {
  name: 'add_door',
  title: 'Add door',
  description:
    'Add a door to an existing straight wall at t (0..1 along it). The door slides to stay on the wall and reports clamped. Refused with a code, as in the editor: curved walls, walls shorter than the door, and overlapping another door, window or wall item unless force is set.',
  input: {
    wallId: NodeId.describe('The wall to add the door to.'),
    ...placement,
    width: measurement('length', 'm', {
      positive: true,
      description: 'Door width (default 0.9 m).',
    }).optional(),
    height: measurement('length', 'm', {
      positive: true,
      description: 'Door height (default 2.1 m).',
    }).optional(),
    hingesSide: z.enum(['left', 'right']).optional().describe('Hinge side (default left).'),
    swingDirection: z
      .enum(['inward', 'outward'])
      .optional()
      .describe('Which way the door opens (default inward).'),
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
    "Add a window to an existing straight wall at t (0..1 along it), on sillHeight above the floor. It slides to stay on the wall and under the wall's ceiling, and reports clamped. Refused with a code, as in the editor: curved walls, walls shorter than the window, and overlapping another door, window or wall item unless force is set.",
  input: {
    wallId: NodeId.describe('The wall to add the window to.'),
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
    style: z
      .enum(WINDOW_STYLES)
      .optional()
      .describe(
        'Visual preset (panes only, never the size); same presets as create_room windows[].',
      ),
  },
}
