import type { FloorplanNodeExtension } from '@pascal-app/editor'
import type { NodeEditContribution } from '../definition-contributions'
import { buildZoneContextualDimensions } from './contextual-dimensions'
import { buildZoneFloorplan } from './floorplan'
import {
  zoneAddVertexAffordance,
  zoneDeleteVertexAffordance,
  zoneMoveEdgeAffordance,
  zoneMoveVertexAffordance,
} from './floorplan-affordances'
import { zoneFloorplanMoveTarget } from './floorplan-move'
import { zoneParametrics } from './parametrics'
import { buildRoomFloorplanSchedule } from './room-documentation'
import type { ZoneNode } from './schema'
import { buildingUnitsForZone } from './unit-membership'

export const zoneEditContribution: NodeEditContribution<typeof ZoneNode> = {
  snapProfile: 'structural',
  extensions: {
    'pascal:editor/floorplan': {
      contextualDimensions: buildZoneContextualDimensions,
      schedule: buildRoomFloorplanSchedule,
    } satisfies FloorplanNodeExtension<ZoneNode>,
  },
  parametrics: zoneParametrics,
  floorplan: buildZoneFloorplan,
  // Every unit under the building, not just the current owner: a zone that
  // joins its first unit has no owner to depend on until the unit changes.
  floorplanDependencies: (node, nodes) => [
    ...(node.autoFromWalls ? node.boundaryWallIds : []),
    ...buildingUnitsForZone(node, (id) => nodes[id]).map((unit) => unit.id),
  ],
  // 2D body move — centroid-pivot polygon mover (same as slab / ceiling).
  // Without this, zone fell through to the overlay's generic free-translate
  // path, which committed a `position` field zone has no schema for, so the
  // polygon never actually moved on drop.
  floorplanMoveTarget: zoneFloorplanMoveTarget,
  // Polygon editor when selected — same four operations slabs / ceilings
  // expose. The shared factories key off `node.polygon`, optional
  // `node.holes` (absent on zones). See `floorplan-affordances.ts`.
  floorplanAffordances: {
    'move-vertex': zoneMoveVertexAffordance,
    'add-vertex': zoneAddVertexAffordance,
    'move-edge': zoneMoveEdgeAffordance,
    'delete-vertex': zoneDeleteVertexAffordance,
  },
}
