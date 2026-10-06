import { z } from 'zod'
import { DOOR_STYLES, WINDOW_STYLES } from '../building/opening-style-presets'
import { levelTarget } from './levels'
import { measurement } from './measurement'

// A list of two, not a tuple: a tuple's list-form schema is refused by some clients.
const point = z.array(z.number()).length(2)

const onEdge = {
  wallIndex: z
    .number()
    .int()
    .min(0)
    .describe('The polygon edge it sits on: edge i runs from corner i to corner i + 1.'),
  t: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe('Position along that edge: 0 = its start, 1 = its end (default 0.5).'),
}

export const createRoomTool = {
  name: 'create_room',
  title: 'Create room',
  description:
    "Create a room on a level from its polygon: a wall per edge, an edge a wall already runs along reusing that wall (rooms share their boundary with their neighbour), and the room zone that names it. The floor plate and the ceiling are derived from the room — never author a slab or a ceiling for it. Declare the room's doors and windows in the same call by polygon edge (wallIndex) and t along it, no wall ids needed; each is placed with add_door's and add_window's rules, and one that cannot be is skipped and listed in skippedOpenings with its code. Returns zoneId, slabId, ceilingId, wallIds in edge order (null where no wall), doorIds, windowIds. outdoor: true draws a terrace instead: separators where no wall runs, no walls of its own and no ceiling.",
  input: {
    ...levelTarget,
    name: z.string().min(1).describe('Room name, e.g. "Bedroom", "Kitchen".'),
    polygon: z.array(point).min(3).describe('The corners in order, as [x, z] in metres.'),
    color: z.string().optional().describe('Hex colour of the room zone, e.g. "#3b82f6".'),
    wallHeight: measurement('length', 'm', {
      positive: true,
      description: "Height of the walls it builds (default: the storey's).",
    }).optional(),
    wallThickness: measurement('length', 'm', {
      positive: true,
      description: 'Thickness of the walls it builds.',
    }).optional(),
    outdoor: z
      .boolean()
      .optional()
      .describe(
        "true for an outdoor room (a terrace): closed with separators (the editor's Separator: a room boundary with no wall) where no wall runs, no walls of its own and no ceiling.",
      ),
    doors: z
      .array(
        z.object({
          ...onEdge,
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
              "Visual preset: 'panel' (default raised-panel), 'glass' (mostly glass), 'modern' (flush slab), 'paneled-glass' (glass top, panel bottom — an entry door), 'french' (two narrow glass leaves), 'shaker' (one flat panel), 'six-panel' (3 × 2 traditional grid), 'craftsman' (4 stacked vertical panels), 'half-louvered' (slats on top, panel below — closet, laundry), 'barn' (wide recessed panel). One style per room type across the home; the entry door may differ.",
            ),
        }),
      )
      .optional()
      .describe('The entry door and the doors to the rooms next to it.'),
    windows: z
      .array(
        z.object({
          ...onEdge,
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
              "Visual preset: 'single' (default single pane), 'double-hung', 'triple-hung' (stacked sashes), 'casement' (two panes side by side), 'sliding' (three side by side — wide), 'grid' (2 × 2), 'tall-grid' (2 × 3), 'wide-grid' (3 × 2), 'horizontal-bands' (4 stacked bands), 'transom' (a small row over a larger pane), 'picture' (one large fixed pane). One style for all the windows of a room, and per room type across the home.",
            ),
        }),
      )
      .optional()
      .describe('Windows, on exterior edges only: not on an edge shared with another room.'),
  },
}
