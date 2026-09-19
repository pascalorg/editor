export const PALM_UP_DOT_THRESHOLD = 0.5

type Point = { x: number; y: number; z: number }

function isFinitePoint(point: Point) {
  return Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)
}

export function isPalmFacingUp(
  wrist: Point,
  indexMetacarpal: Point,
  pinkyMetacarpal: Point,
  handedness: XRHandedness,
  threshold = PALM_UP_DOT_THRESHOLD,
) {
  if (
    !isFinitePoint(wrist) ||
    !isFinitePoint(indexMetacarpal) ||
    !isFinitePoint(pinkyMetacarpal) ||
    (handedness !== 'left' && handedness !== 'right')
  )
    return false

  const indexX = indexMetacarpal.x - wrist.x
  const indexY = indexMetacarpal.y - wrist.y
  const indexZ = indexMetacarpal.z - wrist.z
  const pinkyX = pinkyMetacarpal.x - wrist.x
  const pinkyY = pinkyMetacarpal.y - wrist.y
  const pinkyZ = pinkyMetacarpal.z - wrist.z
  const normalY = indexZ * pinkyX - indexX * pinkyZ
  const normalLength = Math.hypot(
    indexY * pinkyZ - indexZ * pinkyY,
    normalY,
    indexX * pinkyY - indexY * pinkyX,
  )
  if (normalLength === 0) return false
  return (normalY * (handedness === 'right' ? 1 : -1)) / normalLength >= threshold
}
