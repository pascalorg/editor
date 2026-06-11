import {
  type AnyNode,
  type AnyNodeId,
  collectAlignmentAnchors,
  type FloorplanMoveTargetSession,
  polygonAnchors,
  resolveAlignment,
  sceneRegistry,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import { getSegmentGridStep, useAlignmentGuides, type WallPlanPoint } from '@pascal-app/editor'
import type * as THREE from 'three'
import { createFloorplanCursorResolver } from './floorplan-cursor'

/**
 * Shared 2D floor-plan move for polygon-based kinds (slab / ceiling / zone).
 *
 * Existing polygon kinds preserve the cursor grab offset; fresh catalog
 * placement uses the polygon centroid as the cursor-following pivot. This
 * matches the generic 3D move tool while keeping polygon geometry in vertices.
 *
 * **Why a delta in `useLiveTransforms`** (see `wiki/architecture/tools.md`):
 * polygon kinds carry their position in their vertices, not a `position`
 * field. The live preview translates the rendered `<group>` by the delta
 * (`ParametricNodeRenderer` consumes `useLiveTransforms.position` as the
 * group position) so the SVG follows the EXACT snapped result with no CSG
 * rebuild per tick. On commit we write the translated polygon once. Because
 * the live delta and the committed polygon are derived from the same
 * `lastDelta`, the visual and the commit always agree.
 *
 * `meshY` mirrors the value the kind's system sets on rebuild (slab: 0;
 * ceiling: `height − 0.01`) so the 3D mesh doesn't teleport vertically in a
 * split view during the drag.
 */
/** Figma-style alignment threshold (meters) — parity with the 3D move tools. */
const ALIGNMENT_THRESHOLD_M = 0.08

function translatePolygon(
  polygon: ReadonlyArray<readonly [number, number]>,
  dx: number,
  dz: number,
): Array<[number, number]> {
  return polygon.map(([x, z]) => [x + dx, z + dz] as [number, number])
}

/** Average of the polygon's vertices — matches the 3D `MoveSlabTool` pivot. */
function polygonCentroid(polygon: ReadonlyArray<readonly [number, number]>): [number, number] {
  if (polygon.length === 0) return [0, 0]
  let sumX = 0
  let sumZ = 0
  for (const [x, z] of polygon) {
    sumX += x
    sumZ += z
  }
  return [sumX / polygon.length, sumZ / polygon.length]
}

export function createPolygonCentroidMoveTarget(args: {
  node: {
    id: string
    type: string
    polygon: Array<[number, number]>
    holes?: Array<Array<[number, number]>>
    metadata?: unknown
  }
  nodes: Record<AnyNodeId, AnyNode>
  /** 3D mesh Y the kind's system parks the group at on rebuild. */
  meshY: number
  /**
   * Extra fields merged into the commit payload. Use for kind-specific flags
   * that a manual drag should clear — e.g. slab `autoFromWalls: false`, so the
   * space-detection sync stops re-deriving the polygon from walls and
   * snapping the slab back to its original position.
   */
  extraCommitData?: Record<string, unknown>
}): FloorplanMoveTargetSession {
  const { node, nodes, meshY, extraCommitData } = args
  const id = node.id as AnyNodeId
  const typeGuard = node.type
  const originalPolygon = node.polygon.map(([x, z]) => [x, z] as [number, number])
  const hasHoles = Array.isArray(node.holes)
  const originalHoles = (node.holes ?? []).map((hole) =>
    hole.map(([x, z]) => [x, z] as [number, number]),
  )
  const originalCenter = polygonCentroid(originalPolygon)
  const resolveCursor = createFloorplanCursorResolver({
    original: originalCenter,
    metadata: node.metadata,
  })
  // Alignment candidates gathered once — the scene is stable during the drag.
  const candidates = collectAlignmentAnchors(nodes, id)
  let lastDelta: [number, number] = [0, 0]

  return {
    affectedIds: [id],
    apply({ planPoint, modifiers }) {
      // Centroid → snapped cursor. Grid-snap the target centroid (Shift
      // drops the grid snap), then layer Figma alignment on the translated
      // polygon's vertices and fold its snap into the delta. Alt bypasses.
      const step = getSegmentGridStep()
      const snap = (value: number) => (modifiers.shiftKey ? value : Math.round(value / step) * step)
      const target = resolveCursor(planPoint, { snap }) as WallPlanPoint
      let dx = target[0] - originalCenter[0]
      let dz = target[1] - originalCenter[1]

      if (!(modifiers.altKey || modifiers.shiftKey) && candidates.length > 0) {
        const result = resolveAlignment({
          moving: polygonAnchors(id, translatePolygon(originalPolygon, dx, dz)),
          candidates,
          threshold: ALIGNMENT_THRESHOLD_M,
        })
        if (result.snap) {
          dx += result.snap.dx
          dz += result.snap.dz
        }
        useAlignmentGuides.getState().set(result.guides)
      } else {
        useAlignmentGuides.getState().clear()
      }

      lastDelta = [dx, dz]
      // Live-drag exception: write the delta to BOTH `useLiveTransforms`
      // (React source of truth) and the mesh (direct Three.js) so they don't
      // fight per frame.
      useLiveTransforms.getState().set(id, { position: [dx, 0, dz], rotation: 0 })
      const mesh = sceneRegistry.nodes.get(id) as THREE.Object3D | undefined
      if (mesh) mesh.position.set(dx, meshY, dz)
    },
    canCommit() {
      const live = useScene.getState().nodes[id] as { type?: string } | undefined
      if (!live || live.type !== typeGuard) return false
      const [dx, dz] = lastDelta
      if (dx === 0 && dz === 0) return false
      // Sync commit: scene write → direct markDirty → clear live transform,
      // so the React render and the kind's geometry rebuild land in the same
      // paint (no original-position blink). Only write `holes` for kinds that
      // have them (zone has none).
      const data: {
        polygon: Array<[number, number]>
        holes?: Array<Array<[number, number]>>
        [key: string]: unknown
      } = {
        polygon: translatePolygon(originalPolygon, dx, dz),
      }
      if (hasHoles) {
        data.holes = originalHoles.map((h) => translatePolygon(h, dx, dz))
      }
      if (extraCommitData) {
        Object.assign(data, extraCommitData)
      }
      useScene.getState().updateNodes([{ id, data }])
      useScene.getState().markDirty(id)
      useLiveTransforms.getState().clear(id)
      return true
    },
  }
}
