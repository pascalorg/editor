import type {
  AnyNodeId,
  RoofSegmentNode,
  SceneApi,
  WindowNode as WindowNodeType,
} from '@pascal-app/core'

import { windowSlots } from '@pascal-app/core'

import { NEW_WINDOW_FRAME_THICKNESS } from '@pascal-app/core/building'
import type { NodeRenderDefinition } from '../definition-contributions'
import { windowBatchable } from '../shared/node-batch/batchable'
import { computeWindowFloorplanLevelData } from '../shared/opening-documentation'
import { buildRoofWallOpeningCut } from '../shared/roof-wall-opening-cut'
import { openingSeenFromOutside } from '../wall/exterior'
import { buildWindowFloorplan } from './floorplan'
import { windowMechanism } from './mechanism'
import { WindowNode } from './schema'

export function resolveWindowHandlePortalTarget(
  window: WindowNodeType,
  scene: Pick<SceneApi, 'get'>,
): AnyNodeId | null {
  const parentId = window.parentId as AnyNodeId | null
  if (!parentId) return null
  const grandparentId = (scene.get(parentId) as { parentId?: AnyNodeId | null } | undefined)
    ?.parentId
  if (!grandparentId) return null
  if (window.dormerId !== parentId) return grandparentId
  return (
    (scene.get(grandparentId) as { parentId?: AnyNodeId | null } | undefined)?.parentId ??
    grandparentId
  )
}

export const windowRenderDefinition: NodeRenderDefinition<typeof WindowNode> & { kind: 'window' } =
  {
    kind: 'window',
    schemaVersion: 4,
    schema: WindowNode,
    category: 'structure',
    // Same schema-driven defaults trick as door: parse a stub, strip
    // id/type. Window also has many fields with zod `.default()` set.
    defaults: () => {
      const stub = WindowNode.parse({
        id: 'window_default' as never,
        type: 'window',
        frameThickness: NEW_WINDOW_FRAME_THICKNESS,
        casingFaceA: true,
        casingFaceB: true,
      })
      const { id: _id, type: _type, ...rest } = stub
      return rest
    },
    capabilities: {
      reveal: { phase: 'openings', style: 'cut' },
      exterior: openingSeenFromOutside,
      revealOnEdit: ['position', 'width', 'height', 'openingShape', 'windowType'],
      batchable: windowBatchable,
      selectable: { hitVolume: 'bbox' },
      duplicable: true,
      deletable: true,
      wallOpeningPlacement: true,
      // Windows also host on roof-segment wall faces (base walls under the
      // roof, gable ends) — same wiring as door; see the door capability
      // for why `dirtyHandledByOwnSystem` is required.
      roofAccessory: {
        buildCut: (node, hostSegment) =>
          buildRoofWallOpeningCut(node as WindowNodeType, hostSegment as RoofSegmentNode),
        cutScope: 'wall',
        dirtyHandledByOwnSystem: true,
      },
      // `wallId` / `roofSegmentId` / `dormerId` are re-derived from the surface under
      // the cursor at preset placement time — see door for the pattern.
      hostRefFields: ['wallId', 'roofSegmentId', 'roofFace', 'dormerId', 'dormerFace'],
      // Frame / glass slots painted through the registry. The window system tags
      // each mesh with its `userData.slotId`; paint writes `node.slots`.
      slots: () => windowSlots(),
      mechanism: windowMechanism,
    },
    rendersChildren: false,
    renderer: {
      kind: 'parametric',
      module: () => import('./renderer'),
    },
    system: {
      module: () => import('./system'),
      priority: 3,
    },
    // Stage C: floor-plan polygon. ctx.parent gives the wall for direction
    // + thickness — same shape as door.
    floorplan: buildWindowFloorplan,
    computeFloorplanLevelData: computeWindowFloorplanLevelData,
    presentation: {
      label: 'Window',
      description: 'A window cut into a wall. Animated open/close for opening windows.',
      icon: { kind: 'url', src: '/icons/window.webp' },
      paletteSection: 'structure',
      paletteOrder: 60,
    },
    mcp: {
      description: 'A window mounted on a wall, with type / dimensions / opening options.',
    },
  }
