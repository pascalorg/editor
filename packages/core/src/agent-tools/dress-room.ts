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
    "Dress rooms with ordered wall finishes and trims; returns the planned faces, regions, trims and skipped placements. dryRun previews without writing. The room's wallMaterial stays the base finish. Trims (skirting, chairRail, crown) use set_wall_trim and stay within the room's wall stretches. A wall shares each trim's shape, and each face shares its trim finish: changing retained coverage outside the request refuses with trim_conflict, never silently changes another room. Finish layers are flat paint regions: wainscot (to 0.9 m), tiles (to 1.2 m), splashback (from 0.9 m, 0.6 m high; alongRun starts at the cabinet worktop), and accent (the room's stretch of walls named in where.walls). Each finish layer needs finish. Fixture and cabinet targets must be on the room's level; nested cabinet/module poses are composed. Partial curved finish stretches are reported as skipped; partial curved trims refuse. Each call replaces only dress:<zoneId>: regions, including earlier owned regions on former boundary walls; hand paint and other rooms remain. layers: [] removes owned regions, not trims. Eight regions per face, including retained paint. Full-height scripts own their faces. All rooms apply atomically in one undo step. Refusals include target_required, target_not_found, no_walls, not_on_room, side_unknown, curtain_wall, railing_wall, finish_required, walls_required, invalid_layer, invalid_size, region_limit, script_owns_face, trim_conflict, target_level_mismatch and target_frame_unsupported.",
  input: {
    zoneIds: z.array(NodeId).min(1).max(16).describe('The rooms to dress.'),
    layers: z.array(layer).max(8).describe("Bottom to top; [] takes the rooms' regions off."),
    dryRun: z.boolean().optional().describe('List what each face would carry; write nothing.'),
  },
} as const
