import { z } from 'zod'
import { CeilingFrameStyle, CeilingMedallionStyle } from '../schema/nodes/ceiling-ornament'
import { WallTrimProfile } from '../schema/nodes/wall-trim-profile'
import { measurement } from './measurement'
import { NodeId } from './node-id'

const length = (description: string) =>
  measurement('length', 'm', { description, positive: true }).optional()

const ceilingMedallionInput = z.object({
  enabled: z.boolean().optional().describe('True to place/update (default), false to remove.'),
  style: CeilingMedallionStyle.optional().describe(
    'Sculpted plaster bas-relief style: haussmann-acanthe (default), empire-palmette, classique-godrons, art-deco-radial or moulure-anneaux.',
  ),
  diameter: measurement('length', 'm', {
    description: 'Medallion outer diameter in metres (0.25 to 3.0; default 0.9 m).',
    min: 0.25,
    max: 3.0,
  }).optional(),
  relief: measurement('length', 'm', {
    description:
      'Sculpted relief depth below the ceiling in metres (0.015 to 0.12; default 0.045 m).',
    min: 0.015,
    max: 0.12,
  }).optional(),
  offset: z
    .tuple([z.number().finite(), z.number().finite()])
    .optional()
    .describe('Optional [dx, dz] shift in metres from the room ceiling centre.'),
  at: z
    .tuple([z.number().finite(), z.number().finite()])
    .optional()
    .describe('Optional explicit level-plan [x, z] centre in metres.'),
  finish: z
    .string()
    .min(1)
    .optional()
    .describe('Optional finish (library:, scene: ref or #rrggbb); defaults to the ceiling finish.'),
})

const ceilingFrameInput = z.object({
  enabled: z.boolean().optional().describe('True to place/update (default), false to remove.'),
  style: CeilingFrameStyle.optional().describe(
    'Swept ceiling frame style: haussmann-cadre (default), classique-filet, double-cadre or caissons.',
  ),
  inset: measurement('length', 'm', {
    description: 'Inset from room perimeter walls in metres (0.08 to 2.0; default 0.42 m).',
    min: 0.08,
    max: 2.0,
  }).optional(),
  width: measurement('length', 'm', {
    description: 'Moulding band width in metres (0.025 to 0.3; default 0.085 m).',
    min: 0.025,
    max: 0.3,
  }).optional(),
  relief: measurement('length', 'm', {
    description: 'Moulding relief drop in metres (0.01 to 0.12; default 0.032 m).',
    min: 0.01,
    max: 0.12,
  }).optional(),
  notchedCorners: z
    .boolean()
    .optional()
    .describe('For haussmann-cadre: concave notched corners with corner rosettes (default true).'),
  finish: z
    .string()
    .min(1)
    .optional()
    .describe('Optional finish (library:, scene: ref or #rrggbb); defaults to the ceiling finish.'),
})

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
    "Dress rooms in one atomic call: set whole-room base wall, ceiling and floor finishes, drop ceiling height, add native sculpted ceiling medallions (rosaces) and moulded ceiling frames/coffers, lay ordered wall trims/finishes, and optionally replace existing wall or floor scripts. Up to 32 rooms per call; dryRun previews without writing. wallFinish sets the room's base wallMaterial (clearing wallOverrides; ordered layers stay on top). ceilingFinish paints the room ceiling's surface slot and ceilingHeight sets its height (and zone ceilingHeight). ceilingMedallion adds a continuous sculpted plaster rosace centred on each room ceiling (styles: haussmann-acanthe, empire-palmette, classique-godrons, art-deco-radial, moulure-anneaux; pass null or enabled: false to remove). ceilingFrame sweeps a classical moulded ceiling frame around each room polygon (styles: haussmann-cadre with optional notchedCorners + corner rosettes, classique-filet, double-cadre, caissons; pass null or enabled: false to remove). floorFinish sets zone.floor.finish. Passing layers replaces only dress:<zoneId>: regions (layers: [] clears owned regions; omitting layers preserves them). Trims (skirting, chairRail, crown) use set_wall_trim and stay within the room's wall stretches; changing shared trim outside the request refuses with trim_conflict. Finish layers are flat paint regions: wainscot (to 0.9 m), tiles (to 1.2 m), splashback (from 0.9 m, 0.6 m high; alongRun starts at the cabinet worktop), and accent (the room's stretch of walls named in where.walls). Full-height wall finish scripts and floor scripts own their colours and refuse with script_owns_face or script_owns_floor unless replaceScripts: true removes them atomically. Eight regions per face, including retained paint. Refusals include target_required, target_not_found, no_walls, not_on_room, side_unknown, curtain_wall, railing_wall, finish_required, walls_required, invalid_layer, invalid_size, region_limit, script_owns_face, script_owns_floor, trim_conflict, target_level_mismatch and target_frame_unsupported.",
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
    ceilingMedallion: z
      .union([z.null(), ceilingMedallionInput])
      .optional()
      .describe(
        'Native sculpted plaster ceiling rosace centred on each room ceiling; pass null or { enabled: false } to remove.',
      ),
    ceilingFrame: z
      .union([z.null(), ceilingFrameInput])
      .optional()
      .describe(
        'Native swept moulded ceiling frame (cadre / double-cadre / caissons) following each room ceiling polygon; pass null or { enabled: false } to remove.',
      ),
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
