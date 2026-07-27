export type FloorplanCursorPoint = {
  x: number
  y: number
}

type Matrix2D = {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

export function projectFloorplanCursorPoint(
  point: readonly [number, number],
  sceneToViewport: Matrix2D,
  overlayOrigin: FloorplanCursorPoint,
): FloorplanCursorPoint {
  return {
    x:
      sceneToViewport.a * point[0] +
      sceneToViewport.c * point[1] +
      sceneToViewport.e -
      overlayOrigin.x,
    y:
      sceneToViewport.b * point[0] +
      sceneToViewport.d * point[1] +
      sceneToViewport.f -
      overlayOrigin.y,
  }
}

export function resolveFloorplanCursorIndicatorPosition(
  cursorPosition: FloorplanCursorPoint | null,
  projectedCursorPosition: FloorplanCursorPoint | null,
): FloorplanCursorPoint | null {
  return projectedCursorPosition ?? cursorPosition
}
