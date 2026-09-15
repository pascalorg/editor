import { isProceduralItem, queryProceduralItem } from '../procedural-items/query'
import { nodeRegistry } from '../registry/registry'
import type { SceneApi, SurfacesConfig } from '../registry/types'
import { getScaledDimensions, isLowProfileItemSurface } from '../schema/nodes/item'
import type { AnyNode } from '../schema/types'
import { canHostOnTop } from './hosting'
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

export interface HostSurface {
  id: SurfaceId | null
  label?: string
  position: readonly [number, number, number]
  rotationY?: number
  normal: readonly [number, number, number]
  /** Absent regions retain the legacy dimension-only host fit check. */
  region?: SurfaceRegion
  /** Free by default; center selects child-centered grid snapping, not the host origin. */
  snap?: 'free' | 'center'
}

export interface SurfaceHit {
  point: readonly [number, number, number]
  normalWorldY: number
  meshName?: string
}

export interface SurfaceContext {
  scene: Pick<SceneApi, 'get' | 'nodes'>
}

export interface SurfaceProvider {
  surfaces?(host: AnyNode, ctx: SurfaceContext): readonly HostSurface[]
  resolveHit(host: AnyNode, hit: SurfaceHit, ctx: SurfaceContext): HostSurface | null
  accepts?(host: AnyNode, childKind: string, surface: HostSurface, ctx: SurfaceContext): boolean
}

/** Additive registry declaration; existing SurfacesConfig consumers ignore hosting. */
export type SurfaceHostingConfig = SurfacesConfig & { hosting?: SurfaceProvider }

export type SurfacePlacement = {
  position: readonly [number, number, number]
  rotationY: number
  surfaceId: SurfaceId | null
} & (
  | { valid: true; reason?: never }
  | {
      valid: false
      reason: 'child-not-accepted' | 'footprint-outside-surface' | 'footprint-exceeds-host'
    }
)

export const NON_PHYSICAL_HOST_KINDS: readonly string[] = [
  'guide',
  'measurement',
  'scan',
  'construction-dimension',
  'lineset',
  'structural-grid',
  'spawn',
  'zone',
  'site',
  'building',
  'level',
]

const UPWARD_SURFACE_NORMAL_MIN_Y = 0.75

export const hitDerivedSurfaceProvider: SurfaceProvider = {
  resolveHit(_host, hit) {
    if (!(hit.normalWorldY >= UPWARD_SURFACE_NORMAL_MIN_Y) || !Number.isFinite(hit.point[1]))
      return null
    return { id: null, position: hit.point, normal: [0, 1, 0] }
  },
}

export const itemSurfaceProvider: SurfaceProvider = {
  resolveHit(host, hit) {
    if (host.type !== 'item' || !canHostOnTop(host) || isLowProfileItemSurface(host)) return null
    if (!(hit.normalWorldY >= UPWARD_SURFACE_NORMAL_MIN_Y)) return null
    // Authored heights short-circuit even a non-finite local hit Y, as in the mover.
    const height = host.asset.surface ? host.asset.surface.height * host.scale[1] : hit.point[1]
    if (!host.asset.surface && !Number.isFinite(height)) return null
    return { id: null, position: [hit.point[0], height, hit.point[2]], normal: [0, 1, 0] }
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

function shelfSurfaces(host: AnyNode): readonly HostSurface[] {
  return (nodeRegistry.get(host.type)?.capabilities.surfaces?.custom?.(host) ?? []).map(
    (surface, index) => ({
      ...surface,
      id: `row:${index}`,
      snap: 'center',
    }),
  )
}

export const shelfSurfaceProvider: SurfaceProvider = {
  surfaces: shelfSurfaces,
  resolveHit(host, hit) {
    if (!(hit.normalWorldY >= UPWARD_SURFACE_NORMAL_MIN_Y)) return null
    return nearestSurface(shelfSurfaces(host), hit.point[1])
  },
}

function proceduralSurfaces(host: AnyNode): readonly HostSurface[] {
  if (!isProceduralItem(host)) return []
  // Query in an isolated host frame: ancestor support/attachment composition belongs to the caller.
  const local = {
    ...host,
    parentId: null,
    wallId: undefined,
    position: [0, 0, 0] as [number, number, number],
    rotation: [0, 0, 0] as [number, number, number],
  }
  return queryProceduralItem(local, {}).surfaces.map((surface) => ({
    id: surface.id,
    label: surface.label,
    position: surface.position,
    rotationY: surface.rotation[1],
    normal: surface.normal,
    region: { kind: 'rect', size: [surface.size[0] / 2, surface.size[1] / 2] },
  }))
}

function surfaceLocalPoint(
  surface: HostSurface,
  point: readonly [number, number, number],
): [number, number, number] {
  const x = point[0] - surface.position[0]
  const z = point[2] - surface.position[2]
  const yaw = surface.rotationY ?? 0
  return [Math.cos(yaw) * x - Math.sin(yaw) * z, 0, Math.sin(yaw) * x + Math.cos(yaw) * z]
}

export const proceduralItemSurfaceProvider: SurfaceProvider = {
  surfaces: proceduralSurfaces,
  resolveHit(host, hit) {
    if (!(hit.normalWorldY >= UPWARD_SURFACE_NORMAL_MIN_Y)) return null
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
  const declaration = nodeRegistry.get(host.type)?.capabilities.surfaces as
    | SurfaceHostingConfig
    | undefined
  return declaration?.hosting ?? adapters.get(host.type) ?? hitDerivedSurfaceProvider
}

function hostSize(
  host: AnyNode,
  ctx: SurfaceContext,
): readonly [number, number, number] | undefined {
  if (host.type === 'item') return getScaledDimensions(host)
  if (host.type === 'shelf') return [host.width, host.height, host.depth]
  const capabilities = nodeRegistry.get(host.type)?.capabilities
  return (
    capabilities?.dragBounds?.(host, ctx.scene.nodes()).size ??
    capabilities?.floorPlaced?.footprint?.(host, { nodes: ctx.scene.nodes() }).dimensions
  )
}

/** All inputs/outputs are host-local; callers supply scaled child dimensions and host-local yaw. */
export function resolveSurfacePlacement(args: {
  host: AnyNode
  childKind: string
  childFootprint: { size: readonly [number, number, number]; rotationY: number }
  hit: SurfaceHit
  scene: SceneApi
  /** Pure child-centered grid function; omitted means snapping is off. */
  snapScalar?: (position: number, dimension: number) => number
}): SurfacePlacement | null {
  const { host, hit, childKind, childFootprint } = args
  if (NON_PHYSICAL_HOST_KINDS.includes(host.type) || !canHostOnTop(host)) return null
  const ctx: SurfaceContext = { scene: args.scene }
  const provider = getSurfaceProvider(host)
  const surface = provider.resolveHit(host, hit, ctx)
  if (!surface) return null
  const snap = surface.id === null || surface.snap === 'center' ? args.snapScalar : undefined
  const position: [number, number, number] = [
    snap?.(hit.point[0], childFootprint.size[0]) ?? hit.point[0],
    surface.position[1],
    snap?.(hit.point[2], childFootprint.size[2]) ?? hit.point[2],
  ]
  const pose = { position, rotationY: childFootprint.rotationY, surfaceId: surface.id }
  if (provider.accepts && !provider.accepts(host, childKind, surface, ctx)) {
    return { ...pose, valid: false, reason: 'child-not-accepted' }
  }
  if (surface.region) {
    if (
      !surfaceRegionContainsFootprint(
        surface.region,
        surfaceLocalPoint(surface, position),
        childFootprint.size,
        childFootprint.rotationY - (surface.rotationY ?? 0),
      )
    ) {
      return { ...pose, valid: false, reason: 'footprint-outside-surface' }
    }
  } else {
    const size = hostSize(host, ctx)
    if (size && (childFootprint.size[0] > size[0] || childFootprint.size[2] > size[2])) {
      return { ...pose, valid: false, reason: 'footprint-exceeds-host' }
    }
  }
  return { ...pose, valid: true }
}
