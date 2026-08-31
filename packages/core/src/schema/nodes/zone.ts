import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

export const ZoneNode = BaseNode.extend({
  id: objectId('zone'),
  type: nodeType('zone'),
  name: z.string(),
  // Polygon boundary - array of [x, z] coordinates defining the zone
  polygon: z.array(z.tuple([z.number(), z.number()])),
  // Procedural room zones retain the walls that prove their enclosure. The
  // stored polygon remains a fallback for missing or temporarily open walls.
  autoFromWalls: z.boolean().default(false),
  boundaryWallIds: z.array(objectId('wall')).default([]),
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
  metadata: z.json().optional().default({}),
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
  - enclosureStatus: auto-detected, explicitly enclosed, or open
  - clearDimensionPolicy: optional room clear-dimension datum preference
  - color: hex color for visual styling
  - metadata: zone metadata (optional)
  `,
)

export type ZoneNode = z.infer<typeof ZoneNode>
