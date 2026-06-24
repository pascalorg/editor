import { extractPrimitiveShapeContract, type Vec3 } from '@pascal-app/core/lib/primitive-compose'
import {
  type AnyNode,
  type AnyNodeId,
  AssemblyNode,
  BoxNode,
  CapsuleNode,
  ConeNode,
  ConformalStripNode,
  CylinderNode,
  ExtrudeNode,
  FrustumNode,
  HalfCylinderNode,
  HemisphereNode,
  LatheNode,
  RoundedPanelNode,
  SphereNode,
  SweepNode,
  TorusNode,
  TrapezoidPrismNode,
  WedgeNode,
} from '@pascal-app/core/schema'
import type {
  GeneratedGeometryArtifact,
  GeneratedGeometryShapeSpec,
} from './ai-generated-geometry-core'

type ShapeSpec = GeneratedGeometryShapeSpec

export const clampD = (v: unknown, fallback: number, min = 0.01, max = 50) =>
  Math.max(min, Math.min(max, typeof v === 'number' && !Number.isNaN(v) ? v : fallback))
export const clampR = (v: unknown, fallback: number) => clampD(v, fallback, 0.01, 10)
const clampI = (v: unknown, fallback: number, min: number, max: number) =>
  Math.round(clampD(v, fallback, min, max))

function clampCornerRadius(shape: ShapeSpec) {
  const radius = shape.cornerRadius ?? shape.bevelRadius ?? shape.chamfer
  if (radius == null) return undefined
  const length = clampD(shape.length, 1.0)
  const width = clampD(shape.width, 1.0)
  const height = clampD(shape.height, 1.0)
  return clampD(radius, 0, 0, Math.max(0, Math.min(length, width, height) / 2 - 0.001))
}

function clampPanelCornerRadius(shape: ShapeSpec) {
  const radius = shape.cornerRadius ?? shape.bevelRadius ?? shape.chamfer
  if (radius == null) return undefined
  const length = clampD(shape.length, 1.0)
  const width = clampD(shape.width, 0.5)
  return clampD(radius, 0.04, 0, Math.max(0, Math.min(length, width) / 2 - 0.001))
}

function compactRecord(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined))
}

function subtractVec3(left: Vec3 | undefined, right: Vec3 | undefined): Vec3 | undefined {
  if (!left || !right) return left
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]]
}

function shapeWorldPosition(input: {
  artifact: GeneratedGeometryArtifact
  shape: ShapeSpec
  shapeIndex: number
}) {
  return input.artifact.transforms[input.shapeIndex]?.position ?? input.shape.position
}

function localPrimitiveContract(input: {
  artifact: GeneratedGeometryArtifact
  shape: ShapeSpec
  shapeIndex: number
  patternInstances?: Array<{ position?: Vec3; rotation?: Vec3; scale?: Vec3; name?: string }>
}) {
  const contract = extractPrimitiveShapeContract(input.shape)
  if (!contract) return undefined
  const origin = shapeWorldPosition(input)
  const cutouts = contract.cutouts?.map((cutout) => ({
    ...cutout,
    position: subtractVec3(cutout.position, origin),
  }))
  const ports = contract.ports?.map((port) => ({
    ...port,
    position: subtractVec3(port.position, origin),
  }))
  return compactRecord({
    ...contract,
    cutouts,
    ports,
    pattern: contract.pattern
      ? compactRecord({
          ...contract.pattern,
          ...(input.patternInstances?.length
            ? { mode: 'instanced', instances: input.patternInstances }
            : {}),
        })
      : undefined,
  })
}

function generatedPatternInstances(input: {
  artifact: GeneratedGeometryArtifact
  group: number[]
}): Array<{ position?: Vec3; rotation?: Vec3; scale?: Vec3; name?: string }> {
  const firstIndex = input.group[0]
  if (firstIndex == null) return []
  const firstShape = input.artifact.shapes[firstIndex]
  if (!firstShape) return []
  const firstPosition = shapeWorldPosition({
    artifact: input.artifact,
    shape: firstShape,
    shapeIndex: firstIndex,
  })
  const firstRotation = input.artifact.transforms[firstIndex]?.rotation ?? firstShape.rotation
  return input.group
    .map((shapeIndex) => {
      const shape = input.artifact.shapes[shapeIndex]
      if (!shape) return undefined
      const transform = input.artifact.transforms[shapeIndex]
      const position = shapeWorldPosition({ artifact: input.artifact, shape, shapeIndex })
      const rotation = transform?.rotation ?? shape.rotation
      return compactRecord({
        position: subtractVec3(position, firstPosition),
        rotation: subtractVec3(rotation, firstRotation),
        scale: shape.scale,
        name: shape.name,
      })
    })
    .filter((entry): entry is { position?: Vec3; rotation?: Vec3; scale?: Vec3; name?: string } =>
      Boolean(entry),
    )
}

function patternGroups(shapes: readonly ShapeSpec[]) {
  const groups = new Map<string, number[]>()
  shapes.forEach((shape, index) => {
    const patternId = shape.pattern?.id
    if (!patternId || shape.pattern?.mode !== 'expanded') return
    const key = `${shape.kind}:${patternId}`
    groups.set(key, [...(groups.get(key) ?? []), index])
  })
  return [...groups.values()].filter((group) => group.length > 1)
}

function generatedShapeMetadata(input: {
  artifact: GeneratedGeometryArtifact
  shape: ShapeSpec
  shapeIndex: number
  patternInstances?: Array<{ position?: Vec3; rotation?: Vec3; scale?: Vec3; name?: string }>
}) {
  const primitiveContract = localPrimitiveContract(input)
  const selector = compactRecord({
    index: input.shapeIndex,
    semanticRole: input.shape.semanticRole,
    semanticGroup: input.shape.semanticGroup,
    sourcePartKind: input.shape.sourcePartKind,
    sourcePartId: input.shape.sourcePartId,
    kind: input.shape.kind,
    nameIncludes: input.shape.name,
  })

  return compactRecord({
    generatedBy: 'ai-geometry',
    artifactId: input.artifact.id,
    artifactTitle: input.artifact.title,
    shapeIndex: input.shapeIndex,
    shapeKind: input.shape.kind,
    semanticRole: input.shape.semanticRole,
    semanticGroup: input.shape.semanticGroup,
    sourcePartKind: input.shape.sourcePartKind,
    sourcePartId: input.shape.sourcePartId,
    editableHints: input.shape.editableHints,
    primitiveContract,
    generatedShape: compactRecord({
      assemblyName: input.artifact.assemblyName,
      selector,
      label:
        input.shape.name ??
        input.shape.semanticRole ??
        input.shape.sourcePartId ??
        input.shape.sourcePartKind ??
        input.shape.kind,
    }),
  })
}

export function buildGeneratedGeometryNodes(artifact: GeneratedGeometryArtifact) {
  const shouldCreateAssembly = artifact.shapes.length > 1
  const created: string[] = []
  const createdNodes: AnyNode[] = []
  const patternInstancesByLead = new Map<number, ReturnType<typeof generatedPatternInstances>>()
  const skippedPatternShapeIndexes = new Set<number>()

  for (const group of patternGroups(artifact.shapes)) {
    const lead = group[0]
    if (lead == null) continue
    patternInstancesByLead.set(lead, generatedPatternInstances({ artifact, group }))
    for (const shapeIndex of group.slice(1)) skippedPatternShapeIndexes.add(shapeIndex)
  }

  for (let i = 0; i < artifact.shapes.length; i++) {
    if (skippedPatternShapeIndexes.has(i)) continue
    const shape = artifact.shapes[i]
    const transform = artifact.transforms[i]
    if (!shape) continue

    const worldPosition = transform?.position ?? shape.position
    const rotation = transform?.rotation ?? shape.rotation ?? [0, 0, 0]
    const position = shouldCreateAssembly
      ? toAssemblyLocalPosition(worldPosition, artifact.assemblyPosition)
      : worldPosition
    const displayName = shape.name ?? shape.kind

    try {
      let node: AnyNode | undefined
      switch (shape.kind) {
        case 'box':
          node = BoxNode.parse({
            name: displayName,
            position,
            rotation,
            length: clampD(shape.length, 1.0),
            width: clampD(shape.width, 1.0),
            height: clampD(shape.height, 1.0),
            cornerRadius: clampCornerRadius(shape),
            cornerSegments:
              shape.cornerSegments != null
                ? Math.round(clampD(shape.cornerSegments, 4, 1, 12))
                : undefined,
            material: shape.material,
            materialPreset: shape.materialPreset,
          })
          break
        case 'cylinder':
        case 'hollow-cylinder': {
          const wt = shape.wallThickness
          node = CylinderNode.parse({
            name:
              displayName ||
              (shape.kind === 'hollow-cylinder' || wt ? 'Hollow Cylinder' : 'Cylinder'),
            position,
            rotation,
            radius: clampR(shape.radius, 0.5),
            height: clampD(shape.height, 1.0, 0.01, 20),
            radialSegments:
              shape.radialSegments != null
                ? Math.round(clampD(shape.radialSegments, 32, 8, 64))
                : undefined,
            wallThickness:
              wt != null
                ? clampD(wt, 0.05, 0.001, 10)
                : shape.kind === 'hollow-cylinder'
                  ? clampD((shape.radius ?? 0.5) * 0.18, 0.05, 0.001, 10)
                  : undefined,
            material: shape.material,
            materialPreset: shape.materialPreset,
          })
          break
        }
        case 'cone':
          node = ConeNode.parse({
            name: displayName,
            position,
            rotation,
            radius: clampR(shape.radius, 0.5),
            height: clampD(shape.height, 1.0, 0.01, 20),
            radialSegments:
              shape.radialSegments != null ? clampI(shape.radialSegments, 32, 3, 64) : undefined,
            material: shape.material,
            materialPreset: shape.materialPreset,
          })
          break
        case 'frustum':
          node = FrustumNode.parse({
            name: displayName,
            position,
            rotation,
            radiusTop: clampD(shape.radiusTop, 0.25, 0.001, 10),
            radiusBottom: clampD(shape.radiusBottom, 0.5, 0.001, 10),
            height: clampD(shape.height, 1.0, 0.01, 20),
            radialSegments:
              shape.radialSegments != null ? clampI(shape.radialSegments, 32, 3, 64) : undefined,
            material: shape.material,
            materialPreset: shape.materialPreset,
          })
          break
        case 'capsule':
          node = CapsuleNode.parse({
            name: displayName,
            position,
            rotation,
            radius: clampR(shape.radius, 0.25),
            height: clampD(shape.height, 1.0, 0.02, 20),
            capSegments:
              shape.capSegments != null ? clampI(shape.capSegments, 6, 1, 16) : undefined,
            radialSegments:
              shape.radialSegments != null ? clampI(shape.radialSegments, 32, 8, 64) : undefined,
            material: shape.material,
            materialPreset: shape.materialPreset,
          })
          break
        case 'half-cylinder':
          node = HalfCylinderNode.parse({
            name: displayName,
            position,
            rotation,
            radius: clampR(shape.radius, 0.5),
            height: clampD(shape.height, 1.0, 0.01, 20),
            radialSegments:
              shape.radialSegments != null ? clampI(shape.radialSegments, 24, 8, 64) : undefined,
            material: shape.material,
            materialPreset: shape.materialPreset,
          })
          break
        case 'rounded-panel':
          node = RoundedPanelNode.parse({
            name: displayName,
            position,
            rotation,
            length: clampD(shape.length, 1.0, 0.01, 20),
            width: clampD(shape.width, 0.5, 0.01, 20),
            thickness: clampD(shape.thickness ?? shape.height, 0.04, 0.005, 2),
            cornerRadius: clampPanelCornerRadius(shape),
            cornerSegments:
              shape.cornerSegments != null ? clampI(shape.cornerSegments, 4, 1, 12) : undefined,
            material: shape.material,
            materialPreset: shape.materialPreset,
          })
          break
        case 'conformal-strip':
          node = ConformalStripNode.parse({
            name: displayName,
            position,
            rotation,
            surface: shape.surface === 'ellipsoid-cylinder' ? shape.surface : undefined,
            side: shape.side === 'right' ? 'right' : 'left',
            xStart: clampD(shape.xStart, -0.5, -50, 50),
            xEnd: clampD(shape.xEnd, 0.5, -50, 50),
            verticalOffset: clampD(shape.verticalOffset, 0, -20, 20),
            width: clampD(shape.width, 0.04, 0.001, 20),
            thickness: clampD(shape.thickness, 0.003, 0.0005, 1),
            surfaceRadiusY: clampD(shape.surfaceRadiusY, 0.25, 0.001, 20),
            surfaceRadiusZ: clampD(shape.surfaceRadiusZ, 0.25, 0.001, 20),
            surfaceLength:
              shape.surfaceLength != null ? clampD(shape.surfaceLength, 1, 0.001, 100) : undefined,
            endTaper: shape.endTaper != null ? clampD(shape.endTaper, 0.28, 0, 0.95) : undefined,
            segments: shape.segments != null ? clampI(shape.segments, 16, 1, 128) : undefined,
            widthSegments:
              shape.widthSegments != null ? clampI(shape.widthSegments, 2, 1, 16) : undefined,
            material: shape.material,
            materialPreset: shape.materialPreset,
          })
          break
        case 'sphere':
          node = SphereNode.parse({
            name: displayName,
            position,
            rotation,
            scale: shape.scale as [number, number, number] | undefined,
            radius: clampR(shape.radius, 0.5),
            widthSegments:
              shape.widthSegments != null
                ? Math.round(clampD(shape.widthSegments, 32, 8, 64))
                : undefined,
            heightSegments:
              shape.heightSegments != null
                ? Math.round(clampD(shape.heightSegments, 32, 8, 64))
                : undefined,
            material: shape.material,
            materialPreset: shape.materialPreset,
          })
          break
        case 'hemisphere':
          node = HemisphereNode.parse({
            name: displayName,
            position,
            rotation,
            scale: shape.scale as [number, number, number] | undefined,
            radius: clampR(shape.radius, 0.5),
            widthSegments:
              shape.widthSegments != null
                ? Math.round(clampD(shape.widthSegments, 32, 8, 64))
                : undefined,
            heightSegments:
              shape.heightSegments != null
                ? Math.round(clampD(shape.heightSegments, 16, 4, 32))
                : undefined,
            material: shape.material,
            materialPreset: shape.materialPreset,
          })
          break
        case 'torus':
          node = TorusNode.parse({
            name: displayName,
            position,
            rotation,
            majorRadius: clampD(shape.majorRadius ?? shape.radius, 0.5, 0.01, 10),
            tubeRadius: clampD(shape.tubeRadius, 0.08, 0.001, 5),
            radialSegments:
              shape.radialSegments != null ? clampI(shape.radialSegments, 16, 3, 64) : undefined,
            tubularSegments:
              shape.tubularSegments != null ? clampI(shape.tubularSegments, 48, 8, 128) : undefined,
            arc: shape.arc != null ? clampD(shape.arc, Math.PI * 2, 0.01, Math.PI * 2) : undefined,
            material: shape.material,
            materialPreset: shape.materialPreset,
          })
          break
        case 'wedge':
          node = WedgeNode.parse({
            name: displayName,
            position,
            rotation,
            length: clampD(shape.length, 1.0, 0.01, 50),
            width: clampD(shape.width, 1.0, 0.01, 50),
            height: clampD(shape.height, 0.5, 0.01, 20),
            slopeAxis: shape.slopeAxis === 'x' ? 'x' : 'z',
            slopeDirection: shape.slopeDirection === 'negative' ? 'negative' : 'positive',
            material: shape.material,
            materialPreset: shape.materialPreset,
          })
          break
        case 'trapezoid-prism': {
          const topScale = Array.isArray(shape.topScale) ? shape.topScale : undefined
          node = TrapezoidPrismNode.parse({
            name: displayName,
            position,
            rotation,
            length: clampD(shape.length, 1.0, 0.01, 50),
            width: clampD(shape.width, 1.0, 0.01, 50),
            height: clampD(shape.height, 0.5, 0.01, 20),
            topLengthScale: clampD(shape.topLengthScale ?? topScale?.[0], 0.7, 0.01, 3),
            topWidthScale: clampD(shape.topWidthScale ?? topScale?.[1], 0.7, 0.01, 3),
            material: shape.material,
            materialPreset: shape.materialPreset,
          })
          break
        }
        case 'lathe':
          node = LatheNode.parse({
            name: displayName,
            position,
            rotation,
            profile: shape.profile as [number, number][] | undefined,
            segments:
              shape.segments != null ? Math.round(clampD(shape.segments, 32, 8, 128)) : undefined,
            arc: shape.arc != null ? clampD(shape.arc, Math.PI * 2, 0.01, Math.PI * 2) : undefined,
            material: shape.material,
            materialPreset: shape.materialPreset,
          })
          break
        case 'extrude':
          node = ExtrudeNode.parse({
            name: displayName,
            position,
            rotation,
            profile: shape.profile as [number, number][] | undefined,
            holes: shape.holes as [number, number][][] | undefined,
            depth: clampD(shape.depth ?? shape.width, 0.1, 0.005, 10),
            bevelSize: shape.bevelSize != null ? clampD(shape.bevelSize, 0.01, 0, 1) : undefined,
            bevelThickness:
              shape.bevelThickness != null
                ? clampD(shape.bevelThickness, shape.bevelSize ?? 0.01, 0, 1)
                : undefined,
            bevelSegments:
              shape.bevelSegments != null ? clampI(shape.bevelSegments, 2, 0, 12) : undefined,
            curveSegments:
              shape.curveSegments != null ? clampI(shape.curveSegments, 8, 1, 32) : undefined,
            material: shape.material,
            materialPreset: shape.materialPreset,
          })
          break
        case 'sweep':
          node = SweepNode.parse({
            name: displayName,
            position,
            rotation,
            path: shape.path,
            radius: clampD(shape.radius, 0.03, 0.005, 2),
            tubularSegments:
              shape.tubularSegments != null ? clampI(shape.tubularSegments, 24, 2, 128) : undefined,
            radialSegments:
              shape.radialSegments != null ? clampI(shape.radialSegments, 12, 3, 32) : undefined,
            closed: shape.closed,
            material: shape.material,
            materialPreset: shape.materialPreset,
          })
          break
        default:
          continue
      }

      if (!node) continue
      createdNodes.push(
        withNodeMetadata(
          node,
          generatedShapeMetadata({
            artifact,
            shape,
            shapeIndex: i,
            patternInstances: patternInstancesByLead.get(i),
          }),
        ),
      )
      created.push(displayName)
    } catch {
      // Invalid tool output is skipped after clamping.
    }
  }

  return { created, createdNodes }
}

export function markGeneratedPlacementDraft<T extends AnyNode>(node: T): T {
  const metadata =
    typeof node.metadata === 'object' && node.metadata !== null && !Array.isArray(node.metadata)
      ? (node.metadata as Record<string, unknown>)
      : {}

  return {
    ...node,
    metadata: {
      ...metadata,
      isNew: true,
    },
  }
}

export function toAssemblyLocalPosition(position: Vec3, assemblyPosition: Vec3): Vec3 {
  return [
    position[0] - assemblyPosition[0],
    position[1] - assemblyPosition[1],
    position[2] - assemblyPosition[2],
  ]
}

export type GeneratedGeometryCreatePatch = {
  op: 'create'
  node: AnyNode
  parentId?: AnyNodeId
}

export type GeneratedGeometryPlacementSpec = {
  parentId?: AnyNodeId | string | null
  position?: Vec3
  rotation?: Vec3
  generatedBy?: string
  metadata?: Record<string, unknown>
}

export type GeneratedGeometryPatchPlan = {
  created: string[]
  nodeIds: string[]
  rootNode?: AnyNode
  childNodes: AnyNode[]
  patches: GeneratedGeometryCreatePatch[]
}

function nodeMetadata(node: AnyNode): Record<string, unknown> {
  return typeof node.metadata === 'object' &&
    node.metadata !== null &&
    !Array.isArray(node.metadata)
    ? (node.metadata as Record<string, unknown>)
    : {}
}

function withNodeMetadata<T extends AnyNode>(node: T, metadata: Record<string, unknown>): T {
  return {
    ...node,
    metadata: {
      ...nodeMetadata(node),
      ...metadata,
    },
  }
}

function withNodePlacement<T extends AnyNode>(
  node: T,
  placement: Pick<GeneratedGeometryPlacementSpec, 'position' | 'rotation'>,
): T {
  return {
    ...node,
    ...(placement.position ? { position: placement.position } : {}),
    ...(placement.rotation ? { rotation: placement.rotation } : {}),
  } as T
}

function generatedRootMetadata(
  artifact: GeneratedGeometryArtifact,
  options: GeneratedGeometryPlacementSpec,
  partCount: number,
) {
  return {
    generatedBy: options.generatedBy ?? 'ai-chat',
    sourceTool: artifact.sourceTool,
    sourceArgs: artifact.sourceArgs,
    sourcePrompt: artifact.userPrompt,
    artifactId: artifact.id,
    partCount,
    ...options.metadata,
  }
}

export function buildGeneratedGeometryCreatePatches(
  artifact: GeneratedGeometryArtifact,
  options: GeneratedGeometryPlacementSpec = {},
): GeneratedGeometryPatchPlan {
  const { created, createdNodes } = buildGeneratedGeometryNodes(artifact)
  if (!createdNodes.length) return { created, nodeIds: [], childNodes: [], patches: [] }

  const parentId = options.parentId == null ? undefined : (options.parentId as AnyNodeId)
  const shouldCreateAssembly = Boolean(artifact.assemblyName) || createdNodes.length > 1
  if (shouldCreateAssembly) {
    const rootNode = AssemblyNode.parse({
      name: artifact.assemblyName ?? artifact.title,
      position: options.position ?? artifact.assemblyPosition,
      rotation: options.rotation,
      metadata: generatedRootMetadata(artifact, options, createdNodes.length),
    })
    const patches: GeneratedGeometryCreatePatch[] = [
      { op: 'create', node: rootNode, ...(parentId ? { parentId } : {}) },
      ...createdNodes.map((node) => ({
        op: 'create' as const,
        node,
        parentId: rootNode.id as AnyNodeId,
      })),
    ]
    return {
      created,
      nodeIds: [rootNode.id, ...createdNodes.map((node) => node.id)],
      rootNode,
      childNodes: createdNodes,
      patches,
    }
  }

  const rootNode = withNodeMetadata(
    withNodePlacement(createdNodes[0]!, options),
    generatedRootMetadata(artifact, options, 1),
  )
  const patches: GeneratedGeometryCreatePatch[] = [
    { op: 'create', node: rootNode, ...(parentId ? { parentId } : {}) },
  ]
  return { created, nodeIds: [rootNode.id], rootNode, childNodes: [], patches }
}
