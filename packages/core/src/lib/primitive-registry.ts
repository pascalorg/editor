import type { PrimitiveShapeInput } from './primitive-compose'

export type PrimitiveParameterType =
  | 'number'
  | 'integer'
  | 'string'
  | 'boolean'
  | 'vec3'
  | 'profile'

export interface PrimitiveParameterDefinition {
  type: PrimitiveParameterType
  min?: number
  max?: number
  default?: unknown
  values?: readonly unknown[]
  description?: string
}

export interface PrimitiveDefinition {
  kind: string
  aliases: readonly string[]
  params: Record<string, PrimitiveParameterDefinition>
  derivedFrom?: string
  description: string
}

const canonicalPrimitiveDefinitions: PrimitiveDefinition[] = [
  {
    kind: 'box',
    aliases: ['cuboid', 'cube', 'rectangular-prism', 'rectangular prism'],
    description: 'Solid rectangular cuboid.',
    params: {
      length: { type: 'number', min: 0.001 },
      width: { type: 'number', min: 0.001 },
      height: { type: 'number', min: 0.001 },
      cornerRadius: { type: 'number', min: 0 },
    },
  },
  {
    kind: 'cylinder',
    aliases: ['round-cylinder', '圆柱'],
    description: 'Solid circular cylinder along an axis.',
    params: {
      radius: { type: 'number', min: 0.001 },
      height: { type: 'number', min: 0.001 },
      axis: { type: 'string', values: ['x', 'y', 'z'] },
      radialSegments: { type: 'integer', min: 8, max: 64, default: 32 },
    },
  },
  {
    kind: 'hollow-cylinder',
    aliases: ['tube', 'pipe', 'hollow', 'hollow cylinder', '管'],
    description: 'Tube or pipe with wall thickness.',
    params: {
      radius: { type: 'number', min: 0.001 },
      height: { type: 'number', min: 0.001 },
      wallThickness: { type: 'number', min: 0.001 },
      axis: { type: 'string', values: ['x', 'y', 'z'] },
    },
  },
  {
    kind: 'cone',
    aliases: ['圆锥'],
    description: 'Pointed circular cone.',
    params: {
      radius: { type: 'number', min: 0.001 },
      height: { type: 'number', min: 0.001 },
      radialSegments: { type: 'integer', min: 3, max: 64, default: 32 },
      axis: { type: 'string', values: ['x', 'y', 'z'] },
    },
  },
  {
    kind: 'frustum',
    aliases: ['truncated-cone', 'truncated cone', '圆台'],
    description: 'Truncated circular cone.',
    params: {
      radiusTop: { type: 'number', min: 0.001 },
      radiusBottom: { type: 'number', min: 0.001 },
      height: { type: 'number', min: 0.001 },
      radialSegments: { type: 'integer', min: 3, max: 64, default: 32 },
      axis: { type: 'string', values: ['x', 'y', 'z'] },
    },
  },
  {
    kind: 'sphere',
    aliases: ['ball'],
    description: 'Sphere; use scale for ellipsoids.',
    params: {
      radius: { type: 'number', min: 0.001 },
      scale: { type: 'vec3' },
    },
  },
  {
    kind: 'hemisphere',
    aliases: ['dome', 'half-sphere', 'half sphere', '半球'],
    description: 'Half sphere or scaled dome.',
    params: {
      radius: { type: 'number', min: 0.001 },
      scale: { type: 'vec3' },
      axis: { type: 'string', values: ['x', 'y', 'z'] },
    },
  },
  {
    kind: 'torus',
    aliases: ['ring', 'donut', 'tyre', 'tire', '圆环'],
    description: 'Ring or tire tube.',
    params: {
      majorRadius: { type: 'number', min: 0.001 },
      tubeRadius: { type: 'number', min: 0.001 },
      arc: { type: 'number', min: 0, max: Math.PI * 2 },
    },
  },
  {
    kind: 'wedge',
    aliases: ['ramp', 'triangular-prism', 'triangular prism', '楔形'],
    description: 'Sloped wedge / triangular prism.',
    params: {
      length: { type: 'number', min: 0.001 },
      width: { type: 'number', min: 0.001 },
      height: { type: 'number', min: 0.001 },
      slopeAxis: { type: 'string', values: ['x', 'z'] },
      slopeDirection: { type: 'string', values: ['positive', 'negative'] },
    },
  },
  {
    kind: 'trapezoid-prism',
    aliases: ['trapezoid', 'trapezoidal-prism', 'trapezoidal prism', '梯形柱'],
    description: 'Tapered rectangular prism.',
    params: {
      length: { type: 'number', min: 0.001 },
      width: { type: 'number', min: 0.001 },
      height: { type: 'number', min: 0.001 },
      topLengthScale: { type: 'number', min: 0.01, max: 2 },
      topWidthScale: { type: 'number', min: 0.01, max: 2 },
    },
  },
  {
    kind: 'lathe',
    aliases: ['revolve', 'revolved-profile', '旋转体'],
    description: 'Revolved 2D profile.',
    params: { profile: { type: 'profile' }, segments: { type: 'integer', min: 3, max: 96 } },
  },
  {
    kind: 'capsule',
    aliases: ['pill', 'rounded-cylinder', '胶囊'],
    description: 'Rounded-end capsule bar.',
    params: {
      radius: { type: 'number', min: 0.001 },
      height: { type: 'number', min: 0.001 },
      axis: { type: 'string', values: ['x', 'y', 'z'] },
    },
  },
  {
    kind: 'half-cylinder',
    aliases: ['semicylinder', 'semi-cylinder', 'semi cylinder', '半圆柱'],
    description: 'Semicircular cylinder.',
    params: {
      radius: { type: 'number', min: 0.001 },
      height: { type: 'number', min: 0.001 },
      axis: { type: 'string', values: ['x', 'y', 'z'] },
    },
  },
  {
    kind: 'rounded-panel',
    aliases: ['rounded-rectangle', 'rounded rectangle', 'rounded-box-panel', '圆角板'],
    description: 'Thin rounded rectangle panel.',
    params: {
      length: { type: 'number', min: 0.001 },
      width: { type: 'number', min: 0.001 },
      thickness: { type: 'number', min: 0.001 },
      cornerRadius: { type: 'number', min: 0 },
    },
  },
  {
    kind: 'conformal-strip',
    aliases: ['conformal_strip', 'curved-strip', 'curved rectangle', 'curved-rectangle'],
    description: 'Strip conforming to a curved surface.',
    params: {
      width: { type: 'number', min: 0.001 },
      thickness: { type: 'number', min: 0.001 },
      surfaceRadiusY: { type: 'number', min: 0.001 },
      surfaceRadiusZ: { type: 'number', min: 0.001 },
    },
  },
  {
    kind: 'extrude',
    aliases: ['extrusion', 'profile-extrude'],
    description: '2D profile extruded through depth.',
    params: {
      profile: { type: 'profile' },
      depth: { type: 'number', min: 0.001 },
    },
  },
  {
    kind: 'sweep',
    aliases: ['path-tube', 'tube-sweep'],
    description: 'Tube swept along a 3D path.',
    params: {
      path: { type: 'vec3' },
      radius: { type: 'number', min: 0.001 },
    },
  },
]

export const PRIMITIVE_DEFINITIONS: readonly PrimitiveDefinition[] = [
  ...canonicalPrimitiveDefinitions,
  {
    kind: 'ellipsoid',
    aliases: ['ellipse', 'oval', 'spheroid', '椭球', '椭圆体'],
    derivedFrom: 'sphere',
    description: 'Scaled sphere lowered to sphere + scale.',
    params: {
      length: { type: 'number', min: 0.001 },
      width: { type: 'number', min: 0.001 },
      height: { type: 'number', min: 0.001 },
      radius: { type: 'number', min: 0.001 },
    },
  },
  {
    kind: 'ellipse-panel',
    aliases: ['oval-panel', 'ellipse plate', 'oval plate', '椭圆板'],
    derivedFrom: 'extrude',
    description: 'Thin oval/ellipse panel lowered to an extruded ellipse profile.',
    params: {
      length: { type: 'number', min: 0.001 },
      width: { type: 'number', min: 0.001 },
      thickness: { type: 'number', min: 0.001 },
      segments: { type: 'integer', min: 8, max: 96, default: 32 },
    },
  },
  {
    kind: 'semi-ellipse-panel',
    aliases: [
      'half-ellipse',
      'half ellipse',
      'semi ellipse',
      'semicircle',
      'semi-circle',
      '半椭圆',
    ],
    derivedFrom: 'extrude',
    description: 'Thin half-ellipse panel lowered to an extruded profile.',
    params: {
      length: { type: 'number', min: 0.001 },
      height: { type: 'number', min: 0.001 },
      thickness: { type: 'number', min: 0.001 },
      segments: { type: 'integer', min: 8, max: 96, default: 24 },
    },
  },
  {
    kind: 'pyramid',
    aliases: ['square-pyramid', 'rectangular-pyramid', '金字塔'],
    derivedFrom: 'cone',
    description: 'Square or rectangular pyramid lowered to a four-segment cone.',
    params: {
      radius: { type: 'number', min: 0.001 },
      height: { type: 'number', min: 0.001 },
      truncated: { type: 'boolean' },
      topScale: { type: 'number', min: 0, max: 1 },
    },
  },
]

const primitiveAliasMap = new Map<string, string>()
for (const definition of PRIMITIVE_DEFINITIONS) {
  primitiveAliasMap.set(definition.kind, definition.kind)
  for (const alias of definition.aliases) {
    primitiveAliasMap.set(
      alias
        .trim()
        .replace(/[\s_]+/g, '-')
        .toLowerCase(),
      definition.kind,
    )
  }
}

function normalizeName(value: unknown): string {
  return typeof value === 'string'
    ? value
        .trim()
        .replace(/[\s_]+/g, '-')
        .toLowerCase()
    : ''
}

function numberValue(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return undefined
}

function integerValue(value: unknown, fallback: number, min: number, max: number): number {
  return Math.max(
    min,
    Math.min(
      max,
      Math.round(typeof value === 'number' && Number.isFinite(value) ? value : fallback),
    ),
  )
}

function ellipseProfile(rx: number, ry: number, segments: number): [number, number][] {
  return Array.from({ length: segments }, (_, index) => {
    const angle = (index / segments) * Math.PI * 2
    return [Math.cos(angle) * rx, Math.sin(angle) * ry]
  })
}

function semiEllipseProfile(rx: number, ry: number, segments: number): [number, number][] {
  const arc: [number, number][] = Array.from({ length: segments + 1 }, (_, index) => {
    const angle = Math.PI - (index / segments) * Math.PI
    return [Math.cos(angle) * rx, Math.sin(angle) * ry] as [number, number]
  })
  return [...arc, [rx, 0], [-rx, 0]]
}

export function normalizePrimitiveKindFromRegistry(value: unknown): string {
  const normalized = normalizeName(value)
  return primitiveAliasMap.get(normalized) ?? normalized
}

export function getPrimitiveDefinition(kind: unknown): PrimitiveDefinition | undefined {
  const normalized = normalizePrimitiveKindFromRegistry(kind)
  return PRIMITIVE_DEFINITIONS.find((definition) => definition.kind === normalized)
}

export function primitiveCapabilitySummary(): string {
  return PRIMITIVE_DEFINITIONS.map((definition) => {
    const params = Object.keys(definition.params).join(', ')
    const derived = definition.derivedFrom ? ` -> ${definition.derivedFrom}` : ''
    return `${definition.kind}${derived}: ${params}`
  }).join('\n')
}

export function lowerDerivedPrimitiveShape(shape: PrimitiveShapeInput): PrimitiveShapeInput {
  const kind = normalizePrimitiveKindFromRegistry(shape.kind)
  if (kind === 'ellipsoid') {
    const length = numberValue(shape.length, shape.width)
    const height = numberValue(shape.height)
    const depth = numberValue(shape.depth, shape.width)
    const computedScale: [number, number, number] = [
      (length ?? 1) / 2,
      (height ?? length ?? 1) / 2,
      (depth ?? length ?? 1) / 2,
    ]
    return {
      ...shape,
      kind: 'sphere',
      radius: shape.radius ?? 1,
      scale:
        length != null || height != null || depth != null
          ? computedScale
          : (shape.scale ?? computedScale),
    }
  }

  if (kind === 'ellipse-panel') {
    const length = numberValue(shape.length, shape.width, shape.radius) ?? 1
    const width = numberValue(shape.width, shape.depth, shape.radius) ?? length
    const depth = numberValue(shape.thickness, shape.depth, shape.height) ?? 0.04
    const segments = integerValue(shape.segments, 32, 8, 96)
    return {
      ...shape,
      kind: 'extrude',
      profile: ellipseProfile(length / 2, width / 2, segments),
      depth,
      segments,
    }
  }

  if (kind === 'semi-ellipse-panel') {
    const length = numberValue(shape.length, shape.width, shape.radius) ?? 1
    const height = numberValue(shape.height, shape.radius) ?? length / 2
    const depth = numberValue(shape.thickness, shape.depth, shape.width) ?? 0.04
    const segments = integerValue(shape.segments, 24, 8, 96)
    return {
      ...shape,
      kind: 'extrude',
      profile: semiEllipseProfile(length / 2, height, segments),
      depth,
      segments,
    }
  }

  if (kind === 'pyramid') {
    const record = shape as PrimitiveShapeInput & { truncated?: boolean }
    const radius =
      numberValue(shape.radius, shape.length != null ? shape.length / Math.SQRT2 : undefined) ?? 0.5
    const height = numberValue(shape.height) ?? 1
    const topScale = numberValue(
      Array.isArray(shape.topScale) ? shape.topScale[0] : undefined,
      shape.topLengthScale,
      shape.topWidthScale,
    )
    if (record.truncated || (topScale != null && topScale > 0)) {
      return {
        ...shape,
        kind: 'frustum',
        radiusBottom: radius,
        radiusTop: Math.max(0.001, radius * Math.max(0.01, topScale ?? 0.2)),
        height,
        radialSegments: 4,
        rotation: shape.rotation ?? [0, Math.PI / 4, 0],
      }
    }
    return {
      ...shape,
      kind: 'cone',
      radius,
      height,
      radialSegments: 4,
      rotation: shape.rotation ?? [0, Math.PI / 4, 0],
    }
  }

  if (kind !== shape.kind) return { ...shape, kind }
  return shape
}
