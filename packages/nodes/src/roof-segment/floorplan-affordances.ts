import {
  type AnyNodeId,
  type FloorplanAffordance,
  type FloorplanMoveTarget,
  getRoofSegmentResizePatch,
  type RoofNode,
  type RoofSegmentNode,
  snapScalar,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import {
  getSegmentGridStep,
  isAngleSnapActive,
  isGridSnapActive,
  isMagneticSnapActive,
} from '@pascal-app/editor'
import { commitSeatedRoofEdit } from '../roof/roof-level-target'
import {
  bearingWallThickness,
  catchRoofOnWalls,
  catchRoofSideOnWalls,
  placeRoofOnWalls,
  roofCatchWalls,
  segmentWallLine,
} from '../roof/wall-catch'
import { createFloorplanCursorResolver } from '../shared/floorplan-cursor'
import { rotateAffordanceDelta } from '../shared/rotate-affordance'

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
          // Grown onto the walls that carry it, its roof goes to the level above them.
          commitSeatedRoofEdit(
            [{ id: segmentId, data: { width: diameter, depth: diameter } }],
            segmentId,
          )
        },
      }
    }

    const { axis, side } = resize
    const initialValue = axis === 'x' ? node.width : node.depth
    const { effRot } = resolveSegmentFrame(node, nodes)
    const roofId = (node as unknown as { parentId?: AnyNodeId | null }).parentId
    const roof = roofId ? (nodes[roofId] as RoofNode | undefined) : undefined
    const walls = roofCatchWalls(nodes, roof?.parentId)
    const line = {
      center: [cx, cz] as const,
      angle: effRot,
      hw: node.width / 2,
      hd: node.depth / 2,
      wallThickness: node.wallThickness,
    }
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
    // Sized onto the walls under it, its gable and heel walls take their thickness; off them, it
    // keeps its own (the live override merges, so it is always written).
    const resized = (value: number): Partial<RoofSegmentNode> => {
      const patch = getRoofSegmentResizePatch(node, axis, side, value)
      const thickness = bearingWallThickness(
        segmentWallLine(roof ?? { position: [0, 0, 0], rotation: 0 }, { ...node, ...patch }),
        walls,
      )
      return { ...patch, wallThickness: thickness ?? node.wallThickness }
    }

    return {
      affectedIds: [segmentId],
      apply({ planPoint, modifiers }) {
        const currentLocal = projectLocalAxis(planPoint[0], planPoint[1])
        const delta = (currentLocal - initialLocal) * side
        const rawValue = initialValue + delta
        // Mode-aware grid step (0 outside grid mode, so `lines` / `off` resize
        // freely — the "smooth" behaviour that used to need a held Shift). The
        // reshaping scope opened by the dispatcher resolves the `polygon` set.
        // Alt holds the raw cursor, as in 3D.
        const free = modifiers.altKey
        const step = !free && isGridSnapActive() ? getSegmentGridStep() : 0
        let snappedValue = step > 0 ? snapScalar(rawValue, step) : rawValue
        // The dragged side lands on a wall under it in grid and lines, as a move does.
        if (!free && (isGridSnapActive() || isMagneticSnapActive())) {
          snappedValue =
            catchRoofSideOnWalls({ line, axis, side, value: rawValue, walls }) ?? snappedValue
        }
        const newValue = Math.max(MIN_ROOF_DIM, snappedValue)
        lastValue = newValue
        useLiveNodeOverrides.getState().set(segmentId, resized(newValue))
        useScene.getState().markDirty(segmentId)
      },
      canCommit() {
        return true
      },
      commit() {
        useLiveNodeOverrides.getState().clear(segmentId)
        commitSeatedRoofEdit([{ id: segmentId, data: resized(lastValue) }], segmentId)
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
        commitSeatedRoofEdit([{ id: segmentId, data: { rotation: lastRotation } }], segmentId)
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
  const { cx, cz, effRot, cosRoof, sinRoof } = resolveSegmentFrame(node, nodes)
  const roofId = (node as unknown as { parentId?: AnyNodeId | null }).parentId
  const roof = roofId ? (nodes[roofId] as RoofNode | undefined) : undefined
  const roofPosX = roof?.position[0] ?? 0
  const roofPosZ = roof?.position[2] ?? 0
  const resolveCursor = createFloorplanCursorResolver({
    original: [cx, cz],
    metadata: node.metadata,
  })
  const walls = roofCatchWalls(nodes, roof?.parentId)
  let lastLocal: [number, number, number] = [node.position[0], node.position[1], node.position[2]]
  // Off them again, it keeps its own (the live override merges, so it is always written).
  let lastThickness = node.wallThickness
  const moved = (): Partial<RoofSegmentNode> => ({
    position: lastLocal,
    wallThickness: lastThickness,
  })

  return {
    affectedIds: [segmentId],
    apply({ planPoint, modifiers }) {
      // Mode-aware: `getSegmentGridStep()` is 0 outside grid mode (so `lines` /
      // `off` move freely), and the `moving` scope resolves the `polygon` set
      // via the kind's `snapProfile` — no held-Shift bypass. Alt holds the raw cursor, as in 3D.
      const free = modifiers.altKey
      const step = !free && isGridSnapActive() ? getSegmentGridStep() : 0
      const snap = (value: number) => snapScalar(value, step)
      const raw = resolveCursor(planPoint)
      let worldPoint = resolveCursor(planPoint, { snap })
      // Its wall line lands on the walls under it in grid and lines, its outer face on a porch's
      // invisible walls or a deck's railings.
      if (!free && (isGridSnapActive() || isMagneticSnapActive())) {
        const caught = catchRoofOnWalls({
          lines: [
            {
              center: raw,
              angle: effRot,
              hw: node.width / 2,
              hd: node.depth / 2,
              wallThickness: node.wallThickness,
            },
          ],
          walls,
          angle: effRot,
        })
        worldPoint = placeRoofOnWalls(raw, worldPoint, caught, effRot)
      }
      const dx = worldPoint[0] - roofPosX
      const dz = worldPoint[1] - roofPosZ
      let localX = dx * cosRoof + dz * sinRoof
      let localZ = -dx * sinRoof + dz * cosRoof
      lastLocal = [localX, initialY, localZ]
      // Moved onto the walls under it, its gable and heel walls take their thickness.
      lastThickness =
        bearingWallThickness(
          { center: worldPoint, angle: effRot, hw: node.width / 2, hd: node.depth / 2 },
          walls,
        ) ?? node.wallThickness
      useLiveNodeOverrides.getState().set(segmentId, moved())
      useScene.getState().markDirty(segmentId)
    },
    canCommit() {
      return true
    },
    commit() {
      useLiveNodeOverrides.getState().clear(segmentId)
      // Dragged onto the walls that carry it, its roof goes to the level above them.
      commitSeatedRoofEdit([{ id: segmentId, data: moved() }], segmentId)
    },
  }
}
