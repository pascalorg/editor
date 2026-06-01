import {
  type AnyNode,
  type AnyNodeId,
  AssemblyNode,
  BoxNode,
  CapsuleNode,
  ConeNode,
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
  useScene,
  type Vec3,
  WedgeNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import type {
  GeneratedGeometryArtifact,
  GeneratedGeometryShapeSpec,
} from './ai-generated-geometry-core'

export {
  computeGeneratedAssemblyPosition,
  createGeneratedGeometryId,
  formatGeneratedShapeDetails,
  type GeneratedGeometryArtifact,
  type GeneratedGeometryShapeSpec,
  inferGeneratedAssemblyName,
  normalizePrimitiveKind,
} from './ai-generated-geometry-core'

type ShapeSpec = GeneratedGeometryShapeSpec

export const AI_GEOMETRY_ASSETS_STORAGE_KEY = 'pascal.ai.geometryAssets'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isGeneratedGeometryArtifact(value: unknown): value is GeneratedGeometryArtifact {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.sourceTool === 'string' &&
    isRecord(value.sourceArgs) &&
    Array.isArray(value.shapes) &&
    Array.isArray(value.transforms) &&
    Array.isArray(value.createdNames) &&
    Array.isArray(value.assemblyPosition)
  )
}

export function readSavedGeneratedGeometryArtifacts() {
  if (typeof window === 'undefined') return [] as GeneratedGeometryArtifact[]
  try {
    const raw = window.localStorage.getItem(AI_GEOMETRY_ASSETS_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter(isGeneratedGeometryArtifact) : []
  } catch {
    return []
  }
}

function writeSavedGeneratedGeometryArtifacts(entries: GeneratedGeometryArtifact[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(AI_GEOMETRY_ASSETS_STORAGE_KEY, JSON.stringify(entries))
  window.dispatchEvent(new Event('ai-geometry-assets:updated'))
}

export function removeGeneratedGeometryArtifactFromLocalLibrary(artifactId: string) {
  const next = readSavedGeneratedGeometryArtifacts().filter(
    (artifact) => artifact.id !== artifactId,
  )
  writeSavedGeneratedGeometryArtifacts(next)
}

export function replaceGeneratedGeometryArtifactOnCanvas(artifact: GeneratedGeometryArtifact) {
  const scene = useScene.getState()
  const idsToReplace = (artifact.replaceNodeIds ?? [])
    .filter((id) => Boolean(scene.nodes[id as AnyNodeId]))
    .map((id) => id as AnyNodeId)

  if (idsToReplace.length > 0) scene.deleteNodes(idsToReplace)
  return placeGeneratedGeometryArtifact(artifact)
}

export function shouldUseRevisionContext(text: string, artifact: GeneratedGeometryArtifact | null) {
  if (!artifact) return false
  const normalized = text.toLowerCase()
  const revisionTerms = [
    '\u4fee\u6539',
    '\u8c03\u6574',
    '\u6539',
    '\u589e\u52a0',
    '\u5220\u9664',
    '\u51cf\u5c11',
    '\u4e0d\u6ee1\u610f',
    '\u66f4',
    '\u518d',
    '\u4e1d\u6ed1',
    '\u987a\u6ed1',
    '\u5706\u6da6',
    '\u6d41\u7ebf',
    '\u5e73\u6ed1',
    'smooth',
    'smoother',
    'sleek',
    'rounded',
    'change',
    'modify',
    'adjust',
    'add',
    'remove',
    'replace',
    'larger',
    'smaller',
    'wider',
    'taller',
  ]
  return revisionTerms.some((term) => normalized.includes(term))
}


export function buildRevisionContext(artifact: GeneratedGeometryArtifact, userRequest: string) {
  return [
    'The user is asking to revise the previous generated geometry.',
    'Return exactly ONE complete replacement geometry tool call. Do not output a partial patch.',
    'Prefer the same source tool and blueprint when possible. For vehicle smoothness/style revisions, keep compose_parts vehicle parts and tune vehicle_body cornerRadius/cornerSegments/detail/enhanceVisualDetails instead of rebuilding wheels as raw primitive cylinders.',
    `Modification request: ${userRequest}`,
    '',
    'Previous generated geometry:',
    `- id: ${artifact.id}`,
    `- title: ${artifact.title}`,
    `- original prompt: ${artifact.userPrompt}`,
    `- tool: ${artifact.sourceTool}`,
    `- shapes:\n${artifact.shapeDetails}`,
    '',
    `Previous normalized tool arguments JSON:\n${JSON.stringify(artifact.sourceArgs)}`,
  ].join('\n')
}

export const clampD = (v: unknown, fallback: number, min = 0.01, max = 50) =>
  Math.max(min, Math.min(max, typeof v === 'number' && !Number.isNaN(v) ? v : fallback))
export const clampR = (v: unknown, fallback: number) => clampD(v, fallback, 0.01, 10)
const clampI = (v: unknown, fallback: number, min: number, max: number) =>
  Math.round(clampD(v, fallback, min, max))

function clampCornerRadius(shape: ShapeSpec) {
  if (shape.cornerRadius == null) return undefined
  const length = clampD(shape.length, 1.0)
  const width = clampD(shape.width, 1.0)
  const height = clampD(shape.height, 1.0)
  return clampD(shape.cornerRadius, 0, 0, Math.max(0, Math.min(length, width, height) / 2 - 0.001))
}

function clampPanelCornerRadius(shape: ShapeSpec) {
  if (shape.cornerRadius == null) return undefined
  const length = clampD(shape.length, 1.0)
  const width = clampD(shape.width, 0.5)
  const thickness = clampD(shape.thickness ?? shape.height, 0.04, 0.005, 2)
  return clampD(
    shape.cornerRadius,
    0.04,
    0,
    Math.max(0, Math.min(length, width, thickness) / 2 - 0.001),
  )
}

export function buildGeneratedGeometryNodes(artifact: GeneratedGeometryArtifact) {
  const shouldCreateAssembly = artifact.shapes.length > 1
  const created: string[] = []
  const createdNodes: AnyNode[] = []

  for (let i = 0; i < artifact.shapes.length; i++) {
    const shape = artifact.shapes[i]
    const transform = artifact.transforms[i]
    if (!shape || !transform) continue

    const { position: worldPosition, rotation } = transform
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
              shape.radialSegments != null ? clampI(shape.radialSegments, 32, 8, 64) : undefined,
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
              shape.radialSegments != null ? clampI(shape.radialSegments, 32, 8, 64) : undefined,
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
      createdNodes.push(node)
      created.push(displayName)
    } catch {
      // Invalid tool output is skipped after clamping.
    }
  }

  return { created, createdNodes }
}

export function placeGeneratedGeometryArtifact(artifact: GeneratedGeometryArtifact) {
  const { created, createdNodes } = buildGeneratedGeometryNodes(artifact)
  if (!createdNodes.length) return { nodeIds: [] as string[], created }

  const levelId = useViewer.getState().selection.levelId
  const scene = useScene.getState()
  const shouldCreateAssembly = Boolean(artifact.assemblyName) || createdNodes.length > 1
  if (shouldCreateAssembly) {
    const assembly = AssemblyNode.parse({
      name: artifact.assemblyName ?? artifact.title,
      position: artifact.assemblyPosition,
      metadata: {
        generatedBy: 'ai-chat',
        sourceTool: artifact.sourceTool,
        artifactId: artifact.id,
        partCount: createdNodes.length,
      },
    })
    scene.createNode(assembly, levelId ?? undefined)
    const createdNodeIds: string[] = [assembly.id]
    for (const node of createdNodes) {
      scene.createNode(node, assembly.id)
      createdNodeIds.push(node.id)
    }
    useViewer.getState().setSelection({ selectedIds: [assembly.id] })
    return { nodeIds: createdNodeIds, created }
  }

  for (const node of createdNodes) scene.createNode(node, levelId ?? undefined)
  const firstNode = createdNodes[0]
  if (firstNode) useViewer.getState().setSelection({ selectedIds: [firstNode.id] })
  return { nodeIds: createdNodes.map((node) => node.id), created }
}

export function saveGeneratedGeometryArtifactToLocalLibrary(artifact: GeneratedGeometryArtifact) {
  const savedAt = new Date().toISOString()
  const entry = { ...artifact, savedAt }
  const entries = readSavedGeneratedGeometryArtifacts()
  writeSavedGeneratedGeometryArtifacts([
    entry,
    ...entries.filter((item) => item.id !== artifact.id),
  ])
  return savedAt
}

export function toAssemblyLocalPosition(position: Vec3, assemblyPosition: Vec3): Vec3 {
  return [
    position[0] - assemblyPosition[0],
    position[1] - assemblyPosition[1],
    position[2] - assemblyPosition[2],
  ]
}
