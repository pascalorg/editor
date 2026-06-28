import {
  type AnyNodeId,
  type ElevatorNode,
  type FloorplanAffordance,
  useScene,
} from '@pascal-app/core'
import { rotateAffordanceDelta } from '../shared/rotate-affordance'

const MIN_ELEVATOR_DIM = 0.6

type ElevatorResizePayload = { axis: 'x' | 'z'; side: 1 | -1 }

/**
 * Elevator width / depth drag (floor-plan). Mirrors the 3D
 * `linear-resize` handles declared in `definition.ts` — `anchor: 'center'`
 * means dragging outward on either +X or -X edge grows `width` by 2×
 * the elevator-local cursor offset while `position` stays put. Same for
 * +Z / -Z and `depth`. Writes directly to scene each tick (door pattern);
 * the registry dispatcher snapshots / pauses history at start so the
 * per-tick writes collapse into one undoable entry on commit.
 */
export const elevatorResizeAffordance: FloorplanAffordance<ElevatorNode> = {
  start({ node, payload, initialPlanPoint }) {
    const { axis, side } = payload as ElevatorResizePayload
    const elevatorId = node.id as AnyNodeId
    const initialValue = axis === 'x' ? node.width : node.depth
    const cx = node.position[0]
    const cz = node.position[2]
    const rotation = node.rotation ?? 0
    const cos = Math.cos(rotation)
    const sin = Math.sin(rotation)
    // Inverse of the elevator's local→plan rotation. The plan-space
    // matrix is `[c, s; -s, c]`; its inverse is `[c, -s; s, c]`.
    const projectLocalAxis = (px: number, pz: number): number => {
      const lx = (px - cx) * cos - (pz - cz) * sin
      const ly = (px - cx) * sin + (pz - cz) * cos
      return axis === 'x' ? lx : ly
    }
    const initialLocal = projectLocalAxis(initialPlanPoint[0], initialPlanPoint[1])
    let lastValue = initialValue

    return {
      affectedIds: [elevatorId],
      apply({ planPoint }) {
        const currentLocal = projectLocalAxis(planPoint[0], planPoint[1])
        // `side` is +1 for the +axis arrow, -1 for the -axis arrow.
        // Pointer delta along the arrow's outward direction grows the
        // full span 2× (centre anchor).
        const delta = (currentLocal - initialLocal) * side
        const newValue = Math.max(MIN_ELEVATOR_DIM, initialValue + 2 * delta)
        lastValue = newValue
        useScene
          .getState()
          .updateNode(elevatorId, axis === 'x' ? { width: newValue } : { depth: newValue })
      },
      canCommit() {
        return true
      },
      commit() {
        useScene
          .getState()
          .updateNode(elevatorId, axis === 'x' ? { width: lastValue } : { depth: lastValue })
      },
    }
  },
}

/**
 * Elevator rotation drag (floor-plan). Sister to the 3D `arc-resize`
 * handle declared in `definition.ts`. Same `- delta` sign convention as
 * the 3D path so dragging the cursor in the same direction in both views
 * produces the same rotation. Writes directly to scene during the drag;
 * the registry dispatcher captures a snapshot first and re-applies the
 * single tracked update on pointer-up.
 */
export const elevatorRotateAffordance: FloorplanAffordance<ElevatorNode> = {
  start({ node, initialPlanPoint }) {
    const elevatorId = node.id as AnyNodeId
    const initialRotation = node.rotation ?? 0
    const cx = node.position[0]
    const cz = node.position[2]
    const initialAngle = Math.atan2(initialPlanPoint[1] - cz, initialPlanPoint[0] - cx)
    let lastRotation = initialRotation

    return {
      affectedIds: [elevatorId],
      apply({ planPoint, modifiers }) {
        const delta = rotateAffordanceDelta({
          center: [cx, cz],
          initialAngle,
          planPoint,
          free: modifiers.shiftKey,
        })
        const newRotation = initialRotation - delta
        lastRotation = newRotation
        useScene.getState().updateNode(elevatorId, { rotation: newRotation })
      },
      canCommit() {
        return true
      },
      commit() {
        useScene.getState().updateNode(elevatorId, { rotation: lastRotation })
      },
    }
  },
}
