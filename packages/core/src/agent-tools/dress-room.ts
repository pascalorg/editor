import { z } from 'zod'
import { WallTrimProfile } from '../schema/nodes/wall-trim-profile'
import { measurement } from './measurement'
import { NodeId } from './node-id'

const length = (description: string) =>
  measurement('length', 'm', { description, positive: true }).optional()

const layer = z.object({
  kind: z
    .enum(['skirting', 'chairRail', 'crown', 'wainscot', 'tiles', 'splashback', 'accent'])
    .describe('Trims: skirting, chairRail, crown. Finishes laid up a face: the others.'),
  finish: z
    .string()
    .optional()
    .describe(
      'A library: or scene: ref or #rrggbb. Required for a finish; for a trim it paints the trim.',
    ),
  from: measurement('length', 'm', { min: 0 })
    .optional()
    .describe('Splashback: metres above the floor where it starts (default 0.9, or the worktop).'),
  to: z
    .union([measurement('length', 'm', { positive: true }), z.literal('full')])
    .optional()
    .describe('Finish: metres above the floor where it stops, or "full" to the ceiling.'),
  height: length('Trim: its height up the face.'),
  depth: length('Trim: how far it stands proud of the face.'),
  offsetY: measurement('length', 'm', { min: 0 })
    .optional()
    .describe('Chair rail: where it sits above the floor.'),
  profile: WallTrimProfile.optional().describe('Trim: its moulding.'),
  where: z
    .object({
      walls: z
        .array(NodeId)
        .optional()
        .describe('Walls of the room to dress; absent, every wall that looks into it.'),
      around: z
        .array(NodeId)
        .min(1)
        .max(8)
        .optional()
        .describe(
          'Finish: fixtures (items) to lay it around, on each face of the room within 0.15 m of one.',
        ),
      margin: measurement('length', 'm', { min: 0 })
        .optional()
        .describe('With around: metres added each side of a fixture (default 0.1).'),
      alongRun: NodeId.optional().describe(
        'Finish: a base cabinet run; each face behind it, over its stretch.',
      ),
    })
    .optional()
    .describe('Limits the layer to part of the room.'),
})

export const dressRoomTool = {
  name: 'dress_room',
  title: 'Dress a room',
  description:
    "Dress rooms in one atomic call: set whole-room base wall, ceiling and floor finishes, drop ceiling height, lay ordered wall trims/finishes, and optionally replace existing wall or floor scripts. Up to 32 rooms per call; dryRun previews without writing. wallFinish sets the room's base wallMaterial (clearing wallOverrides; ordered layers stay on top). ceilingFinish paints the room ceiling's surface slot and ceilingHeight sets its height (and zone ceilingHeight). floorFinish sets zone.floor.finish. Passing layers replaces only dress:<zoneId>: regions (layers: [] clears owned regions; omitting layers preserves them). Trims (skirting, chairRail, crown) use set_wall_trim and stay within the room's wall stretches; changing shared trim outside the request refuses with trim_conflict. Finish layers are flat paint regions: wainscot (to 0.9 m), tiles (to 1.2 m), splashback (from 0.9 m, 0.6 m high; alongRun starts at the cabinet worktop), and accent (the room's stretch of walls named in where.walls). Full-height wall finish scripts and floor scripts own their colours and refuse with script_owns_face or script_owns_floor unless replaceScripts: true removes them atomically. Eight regions per face, including retained paint. Refusals include target_required, target_not_found, no_walls, not_on_room, side_unknown, curtain_wall, railing_wall, finish_required, walls_required, invalid_layer, invalid_size, region_limit, script_owns_face, script_owns_floor, trim_conflict, target_level_mismatch and target_frame_unsupported.",
  input: {
    zoneIds: z.array(NodeId).min(1).max(32).describe('The rooms to dress (1 to 32).'),
    layers: z
      .array(layer)
      .max(8)
      .optional()
      .describe(
        'Bottom to top wall trims/finishes; omit to keep existing dress:<zoneId>: regions, or [] to remove them.',
      ),
    wallFinish: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Whole-room base wall finish (library:, scene: ref or #rrggbb). Clears room wallOverrides; layers stay on top.',
      ),
    ceilingFinish: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Whole-room ceiling finish (library:, scene: ref or #rrggbb) applied to the room ceiling node surface slot.',
      ),
    ceilingHeight: measurement('length', 'm', {
      description:
        'Dropped/explicit ceiling height in metres (min 0.1 m) written to the room ceiling node and room metadata.',
      min: 0.1,
    }).optional(),
    floorFinish: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Whole-room floor finish (library:, scene: ref or #rrggbb) written to zone.floor.finish.',
      ),
    replaceScripts: z
      .boolean()
      .optional()
      .describe(
        'When true, removes full-height wall finishScripts on dressed inward faces (and zone.floor.script when setting floorFinish) atomically instead of refusing with script_owns_face / script_owns_floor.',
      ),
    dryRun: z
      .boolean()
      .optional()
      .describe('List what each face and surface would carry; write nothing.'),
  },
} as const
