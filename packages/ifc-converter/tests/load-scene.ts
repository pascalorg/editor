import type { AnyNode } from '@pascal-app/core'
import {
  ensureSceneOpenings,
  healSceneNodes,
  materializeLegacyAutoOpenings,
  materializeNodeDefaults,
  migrateCeilingRoomLinks,
  migrateFloorPlates,
  migrateLegacyWallAssemblies,
  migrateRoomZones,
  migrateSlabSlots,
  migrateStructuralMaterialSlots,
  migrateVerticalSceneNodes,
  migrateWallFaceBands,
  migrateWallFaceKeys,
  normalizeLegacyStructure,
  reconcileStructureOnLoad,
  removeRetiredDrawingSheetNodes,
  STRUCTURE_NODE_KINDS,
} from '@pascal-app/core/scene-migrations'

type Nodes = Record<string, AnyNode>

/**
 * Loads a converted graph the way the editor and the scene authority do
 * (normalize-authority-scene.ts / useScene.setScene).
 */
export function loadScene(source: Record<string, unknown>): Nodes {
  const legacyNodes = normalizeLegacyStructure(source)
  const healed = healSceneNodes(legacyNodes)
  const retained = removeRetiredDrawingSheetNodes(healed.nodes).nodes
  const materials = migrateStructuralMaterialSlots(retained)
  const walls = migrateLegacyWallAssemblies(materials.nodes)
  const vertical = migrateVerticalSceneNodes(walls.nodes)
  const rooms = migrateRoomZones(vertical.nodes)
  const ceilings = migrateCeilingRoomLinks(rooms.nodes)
  const ceilingNodes = Object.values(ceilings.nodes) as AnyNode[]
  const legacyOpeningsPrepared =
    ceilingNodes.some((node) => node.type === 'slab' && node.autoFromWalls && !node.plateRole) &&
    ceilingNodes.some((node) => node.type === 'stair' || node.type === 'elevator')
  const plates = migrateFloorPlates(materializeLegacyAutoOpenings(ceilings.nodes, true))
  const slots = migrateSlabSlots(plates.nodes)
  const openings = ensureSceneOpenings(slots.nodes)
  const wallFaces = migrateWallFaceKeys(openings.nodes)
  const wallBands = migrateWallFaceBands(wallFaces.nodes)
  const structure = reconcileStructureOnLoad(wallBands.nodes, vertical.nodes, {
    legacyOpeningsPrepared,
  })
  return materializeNodeDefaults(structure.nodes, STRUCTURE_NODE_KINDS).nodes as Nodes
}
