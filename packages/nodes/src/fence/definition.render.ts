import {
  type AnyNodeId,
  type FenceNode as FenceNodeType,
  fenceSlots,
  findLevelAncestorId,
  floorConstructionLift,
  levelBaseElevationAt,
  type SceneApi,
} from '@pascal-app/core'

import {
  createNodeTopSurfaceHeightSampler,
  createSceneSupportHeightSampler,
} from '@pascal-app/viewer'
import type { NodeRenderDefinition } from '../definition-contributions'
import { buildFenceGeometry } from './geometry'
import { resolveFenceLiftElevation, resolveFenceLiftElevationForNodes } from './lift'
import { FenceNode } from './schema'

export function fenceBaseElevation(
  n: FenceNodeType,
  sceneApi?: SceneApi,
  point: readonly [number, number] = n.start,
): number {
  const nodes = sceneApi?.nodes()
  if (!nodes) return resolveFenceLiftElevation(n, () => undefined)
  if (n.supportSlabId) return resolveFenceLiftElevationForNodes(n, nodes)
  const levelId = findLevelAncestorId(n.id as AnyNodeId, nodes)
  if (levelId && ((n.path?.length ?? 0) >= 2 || Math.abs(n.curveOffset ?? 0) > 1e-4)) {
    const selectedHost =
      n.surfaceMode === 'selected'
        ? ((n.supportSurfaceNodeId ?? n.supportSlabId) as AnyNodeId | undefined)
        : undefined
    const samplePoint = n.surfaceMode === 'level' ? n.start : point
    return (
      Math.max(
        createSceneSupportHeightSampler(
          nodes,
          levelId as AnyNodeId,
          selectedHost,
        )(samplePoint[0], samplePoint[1]),
        levelBaseElevationAt(nodes, levelId, samplePoint[0], samplePoint[1]) +
          floorConstructionLift(nodes, n),
      ) + (n.supportOffset ?? 0)
    )
  }
  if (n.supportSurfaceNodeId && levelId) {
    const height = createNodeTopSurfaceHeightSampler(
      n.supportSurfaceNodeId as AnyNodeId,
      levelId as AnyNodeId,
    )?.(point[0], point[1])
    if (height !== null && height !== undefined) return height + (n.supportOffset ?? 0)
  }
  return resolveFenceLiftElevationForNodes(n, nodes)
}

export const fenceRenderDefinition: NodeRenderDefinition<typeof FenceNode> & { kind: 'fence' } = {
  kind: 'fence',
  schemaVersion: 3,
  schema: FenceNode,
  category: 'structure',
  surfaceRole: 'wall',
  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    start: [0, 0],
    end: [3, 0],
    height: 1.8,
    thickness: 0.08,
    baseHeight: 0.22,
    postSpacing: 1.98,
    picketSpacing: 0.27,
    patternDistribution: 'automatic',
    patternAlignment: 'center',
    patternCount: 4,
    patternRemainder: 'leave',
    picketWidth: 0.07,
    picketTop: 'flat',
    picketRailCount: 2,
    picketProfile: 'level',
    picketTopClearance: 0.2,
    picketVariation: 0.23,
    picketRailProjection: 0.001,
    postSize: 0.109,
    topRailHeight: 0.04,
    groundClearance: 0.14,
    edgeInset: 0.015,
    slatGap: 0.01,
    postCap: 'pyramid',
    baseStyle: 'floating',
    surfaceMode: 'auto',
    transitionMode: 'slope',
    transitionWidth: 0.8,
    showInfill: true,
    infillPlacement: 'center',
    color: '#ffffff',
    style: 'picket',
    children: [],
  }),
  capabilities: {
    exterior: true,
    reveal: { phase: 'structure', style: 'rise' },
    revealOnEdit: [
      'start',
      'end',
      'path',
      'curveOffset',
      'height',
      'thickness',
      'baseHeight',
      'postSpacing',
      'picketSpacing',
      'style',
    ],
    hostRefFields: ['supportSurfaceNodeId'],
    surfacePlacement: 'floor-only',
    selectable: { hitVolume: 'bbox' },
    surfaces: { sides: { faces: 'all' }, hosting: false },
    duplicable: true,
    deletable: true,
    slots: (node) => fenceSlots(node as FenceNodeType),
    // Placed by drawing the span with the two-click tool; a saved preset
    // seeds its build parameters via `toolDefaults.fence` (see `tool.tsx`
    // and `createFenceOnCurrentLevel`).
    drawTool: true,
  },
  relations: {
    linkedBy: 'endpoint-match',
    cascadeDelete: 'descendants',
  },
  // Stage B: pure geometry function. Generic <GeometrySystem> rebuilds
  // on dirtyNodes; <ParametricNodeRenderer> mounts the empty group.
  geometry: buildFenceGeometry,
  geometryChildTypes: ['fence-gate', 'fence-opening'],
  // Dependency tracker only — a hosted railing (`supportSlabId`) renders at
  // its slab's elevation, so host elevation edits must re-dirty the fence.
  system: {
    module: () => import('./system'),
    priority: 4,
  },
  presentation: {
    label: 'Fence',
    description: 'A straight or curved fence segment with configurable posts and infill.',
    icon: { kind: 'url', src: '/icons/fence.webp' },
    paletteSection: 'structure',
    paletteOrder: 20,
  },
  mcp: {
    description: 'A fence segment defined by start + end points, with optional curve sagitta.',
  },
}
