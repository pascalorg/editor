import type { Vec3 } from '@pascal-app/core/lib/primitive-compose'
import type {
  GeneratedGeometryArtifact,
  GeneratedGeometryShapeSpec,
} from '../../../../packages/editor/src/lib/ai-generated-geometry-core'
import type { ProcessEquipmentContract } from './process-line-types'

export type FactoryPrimitiveQualityDiagnostic = {
  code: string
  severity: 'warning' | 'error'
  message: string
}

export type FactoryPrimitiveQualityResult = {
  passed: boolean
  diagnostics: FactoryPrimitiveQualityDiagnostic[]
  bounds?: {
    length: number
    width: number
    height: number
  }
}

function shapePosition(
  artifact: GeneratedGeometryArtifact,
  shape: GeneratedGeometryShapeSpec,
  index: number,
): Vec3 {
  return artifact.transforms[index]?.position ?? shape.position
}

function shapeExtents(shape: GeneratedGeometryShapeSpec): Vec3 {
  switch (shape.kind) {
    case 'box':
    case 'wedge':
    case 'trapezoid-prism':
      return [shape.length ?? 1, shape.height ?? 1, shape.width ?? 1]
    case 'rounded-panel':
      return [shape.length ?? 1, shape.thickness ?? shape.height ?? 0.04, shape.width ?? 1]
    case 'cylinder':
    case 'hollow-cylinder':
    case 'capsule':
    case 'cone':
    case 'frustum': {
      const radius = Math.max(
        shape.radius ?? 0,
        shape.radiusTop ?? 0,
        shape.radiusBottom ?? 0,
        0.1,
      )
      const height = shape.height ?? 1
      if (shape.axis === 'x') return [height, radius * 2, radius * 2]
      if (shape.axis === 'z') return [radius * 2, radius * 2, height]
      return [radius * 2, height, radius * 2]
    }
    case 'sphere':
    case 'hemisphere': {
      const radius = shape.radius ?? 0.5
      const scale = shape.scale ?? [1, 1, 1]
      return [radius * 2 * scale[0], radius * 2 * scale[1], radius * 2 * scale[2]]
    }
    case 'torus': {
      const radius = (shape.majorRadius ?? shape.radius ?? 0.5) + (shape.tubeRadius ?? 0.08)
      return [radius * 2, radius * 2, radius * 2]
    }
    default:
      return [0.25, 0.25, 0.25]
  }
}

function artifactBounds(artifact: GeneratedGeometryArtifact) {
  if (!artifact.shapes.length) return undefined
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY

  artifact.shapes.forEach((shape, index) => {
    const position = shapePosition(artifact, shape, index)
    const [length, height, width] = shapeExtents(shape)
    minX = Math.min(minX, position[0] - length / 2)
    maxX = Math.max(maxX, position[0] + length / 2)
    minY = Math.min(minY, position[1] - height / 2)
    maxY = Math.max(maxY, position[1] + height / 2)
    minZ = Math.min(minZ, position[2] - width / 2)
    maxZ = Math.max(maxZ, position[2] + width / 2)
  })

  return {
    length: maxX - minX,
    width: maxZ - minZ,
    height: maxY - minY,
  }
}

function hasRole(artifact: GeneratedGeometryArtifact, role: string) {
  const normalized = role.toLowerCase()
  return artifact.shapes.some((shape) =>
    [shape.semanticRole, shape.semanticGroup, shape.sourcePartKind, shape.sourcePartId, shape.name]
      .filter((value): value is string => typeof value === 'string')
      .some((value) => value.toLowerCase().includes(normalized)),
  )
}

export function evaluateFactoryPrimitiveArtifactContract(input: {
  artifact: GeneratedGeometryArtifact
  contract?: ProcessEquipmentContract
}): FactoryPrimitiveQualityResult {
  const diagnostics: FactoryPrimitiveQualityDiagnostic[] = []
  const bounds = artifactBounds(input.artifact)
  const contract = input.contract
  if (!contract || !bounds) return { passed: true, diagnostics, bounds }

  const tolerance = contract.envelope.tolerance ?? 0.05
  const maxLength = contract.envelope.length * (1 + tolerance)
  const maxWidth = contract.envelope.width * (1 + tolerance)
  const maxHeight = contract.envelope.height * (1 + tolerance)

  if (bounds.length > maxLength || bounds.width > maxWidth || bounds.height > maxHeight) {
    diagnostics.push({
      code: 'factory_primitive_envelope_exceeded',
      severity: 'error',
      message: `Generated artifact exceeds ${contract.profileId} envelope.`,
    })
  }

  if (
    bounds.length < contract.envelope.length * 0.35 ||
    bounds.width < contract.envelope.width * 0.35
  ) {
    diagnostics.push({
      code: 'factory_primitive_underfilled_envelope',
      severity: 'warning',
      message: `Generated artifact is much smaller than ${contract.profileId} envelope.`,
    })
  }

  for (const role of contract.requiredRoles ?? []) {
    if (hasRole(input.artifact, role)) continue
    diagnostics.push({
      code: 'factory_primitive_required_role_missing',
      severity: 'warning',
      message: `Generated artifact is missing expected role ${role}.`,
    })
  }

  for (const port of contract.ports) {
    if (hasRole(input.artifact, port.id)) continue
    diagnostics.push({
      code: 'factory_primitive_port_missing',
      severity: 'warning',
      message: `Generated artifact is missing port marker ${port.id}.`,
    })
  }

  return {
    passed: !diagnostics.some((diagnostic) => diagnostic.severity === 'error'),
    diagnostics,
    bounds,
  }
}
