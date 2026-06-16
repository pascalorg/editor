import type { PrimitiveMaterialInput, Vec3 } from '@pascal-app/core/lib/primitive-compose'
import { buildPrimitiveGeometryFacts } from '@pascal-app/core/lib/primitive-facts'
import type { GeneratedGeometryArtifact } from '../ai-generated-geometry-core'

export type ArtifactPartFact = {
  shapeId: string
  partId: string
  index: number
  kind: string
  name?: string
  semanticRole?: string
  semanticGroup?: string
  sourcePartKind?: string
  sourcePartId?: string
  materialKey?: string
  center: Vec3
}

export type ArtifactRoleFacts = {
  count: number
  shapeIds: string[]
  partIds: string[]
  materialKeys: string[]
}

export type ArtifactGroupFacts = {
  count: number
  shapeIds: string[]
  partIds: string[]
  roles: string[]
}

export type ArtifactMaterialFacts = {
  color?: string
  materialPreset?: string
  shapeIds: string[]
  partIds: string[]
}

export type ArtifactComponentInstanceFacts = {
  component: string
  instanceId: string
  shapeIds: string[]
  partIds: string[]
  roles: string[]
  center: Vec3
}

export type ArtifactFacts = {
  artifactId: string
  summary: {
    family?: string
    category?: string
    scope?: string
    component?: string
  }
  shapeCount: number
  bounds: {
    min: Vec3
    max: Vec3
    size: Vec3
  }
  parts: ArtifactPartFact[]
  roles: Record<string, ArtifactRoleFacts>
  groups: Record<string, ArtifactGroupFacts>
  materials: Record<string, ArtifactMaterialFacts>
  components: ArtifactComponentInstanceFacts[]
}

function normalizeToken(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim()
    ? value
        .trim()
        .replace(/[\s-]+/g, '_')
        .toLowerCase()
    : undefined
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function materialColor(material: PrimitiveMaterialInput | undefined): string | undefined {
  const color = material?.properties?.color
  return typeof color === 'string' && color.trim() ? color.trim() : undefined
}

function materialKeyFor(
  material: PrimitiveMaterialInput | undefined,
  materialPreset: string | undefined,
): string | undefined {
  const color = materialColor(material)
  if (color) return `color:${color.toLowerCase()}`
  if (materialPreset) return `preset:${materialPreset}`
  return undefined
}

function pushUnique(target: string[], values: Iterable<string | undefined>) {
  for (const value of values) {
    if (value && !target.includes(value)) target.push(value)
  }
}

function averageCenter(parts: ArtifactPartFact[]): Vec3 {
  if (!parts.length) return [0, 0, 0]
  const sum = parts.reduce<Vec3>(
    (acc, part) => [acc[0] + part.center[0], acc[1] + part.center[1], acc[2] + part.center[2]],
    [0, 0, 0],
  )
  return [sum[0] / parts.length, sum[1] / parts.length, sum[2] / parts.length]
}

function inferComponentFromRole(role: string | undefined): string | undefined {
  if (!role) return undefined
  if (/^(bicycle|bike)_(tire|rim|hub|spoke|wheel)$/.test(role)) return 'wheel'
  if (/^(vehicle|car)_(tire|rim|hub|wheel|wheel_detail)$/.test(role)) return 'wheel'
  return undefined
}

function buildWheelComponentInstances(parts: ArtifactPartFact[]): ArtifactComponentInstanceFacts[] {
  const wheelParts = parts.filter((part) => inferComponentFromRole(part.semanticRole) === 'wheel')
  const tires = wheelParts.filter((part) => /_(tire|wheel)$/.test(part.semanticRole ?? ''))
  const seedParts = tires.length
    ? tires
    : wheelParts.filter((part) => part.semanticRole?.endsWith('_hub'))
  if (seedParts.length <= 1) {
    return seedParts.length === 1
      ? [
          {
            component: 'wheel',
            instanceId: 'wheel:0',
            shapeIds: wheelParts.map((part) => part.shapeId),
            partIds: wheelParts.map((part) => part.partId),
            roles: Array.from(
              new Set(wheelParts.map((part) => part.semanticRole).filter(isString)),
            ),
            center: averageCenter(wheelParts),
          },
        ]
      : []
  }

  return seedParts.map((seed, seedIndex) => {
    const instanceParts = wheelParts.filter((part) => {
      const dx = Math.abs(part.center[0] - seed.center[0])
      const dy = Math.abs(part.center[1] - seed.center[1])
      const dz = Math.abs(part.center[2] - seed.center[2])
      return dx <= 0.18 && dy <= 0.18 && dz <= 0.18
    })
    const uniqueParts = instanceParts.length ? instanceParts : [seed]
    return {
      component: 'wheel',
      instanceId: `wheel:${seedIndex}`,
      shapeIds: uniqueParts.map((part) => part.shapeId),
      partIds: uniqueParts.map((part) => part.partId),
      roles: Array.from(new Set(uniqueParts.map((part) => part.semanticRole).filter(isString))),
      center: averageCenter(uniqueParts),
    }
  })
}

export function buildArtifactFacts(artifact: GeneratedGeometryArtifact): ArtifactFacts {
  const geometryFacts = buildPrimitiveGeometryFacts(artifact.shapes, artifact.transforms)
  const parts: ArtifactPartFact[] = artifact.shapes.map((shape, index) => {
    const fact = geometryFacts.shapes[index]
    const semanticRole = normalizeToken(shape.semanticRole ?? fact?.semanticRole)
    const semanticGroup = normalizeToken(shape.semanticGroup ?? fact?.semanticGroup)
    const sourcePartKind = normalizeToken(shape.sourcePartKind ?? fact?.sourcePartKind)
    const sourcePartId = normalizeToken(shape.sourcePartId ?? fact?.sourcePartId)
    const shapeId = `shape:${index}`
    return {
      shapeId,
      partId: sourcePartId ?? shapeId,
      index,
      kind: String(shape.kind),
      name: shape.name,
      semanticRole,
      semanticGroup,
      sourcePartKind,
      sourcePartId,
      materialKey: materialKeyFor(shape.material, shape.materialPreset),
      center: fact?.center ?? artifact.transforms[index]?.position ?? shape.position ?? [0, 0, 0],
    }
  })

  const roles: Record<string, ArtifactRoleFacts> = {}
  const groups: Record<string, ArtifactGroupFacts> = {}
  const materials: Record<string, ArtifactMaterialFacts> = {}

  for (const part of parts) {
    const roleKey = part.semanticRole
    if (roleKey) {
      if (!roles[roleKey]) {
        roles[roleKey] = {
          count: 0,
          shapeIds: [],
          partIds: [],
          materialKeys: [],
        }
      }
      const role = roles[roleKey] as ArtifactRoleFacts
      role.count += 1
      role.shapeIds.push(part.shapeId)
      pushUnique(role.partIds, [part.partId])
      pushUnique(role.materialKeys, [part.materialKey])
    }
    const groupKey = part.semanticGroup
    if (groupKey) {
      if (!groups[groupKey]) {
        groups[groupKey] = {
          count: 0,
          shapeIds: [],
          partIds: [],
          roles: [],
        }
      }
      const group = groups[groupKey] as ArtifactGroupFacts
      group.count += 1
      group.shapeIds.push(part.shapeId)
      pushUnique(group.partIds, [part.partId])
      pushUnique(group.roles, [part.semanticRole])
    }
    const materialKey = part.materialKey
    if (materialKey) {
      if (!materials[materialKey]) {
        materials[materialKey] = {
          color: materialKey.startsWith('color:') ? materialKey.slice(6) : undefined,
          materialPreset: materialKey.startsWith('preset:') ? materialKey.slice(7) : undefined,
          shapeIds: [],
          partIds: [],
        }
      }
      const material = materials[materialKey] as ArtifactMaterialFacts
      material.shapeIds.push(part.shapeId)
      pushUnique(material.partIds, [part.partId])
    }
  }
  const briefRecord =
    typeof artifact.geometryBrief === 'object' && artifact.geometryBrief !== null
      ? (artifact.geometryBrief as Record<string, unknown>)
      : {}

  return {
    artifactId: artifact.id,
    summary: {
      category: stringField(artifact.geometryBrief?.category),
      family: normalizeToken(artifact.sourceArgs.family),
      scope: stringField(briefRecord.scope),
      component: normalizeToken(briefRecord.component),
    },
    shapeCount: parts.length,
    bounds: {
      min: geometryFacts.bbox.min,
      max: geometryFacts.bbox.max,
      size: geometryFacts.dimensions,
    },
    parts,
    roles,
    groups,
    materials,
    components: buildWheelComponentInstances(parts),
  }
}
