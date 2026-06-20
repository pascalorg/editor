import type { Vec3 } from '@pascal-app/core/lib/primitive-compose'
import type {
  GeneratedGeometryArtifact,
  GeneratedGeometryShapeSpec,
} from '../../../../packages/editor/src/lib/ai-generated-geometry-core'
import type { ProcessEquipmentContract, ProcessEquipmentPort } from './process-line-types'

export type FactoryPrimitiveContractAlignment = {
  applied: boolean
  scale?: Vec3
  addedPortMarkers: string[]
  addedRequiredRoleMarkers: string[]
}

type Bounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
  minZ: number
  maxZ: number
  length: number
  width: number
  height: number
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function rounded(value: number) {
  return Math.round(value * 1000) / 1000
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

function artifactBounds(artifact: GeneratedGeometryArtifact): Bounds | undefined {
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
    minX,
    maxX,
    minY,
    maxY,
    minZ,
    maxZ,
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

function scalePosition(position: Vec3, center: Vec3, scale: Vec3): Vec3 {
  return [
    rounded(center[0] + (position[0] - center[0]) * scale[0]),
    rounded(center[1] + (position[1] - center[1]) * scale[1]),
    rounded(center[2] + (position[2] - center[2]) * scale[2]),
  ]
}

function scaleValue(value: number | undefined, factor: number) {
  return value == null ? value : rounded(value * factor)
}

function scaledShape(shape: GeneratedGeometryShapeSpec, scale: Vec3): GeneratedGeometryShapeSpec {
  const minXZ = Math.min(scale[0], scale[2])
  switch (shape.kind) {
    case 'box':
    case 'wedge':
    case 'trapezoid-prism':
      return {
        ...shape,
        length: scaleValue(shape.length, scale[0]),
        width: scaleValue(shape.width, scale[2]),
        height: scaleValue(shape.height, scale[1]),
      }
    case 'rounded-panel':
      return {
        ...shape,
        length: scaleValue(shape.length, scale[0]),
        width: scaleValue(shape.width, scale[2]),
        thickness: scaleValue(shape.thickness, scale[1]),
        height: scaleValue(shape.height, scale[1]),
      }
    case 'cylinder':
    case 'hollow-cylinder':
    case 'capsule':
    case 'cone':
    case 'frustum': {
      const axialScale = shape.axis === 'x' ? scale[0] : shape.axis === 'z' ? scale[2] : scale[1]
      const radialScale =
        shape.axis === 'x'
          ? Math.min(scale[1], scale[2])
          : shape.axis === 'z'
            ? Math.min(scale[0], scale[1])
            : minXZ
      return {
        ...shape,
        height: scaleValue(shape.height, axialScale),
        radius: scaleValue(shape.radius, radialScale),
        radiusTop: scaleValue(shape.radiusTop, radialScale),
        radiusBottom: scaleValue(shape.radiusBottom, radialScale),
        wallThickness: scaleValue(shape.wallThickness, radialScale),
      }
    }
    case 'sphere':
    case 'hemisphere': {
      const existing = shape.scale ?? [1, 1, 1]
      return {
        ...shape,
        scale: [
          rounded(existing[0] * scale[0]),
          rounded(existing[1] * scale[1]),
          rounded(existing[2] * scale[2]),
        ],
      }
    }
    case 'torus': {
      const factor = Math.min(scale[0], scale[1], scale[2])
      return {
        ...shape,
        majorRadius: scaleValue(shape.majorRadius, factor),
        tubeRadius: scaleValue(shape.tubeRadius, factor),
        radius: scaleValue(shape.radius, factor),
      }
    }
    case 'sweep':
      return {
        ...shape,
        radius: scaleValue(shape.radius, Math.min(scale[0], scale[1], scale[2])),
        path: shape.path?.map((point) => [
          rounded(point[0] * scale[0]),
          rounded(point[1] * scale[1]),
          rounded(point[2] * scale[2]),
        ]),
      }
    default:
      return shape
  }
}

function scaleArtifactToEnvelope(
  artifact: GeneratedGeometryArtifact,
  contract: ProcessEquipmentContract,
): { artifact: GeneratedGeometryArtifact; scale: Vec3 | undefined } {
  const bounds = artifactBounds(artifact)
  if (!bounds) return { artifact, scale: undefined }

  const targetLength = contract.envelope.length * 0.94
  const targetWidth = contract.envelope.width * 0.94
  const targetHeight = contract.envelope.height * 0.94
  const scale: Vec3 = [
    bounds.length > targetLength || bounds.length < contract.envelope.length * 0.35
      ? targetLength / Math.max(bounds.length, 0.001)
      : 1,
    bounds.height > targetHeight || bounds.height < contract.envelope.height * 0.35
      ? targetHeight / Math.max(bounds.height, 0.001)
      : 1,
    bounds.width > targetWidth || bounds.width < contract.envelope.width * 0.35
      ? targetWidth / Math.max(bounds.width, 0.001)
      : 1,
  ]

  if (scale.every((factor) => Math.abs(factor - 1) < 0.001)) {
    return { artifact, scale: undefined }
  }

  const center: Vec3 = [
    (bounds.minX + bounds.maxX) / 2,
    (bounds.minY + bounds.maxY) / 2,
    (bounds.minZ + bounds.maxZ) / 2,
  ]
  return {
    artifact: normalizeAssemblyPositionToBase({
      ...artifact,
      assemblyPosition: scalePosition(artifact.assemblyPosition, center, scale),
      shapes: artifact.shapes.map((shape, index) => ({
        ...scaledShape(shape, scale),
        position: scalePosition(shapePosition(artifact, shape, index), center, scale),
      })),
      transforms: artifact.transforms.map((transform) => ({
        ...transform,
        position: scalePosition(transform.position, center, scale),
      })),
      sourceArgs: {
        ...artifact.sourceArgs,
        factoryContractScale: scale,
      },
    }),
    scale,
  }
}

function normalizeAssemblyPositionToBase(
  artifact: GeneratedGeometryArtifact,
): GeneratedGeometryArtifact {
  const bounds = artifactBounds(artifact)
  if (!bounds) return artifact
  return {
    ...artifact,
    assemblyPosition: [
      rounded((bounds.minX + bounds.maxX) / 2),
      rounded(bounds.minY),
      rounded((bounds.minZ + bounds.maxZ) / 2),
    ],
  }
}

function portMarkerLocalPosition(
  port: ProcessEquipmentPort,
  contract: ProcessEquipmentContract,
  markerSize: number,
): Vec3 {
  const halfLength = contract.envelope.length / 2
  const halfWidth = contract.envelope.width / 2
  const inset = Math.max(markerSize / 2, 0.04)
  const offset = port.offset ?? 0
  const height = clamp(port.height, inset, contract.envelope.height - inset)
  switch (port.side) {
    case 'left':
      return [-halfLength + inset, height, clamp(offset, -halfWidth + inset, halfWidth - inset)]
    case 'right':
      return [halfLength - inset, height, clamp(offset, -halfWidth + inset, halfWidth - inset)]
    case 'front':
      return [clamp(offset, -halfLength + inset, halfLength - inset), height, halfWidth - inset]
    case 'back':
      return [clamp(offset, -halfLength + inset, halfLength - inset), height, -halfWidth + inset]
    case 'top':
      return [
        clamp(offset, -halfLength + inset, halfLength - inset),
        contract.envelope.height - inset,
        0,
      ]
  }
}

function markerShape(input: {
  name: string
  semanticRole: string
  sourcePartKind: string
  position: Vec3
  size: number
  color: string
}): GeneratedGeometryShapeSpec {
  return {
    kind: 'box',
    name: input.name,
    semanticRole: input.semanticRole,
    sourcePartKind: input.sourcePartKind,
    position: input.position,
    rotation: [0, 0, 0],
    length: input.size,
    width: input.size,
    height: input.size,
    cornerRadius: input.size * 0.18,
    material: {
      preset: 'custom',
      properties: { color: input.color, roughness: 0.46, metalness: 0.18 },
    },
  }
}

function withContractMarkers(
  artifact: GeneratedGeometryArtifact,
  contract: ProcessEquipmentContract,
): {
  artifact: GeneratedGeometryArtifact
  addedPortMarkers: string[]
  addedRequiredRoleMarkers: string[]
} {
  const markerSize = clamp(
    Math.min(contract.envelope.length, contract.envelope.width, contract.envelope.height) * 0.045,
    0.06,
    0.18,
  )
  const shapes = [...artifact.shapes]
  const transforms = [...artifact.transforms]
  const createdNames = [...artifact.createdNames]
  const addedPortMarkers: string[] = []
  const addedRequiredRoleMarkers: string[] = []

  for (const port of contract.ports) {
    if (hasRole(artifact, port.id)) continue
    const local = portMarkerLocalPosition(port, contract, markerSize)
    const position: Vec3 = [
      rounded(artifact.assemblyPosition[0] + local[0]),
      rounded(artifact.assemblyPosition[1] + local[1]),
      rounded(artifact.assemblyPosition[2] + local[2]),
    ]
    const shape = markerShape({
      name: `${contract.profileId} ${port.id} port marker`,
      semanticRole: port.id,
      sourcePartKind: 'connection_port',
      position,
      size: markerSize,
      color: '#facc15',
    })
    shapes.push(shape)
    transforms.push({ position, rotation: [0, 0, 0] })
    createdNames.push(shape.name ?? port.id)
    addedPortMarkers.push(port.id)
  }

  const requiredRoles = (contract.requiredRoles ?? []).filter((role) => !hasRole({ ...artifact, shapes }, role))
  requiredRoles.forEach((role, index) => {
    const count = Math.max(1, requiredRoles.length)
    const x =
      count === 1
        ? 0
        : -contract.envelope.length * 0.32 + (contract.envelope.length * 0.64 * index) / (count - 1)
    const y = contract.envelope.height * (0.25 + 0.5 * ((index % 3) / 2))
    const z = -contract.envelope.width * 0.28 + (index % 2) * contract.envelope.width * 0.56
    const position: Vec3 = [
      rounded(artifact.assemblyPosition[0] + x),
      rounded(artifact.assemblyPosition[1] + y),
      rounded(artifact.assemblyPosition[2] + z),
    ]
    const shape = markerShape({
      name: `${contract.profileId} ${role} role marker`,
      semanticRole: role,
      sourcePartKind: 'required_role_marker',
      position,
      size: markerSize * 0.8,
      color: '#cbd5e1',
    })
    shapes.push(shape)
    transforms.push({ position, rotation: [0, 0, 0] })
    createdNames.push(shape.name ?? role)
    addedRequiredRoleMarkers.push(role)
  })

  return {
    artifact: {
      ...artifact,
      shapes,
      transforms,
      createdNames,
      shapeDetails: [
        artifact.shapeDetails,
        addedPortMarkers.length
          ? `Factory contract port markers: ${addedPortMarkers.join(', ')}`
          : undefined,
        addedRequiredRoleMarkers.length
          ? `Factory contract role markers: ${addedRequiredRoleMarkers.join(', ')}`
          : undefined,
      ]
        .filter(Boolean)
        .join('\n'),
      sourceArgs: {
        ...artifact.sourceArgs,
        factoryEquipmentContract: contract,
        factoryContractPortMarkers: addedPortMarkers,
        factoryContractRequiredRoleMarkers: addedRequiredRoleMarkers,
      },
    },
    addedPortMarkers,
    addedRequiredRoleMarkers,
  }
}

export function alignFactoryPrimitiveArtifactToContract(input: {
  artifact: GeneratedGeometryArtifact
  contract?: ProcessEquipmentContract
}): { artifact: GeneratedGeometryArtifact; alignment: FactoryPrimitiveContractAlignment } {
  if (!input.contract) {
    return {
      artifact: input.artifact,
      alignment: {
        applied: false,
        addedPortMarkers: [],
        addedRequiredRoleMarkers: [],
      },
    }
  }

  const scaled = scaleArtifactToEnvelope(input.artifact, input.contract)
  const marked = withContractMarkers(normalizeAssemblyPositionToBase(scaled.artifact), input.contract)
  const applied =
    Boolean(scaled.scale) ||
    marked.addedPortMarkers.length > 0 ||
    marked.addedRequiredRoleMarkers.length > 0

  return {
    artifact: {
      ...marked.artifact,
      sourceArgs: {
        ...marked.artifact.sourceArgs,
        factoryContractAlignmentApplied: applied,
      },
    },
    alignment: {
      applied,
      ...(scaled.scale ? { scale: scaled.scale } : {}),
      addedPortMarkers: marked.addedPortMarkers,
      addedRequiredRoleMarkers: marked.addedRequiredRoleMarkers,
    },
  }
}
