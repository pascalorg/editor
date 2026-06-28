import {
  type AnyNodeId,
  type FloorplanAffordance,
  type FloorplanMoveTarget,
  type RoofNode,
  type RoofSegmentNode,
  snapScalar,
  useScene,
} from '@pascal-app/core'
import { getSegmentGridStep } from '@pascal-app/editor'
import { createFloorplanCursorResolver } from '../shared/floorplan-cursor'
import { rotateAffordanceDelta } from '../shared/rotate-affordance'

const MIN_ROOF_DIM = 1

type RoofSegmentResizePayload = { axis: 'x' | 'z'; side: 1 | -1 }

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
 * `linear-resize` handles in `definition.ts` — `anchor: 'center'`
 * means dragging outward on either +/-X (or +/-Z) edge grows the
 * dimension by 2× the segment-local cursor offset while the segment's
 * roof-local position stays put. Projects the plan cursor onto the
 * segment's effective rotation (roof.rotation + segment.rotation) so
 * the math survives any parent-roof rotation.
 */
export const roofSegmentResizeAffordance: FloorplanAffordance<RoofSegmentNode> = {
  start({ node, payload, nodes, initialPlanPoint }) {
    const { axis, side } = payload as RoofSegmentResizePayload
    const segmentId = node.id as AnyNodeId
    const initialValue = axis === 'x' ? node.width : node.depth
    const { cx, cz, effRot } = resolveSegmentFrame(node, nodes)
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
        const rawValue = initialValue + 2 * delta
        // Mode-aware grid step (0 outside grid mode, so `lines` / `off` resize
        // freely — the "smooth" behaviour that used to need a held Shift). The
        // reshaping scope opened by the dispatcher resolves the `polygon` set.
        const step = getSegmentGridStep()
        const snappedValue = step > 0 ? snapScalar(rawValue, step) : rawValue
        const newValue = Math.max(MIN_ROOF_DIM, snappedValue)
        lastValue = newValue
        useScene
          .getState()
          .updateNode(segmentId, axis === 'x' ? { width: newValue } : { depth: newValue })
      },
      canCommit() {
        return true
      },
      commit() {
        useScene
          .getState()
          .updateNode(segmentId, axis === 'x' ? { width: lastValue } : { depth: lastValue })
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
      apply({ planPoint, modifiers }) {
        const delta = rotateAffordanceDelta({
          center: [cx, cz],
          initialAngle,
          planPoint,
          free: modifiers.shiftKey,
        })
        lastRotation = initialRotation - delta
        useScene.getState().updateNode(segmentId, { rotation: lastRotation })
      },
      canCommit() {
        return true
      },
      commit() {
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
      const step = getSegmentGridStep()
      const snap = (value: number) => snapScalar(value, step)
      const worldPoint = resolveCursor(planPoint, { snap })
      const dx = worldPoint[0] - roofPosX
      const dz = worldPoint[1] - roofPosZ
      let localX = dx * cosRoof + dz * sinRoof
      let localZ = -dx * sinRoof + dz * cosRoof
      lastLocal = [localX, initialY, localZ]
      useScene.getState().updateNode(segmentId, { position: lastLocal })
    },
    canCommit() {
      return true
    },
    commit() {
      useScene.getState().updateNode(segmentId, { position: lastLocal })
    },
  }
}
