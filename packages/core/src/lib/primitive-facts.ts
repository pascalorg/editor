import type {
  PrimitiveMaterialInput,
  PrimitiveShapeInput,
  ResolvedPrimitiveTransform,
  Vec3,
} from './primitive-compose'

export interface PrimitiveShapeFact {
  index: number
  kind: string
  name?: string
  semanticRole?: string
  semanticGroup?: string
  sourcePartKind?: string
  sourcePartId?: string
  center: Vec3
  halfExtents: Vec3
  min: Vec3
  max: Vec3
  materialColor?: string
}

export interface PrimitiveGeometryFacts {
  shapeCount: number
  bbox: {
    min: Vec3
    max: Vec3
  }
  dimensions: Vec3
  roles: Record<string, number>
  sourcePartKinds: Record<string, number>
  shapes: PrimitiveShapeFact[]
}

function numeric(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function scaleAt(scale: Vec3 | undefined, index: 0 | 1 | 2): number {
  return Math.abs(scale?.[index] ?? 1)
}

function materialColor(material: PrimitiveMaterialInput | undefined): string | undefined {
  const color = material?.properties?.color
  return typeof color === 'string' && color.trim() ? color.trim() : undefined
}

function inferPrimitiveSemanticRole(shape: PrimitiveShapeInput): string | undefined {
  const name = shape.name?.toLowerCase() ?? ''
  const sourcePartKind = shape.sourcePartKind?.toLowerCase()

  if (sourcePartKind === 'vehicle_body' && name.includes('body shell')) return 'vehicle_body'
  if (sourcePartKind === 'vehicle_wheels' && name.includes('tire')) return 'vehicle_tire'
  if (sourcePartKind === 'vehicle_windows') return 'vehicle_window'
  if (sourcePartKind === 'headlights') return 'headlight'
  if (sourcePartKind === 'bumper' && name.includes('front')) return 'front_bumper'
  if (sourcePartKind === 'bumper' && name.includes('rear')) return 'rear_bumper'
  if (sourcePartKind === 'bicycle_wheels' && name.includes('tire')) return 'bicycle_tire'
  if (sourcePartKind === 'bicycle_frame') return 'bicycle_frame'
  if (sourcePartKind === 'bicycle_fork') return 'bicycle_fork'
  if (sourcePartKind === 'handlebar') return 'handlebar'
  if (sourcePartKind === 'saddle') return 'saddle'
  if (sourcePartKind === 'chain_loop') return 'chain_loop'

  if (name.includes('bicycle') && name.includes('tire')) return 'bicycle_tire'
  if (name.includes('vehicle') && name.includes('tire')) return 'vehicle_tire'
  if ((name.includes('car') || name.includes('vehicle')) && name.includes('wheel')) {
    return shape.kind === 'torus' ? 'vehicle_tire' : 'vehicle_wheel_detail'
  }
  if (name.includes('windshield') || name.includes('window')) return 'vehicle_window'
  if (name.includes('headlight') || name.includes('head light')) return 'headlight'
  if (name.includes('front bumper')) return 'front_bumper'
  if (name.includes('rear bumper')) return 'rear_bumper'
  if ((name.includes('car') || name.includes('vehicle')) && name.includes('body')) {
    return 'vehicle_body'
  }

  return undefined
}

export function getPrimitiveShapeHalfExtents(shape: PrimitiveShapeInput): Vec3 {
  const sx = scaleAt(shape.scale, 0)
  const sy = scaleAt(shape.scale, 1)
  const sz = scaleAt(shape.scale, 2)

  switch (shape.kind) {
    case 'box':
    case 'wedge':
    case 'trapezoid-prism':
      return [
        (numeric(shape.length, 1) * sx) / 2,
        (numeric(shape.height, 1) * sy) / 2,
        (numeric(shape.width, 1) * sz) / 2,
      ]
    case 'rounded-panel':
      return [
        (numeric(shape.length, 1) * sx) / 2,
        (numeric(shape.thickness ?? shape.height, 0.04) * sy) / 2,
        (numeric(shape.width, 0.5) * sz) / 2,
      ]
    case 'conformal-strip': {
      const xStart = numeric(shape.xStart, -numeric(shape.length, 1) / 2)
      const xEnd = numeric(shape.xEnd, numeric(shape.length, 1) / 2)
      return [
        Math.max(0.005, Math.abs(xEnd - xStart) / 2) * sx,
        (numeric(shape.surfaceRadiusY, 0.25) + numeric(shape.thickness, 0.003)) * sy,
        (numeric(shape.surfaceRadiusZ, 0.25) + numeric(shape.thickness, 0.003)) * sz,
      ]
    }
    case 'cylinder':
    case 'hollow-cylinder':
    case 'cone':
    case 'frustum': {
      const radius =
        shape.kind === 'frustum'
          ? Math.max(numeric(shape.radiusTop, 0.25), numeric(shape.radiusBottom, 0.5))
          : numeric(shape.radius, 0.5)
      const halfHeight = numeric(shape.height, 1) / 2
      if (shape.axis === 'x') return [halfHeight * sx, radius * sy, radius * sz]
      if (shape.axis === 'z') return [radius * sx, radius * sy, halfHeight * sz]
      return [radius * sx, halfHeight * sy, radius * sz]
    }
    case 'capsule':
    case 'half-cylinder': {
      const radius = numeric(shape.radius, 0.5)
      const halfHeight = numeric(shape.height, 1) / 2
      if (shape.axis === 'x') return [halfHeight * sx, radius * sy, radius * sz]
      if (shape.axis === 'z') return [radius * sx, radius * sy, halfHeight * sz]
      return [radius * sx, halfHeight * sy, radius * sz]
    }
    case 'sphere': {
      const radius = numeric(shape.radius, 0.5)
      return [radius * sx, radius * sy, radius * sz]
    }
    case 'hemisphere': {
      const radius = numeric(shape.radius, 0.5)
      if (shape.axis === 'x') return [(radius * sx) / 2, radius * sy, radius * sz]
      if (shape.axis === 'z') return [radius * sx, radius * sy, (radius * sz) / 2]
      return [radius * sx, (radius * sy) / 2, radius * sz]
    }
    case 'torus': {
      const ring = numeric(shape.majorRadius ?? shape.radius, 0.5) + numeric(shape.tubeRadius, 0.08)
      const tube = numeric(shape.tubeRadius, 0.08)
      if (shape.axis === 'x') return [tube * sx, ring * sy, ring * sz]
      if (shape.axis === 'y') return [ring * sx, tube * sy, ring * sz]
      return [ring * sx, ring * sy, tube * sz]
    }
    case 'lathe': {
      const profile = shape.profile ?? [
        [0, 0],
        [0.5, 1],
      ]
      let maxRadius = 0
      let minY = Number.POSITIVE_INFINITY
      let maxY = Number.NEGATIVE_INFINITY
      for (const point of profile) {
        const radius = numeric(point[0], 0)
        const y = numeric(point[1], 0)
        maxRadius = Math.max(maxRadius, Math.abs(radius))
        minY = Math.min(minY, y)
        maxY = Math.max(maxY, y)
      }
      return [maxRadius * sx, Math.max(0.01, (maxY - minY) / 2) * sy, maxRadius * sz]
    }
    case 'extrude': {
      const profile = shape.profile ?? [
        [-0.5, -0.25],
        [0.5, -0.25],
        [0.5, 0.25],
        [-0.5, 0.25],
      ]
      let minX = Number.POSITIVE_INFINITY
      let maxX = Number.NEGATIVE_INFINITY
      let minY = Number.POSITIVE_INFINITY
      let maxY = Number.NEGATIVE_INFINITY
      for (const point of profile) {
        const x = numeric(point[0], 0)
        const y = numeric(point[1], 0)
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minY = Math.min(minY, y)
        maxY = Math.max(maxY, y)
      }
      return [
        Math.max(0.01, (maxX - minX) / 2) * sx,
        Math.max(0.01, (maxY - minY) / 2) * sy,
        (numeric(shape.depth, 0.1) * sz) / 2,
      ]
    }
    case 'sweep': {
      const radius = numeric(shape.radius, 0.03)
      const path = shape.path ?? [
        [-0.5, 0, 0],
        [0.5, 0, 0],
      ]
      let minX = Number.POSITIVE_INFINITY
      let maxX = Number.NEGATIVE_INFINITY
      let minY = Number.POSITIVE_INFINITY
      let maxY = Number.NEGATIVE_INFINITY
      let minZ = Number.POSITIVE_INFINITY
      let maxZ = Number.NEGATIVE_INFINITY
      for (const point of path) {
        const x = numeric(point[0], 0)
        const y = numeric(point[1], 0)
        const z = numeric(point[2], 0)
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minY = Math.min(minY, y)
        maxY = Math.max(maxY, y)
        minZ = Math.min(minZ, z)
        maxZ = Math.max(maxZ, z)
      }
      return [
        Math.max(radius, (maxX - minX) / 2 + radius) * sx,
        Math.max(radius, (maxY - minY) / 2 + radius) * sy,
        Math.max(radius, (maxZ - minZ) / 2 + radius) * sz,
      ]
    }
    default:
      return [0.5 * sx, 0.5 * sy, 0.5 * sz]
  }
}

export function buildPrimitiveGeometryFacts(
  shapes: readonly PrimitiveShapeInput[],
  transforms: readonly ResolvedPrimitiveTransform[] = [],
): PrimitiveGeometryFacts {
  const facts: PrimitiveShapeFact[] = []
  const roles: Record<string, number> = {}
  const sourcePartKinds: Record<string, number> = {}
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY

  shapes.forEach((shape, index) => {
    const center = transforms[index]?.position ?? shape.position ?? [0, 0, 0]
    const halfExtents = getPrimitiveShapeHalfExtents(shape)
    const min: Vec3 = [
      center[0] - halfExtents[0],
      center[1] - halfExtents[1],
      center[2] - halfExtents[2],
    ]
    const max: Vec3 = [
      center[0] + halfExtents[0],
      center[1] + halfExtents[1],
      center[2] + halfExtents[2],
    ]
    const semanticRole = shape.semanticRole ?? inferPrimitiveSemanticRole(shape)
    const fact: PrimitiveShapeFact = {
      index,
      kind: String(shape.kind),
      name: shape.name,
      semanticRole,
      semanticGroup: shape.semanticGroup,
      sourcePartKind: shape.sourcePartKind,
      sourcePartId: shape.sourcePartId,
      center,
      halfExtents,
      min,
      max,
      materialColor: materialColor(shape.material),
    }

    facts.push(fact)
    if (semanticRole) roles[semanticRole] = (roles[semanticRole] ?? 0) + 1
    if (shape.sourcePartKind) {
      sourcePartKinds[shape.sourcePartKind] = (sourcePartKinds[shape.sourcePartKind] ?? 0) + 1
    }

    minX = Math.min(minX, min[0])
    minY = Math.min(minY, min[1])
    minZ = Math.min(minZ, min[2])
    maxX = Math.max(maxX, max[0])
    maxY = Math.max(maxY, max[1])
    maxZ = Math.max(maxZ, max[2])
  })

  if (facts.length === 0) {
    return {
      shapeCount: 0,
      bbox: { min: [0, 0, 0], max: [0, 0, 0] },
      dimensions: [0, 0, 0],
      roles,
      sourcePartKinds,
      shapes: facts,
    }
  }

  return {
    shapeCount: facts.length,
    bbox: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
    dimensions: [maxX - minX, maxY - minY, maxZ - minZ],
    roles,
    sourcePartKinds,
    shapes: facts,
  }
}
