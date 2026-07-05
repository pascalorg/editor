import type {
  DeviceProfileQualityScore,
  PrimitiveEditableHints,
  PrimitiveGeometryBrief,
  PrimitiveMaterialInput,
  PrimitiveRevisionOperation,
  PrimitiveShapeContract,
  ResolvedPrimitiveTransform,
  Vec3,
} from '@pascal-app/core'
import { normalizePrimitiveKindFromRegistry } from '@pascal-app/core/lib/primitive-registry'
import type { AssetSourceContract } from './asset-source-contract'

export interface GeneratedGeometryShapeSpec {
  kind: string
  position: Vec3
  rotation: Vec3
  scale?: Vec3
  name?: string
  semanticRole?: string
  semanticGroup?: string
  sourcePartKind?: string
  sourcePartId?: string
  editableHints?: PrimitiveEditableHints
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
  axis?: string
  capSegments?: number
  radialSegments?: number
  tubularSegments?: number
  widthSegments?: number
  heightSegments?: number
  wallThickness?: number
  surface?: string
  side?: string
  xStart?: number
  xEnd?: number
  verticalOffset?: number
  surfaceRadiusY?: number
  surfaceRadiusZ?: number
  surfaceLength?: number
  endTaper?: number
  radiusTop?: number
  radiusBottom?: number
  majorRadius?: number
  tubeRadius?: number
  topScale?: [number, number]
  topLengthScale?: number
  topWidthScale?: number
  slopeAxis?: string
  slopeDirection?: string
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
  material?: PrimitiveMaterialInput
  materialPreset?: string
  attachTo?: number | string
  anchor?: string
  childAnchor?: string
  cutouts?: PrimitiveShapeContract['cutouts']
  ports?: PrimitiveShapeContract['ports']
  pattern?: PrimitiveShapeContract['pattern']
  duct?: PrimitiveShapeContract['duct']
}

type ShapeSpec = GeneratedGeometryShapeSpec

export type GeneratedGeometryArtifact = {
  id: string
  title: string
  sourceTool: string
  sourceArgs: Record<string, unknown>
  userPrompt: string
  revisionOf?: string
  version: number
  createdAt: string
  shapes: GeneratedGeometryShapeSpec[]
  transforms: ResolvedPrimitiveTransform[]
  assemblyName: string | null
  assemblyPosition: Vec3
  createdNames: string[]
  shapeDetails: string
  geometryBrief?: PrimitiveGeometryBrief
  semanticSummary?: string
  visualQualitySummary?: string
  profileQuality?: DeviceProfileQualityScore
  assetSource?: AssetSourceContract
  editHistory?: GeneratedGeometryEdit[]
  placedNodeIds?: string[]
  placedAt?: string
  savedAt?: string
  supersededBy?: string
  replaceNodeIds?: string[]
  replacedAt?: string
}

export type GeneratedGeometryEdit = {
  at: string
  feedback?: string
  intent?: string
  summary?: string
  tool: string
  operations?: PrimitiveRevisionOperation[]
}

export function createGeneratedGeometryId() {
  return `ai_geometry_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export function formatGeneratedShapeDetails(
  shapes: ShapeSpec[],
  transforms: ResolvedPrimitiveTransform[],
) {
  return shapes
    .map((s, index) => {
      const parts: string[] = [`  - ${s.name ?? s.kind}: ${s.kind}`]
      const displayPosition = transforms[index]?.position ?? s.position
      parts.push(`pos=[${(displayPosition as Vec3).join(',')}]`)
      if (s.kind === 'box')
        parts.push(`${s.length}x${s.width}x${s.height}, corner=${s.cornerRadius ?? 0}`)
      if (s.kind === 'rounded-panel')
        parts.push(`${s.length}x${s.width}x${s.thickness}, corner=${s.cornerRadius ?? 0}`)
      if (s.kind === 'conformal-strip')
        parts.push(
          `x=${s.xStart ?? -((s.length ?? 1) / 2)}..${s.xEnd ?? (s.length ?? 1) / 2}, side=${s.side ?? 'left'}, w=${s.width}, t=${s.thickness}`,
        )
      if (s.kind === 'cylinder' || s.kind === 'hollow-cylinder')
        parts.push(`axis=${s.axis}, r=${s.radius}, h=${s.height}`)
      if (s.kind === 'cone') parts.push(`axis=${s.axis}, r=${s.radius}, h=${s.height}`)
      if (s.kind === 'frustum')
        parts.push(`axis=${s.axis}, rt=${s.radiusTop}, rb=${s.radiusBottom}, h=${s.height}`)
      if (s.kind === 'hemisphere')
        parts.push(`axis=${s.axis}, r=${s.radius}, scale=[${(s.scale as Vec3).join(',')}]`)
      if (s.kind === 'torus')
        parts.push(`axis=${s.axis}, R=${s.majorRadius ?? s.radius}, r=${s.tubeRadius}`)
      if (s.kind === 'wedge')
        parts.push(
          `${s.length}x${s.width}x${s.height}, slope=${s.slopeAxis ?? 'z'}:${s.slopeDirection ?? 'positive'}`,
        )
      if (s.kind === 'trapezoid-prism') {
        parts.push(
          `${s.length}x${s.width}x${s.height}, topScale=[${s.topLengthScale ?? s.topScale?.[0] ?? 0.7},${s.topWidthScale ?? s.topScale?.[1] ?? 0.7}]`,
        )
      }
      if (s.kind === 'capsule' || s.kind === 'half-cylinder')
        parts.push(`axis=${s.axis}, r=${s.radius}, h=${s.height}`)
      if (s.kind === 'sphere') {
        parts.push(
          `r=${s.radius}, scale=[${(s.scale as Vec3).join(',')}]${s.rotation && (s.rotation as Vec3).some((v) => v !== 0) ? `, rot=[${(s.rotation as Vec3).join(',')}]` : ''}`,
        )
      }
      if (s.kind === 'lathe') parts.push(`profile=${s.profile?.length ?? 0}pts, seg=${s.segments}`)
      if (s.kind === 'extrude')
        parts.push(
          `profile=${s.profile?.length ?? 0}pts, holes=${s.holes?.length ?? 0}, depth=${s.depth}`,
        )
      if (s.kind === 'sweep') parts.push(`path=${s.path?.length ?? 0}pts, r=${s.radius}`)
      if (s.material?.properties?.color) parts.push(`color=${s.material.properties.color}`)
      else if (s.material?.preset) parts.push(`material=${s.material.preset}`)
      else if (s.materialPreset) parts.push(`material=${s.materialPreset}`)
      if (s.semanticRole) parts.push(`role=${s.semanticRole}`)
      if (s.semanticGroup) parts.push(`group=${s.semanticGroup}`)
      if (s.sourcePartKind) parts.push(`source=${s.sourcePartKind}`)
      if (s.editableHints?.primaryDimension) {
        parts.push(`editable=${s.editableHints.primaryDimension}`)
      }
      if (s.attachTo != null) parts.push(`attachTo=${s.attachTo} ${s.anchor}->${s.childAnchor}`)
      return parts.join(' ')
    })
    .join('\n')
}

export function computeGeneratedAssemblyPosition(
  transforms: ReadonlyArray<{ position?: Vec3 } | undefined>,
): Vec3 {
  const positions = transforms
    .map((transform) => transform?.position)
    .filter((position): position is Vec3 => Array.isArray(position) && position.length >= 3)

  if (positions.length === 0) return [0, 0, 0]

  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY

  for (const position of positions) {
    minX = Math.min(minX, position[0])
    maxX = Math.max(maxX, position[0])
    minZ = Math.min(minZ, position[2])
    maxZ = Math.max(maxZ, position[2])
  }

  return [(minX + maxX) / 2, 0, (minZ + maxZ) / 2]
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function normalizePrimitiveKind(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
  const registryKind = normalizePrimitiveKindFromRegistry(raw)
  if (registryKind && registryKind !== raw) return registryKind
  switch (raw) {
    case 'tube':
    case 'pipe':
    case 'hollow':
    case 'hollow-cylinder':
      return 'hollow-cylinder'
    case 'dome':
    case 'half-sphere':
    case 'half sphere':
    case 'hemisphere':
      return 'hemisphere'
    case 'ring':
    case 'donut':
    case 'tyre':
    case 'tire':
    case 'torus':
      return 'torus'
    case 'trapezoid':
    case 'trapezoid-prism':
    case 'trapezoidal-prism':
    case 'trapezoidal prism':
      return 'trapezoid-prism'
    case 'conformal_strip':
    case 'conformal-strip':
    case 'curved-strip':
    case 'curved rectangle':
    case 'curved-rectangle':
      return 'conformal-strip'
    case 'ramp':
    case 'wedge':
      return 'wedge'
    default:
      return raw
  }
}

export function inferGeneratedAssemblyName(
  toolName: string,
  args: Record<string, unknown>,
  shapes: ShapeSpec[],
): string {
  const explicitName = readString(args.name)
  if (explicitName) return explicitName

  if (toolName === 'compose_robot_arm') return 'Robot arm'

  const firstShapeName = readString(shapes[0]?.name)
  return firstShapeName ? `${firstShapeName} assembly` : 'Generated object'
}
