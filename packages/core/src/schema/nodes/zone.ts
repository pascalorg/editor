import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { SurfacePaintRegion } from './surface-paint-region'

export const ZoneNode = BaseNode.extend({
  id: objectId('zone'),
  type: nodeType('zone'),
  name: z.string(),
  // Polygon boundary - array of [x, z] coordinates defining the zone
  polygon: z.array(z.tuple([z.number(), z.number()])),
  // Procedural room zones retain the walls that prove their enclosure. The
  // stored polygon remains a fallback for missing or temporarily open walls.
  holes: z.array(z.array(z.tuple([z.number(), z.number()]))).default([]),
  autoFromWalls: z.boolean().default(false),
  boundaryWallIds: z.array(objectId('wall')).default([]),
  boundarySeparatorIds: z.array(z.string()).default([]),
  hostZoneId: z.string().optional(),
  seed: z.tuple([z.number(), z.number()]).optional(),
  floor: z
    .object({
      elevation: z.number().optional(),
      support: z.literal('open').optional(),
      footprint: z.string().min(1).optional(),
      thickness: z.number().min(0.02).optional(),
      sourceSlabId: z.templateLiteral(['slab_', z.string()]).optional(),
      finish: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
      regions: z.array(SurfacePaintRegion).optional(),
    })
    .optional(),
  // Painted parts of the room's ceiling. The automatic ceilings are rebuilt
  // from the room, so what the user painted on them lives here.
  ceiling: z
    .object({
      regions: z.array(SurfacePaintRegion).optional(),
    })
    .optional(),
  floorStepFinish: z.string().optional(),
  // Per-doorway step paint over `floorStepFinish`, keyed by the door the step
  // sits under or the lower room it looks at (see `lib/floor-step-finish`).
  floorStepOverrides: z
    .array(
      z.object({
        key: z.string(),
        step: z.number().int().min(0).optional(),
        finish: z.string(),
      }),
    )
    .optional(),
  floorEdgeFinish: z.string().optional(),
  wallMaterial: z.string().optional(),
  wallOverrides: z
    .array(
      z.object({
        wallId: z.string(),
        face: z.enum(['a', 'b']),
        finish: z.string(),
      }),
    )
    .optional(),
  hasFloor: z.literal(false).optional(),
  hasCeiling: z.literal(false).optional(),
  // Generic zones remain available for sites and analysis. Architectural
  // room documentation is opt-in so legacy zone behavior is unchanged.
  spaceRole: z.enum(['generic', 'room']).default('generic'),
  roomNumber: z.string().trim().max(32).default(''),
  enclosureStatus: z.enum(['auto', 'enclosed', 'open']).default('auto'),
  floorFinish: z.string().trim().max(120).default(''),
  wallFinish: z.string().trim().max(120).default(''),
  ceilingFinish: z.string().trim().max(120).default(''),
  ceilingHeight: z.number().min(0.1).default(2.7),
  occupancy: z.string().trim().max(80).default(''),
  clearDimensionPolicy: z.enum(['none', 'inside-faces', 'finish-faces']).default('none'),
  // Visual styling
  color: z.string().default('#3b82f6'), // Default blue
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
}).describe(
  dedent`
  Zone schema - a polygon zone attached to a level
  - object: "zone"
  - id: zone id
  - levelId: level this zone is attached to
  - name: zone name
  - polygon: array of [x, z] points defining the zone boundary
  - autoFromWalls: whether the boundary follows an enclosed wall loop
  - boundaryWallIds: wall ids that prove the procedural enclosure
  - spaceRole: generic site/analysis zone or architectural room
  - roomNumber/finishes/ceilingHeight/occupancy: construction-document room metadata
  - floor.regions / ceiling.regions: painted parts of the room's floor and ceiling ([x, z] polygons, later wins)
  - floorStepFinish: finish of the room's steps; floorStepOverrides: per-doorway step finishes keyed by door id (or the lower room id), optional step index
  - enclosureStatus: auto-detected, explicitly enclosed, or open
  - clearDimensionPolicy: optional room clear-dimension datum preference
  - color: hex color for visual styling
  - metadata: zone metadata (optional)
  `,
)

export type ZoneNode = z.infer<typeof ZoneNode>
