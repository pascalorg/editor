export type Vec3 = [number, number, number]

export type PrimitiveShapeKind = 'box' | 'cylinder' | 'sphere' | 'lathe'
export type PrimitiveAnchor = 'top' | 'bottom' | 'center' | 'front' | 'back' | 'left' | 'right'
export type PrimitiveAxis = 'x' | 'y' | 'z'

export interface PrimitiveShapeInput {
  kind: PrimitiveShapeKind | string
  name?: string
  position?: Vec3
  rotation?: Vec3
  scale?: Vec3
  length?: number
  width?: number
  height?: number
  radius?: number
  axis?: PrimitiveAxis | string
  radialSegments?: number
  widthSegments?: number
  heightSegments?: number
  attachTo?: number
  anchor?: PrimitiveAnchor | string
  childAnchor?: PrimitiveAnchor | string
  wallThickness?: number
  materialPreset?: string
  profile?: [number, number][]
  segments?: number
  arc?: number
}

export interface ResolvedPrimitiveTransform {
  position: Vec3
  rotation: Vec3
}

interface HalfExtents {
  x: number
  y: number
  z: number
}

function getHalfExtents(spec: PrimitiveShapeInput): HalfExtents {
  switch (spec.kind) {
    case 'box':
      return {
        x: (spec.length ?? 1.0) / 2,
        y: (spec.height ?? 1.0) / 2,
        z: (spec.width ?? 1.0) / 2,
    }
    case 'cylinder': {
      const r = spec.radius ?? 0.5
      const halfHeight = (spec.height ?? 1.0) / 2
      switch (spec.axis) {
        case 'x':
          return { x: halfHeight, y: r, z: r }
        case 'z':
          return { x: r, y: r, z: halfHeight }
        case 'y':
        default:
          return { x: r, y: halfHeight, z: r }
      }
    }
    case 'sphere': {
      const r = spec.radius ?? 0.5
      const sx = spec.scale?.[0] ?? 1
      const sy = spec.scale?.[1] ?? 1
      const sz = spec.scale?.[2] ?? 1
      return { x: r * sx, y: r * sy, z: r * sz }
    }
    case 'lathe': {
      const profile = spec.profile ?? [[0, 0], [0.5, 1]]
      let maxX = 0
      let minY = Infinity
      let maxY = -Infinity
      for (const [x, y] of profile) {
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
      return { x: maxX, y: (maxY - minY) / 2, z: maxX }
    }
    default:
      return { x: 0.5, y: 0.5, z: 0.5 }
  }
}

function getAnchorOffset(anchor: string, he: HalfExtents): Vec3 {
  switch (anchor) {
    case 'top':
      return [0, he.y, 0]
    case 'bottom':
      return [0, -he.y, 0]
    case 'center':
      return [0, 0, 0]
    case 'front':
      return [0, 0, he.z]
    case 'back':
      return [0, 0, -he.z]
    case 'left':
      return [-he.x, 0, 0]
    case 'right':
      return [he.x, 0, 0]
    default:
      return [0, he.y, 0]
  }
}

function getAnchorAxis(anchor: string): 'x' | 'y' | 'z' | null {
  switch (anchor) {
    case 'top':
    case 'bottom':
      return 'y'
    case 'left':
    case 'right':
      return 'x'
    case 'front':
    case 'back':
      return 'z'
    default:
      return null
  }
}

function rotateVector(v: Vec3, euler: Vec3): Vec3 {
  let [x, y, z] = v

  const cz = Math.cos(euler[2])
  const sz = Math.sin(euler[2])
  ;[x, y] = [x * cz - y * sz, x * sz + y * cz]

  const cy = Math.cos(euler[1])
  const sy = Math.sin(euler[1])
  ;[x, z] = [x * cy + z * sy, -x * sy + z * cy]

  const cx = Math.cos(euler[0])
  const sx = Math.sin(euler[0])
  ;[y, z] = [y * cx - z * sx, y * sx + z * cx]

  return [x, y, z]
}

type Mat3 = [number, number, number, number, number, number, number, number, number]

function eulerToMatrix(euler: Vec3): Mat3 {
  const [x, y, z] = euler
  const cx = Math.cos(x)
  const sx = Math.sin(x)
  const cy = Math.cos(y)
  const sy = Math.sin(y)
  const cz = Math.cos(z)
  const sz = Math.sin(z)

  return [
    cy * cz,
    -cy * sz,
    sy,
    cx * sz + sx * sy * cz,
    cx * cz - sx * sy * sz,
    -sx * cy,
    sx * sz - cx * sy * cz,
    sx * cz + cx * sy * sz,
    cx * cy,
  ]
}

function multiplyMatrix(a: Mat3, b: Mat3): Mat3 {
  return [
    a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
    a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
    a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
    a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
    a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
    a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
    a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
    a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
    a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
  ]
}

function rotateVectorByMatrix(v: Vec3, m: Mat3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ]
}

function matrixToEuler(m: Mat3): Vec3 {
  const y = Math.asin(Math.max(-1, Math.min(1, m[2])))
  const cy = Math.cos(y)

  if (Math.abs(cy) < 1e-8) {
    return [0, y, Math.atan2(m[3], m[4])]
  }

  return [Math.atan2(-m[5], m[8]), y, Math.atan2(-m[1], m[0])]
}

function addVec(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

function subtractVec(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function getAxisRotation(spec: PrimitiveShapeInput): Vec3 {
  if (spec.kind !== 'cylinder') return [0, 0, 0]

  switch (spec.axis) {
    case 'x':
      return [0, 0, -Math.PI / 2]
    case 'z':
      return [Math.PI / 2, 0, 0]
    case 'y':
    default:
      return [0, 0, 0]
  }
}

function getLocalRotationMatrix(spec: PrimitiveShapeInput): Mat3 {
  const rotation = spec.rotation ?? [0, 0, 0]
  return multiplyMatrix(eulerToMatrix(rotation), eulerToMatrix(getAxisRotation(spec)))
}

function getSemanticRotationMatrix(spec: PrimitiveShapeInput): Mat3 {
  return eulerToMatrix(spec.rotation ?? [0, 0, 0])
}

export interface ResolveTransformsOptions {
  positionMode?: 'anchor-offset' | 'world-center'
}

export function resolvePrimitiveWorldTransforms(
  shapes: readonly PrimitiveShapeInput[],
  options?: ResolveTransformsOptions,
): ResolvedPrimitiveTransform[] {
  const results: ResolvedPrimitiveTransform[] = []
  const semanticRotations: Mat3[] = []

  for (let i = 0; i < shapes.length; i++) {
    const shape = shapes[i]
    if (!shape) {
      results[i] = { position: [0, 0, 0], rotation: [0, 0, 0] }
      semanticRotations[i] = eulerToMatrix([0, 0, 0])
      continue
    }

    const position = shape.position ?? [0, 0, 0]
    const localRotationMatrix = getLocalRotationMatrix(shape)
    const semanticRotationMatrix = getSemanticRotationMatrix(shape)
    const localRotation = matrixToEuler(localRotationMatrix)

    if (shape.attachTo === undefined || shape.attachTo >= i) {
      results[i] = { position, rotation: localRotation }
      semanticRotations[i] = semanticRotationMatrix
      continue
    }

    const parent = results[shape.attachTo]
    const parentSpec = shapes[shape.attachTo]
    const parentSemanticRotationMatrix = semanticRotations[shape.attachTo]
    if (!parent || !parentSpec || !parentSemanticRotationMatrix) {
      results[i] = { position, rotation: localRotation }
      semanticRotations[i] = semanticRotationMatrix
      continue
    }

    const parentHE = getHalfExtents(parentSpec)
    const anchor = shape.anchor ?? 'top'
    const childAnchor = shape.childAnchor ?? 'center'
    const childHE = getHalfExtents(shape)
    const anchorOffset = getAnchorOffset(anchor, parentHE)
    const composedSemanticRotationMatrix = multiplyMatrix(parentSemanticRotationMatrix, semanticRotationMatrix)
    const composedRotationMatrix = multiplyMatrix(parentSemanticRotationMatrix, localRotationMatrix)
    const childAnchorOffset = getAnchorOffset(childAnchor, childHE)

    const useWorldCenter = options?.positionMode === 'world-center'
    const anchorAxis = getAnchorAxis(anchor)
    const childAnchorAxis = getAnchorAxis(childAnchor)

    if (useWorldCenter && anchorAxis && anchorAxis === childAnchorAxis) {
      // World-center mode: position is the child's intended world-space center.
      // Auto-snap only the anchor axis so childAnchor touches parent anchor.
      const parentAnchorWorld = addVec(
        parent.position,
        rotateVectorByMatrix(anchorOffset, parentSemanticRotationMatrix),
      )
      const childAnchorWorldOffset = rotateVectorByMatrix(
        childAnchorOffset,
        composedSemanticRotationMatrix,
      )
      const childAnchorCurrent = addVec(position, childAnchorWorldOffset)
      const correction = subtractVec(parentAnchorWorld, childAnchorCurrent)

      const axisIndex = anchorAxis === 'x' ? 0 : anchorAxis === 'y' ? 1 : 2
      const snapped: Vec3 = [position[0], position[1], position[2]]
      snapped[axisIndex] += correction[axisIndex]

      results[i] = {
        position: snapped,
        rotation: matrixToEuler(composedRotationMatrix),
      }
    } else if (useWorldCenter) {
      // World-center mode without snap: position is world-space center,
      // only inherit parent rotation, no anchor-based position adjustment.
      results[i] = {
        position,
        rotation: matrixToEuler(composedRotationMatrix),
      }
    } else {
      // Anchor-offset mode (legacy): position is local offset from parent anchor
      const localCenterOffset = subtractVec(
        position,
        rotateVectorByMatrix(childAnchorOffset, semanticRotationMatrix),
      )
      const worldAnchorOffset = rotateVectorByMatrix(anchorOffset, parentSemanticRotationMatrix)
      const worldLocalPos = rotateVectorByMatrix(localCenterOffset, parentSemanticRotationMatrix)

      results[i] = {
        position: addVec(parent.position, addVec(worldAnchorOffset, worldLocalPos)),
        rotation: matrixToEuler(composedRotationMatrix),
      }
    }
    semanticRotations[i] = composedSemanticRotationMatrix
  }

  return results
}
