import {
  DEFAULT_WALL_THICKNESS,
  getWallBaseElevationForNodes,
  getWallEffectiveHeightForNodes,
  isRailingWall,
  type WallNode as WallNodeType,
  wallSlots,
} from '@pascal-app/core'
import type { NodeRenderDefinition } from '../definition-contributions'
import { wallSeenFromOutside } from './exterior'
import { buildWallFloorplan, computeWallFloorplanLevelData } from './floorplan'
import {
  matchWallMeasurementFeature,
  resolveWallMeasurementFeature,
  wallMeasurementFeatures,
} from './measurement'
import { wallQuickMeasurement } from './quick-measurement'
import { WallNode } from './schema'

export const wallRenderDefinition: NodeRenderDefinition<typeof WallNode> & { kind: 'wall' } = {
  kind: 'wall',
  schemaVersion: 10,
  schema: WallNode,
  category: 'structure',
  surfaceRole: 'wall',
  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    children: [],
    start: [0, 0],
    end: [3, 0],
    frontSide: 'unknown',
    backSide: 'unknown',
  }),
  capabilities: {
    reveal: { phase: 'structure', style: 'rise' },
    exterior: wallSeenFromOutside,
    revealLayout: { line: (node) => (node.type === 'wall' ? [node.start, node.end] : null) },
    revealOnEdit: [
      'start',
      'end',
      'curveOffset',
      'height',
      'thickness',
      'wallType',
      'curtainWall',
      'railing',
    ],
    // Wall move is bespoke (endpoint drag, linked-wall corner cascade,
    // ALT-detach). Omitting `movable` keeps the legacy MoveWallTool via
    // capability-driven dispatch.
    selectable: { hitVolume: 'bbox' },
    // Front + back faces host items (paintings, shelves, switches).
    surfaces: {
      renderOpeningContent: (node) => !isRailingWall(node),
      hosting: false,
      top: {
        height: (node, { nodes }) => {
          const wall = node as WallNodeType
          return (
            getWallBaseElevationForNodes(wall, nodes) +
            Math.max(
              getWallEffectiveHeightForNodes(wall, nodes, 0),
              getWallEffectiveHeightForNodes(wall, nodes, 1),
            )
          )
        },
      },
      sides: { faces: 'all' },
    },
    duplicable: true,
    deletable: true,
    // Declared paintable slots with their default appearance — the same
    // `{ slotId, label, default }` contract every other paintable kind exposes.
    // Paint still writes the legacy inline fields for base faces via
    // `wallPaint`; migrating those fully into `node.slots` is a later step.
    slots: (node) => wallSlots(node as WallNodeType),
    // F2 layers stack from the front face (or the exterior with
    // `face: 'exterior'`); `thickness` holds their sum.
    assembly: {
      reference: 'front',
      measure: 'normal',
      body: (node) => (node as WallNodeType).thickness ?? DEFAULT_WALL_THICKNESS,
    },
  },
  relations: {
    hosts: ['door', 'window', 'item', 'lean-to-extension'],
    affectsSpatial: ['slab', 'ceiling', 'zone'],
    linkedBy: 'endpoint-match',
    cascadeDelete: 'descendants',
  },
  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  system: {
    module: () => import('./system'),
    // Priority 4 mirrors the legacy WallSystem's useFrame priority.
    priority: 4,
  },
  measurement: {
    features: (node) => wallMeasurementFeatures(node),
    quickMeasure: (node) => wallQuickMeasurement(node),
    match: (node, _ctx, point, maxDistance) =>
      matchWallMeasurementFeature(node, point, maxDistance),
    resolve: (node, _ctx, reference) => resolveWallMeasurementFeature(node, reference),
  },
  // Stage C: floor-plan rendering. Precomputes the level miter graph once
  // per render pass, then the builder reads its own junctions by wall id.
  computeFloorplanLevelData: computeWallFloorplanLevelData,
  floorplan: buildWallFloorplan,
  presentation: {
    label: 'Wall',
    description:
      'A straight or curved wall segment. Hosts doors, windows, lean-to extensions, and wall-mounted items.',
    icon: { kind: 'url', src: '/icons/wall.webp' },
    paletteSection: 'structure',
    paletteOrder: 10,
  },
  mcp: {
    description:
      'A wall defined by endpoints and optional curve sagitta. wallType selects standard, curtain or railing. curtainWall configures construction, framing, grids, glazing, spandrels, and zero-based panel overrides. Thickness is frame depth for curtain walls. A railing is an open guard (railing: style, postSpacing, postSize, infillSize, infillGap, bottomClearance, cap) that closes rooms like a wall; its height is its own (36 in by default), its thickness its posts, and a door on it is a gap in the guard.',
  },
}
