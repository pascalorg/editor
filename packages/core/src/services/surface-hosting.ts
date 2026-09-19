import {
  attachmentBounds,
  attachmentRegionsOverlap,
  isProceduralItem,
} from '../procedural-items/query'
import { evaluateRecipe, type Recipe, type Vec3 } from '../procedural-items/recipe'
import { boundsOf, boxCorners, frame, transformPoint } from '../procedural-items/spatial'
import { nodeRegistry } from '../registry/registry'
import type { AnyNodeDefinition, SceneApi } from '../registry/types'
import { getScaledDimensions, isLowProfileItemSurface } from '../schema/nodes/item'
import type { AnyNode, AnyNodeId } from '../schema/types'
import { canHostOnTop, wouldCreateHostingCycle } from './hosting'
import { shelfRowBoardDimensions } from './shelf-board'
import { surfaceRegionContainsFootprint, surfaceRegionContainsPoint } from './surface-region'

export type SurfaceId = string

export interface SurfaceRegion {
  kind: 'rect' | 'polygon'
  /** Rectangle half-extents in the surface frame's XZ plane. */
  size?: readonly [number, number]
  center?: readonly [number, number]
  /** Counterclockwise boundary in the surface frame's XZ plane. */
  points?: readonly (readonly [number, number])[]
  holes?: readonly (readonly (readonly [number, number])[])[]
}

interface SurfaceFrame {
  label?: string
  position: readonly [number, number, number]
  rotation?: readonly [number, number, number]
  normal: readonly [number, number, number]
  /** Defaults to true; the caller's snap function still controls whether the grid is active. */
  gridSnap?: boolean
}

export type DeclaredHostSurface = SurfaceFrame & { id: SurfaceId; region: SurfaceRegion }
export type HostSurface = DeclaredHostSurface | (SurfaceFrame & { id: null; region?: never })

export interface SurfaceHit {
  point: readonly [number, number, number]
  normalWorldY: number
  meshName?: string
}

export interface SurfaceContext {
  scene: Pick<SceneApi, 'get' | 'nodes'>
}

export interface SurfaceProvider {
  childFrame: 'host-local' | 'surface-local'
  surfaces?(host: AnyNode, ctx: SurfaceContext): readonly DeclaredHostSurface[]
  resolveHit(host: AnyNode, hit: SurfaceHit, ctx: SurfaceContext): HostSurface | null
  accepts?(host: AnyNode, childKind: string, surface: HostSurface, ctx: SurfaceContext): boolean
}

export type SurfaceRejectReason =
  | 'host-not-eligible'
  | 'invalid-hit'
  | 'no-surface'
  | 'child-not-accepted'
  | 'footprint-outside-surface'
  | 'footprint-exceeds-host'
  | 'surface-cutout'
  | 'surface-occupied'

export type SurfacePlacement = {
  position: readonly [number, number, number]
  rotationY: number
  surfaceId: SurfaceId | null
  /** Movers write surfaceLocal for surface-local providers, otherwise the host-local pose. */
  childFrame: SurfaceProvider['childFrame']
  /** Null exactly for hit-derived surfaces. Full XYZ rotation is needed on tilted surfaces. */
  surfaceLocal: {
    position: readonly [number, number, number]
    rotationY: number
    rotation: readonly [number, number, number]
  } | null
}

export const NON_PHYSICAL_HOST_KINDS: readonly string[] = [
  'guide',
  'measurement',
  'scan',
  'construction-dimension',
  'lineset',
  'structural-grid',
  'spawn',
  'zone',
  'unit',
  'site',
  'building',
  'level',
]

const UPWARD_SURFACE_NORMAL_MIN_Y = 0.75

export const hitDerivedSurfaceProvider: SurfaceProvider = {
  childFrame: 'host-local',
  resolveHit(_host, hit) {
    if (!(hit.normalWorldY >= UPWARD_SURFACE_NORMAL_MIN_Y) || !hit.point.every(Number.isFinite))
      return null
    return { id: null, position: hit.point, normal: [0, 1, 0], gridSnap: true }
  },
}

export const itemSurfaceProvider: SurfaceProvider = {
  childFrame: 'host-local',
  resolveHit(host, hit) {
    if (host.type !== 'item' || !canHostOnTop(host) || isLowProfileItemSurface(host)) return null
    if (!(hit.normalWorldY >= UPWARD_SURFACE_NORMAL_MIN_Y) || !hit.point.every(Number.isFinite))
      return null
    const height = host.asset.surface ? host.asset.surface.height * host.scale[1] : hit.point[1]
    return {
      id: null,
      position: [hit.point[0], height, hit.point[2]],
      normal: [0, 1, 0],
      gridSnap: true,
    }
  },
}

function nearestSurface(surfaces: readonly HostSurface[], localY: number): HostSurface | null {
  let best = surfaces[0] ?? null
  for (const surface of surfaces.slice(1)) {
    if (best && Math.abs(surface.position[1] - localY) < Math.abs(best.position[1] - localY))
      best = surface
  }
  return best
}

function shelfSurfaces(host: AnyNode): readonly DeclaredHostSurface[] {
  if (host.type !== 'shelf') return []
  return (nodeRegistry.get(host.type)?.capabilities.surfaces?.custom?.(host) ?? []).map(
    (surface, index) => {
      const [width, , depth] = shelfRowBoardDimensions(host, surface.position[1])
      return {
        ...surface,
        id: `row:${index}`,
        gridSnap: true,
        region: { kind: 'rect', size: [width / 2, depth / 2] },
      }
    },
  )
}

export const shelfSurfaceProvider: SurfaceProvider = {
  childFrame: 'host-local',
  surfaces: shelfSurfaces,
  resolveHit(host, hit) {
    if (!(hit.normalWorldY >= UPWARD_SURFACE_NORMAL_MIN_Y) || !hit.point.every(Number.isFinite))
      return null
    return nearestSurface(shelfSurfaces(host), hit.point[1])
  },
}

const proceduralSurfaceCache = new WeakMap<
  Recipe,
  { key: string; surfaces: readonly DeclaredHostSurface[] }
>()

function proceduralSurfaces(host: AnyNode): readonly DeclaredHostSurface[] {
  if (!isProceduralItem(host)) return []
  // Include contents as well as identity so in-place parameter/recipe edits cannot leave stale surfaces.
  const key = JSON.stringify([host.recipe, host.parameters])
  const cached = proceduralSurfaceCache.get(host.recipe)
  if (cached?.key === key) return cached.surfaces
  const surfaces: DeclaredHostSurface[] = evaluateRecipe(host.recipe, host.parameters).surfaces.map(
    (surface) => ({
      id: surface.id,
      label: surface.label,
      position: surface.position,
      rotation: surface.rotation,
      normal: surface.normal,
      gridSnap: true,
      region: { kind: 'rect', size: [surface.size[0] / 2, surface.size[1] / 2] },
    }),
  )
  proceduralSurfaceCache.set(host.recipe, { key, surfaces })
  return surfaces
}

function surfaceLocalPoint(surface: HostSurface, point: readonly [number, number, number]): Vec3 {
  const delta = point.map((v, i) => v - surface.position[i]!)
  return frame([0, 0, 0], [...(surface.rotation ?? [0, 0, 0])]).axes.map((axis) =>
    axis.reduce((sum, v, i) => sum + v * delta[i]!, 0),
  ) as Vec3
}

function surfaceLocalRotation(surface: HostSurface, rotation: Vec3): Vec3 {
  const surfaceRotation = surface.rotation ?? [0, 0, 0]
  // Preserve unwrapped yaw exactly for the common horizontal, yaw-only case.
  if (!surfaceRotation[0] && !surfaceRotation[2] && !rotation[0] && !rotation[2])
    return [0, rotation[1] - surfaceRotation[1], 0]
  const axes = frame([0, 0, 0], rotation).axes.map((axis) =>
    surfaceLocalPoint({ ...surface, position: [0, 0, 0] }, axis),
  )
  const y = Math.asin(Math.max(-1, Math.min(1, axes[2]![0])))
  return Math.abs(axes[2]![0]) < 0.9999999
    ? [Math.atan2(-axes[2]![1], axes[2]![2]), y, Math.atan2(-axes[1]![0], axes[0]![0])]
    : [Math.atan2(axes[1]![2], axes[1]![1]), y, 0]
}

export const proceduralItemSurfaceProvider: SurfaceProvider = {
  childFrame: 'surface-local',
  surfaces: proceduralSurfaces,
  resolveHit(host, hit) {
    if (!(hit.normalWorldY >= UPWARD_SURFACE_NORMAL_MIN_Y) || !hit.point.every(Number.isFinite))
      return null
    const candidates = proceduralSurfaces(host).filter((surface) => {
      const point = surfaceLocalPoint(surface, hit.point)
      return (
        surface.normal[1] >= UPWARD_SURFACE_NORMAL_MIN_Y &&
        surfaceRegionContainsPoint(surface.region, [point[0], point[2]])
      )
    })
    return nearestSurface(candidates, hit.point[1])
  },
}

const adapters = new Map<string, SurfaceProvider>([
  ['item', itemSurfaceProvider],
  ['shelf', shelfSurfaceProvider],
  ['procedural-item', proceduralItemSurfaceProvider],
])

export function getSurfaceProvider(host: AnyNode): SurfaceProvider {
  const declaration = nodeRegistry.get(host.type)?.capabilities.surfaces
  return declaration?.hosting || adapters.get(host.type) || hitDerivedSurfaceProvider
}

export function rendersHostedChildren(def: AnyNodeDefinition): boolean {
  return def.renderer
    ? def.renderer.kind === 'parametric' && def.rendersChildren !== false
    : !!def.geometry
}

export function canHostSurfaceChild(host: AnyNode, childKind: string, childId?: string): boolean {
  const def = nodeRegistry.get(host.type)
  if (
    !def ||
    NON_PHYSICAL_HOST_KINDS.includes(host.type) ||
    def.capabilities.surfaces?.hosting === false ||
    nodeRegistry.get(childKind)?.capabilities.surfacePlacement === 'floor-only' ||
    !rendersHostedChildren(def)
  )
    return false
  const generated = childId
    ? undefined
    : nodeRegistry.get(childKind)?.schema.shape.id?.safeParse(undefined)
  const id = childId ?? (generated?.success ? generated.data : undefined)
  if (typeof id !== 'string') return false
  const parsed = def.schema.shape.children?.safeParse([id])
  return parsed?.success === true && Array.isArray(parsed.data) && parsed.data.includes(id)
}

function hostRegion(host: AnyNode, ctx: SurfaceContext): SurfaceRegion | undefined {
  const capabilities = nodeRegistry.get(host.type)?.capabilities
  const evaluated = isProceduralItem(host) ? evaluateRecipe(host.recipe, host.parameters) : null
  const bounds =
    capabilities?.dragBounds?.(host, ctx.scene.nodes()) ??
    (evaluated
      ? {
          size: evaluated.dimensions,
          center: evaluated.min.map((v, i) => (v + evaluated.max[i]!) / 2),
        }
      : undefined)
  const size =
    host.type === 'item'
      ? getScaledDimensions(host)
      : (bounds?.size ??
        capabilities?.floorPlaced?.footprint?.(host, { nodes: ctx.scene.nodes() }).dimensions)
  if (!size) return undefined
  return {
    kind: 'rect',
    size: [size[0] / 2, size[2] / 2],
    center: bounds?.center ? [bounds.center[0], bounds.center[2]] : [0, 0],
  }
}

/** Hit and child rotation are host-local; bounds and dimensions are scaled child-local values. */
export function resolveSurfacePlacement(args: {
  host: AnyNode
  surface?: HostSurface
  childKind: string
  childId?: string
  childFootprint: {
    size: readonly [number, number, number]
    rotationY: number
    /** Full host-local XYZ Euler rotation, when available; otherwise rotationY is used. */
    rotation?: readonly [number, number, number]
    localBounds?: { min: readonly [number, number, number]; max: readonly [number, number, number] }
  }
  hit: SurfaceHit
  /** Child origin after grab-offset correction; the hit still elects the actual support. */
  origin?: readonly [number, number, number]
  scene: SceneApi
  /** Pure child-centered grid function; omitted means snapping is off. */
  snapScalar?: (position: number, dimension: number) => number
  /** Defaults to true; drag previews may skip fit while still enforcing host and child eligibility. */
  checkFootprint?: boolean
  onReject?: (reason: SurfaceRejectReason) => void
}): SurfacePlacement | null {
  const { host, hit, childKind, childFootprint } = args
  if (args.childId && wouldCreateHostingCycle(args.childId, host, args.scene)) return null
  // Defer without a refusal so the paired grid event can place on floor support.
  if (!canHostOnTop(host) || !canHostSurfaceChild(host, childKind, args.childId)) return null
  const reject = (reason: SurfaceRejectReason) => {
    args.onReject?.(reason)
    return null
  }
  if (!hit.point.every(Number.isFinite)) return reject('invalid-hit')
  const ctx: SurfaceContext = { scene: args.scene }
  const provider = getSurfaceProvider(host)
  const poseFor = (surface: HostSurface): SurfacePlacement => {
    const declaredId = surface.id
    if (declaredId !== null && !surface.region) {
      throw new Error(`Declared surface ${host.type}:${declaredId} must publish a region`)
    }
    const snap = (surface.gridSnap ?? true) ? args.snapScalar : undefined
    const origin = args.origin ?? hit.point
    const position: [number, number, number] = [
      snap?.(origin[0], childFootprint.size[0]) ?? origin[0],
      surface.position[1],
      snap?.(origin[2], childFootprint.size[2]) ?? origin[2],
    ]
    const rotation = surfaceLocalRotation(surface, [
      ...(childFootprint.rotation ?? [0, childFootprint.rotationY, 0]),
    ])
    const localPosition = surfaceLocalPoint(surface, position)
    if (surface.id !== null) {
      const bounds = childFootprint.localBounds ?? {
        min: [-childFootprint.size[0] / 2, 0, -childFootprint.size[2] / 2] as const,
        max: [
          childFootprint.size[0] / 2,
          childFootprint.size[1],
          childFootprint.size[2] / 2,
        ] as const,
      }
      localPosition[1] = -Math.min(
        ...boxCorners([...bounds.min], [...bounds.max]).map(
          (p) => transformPoint(frame([0, 0, 0], rotation), p)[1],
        ),
      )
      // Intersect the host-local vertical cursor line with the support plane, then lift the child's bottom.
      const normal = frame([0, 0, 0], [...(surface.rotation ?? [0, 0, 0])]).axes[1]
      position[1] =
        surface.position[1] +
        (localPosition[1] -
          normal[0] * (position[0] - surface.position[0]) -
          normal[2] * (position[2] - surface.position[2])) /
          normal[1]
      const projected = surfaceLocalPoint(surface, position)
      localPosition[0] = projected[0]
      localPosition[2] = projected[2]
    }
    return {
      position,
      rotationY: childFootprint.rotationY,
      surfaceId: surface.id,
      childFrame: surface.id === null ? 'host-local' : provider.childFrame,
      surfaceLocal:
        surface.id === null ? null : { position: localPosition, rotationY: rotation[1], rotation },
    }
  }
  let surface = args.surface ?? provider.resolveHit(host, hit, ctx)
  if (!surface && hit.normalWorldY >= UPWARD_SURFACE_NORMAL_MIN_Y) {
    // Grab offsets and snapping can leave the pointer over a hole while the child's centre is supported.
    surface = nearestSurface(
      (provider.surfaces?.(host, ctx) ?? []).filter((candidate) => {
        if (candidate.normal[1] < UPWARD_SURFACE_NORMAL_MIN_Y) return false
        const proposal = poseFor(candidate).surfaceLocal!
        return surfaceRegionContainsFootprint(
          candidate.region,
          proposal.position,
          childFootprint.size,
          proposal.rotation,
          childFootprint.localBounds,
        )
      }),
      hit.point[1],
    )
  }
  if (!surface && isProceduralItem(host)) {
    const bounds = evaluateRecipe(host.recipe, host.parameters)
    if (
      hit.point.every(
        (value, axis) => value >= bounds.min[axis]! - 1e-6 && value <= bounds.max[axis]! + 1e-6,
      )
    )
      surface = hitDerivedSurfaceProvider.resolveHit(host, hit, ctx)
  }
  if (!surface) {
    const overCutout =
      hit.normalWorldY >= UPWARD_SURFACE_NORMAL_MIN_Y &&
      provider.surfaces?.(host, ctx).some((candidate) => {
        if (!candidate.region?.holes?.length) return false
        const local = surfaceLocalPoint(candidate, hit.point)
        const point = [local[0], local[2]] as const
        return (
          surfaceRegionContainsPoint({ ...candidate.region, holes: [] }, point) &&
          !surfaceRegionContainsPoint(candidate.region, point)
        )
      })
    return reject(overCutout ? 'surface-cutout' : 'no-surface')
  }
  const pose = poseFor(surface)
  const localPosition = pose.surfaceLocal?.position ?? ([0, 0, 0] as const)
  const rotation = pose.surfaceLocal?.rotation ?? ([0, childFootprint.rotationY, 0] as const)
  if (provider.accepts && !provider.accepts(host, childKind, surface, ctx)) {
    return reject('child-not-accepted')
  }
  if (args.checkFootprint === false) return pose
  if (surface.region) {
    if (
      !surfaceRegionContainsFootprint(
        surface.region,
        localPosition,
        childFootprint.size,
        rotation,
        childFootprint.localBounds,
      )
    ) {
      const insideOutline = surfaceRegionContainsFootprint(
        { ...surface.region, holes: [] },
        localPosition,
        childFootprint.size,
        rotation,
        childFootprint.localBounds,
      )
      return reject(insideOutline ? 'surface-cutout' : 'footprint-outside-surface')
    }
  } else {
    if (
      !surfaceRegionContainsFootprint(
        hostRegion(host, ctx),
        pose.position,
        childFootprint.size,
        childFootprint.rotation ?? childFootprint.rotationY,
        childFootprint.localBounds,
      )
    )
      return reject('footprint-exceeds-host')
  }
  if (isProceduralItem(host) && pose.surfaceId !== null && pose.surfaceLocal) {
    const bounds = childFootprint.localBounds ?? {
      min: [-childFootprint.size[0] / 2, 0, -childFootprint.size[2] / 2] as Vec3,
      max: [childFootprint.size[0] / 2, childFootprint.size[1], childFootprint.size[2] / 2] as Vec3,
    }
    const proposal = boundsOf(
      boxCorners([...bounds.min], [...bounds.max]).map((point) =>
        transformPoint(
          frame([...pose.surfaceLocal!.position], [...pose.surfaceLocal!.rotation]),
          point,
        ),
      ),
    )
    for (const id of host.children) {
      if (id === args.childId || host.attachments[id] !== pose.surfaceId) continue
      const child = args.scene.get(id as AnyNodeId)
      if (
        child &&
        (isProceduralItem(child) || child.type === 'item') &&
        attachmentRegionsOverlap(attachmentBounds(child), proposal)
      )
        return reject('surface-occupied')
    }
  }
  return pose
}
