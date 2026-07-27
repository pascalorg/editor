import { BuildingNode as BuildingNodeSchema, type NodeDefinition } from '@pascal-app/core'
import { buildingParametrics } from './parametrics'
import { BuildingNode } from './schema'

/**
 * Building — Stage A. Container for levels; can be translated /
 * rotated as a whole (movable + rotatable on Y). The legacy
 * `MoveBuildingContent` handles building-wide drag; the registry
 * fallback would translate position, which is close to right —
 * but kept legacy at Stage A to avoid disturbing the building's
 * world-space group transform handling.
 */
export const buildingDefinition: NodeDefinition<typeof BuildingNode> = {
  kind: 'building',
  schemaVersion: 1,
  schema: BuildingNode,
  category: 'site',

  defaults: () => {
    const stub = BuildingNodeSchema.parse({ id: 'building_default' as never, type: 'building' })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },

  capabilities: {
    // Building is a container — sidebar / building switcher drive
    // selection, never 3D click. Same reasoning as `level` / `site`.
    duplicable: false,
    deletable: false,
    floorplanLevelContainer: true,
    presettable: false,
  },

  // Building-wide drag (whole-building translate + R/T rotation). Routed
  // through `MoveTool`'s registry-affordance lookup rather than a
  // hardcoded dispatcher arm.
  affordanceTools: {
    move: () => import('./move-tool'),
  },

  parametrics: buildingParametrics,
  // No dirty consumer rebuilds this kind — see NodeDefinition.dirtyTracking.
  dirtyTracking: false,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },

  presentation: {
    label: 'Building',
    description: 'A building container holding one or more levels.',
    icon: { kind: 'url', src: '/icons/building.webp' },
    paletteSection: 'site',
    paletteOrder: 6,
  },

  mcp: {
    description: 'A building container that groups levels.',
  },
}
