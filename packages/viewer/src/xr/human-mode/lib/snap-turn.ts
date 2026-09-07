import { SNAP_TURN_ANGLE, SNAP_TURN_THRESHOLD } from '../constants/human-mode-constants'

export { SNAP_TURN_ANGLE, SNAP_TURN_THRESHOLD }

export function resolveSnapTurnDirection(axis: number, threshold = SNAP_TURN_THRESHOLD) {
  if (!Number.isFinite(axis)) return 0
  if (axis >= threshold) return 1
  if (axis <= -threshold) return -1
  return 0
}

export function shouldSnapTurn(previousDirection: number, nextDirection: number) {
  return previousDirection === 0 && nextDirection !== 0
}
