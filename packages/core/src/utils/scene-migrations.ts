// Server-safe scene migrations shared by the client loader and the hosted
// scene authority. Everything exported here must stay pure data logic with no
// store, React, or Three.js imports so it can run in Server Components and
// API routes.

export type { NodePatch, SceneNodes, StructureEvent } from '../lib/structure-kernel'
export {
  reconcileSceneStructure,
  type SceneStructureInput,
  type SceneStructureResult,
  type StructureIdFactory,
} from '../lib/structure-reconcile'
export { ensureSceneOpenings } from './ensure-scene-openings'
export { migrateFloorOpeningNodes } from './floor-opening-migration'
export {
  type FloorPlateMigrationReport,
  migrateFloorPlates,
  migrateSlabSlots,
} from './floor-plate-migration'
export { healScenePlanCoordinates } from './heal-plan-coordinates'
export { type HealSceneResult, healSceneNodes } from './heal-scene-graph'
export { migrateStructuralMaterialSlots } from './legacy-material-slots'
export { materializeNodeDefaults, STRUCTURE_NODE_KINDS } from './node-defaults'
export { normalizeLegacyStructure } from './normalize-legacy-structure'
export {
  materializeLegacyAutoOpenings,
  migrateOwnedFloorOpenings,
} from './owned-floor-opening-migration'
export { reconcileStructureOnLoad } from './reconcile-structure-on-load'
export {
  type RetiredSceneNodeMigration,
  removeRetiredDrawingSheetNodes,
} from './retired-scene-nodes'
export {
  type CeilingRoomLinkMigration,
  migrateCeilingRoomLinks,
  migrateRoomZones,
  type RoomZoneMigration,
} from './room-zone-migration'
export { createStructureIdFactory, reconcileStructureWithStableIds } from './structure-id'
export {
  migrateVerticalSceneNodes,
  type VerticalSceneMigration,
} from './vertical-scene-migration'
export {
  migrateLegacyWallAssemblies,
  type WallAssemblyMigration,
} from './wall-assembly-migration'
export { migrateWallFaceBands, migrateWallFaceKeys } from './wall-face-migration'
