export type BlockTransformAxis = 'x' | 'y' | 'z'
export type BlockTransformOperation = 'translate' | 'rotate' | 'scale'
export type BlockTransformConstraint = BlockTransformAxis | 'free' | 'uniform'

export type BlockActiveTransform = {
  operation: BlockTransformOperation
  constraint: BlockTransformConstraint
}

export type BlockAxisVisualState = 'normal' | 'active' | 'faded'

export type BlockScreenPoint = { x: number; y: number }

export function blockRotationPointerAngle(
  pivot: BlockScreenPoint,
  start: BlockScreenPoint,
  current: BlockScreenPoint,
): number {
  const startDistanceSquared = (start.x - pivot.x) ** 2 + (start.y - pivot.y) ** 2
  if (startDistanceSquared < 64) {
    return (current.x - start.x - (current.y - start.y)) * 0.01
  }
  return (
    Math.atan2(current.y - pivot.y, current.x - pivot.x) -
    Math.atan2(start.y - pivot.y, start.x - pivot.x)
  )
}

export function blockTransformAxisFromKey(key: string): BlockTransformAxis | null {
  const normalized = key.toLowerCase()
  return normalized === 'x' || normalized === 'y' || normalized === 'z' ? normalized : null
}

export function blockAxisDelta(
  axis: BlockTransformAxis,
  distance: number,
): [number, number, number] {
  return [axis === 'x' ? distance : 0, axis === 'y' ? distance : 0, axis === 'z' ? distance : 0]
}

export function blockAxisVisualState(
  activeTransform: BlockActiveTransform | null,
  operation: BlockTransformOperation,
  axis: BlockTransformAxis,
): BlockAxisVisualState {
  if (!activeTransform) return 'normal'
  if (activeTransform.operation !== operation) return 'faded'
  if (activeTransform.constraint === 'free' || activeTransform.constraint === 'uniform') {
    return 'normal'
  }
  return activeTransform.constraint === axis ? 'active' : 'faded'
}

export function blockModalTransformStatus(activeTransform: BlockActiveTransform): string {
  const operation =
    activeTransform.operation === 'translate'
      ? 'Move'
      : activeTransform.operation === 'rotate'
        ? 'Rotate'
        : 'Scale'
  const constraint =
    activeTransform.constraint === 'free'
      ? 'free'
      : activeTransform.constraint === 'uniform'
        ? 'uniform'
        : `${activeTransform.constraint.toUpperCase()} axis`
  return `${operation} · ${constraint} · X/Y/Z constrains · click applies · Esc cancels`
}
