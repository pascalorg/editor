import {
  type AnyNodeId,
  type FloorplanAffordance,
  type FloorplanMoveTarget,
  getGableRidge,
  getGableWallInsets,
  getRoofRingEdgeNormal,
  getRoofSegmentCoverOutline,
  pullRoofSegmentCoverEdge,
  type RoofNode,
  type RoofSegmentNode,
  snapScalar,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { getSegmentGridStep, isAngleSnapActive, isGridSnapActive } from '@pascal-app/editor'
import { createFloorplanCursorResolver } from '../shared/floorplan-cursor'
import { rotateAffordanceDelta } from '../shared/rotate-affordance'
import { getCanopySnapPoints, snapCanopyReach } from './canopy-snap'
import { applyGableRidgeEdit, readGableRidgeLocks } from './gable-ridge-edit'

const MIN_ROOF_DIM = 1

type RoofSegmentResizePayload = { mode: 'radial' } | { axis: 'x' | 'z'; side: 1 | -1 }

// Resolve world-space center + effective rotation of a roof segment by
// composing the parent roof's position + rotation with the segment's
// local position. Mirrors the floorplan builder's transform so handles
// and affordances stay glued to the rendered footprint.
function resolveSegmentFrame(
  segment: RoofSegmentNode,
  nodes: Record<AnyNodeId, unknown>,
): {
  cx: number
  cz: number
  roofRot: number
  effRot: number
  cosRoof: number
  sinRoof: number
} {
  const roofId = (segment as unknown as { parentId?: AnyNodeId | null }).parentId
  const roof = roofId ? (nodes[roofId] as RoofNode | undefined) : undefined
  const roofPosX = roof?.position[0] ?? 0
  const roofPosZ = roof?.position[2] ?? 0
  // Floor-plan plots at `-rotation` so SVG-CW matches Three.js-CCW (see
  // `buildRoofSegmentFloorplan` for the rationale). This frame mirrors
  // the builder's transform so affordance cx/cz line up with where the
  // segment actually renders, and the cursor projection in `effRot`
  // works in the same coord system.
  const roofRot = -(roof?.rotation ?? 0)
  const cosRoof = Math.cos(roofRot)
  const sinRoof = Math.sin(roofRot)
  const localX = segment.position[0]
  const localZ = segment.position[2]
  const cx = roofPosX + localX * cosRoof - localZ * sinRoof
  const cz = roofPosZ + localX * sinRoof + localZ * cosRoof
  const effRot = roofRot + -(segment.rotation ?? 0)
  return { cx, cz, roofRot, effRot, cosRoof, sinRoof }
}

/**
 * Roof-segment width / depth drag (floor-plan). Mirrors the 3D
 * `linear-resize` handles in `definition.ts`: the dragged side moves
 * while the opposite side stays fixed. Projects the plan cursor onto
 * the segment's effective rotation (roof.rotation + segment.rotation)
 * so the math survives any parent-roof rotation, then writes the
 * corresponding roof-local center shift alongside the new dimension.
 */
export const roofSegmentResizeAffordance: FloorplanAffordance<RoofSegmentNode> = {
  start({ node, payload, nodes, initialPlanPoint }) {
    const resize = payload as RoofSegmentResizePayload
    const segmentId = node.id as AnyNodeId
    const { cx, cz } = resolveSegmentFrame(node, nodes)
    if ('mode' in resize) {
      const initialRadius = node.width / 2
      const initialPointerRadius = Math.hypot(initialPlanPoint[0] - cx, initialPlanPoint[1] - cz)
      let lastRadius = initialRadius

      return {
        affectedIds: [segmentId],
        apply({ planPoint }) {
          const pointerRadius = Math.hypot(planPoint[0] - cx, planPoint[1] - cz)
          lastRadius = Math.max(
            MIN_ROOF_DIM / 2,
            initialRadius + pointerRadius - initialPointerRadius,
          )
          const diameter = lastRadius * 2
          useLiveNodeOverrides.getState().set(segmentId, { width: diameter, depth: diameter })
          useScene.getState().markDirty(segmentId)
        },
        canCommit() {
          return true
        },
        commit() {
          useLiveNodeOverrides.getState().clear(segmentId)
          const diameter = lastRadius * 2
          useScene.getState().updateNode(segmentId, { width: diameter, depth: diameter })
        },
      }
    }

    const { axis, side } = resize
    const initialValue = axis === 'x' ? node.width : node.depth
    const initialPosition = node.position
    const segmentRotation = node.rotation ?? 0
    const armX = axis === 'x' ? Math.cos(segmentRotation) : Math.sin(segmentRotation)
    const armZ = axis === 'x' ? -Math.sin(segmentRotation) : Math.cos(segmentRotation)
    const { effRot } = resolveSegmentFrame(node, nodes)
    const cosEff = Math.cos(effRot)
    const sinEff = Math.sin(effRot)
    // Project (planPoint - center) onto the segment's local X or Z axis
    // (world directions of those axes are (cosEff, sinEff) and
    // (-sinEff, cosEff)).
    const projectLocalAxis = (px: number, pz: number): number => {
      const dx = px - cx
      const dz = pz - cz
      return axis === 'x' ? dx * cosEff + dz * sinEff : -dx * sinEff + dz * cosEff
    }
    const initialLocal = projectLocalAxis(initialPlanPoint[0], initialPlanPoint[1])
    let lastValue = initialValue

    return {
      affectedIds: [segmentId],
      apply({ planPoint }) {
        const currentLocal = projectLocalAxis(planPoint[0], planPoint[1])
        const delta = (currentLocal - initialLocal) * side
        const rawValue = initialValue + delta
        // Mode-aware grid step (0 outside grid mode, so `lines` / `off` resize
        // freely — the "smooth" behaviour that used to need a held Shift). The
        // reshaping scope opened by the dispatcher resolves the `polygon` set.
        const step = isGridSnapActive() ? getSegmentGridStep() : 0
        const snappedValue = step > 0 ? snapScalar(rawValue, step) : rawValue
        const newValue = Math.max(MIN_ROOF_DIM, snappedValue)
        const centerOffset = (side * (newValue - initialValue)) / 2
        const position: [number, number, number] = [
          initialPosition[0] + centerOffset * armX,
          initialPosition[1],
          initialPosition[2] + centerOffset * armZ,
        ]
        lastValue = newValue
        const dimensions =
          node.roofType === 'conical'
            ? { width: newValue, depth: newValue }
            : axis === 'x'
              ? { width: newValue }
              : { depth: newValue }
        useLiveNodeOverrides.getState().set(segmentId, { ...dimensions, position })
        useScene.getState().markDirty(segmentId)
      },
      canCommit() {
        return true
      },
      commit() {
        useLiveNodeOverrides.getState().clear(segmentId)
        const centerOffset = (side * (lastValue - initialValue)) / 2
        const position: [number, number, number] = [
          initialPosition[0] + centerOffset * armX,
          initialPosition[1],
          initialPosition[2] + centerOffset * armZ,
        ]
        const dimensions =
          node.roofType === 'conical'
            ? { width: lastValue, depth: lastValue }
            : axis === 'x'
              ? { width: lastValue }
              : { depth: lastValue }
        useScene.getState().updateNode(segmentId, { ...dimensions, position })
      },
    }
  },
}

/**
 * Gable ridge drag (floor-plan). Sister to the 3D ridge-position arrow: the
 * plan cursor, projected onto the segment's local Z, slides the ridge across
 * the depth through the ridge group's edit, so the locks decide what gives
 * way. A locked ridge does not move.
 */
export const roofSegmentRidgeAffordance: FloorplanAffordance<RoofSegmentNode> = {
  start({ node, nodes, initialPlanPoint }) {
    const segmentId = node.id as AnyNodeId
    const ridge = getGableRidge(node)
    const locks = readGableRidgeLocks(node.metadata)
    const { cx, cz, effRot } = resolveSegmentFrame(node, nodes)
    const cosEff = Math.cos(effRot)
    const sinEff = Math.sin(effRot)
    const projectLocalZ = (px: number, pz: number) => -(px - cx) * sinEff + (pz - cz) * cosEff
    const initialLocal = projectLocalZ(initialPlanPoint[0], initialPlanPoint[1])
    let lastPatch: Partial<RoofSegmentNode> | null = null

    return {
      affectedIds: [segmentId],
      apply({ planPoint }) {
        if (!ridge || locks.ridge) return
        const delta = projectLocalZ(planPoint[0], planPoint[1]) - initialLocal
        const step = isGridSnapActive() ? getSegmentGridStep() : 0
        const rawZ = ridge.ridgeZ + delta
        const ridgeZ = step > 0 ? snapScalar(rawZ, step) : rawZ
        lastPatch = applyGableRidgeEdit(
          node,
          {
            kind: 'position',
            side: 'front',
            value: node.depth / 2 - ridgeZ - getGableWallInsets(node).front,
          },
          locks,
        )
        if (!lastPatch) return
        useLiveNodeOverrides.getState().set(segmentId, lastPatch)
        useScene.getState().markDirty(segmentId)
      },
      canCommit() {
        return lastPatch !== null
      },
      commit() {
        useLiveNodeOverrides.getState().clear(segmentId)
        if (lastPatch) useScene.getState().updateNode(segmentId, lastPatch)
      },
    }
  },
}

/**
 * Canopy pull (floor-plan): drag an edge of what the roof covers out past the
 * walls (or back to them). The plan cursor, projected onto the edge's outward
 * normal, is how far the edge slides; `pullRoofSegmentCoverEdge` keeps the
 * slopes in their planes and the roof's walls on the house.
 */
export const roofSegmentPullAffordance: FloorplanAffordance<RoofSegmentNode> = {
  start({ node, payload, nodes, initialPlanPoint }) {
    const segmentId = node.id as AnyNodeId
    const edge = (payload as { edge: number }).edge
    const cover = getRoofSegmentCoverOutline(node)
    const [nx, nz] = getRoofRingEdgeNormal(cover, edge)
    const { effRot } = resolveSegmentFrame(node, nodes)
    const cosEff = Math.cos(effRot)
    const sinEff = Math.sin(effRot)
    // the edge's outward normal in plan (local x → (cos, sin), local z → (−sin, cos))
    const planNx = nx * cosEff - nz * sinEff
    const planNz = nx * sinEff + nz * cosEff
    const along = (px: number, pz: number) => px * planNx + pz * planNz
    const initialAlong = along(initialPlanPoint[0], initialPlanPoint[1])
    const [ex, ez] = cover[edge]!
    const initialReach = nx * ex + nz * ez
    // neighbouring lines to line the edge up with, gathered once per drag
    const snapPoints = getCanopySnapPoints(node, edge, nodes)
    let lastPatch: Partial<RoofSegmentNode> | null = null

    return {
      affectedIds: [segmentId],
      apply({ planPoint, modifiers }) {
        const raw = along(planPoint[0], planPoint[1]) - initialAlong
        const step = isGridSnapActive() ? getSegmentGridStep() : 0
        let distance = step > 0 ? snapScalar(raw, step) : raw
        // a neighbouring line within reach wins over the grid in every snapping
        // mode (as the 3D arrow's connection snap); Alt pulls freely
        if (!modifiers.altKey) {
          const reach = snapCanopyReach(node, edge, initialReach + raw, snapPoints)
          if (reach !== initialReach + raw) distance = reach - initialReach
        }
        lastPatch = pullRoofSegmentCoverEdge(node, edge, distance)
        if (!lastPatch) return
        useLiveNodeOverrides.getState().set(segmentId, lastPatch)
        useScene.getState().markDirty(segmentId)
      },
      canCommit() {
        return lastPatch !== null
      },
      commit() {
        useLiveNodeOverrides.getState().clear(segmentId)
        if (lastPatch) useScene.getState().updateNode(segmentId, lastPatch)
      },
    }
  },
}

/**
 * Roof-segment rotation drag (floor-plan). Sister to the 3D `arc-resize`
 * handle. Same `- delta` convention as the 3D handle: the floor-plan
 * builder plots the footprint at `-(roof.rotation + segment.rotation)`
 * (see `buildRoofSegmentFloorplan`'s `rotation` local), so the 2D
 * view rotates the same direction as 3D for the same `rotation` value,
 * and the same cursor gesture writes the same sign in both views.
 */
export const roofSegmentRotateAffordance: FloorplanAffordance<RoofSegmentNode> = {
  start({ node, nodes, initialPlanPoint }) {
    const segmentId = node.id as AnyNodeId
    const initialRotation = node.rotation ?? 0
    const { cx, cz } = resolveSegmentFrame(node, nodes)
    const initialAngle = Math.atan2(initialPlanPoint[1] - cz, initialPlanPoint[0] - cx)
    let lastRotation = initialRotation

    return {
      affectedIds: [segmentId],
      apply({ planPoint }) {
        const delta = rotateAffordanceDelta({
          center: [cx, cz],
          initialAngle,
          planPoint,
          free: !isAngleSnapActive(),
        })
        lastRotation = initialRotation - delta
        useLiveNodeOverrides.getState().set(segmentId, { rotation: lastRotation })
        useScene.getState().markDirty(segmentId)
      },
      canCommit() {
        return true
      },
      commit() {
        useLiveNodeOverrides.getState().clear(segmentId)
        useScene.getState().updateNode(segmentId, { rotation: lastRotation })
      },
    }
  },
}

/**
 * Roof-segment body-move target (floor-plan). The generic Path 2 move
 * fallback writes the cursor's plan position straight into `position`,
 * which is wrong for roof segments because `position` is **roof-local**
 * (the floorplan builder composes parent roof's transform to render).
 * This target inverts the parent roof's transform so the segment moves
 * to the cursor's WORLD-plan position, not to a roof-local interpretation
 * of those world coords. Falls back to identity for orphaned segments.
 */
export const roofSegmentMoveTarget: FloorplanMoveTarget<RoofSegmentNode> = ({ node, nodes }) => {
  const segmentId = node.id as AnyNodeId
  const initialY = node.position[1]
  const { cx, cz, roofRot, cosRoof, sinRoof } = resolveSegmentFrame(node, nodes)
  const roofId = (node as unknown as { parentId?: AnyNodeId | null }).parentId
  const roof = roofId ? (nodes[roofId] as RoofNode | undefined) : undefined
  const roofPosX = roof?.position[0] ?? 0
  const roofPosZ = roof?.position[2] ?? 0
  const resolveCursor = createFloorplanCursorResolver({
    original: [cx, cz],
    metadata: node.metadata,
  })
  // Inverse of the forward transform `[cosRoof, -sinRoof; sinRoof, cosRoof]`
  // is `[cosRoof, sinRoof; -sinRoof, cosRoof]`. Used to project world cursor
  // back into roof-local coords.
  void roofRot
  let lastLocal: [number, number, number] = [node.position[0], node.position[1], node.position[2]]

  return {
    affectedIds: [segmentId],
    apply({ planPoint }) {
      // Mode-aware: `getSegmentGridStep()` is 0 outside grid mode (so `lines` /
      // `off` move freely), and the `moving` scope resolves the `polygon` set
      // via the kind's `snapProfile` — no held-Shift bypass.
      const step = isGridSnapActive() ? getSegmentGridStep() : 0
      const snap = (value: number) => snapScalar(value, step)
      const worldPoint = resolveCursor(planPoint, { snap })
      const dx = worldPoint[0] - roofPosX
      const dz = worldPoint[1] - roofPosZ
      let localX = dx * cosRoof + dz * sinRoof
      let localZ = -dx * sinRoof + dz * cosRoof
      lastLocal = [localX, initialY, localZ]
      useLiveNodeOverrides.getState().set(segmentId, { position: lastLocal })
      useScene.getState().markDirty(segmentId)
    },
    canCommit() {
      return true
    },
    commit() {
      useLiveNodeOverrides.getState().clear(segmentId)
      useScene.getState().updateNode(segmentId, { position: lastLocal })
    },
  }
}
