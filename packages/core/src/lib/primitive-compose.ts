export type Vec3 = [number, number, number]

export type PrimitiveShapeKind =
  | 'box'
  | 'cylinder'
  | 'hollow-cylinder'
  | 'cone'
  | 'frustum'
  | 'sphere'
  | 'hemisphere'
  | 'torus'
  | 'wedge'
  | 'trapezoid-prism'
  | 'lathe'
  | 'capsule'
  | 'half-cylinder'
  | 'rounded-panel'
  | 'conformal-strip'
  | 'extrude'
  | 'sweep'
export type PrimitiveAnchor = 'top' | 'bottom' | 'center' | 'front' | 'back' | 'left' | 'right'
export type PrimitiveAxis = 'x' | 'y' | 'z'
export interface PrimitiveMaterialInput {
  id?: string
  preset?: string
  properties?: {
    color?: string
    roughness?: number
    metalness?: number
    opacity?: number
    transparent?: boolean
    side?: 'front' | 'back' | 'double'
  }
}

export interface PrimitiveGeometryBrief {
  category?: string
  units?: string
  coordinateConvention?: string
  coordinateSystem?: string
  expectedDimensions?: {
    length?: number
    width?: number
    height?: number
    [key: string]: number | undefined
  }
  requiredRoles?: string[]
  semanticRoles?: string[]
  validationTargets?: string[]
  assumptions?: string[]
}

export interface PrimitiveArrayInput {
  count?: number
  columns?: number
  rows?: number
  layers?: number
  spacing?: Vec3 | number
  step?: Vec3
  axis?: PrimitiveAxis | string
  mode?: 'expand' | 'metadata' | 'instanced' | string
  patternId?: string
}

export type PrimitiveCutoutKind = 'rectangular' | 'round' | 'slot' | 'polygon' | string
export type PrimitivePortKind =
  | 'inlet'
  | 'outlet'
  | 'access'
  | 'support'
  | 'drive'
  | 'instrument'
  | 'generic'
  | string
export type PrimitivePatternKind = 'linear' | 'grid' | 'radial' | string
export type PrimitiveDuctCrossSection = 'round' | 'rectangular' | 'oval' | string

export interface PrimitiveCutoutInput {
  id?: string
  kind: PrimitiveCutoutKind
  semanticRole?: string
  position?: Vec3
  normal?: Vec3
  axis?: PrimitiveAxis | string
  length?: number
  width?: number
  height?: number
  radius?: number
  depth?: number
  profile?: [number, number][]
  through?: boolean
  bevelRadius?: number
  bevelSegments?: number
}

export interface PrimitivePortMarkerInput {
  id?: string
  kind?: PrimitivePortKind
  semanticRole?: string
  position?: Vec3
  normal?: Vec3
  axis?: PrimitiveAxis | string
  radius?: number
  width?: number
  height?: number
  direction?: 'in' | 'out' | 'bidirectional' | string
  connectsTo?: string
}

export interface PrimitivePatternInput {
  id?: string
  kind: PrimitivePatternKind
  semanticRole?: string
  count?: number
  columns?: number
  rows?: number
  layers?: number
  spacing?: Vec3 | number
  step?: Vec3
  axis?: PrimitiveAxis | string
  radius?: number
  startAngle?: number
  endAngle?: number
  sourceShapeId?: string
  mode?: 'expanded' | 'metadata' | 'instanced' | string
  instances?: Array<{
    position?: Vec3
    rotation?: Vec3
    scale?: Vec3
    name?: string
  }>
}

export interface PrimitiveDuctInput {
  crossSection?: PrimitiveDuctCrossSection
  width?: number
  height?: number
  radius?: number
  wallThickness?: number
  taper?: {
    startWidth?: number
    startHeight?: number
    startRadius?: number
    endWidth?: number
    endHeight?: number
    endRadius?: number
  }
  branchPorts?: PrimitivePortMarkerInput[]
}

export interface PrimitiveBevelContract {
  radius?: number
  chamfer?: number
  segments?: number
  size?: number
  thickness?: number
}

export interface PrimitiveShapeContract {
  cutouts?: PrimitiveCutoutInput[]
  ports?: PrimitivePortMarkerInput[]
  pattern?: PrimitivePatternInput
  duct?: PrimitiveDuctInput
  bevel?: PrimitiveBevelContract
}

export type PrimitiveEditableDimension =
  | 'primary'
  | 'uniform'
  | 'length'
  | 'width'
  | 'height'
  | 'depth'
  | 'thickness'
  | 'radius'
  | 'diameter'
  | 'majorRadius'
  | 'tubeRadius'
  | 'axisLength'
  | 'profileX'
  | 'profileY'

export interface PrimitiveEditableHints {
  primaryDimension?: PrimitiveEditableDimension | string
  canScale?: Array<PrimitiveEditableDimension | string>
  minFactor?: number
  maxFactor?: number
}

export interface PrimitiveShapeInput {
  kind: PrimitiveShapeKind | string
  name?: string
  semanticRole?: string
  semanticGroup?: string
  sourcePartKind?: string
  sourcePartId?: string
  editableHints?: PrimitiveEditableHints
  industrialArchetype?: string
  industrialVariant?: string
  position?: Vec3
  rotation?: Vec3
  scale?: Vec3
  length?: number
  width?: number
  height?: number
  depth?: number
  thickness?: number
  cornerRadius?: number
  bevelRadius?: number
  chamfer?: number
  cornerSegments?: number
  radius?: number
  axis?: PrimitiveAxis | string
  capSegments?: number
  radialSegments?: number
  tubularSegments?: number
  widthSegments?: number
  heightSegments?: number
  radiusTop?: number
  radiusBottom?: number
  majorRadius?: number
  tubeRadius?: number
  topScale?: [number, number]
  topLengthScale?: number
  topWidthScale?: number
  slopeAxis?: 'x' | 'z' | string
  slopeDirection?: 'positive' | 'negative' | string
  attachTo?: number | string
  anchor?: PrimitiveAnchor | string
  childAnchor?: PrimitiveAnchor | string
  wallThickness?: number
  surface?: string
  side?: 'left' | 'right' | string
  xStart?: number
  xEnd?: number
  verticalOffset?: number
  surfaceRadiusY?: number
  surfaceRadiusZ?: number
  surfaceLength?: number
  endTaper?: number
  materialPreset?: string
  material?: PrimitiveMaterialInput
  profile?: [number, number][]
  holes?: [number, number][][]
  path?: Vec3[]
  segments?: number
  arc?: number
  bevelSize?: number
  bevelThickness?: number
  bevelSegments?: number
  curveSegments?: number
  closed?: boolean
  cutouts?: PrimitiveCutoutInput[]
  ports?: PrimitivePortMarkerInput[]
  pattern?: PrimitivePatternInput
  duct?: PrimitiveDuctInput
  array?: PrimitiveArrayInput
  arrayCount?: number
  arrayStep?: Vec3
  arrayAxis?: PrimitiveAxis | string
  arrayColumns?: number
  arrayRows?: number
  arrayLayers?: number
  arraySpacing?: Vec3 | number
}

export type PrimitiveArrayExpandableShape = Omit<Partial<PrimitiveShapeInput>, 'material'> & {
  material?: unknown
  params?: Record<string, unknown>
  [key: string]: unknown
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function numberField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function integerField(value: unknown, fallback: number, min: number, max: number): number {
  const resolved = numberField(value) ?? fallback
  return Math.max(min, Math.min(max, Math.round(resolved)))
}

function vec3Field(value: unknown): Vec3 | undefined {
  return Array.isArray(value) &&
    value.length >= 3 &&
    value.slice(0, 3).every((entry) => typeof entry === 'number' && Number.isFinite(entry))
    ? [value[0] as number, value[1] as number, value[2] as number]
    : undefined
}

function compactPrimitiveContract<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(([, entry]) => {
      if (entry === undefined) return false
      if (Array.isArray(entry)) return entry.length > 0
      if (isRecord(entry)) return Object.keys(entry).length > 0
      return true
    }),
  ) as Partial<T>
}

export function extractPrimitiveShapeContract(
  shape: PrimitiveShapeInput,
): PrimitiveShapeContract | undefined {
  const bevel = compactPrimitiveContract<PrimitiveBevelContract>({
    radius: shape.bevelRadius ?? shape.cornerRadius,
    chamfer: shape.chamfer,
    segments: shape.bevelSegments ?? shape.cornerSegments,
    size: shape.bevelSize,
    thickness: shape.bevelThickness,
  })
  const contract = compactPrimitiveContract<PrimitiveShapeContract>({
    cutouts: shape.cutouts,
    ports: shape.ports,
    pattern: shape.pattern,
    duct: shape.duct,
    bevel: Object.keys(bevel).length > 0 ? bevel : undefined,
  })
  return Object.keys(contract).length > 0 ? (contract as PrimitiveShapeContract) : undefined
}

function arrayStepFromAxis(axis: unknown, spacing: unknown): Vec3 | undefined {
  const distance = numberField(spacing)
  if (distance == null) return undefined
  switch (typeof axis === 'string' ? axis.toLowerCase() : 'x') {
    case 'y':
      return [0, distance, 0]
    case 'z':
      return [0, 0, distance]
    default:
      return [distance, 0, 0]
  }
}

function stripPrimitiveArrayFields<T extends PrimitiveArrayExpandableShape>(shape: T): T {
  const {
    array: _array,
    arrayCount: _arrayCount,
    arrayStep: _arrayStep,
    arrayAxis: _arrayAxis,
    arrayColumns: _arrayColumns,
    arrayRows: _arrayRows,
    arrayLayers: _arrayLayers,
    arraySpacing: _arraySpacing,
    params: rawParams,
    ...rest
  } = shape
  const params = isRecord(rawParams)
    ? Object.fromEntries(
        Object.entries(rawParams).filter(
          ([key]) =>
            ![
              'array',
              'arrayCount',
              'arrayStep',
              'arrayAxis',
              'arrayColumns',
              'arrayRows',
              'arrayLayers',
              'arraySpacing',
            ].includes(key),
        ),
      )
    : rawParams
  return {
    ...rest,
    ...(isRecord(params) && Object.keys(params).length > 0 ? { params } : {}),
  } as T
}

export function expandPrimitiveShapeArrays<T extends PrimitiveArrayExpandableShape>(
  rawShapes: T[],
  options: { maxExpandedPerShape?: number } = {},
): T[] {
  const maxExpandedPerShape = integerField(options.maxExpandedPerShape, 80, 1, 1000)
  const expanded: T[] = []
  for (const shape of rawShapes) {
    const record = shape as Record<string, unknown>
    const params = isRecord(record.params) ? record.params : {}
    const array = isRecord(record.array) ? record.array : isRecord(params.array) ? params.array : {}
    const read = (key: string) => record[key] ?? params[key] ?? array[key]
    const columns = integerField(read('columns') ?? read('arrayColumns'), 1, 1, 24)
    const rows = integerField(read('rows') ?? read('arrayRows'), 1, 1, 24)
    const layers = integerField(read('layers') ?? read('arrayLayers'), 1, 1, 12)
    const explicitCount = numberField(read('arrayCount') ?? read('count'))
    const linearCount = explicitCount != null ? integerField(explicitCount, 1, 1, 80) : 1
    const total = columns * rows * layers > 1 ? columns * rows * layers : linearCount
    if (total <= 1) {
      expanded.push(stripPrimitiveArrayFields(shape))
      continue
    }

    const spacing = vec3Field(read('spacing') ?? read('arraySpacing'))
    const spacingScalar = numberField(read('spacing') ?? read('arraySpacing'))
    const step =
      vec3Field(read('step') ?? read('arrayStep')) ??
      (columns * rows * layers > 1
        ? [
            spacing?.[0] ?? spacingScalar ?? 0.25,
            spacing?.[1] ?? spacingScalar ?? 0,
            spacing?.[2] ?? spacingScalar ?? 0.25,
          ]
        : arrayStepFromAxis(read('axis') ?? read('arrayAxis'), spacingScalar ?? 0.25))
    const resolvedStep: Vec3 = step ?? [0.25, 0, 0]
    const basePosition = vec3Field(record.position ?? params.position) ?? [0, 0, 0]
    const baseName =
      typeof (record.name ?? params.name) === 'string'
        ? ((record.name ?? params.name) as string)
        : undefined
    const baseShape = stripPrimitiveArrayFields(shape)

    if (columns * rows * layers <= 1) {
      for (let index = 0; index < Math.min(total, maxExpandedPerShape); index += 1) {
        expanded.push({
          ...baseShape,
          position: [
            basePosition[0] + index * resolvedStep[0],
            basePosition[1] + index * resolvedStep[1],
            basePosition[2] + index * resolvedStep[2],
          ],
          ...(baseName ? { name: `${baseName} ${index + 1}` } : {}),
        } as T)
      }
      continue
    }

    let emitted = 0
    for (let layer = 0; layer < layers; layer += 1) {
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          if (emitted >= total || emitted >= maxExpandedPerShape) break
          expanded.push({
            ...baseShape,
            position: [
              basePosition[0] + column * resolvedStep[0],
              basePosition[1] + layer * resolvedStep[1],
              basePosition[2] + row * resolvedStep[2],
            ],
            ...(baseName ? { name: `${baseName} ${emitted + 1}` } : {}),
          } as T)
          emitted += 1
        }
      }
    }
  }
  return expanded
}

function getHalfExtents(spec: PrimitiveShapeInput): HalfExtents {
  switch (spec.kind) {
    case 'box':
      return {
        x: (spec.length ?? 1.0) / 2,
        y: (spec.height ?? 1.0) / 2,
        z: (spec.width ?? 1.0) / 2,
      }
    case 'cylinder':
    case 'hollow-cylinder':
    case 'cone':
    case 'frustum': {
      const r =
        spec.kind === 'frustum'
          ? Math.max(spec.radiusTop ?? 0.25, spec.radiusBottom ?? 0.5)
          : (spec.radius ?? 0.5)
      const halfHeight = (spec.height ?? 1.0) / 2
      switch (spec.axis) {
        case 'x':
          return { x: halfHeight, y: r, z: r }
        case 'z':
          return { x: r, y: r, z: halfHeight }
        default:
          return { x: r, y: halfHeight, z: r }
      }
    }
    case 'capsule':
    case 'half-cylinder': {
      const r = spec.radius ?? 0.5
      const halfHeight = (spec.height ?? 1.0) / 2
      switch (spec.axis) {
        case 'x':
          return { x: halfHeight, y: r, z: r }
        case 'z':
          return { x: r, y: r, z: halfHeight }
        default:
          return { x: r, y: halfHeight, z: r }
      }
    }
    case 'rounded-panel':
      return {
        x: (spec.length ?? 1.0) / 2,
        y: (spec.thickness ?? spec.height ?? 0.04) / 2,
        z: (spec.width ?? 0.5) / 2,
      }
    case 'conformal-strip': {
      const xStart = spec.xStart ?? -((spec.length ?? 1) / 2)
      const xEnd = spec.xEnd ?? (spec.length ?? 1) / 2
      return {
        x: Math.max(0.005, Math.abs(xEnd - xStart) / 2),
        y: (spec.surfaceRadiusY ?? 0.25) + (spec.thickness ?? 0.003),
        z: (spec.surfaceRadiusZ ?? 0.25) + (spec.thickness ?? 0.003),
      }
    }
    case 'sphere': {
      const r = spec.radius ?? 0.5
      const sx = spec.scale?.[0] ?? 1
      const sy = spec.scale?.[1] ?? 1
      const sz = spec.scale?.[2] ?? 1
      return { x: r * sx, y: r * sy, z: r * sz }
    }
    case 'hemisphere': {
      const r = spec.radius ?? 0.5
      const sx = spec.scale?.[0] ?? 1
      const sy = spec.scale?.[1] ?? 1
      const sz = spec.scale?.[2] ?? 1
      switch (spec.axis) {
        case 'x':
          return { x: (r * sx) / 2, y: r * sy, z: r * sz }
        case 'z':
          return { x: r * sx, y: r * sy, z: (r * sz) / 2 }
        default:
          return { x: r * sx, y: (r * sy) / 2, z: r * sz }
      }
    }
    case 'torus': {
      const ring = (spec.majorRadius ?? spec.radius ?? 0.5) + (spec.tubeRadius ?? 0.08)
      const tube = spec.tubeRadius ?? 0.08
      switch (spec.axis) {
        case 'x':
          return { x: tube, y: ring, z: ring }
        case 'y':
          return { x: ring, y: tube, z: ring }
        default:
          return { x: ring, y: ring, z: tube }
      }
    }
    case 'wedge':
    case 'trapezoid-prism':
      return {
        x: (spec.length ?? 1.0) / 2,
        y: (spec.height ?? 0.5) / 2,
        z: (spec.width ?? 1.0) / 2,
      }
    case 'lathe': {
      const profile = spec.profile ?? [
        [0, 0],
        [0.5, 1],
      ]
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
    case 'extrude': {
      const profile = spec.profile ?? [
        [-0.5, -0.25],
        [0.5, -0.25],
        [0.5, 0.25],
        [-0.5, 0.25],
      ]
      let minX = Infinity
      let maxX = -Infinity
      let minY = Infinity
      let maxY = -Infinity
      for (const [x, y] of profile) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
      return {
        x: Math.max(0.01, (maxX - minX) / 2),
        y: Math.max(0.01, (maxY - minY) / 2),
        z: (spec.depth ?? 0.1) / 2,
      }
    }
    case 'sweep': {
      const path = spec.path ?? [
        [-0.5, 0, 0],
        [0.5, 0, 0],
      ]
      const r = spec.radius ?? 0.03
      let minX = Infinity
      let maxX = -Infinity
      let minY = Infinity
      let maxY = -Infinity
      let minZ = Infinity
      let maxZ = -Infinity
      for (const [x, y, z] of path) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
        if (z < minZ) minZ = z
        if (z > maxZ) maxZ = z
      }
      return {
        x: Math.max(r, (maxX - minX) / 2 + r),
        y: Math.max(r, (maxY - minY) / 2 + r),
        z: Math.max(r, (maxZ - minZ) / 2 + r),
      }
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
  if (spec.kind === 'torus') {
    switch (spec.axis) {
      case 'x':
        return [0, Math.PI / 2, 0]
      case 'y':
        return [-Math.PI / 2, 0, 0]
      default:
        return [0, 0, 0]
    }
  }

  if (
    spec.kind !== 'cylinder' &&
    spec.kind !== 'hollow-cylinder' &&
    spec.kind !== 'cone' &&
    spec.kind !== 'frustum' &&
    spec.kind !== 'hemisphere' &&
    spec.kind !== 'capsule' &&
    spec.kind !== 'half-cylinder'
  ) {
    return [0, 0, 0]
  }

  switch (spec.axis) {
    case 'x':
      return [0, 0, -Math.PI / 2]
    case 'z':
      return [Math.PI / 2, 0, 0]
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

    if (typeof shape.attachTo !== 'number' || shape.attachTo >= i) {
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
    const composedSemanticRotationMatrix = multiplyMatrix(
      parentSemanticRotationMatrix,
      semanticRotationMatrix,
    )
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
