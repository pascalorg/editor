import {
  type AnyNode,
  type AnyNodeId,
  type CabinetNode,
  type DeclaredHostSurface,
  type GeometryContext,
  hitDerivedSurfaceProvider,
  pointInPolygon2D,
  type SurfaceContext,
  type SurfaceProvider,
} from '@pascal-app/core'
import { cooktopFootprint, sinkFaucetFootprint, sinkOpening } from './appliance-layout'
import { type CabinetSlab, getCabinetCountertopLayout } from './countertop-layout'
import { isCooktopCompartmentType } from './stack'

function rectangle(x: number, z: number, width: number, depth: number): [number, number][] {
  return [
    [x - width / 2, z - depth / 2],
    [x + width / 2, z - depth / 2],
    [x + width / 2, z + depth / 2],
    [x - width / 2, z + depth / 2],
  ]
}

function slabSurface(id: string, label: string, slab: CabinetSlab): DeclaredHostSurface {
  // Keep XZ anchored to the run, so changing either end or an overhang cannot move an attachment.
  return {
    id,
    label,
    position: [0, slab.position[1] + slab.size[1] / 2, 0],
    normal: [0, 1, 0],
    gridSnap: true,
    region: {
      kind: 'rect',
      center: [slab.position[0], slab.position[2]],
      size: [slab.size[0] / 2, slab.size[2] / 2],
    },
  }
}

export function getCabinetSurfaces(
  node: CabinetNode,
  ctx?: GeometryContext,
): DeclaredHostSurface[] {
  const surfaces: DeclaredHostSurface[] = []
  for (const layout of getCabinetCountertopLayout(node, ctx)) {
    // First member identity survives edits to other spans and changes to this span's far end.
    // Removing/replacing that member or splitting/merging the span is a topology edit.
    const anchorId = layout.modules[0]!.id
    if (layout.countertop) {
      const surface = slabSurface(`countertop:${anchorId}`, 'Countertop', layout.countertop)
      const holes = layout.sinkCuts.flatMap((cut) =>
        cut.bowls.map((bowl) => {
          const opening = sinkOpening(bowl)
          return rectangle(cut.x + opening.centerX, cut.z, opening.width, opening.depth)
        }),
      )
      for (const cut of layout.sinkCuts) {
        const faucet = sinkFaucetFootprint(cut.bowls)
        holes.push(
          Array.from({ length: 28 }, (_, index) => {
            const angle = (index * Math.PI * 2) / 28
            return [
              cut.x + faucet.x + Math.cos(angle) * faucet.radius,
              cut.z + faucet.z + Math.sin(angle) * faucet.radius,
            ]
          }),
        )
      }
      for (const module of layout.modules) {
        if (!module.stack?.some((compartment) => isCooktopCompartmentType(compartment.type)))
          continue
        const footprint = cooktopFootprint(module)
        holes.push(
          rectangle(module.position[0], module.position[2], footprint.width, footprint.depth),
        )
      }
      surface.region = { ...surface.region!, ...(holes.length > 0 ? { holes } : {}) }
      surfaces.push(surface)
    }
    if (layout.bar) {
      surfaces.push(slabSurface(`bar:${layout.bar.edge}:${anchorId}`, 'Bar ledge', layout.bar.slab))
    }
  }
  return surfaces
}

function geometryContext(host: CabinetNode, ctx: SurfaceContext): GeometryContext {
  const nodes = ctx.scene.nodes()
  return {
    resolve: <N = AnyNode>(id: AnyNodeId) => nodes[id] as N | undefined,
    children: host.children
      .map((id) => ctx.scene.get(id as AnyNodeId))
      .filter((node): node is AnyNode => !!node),
    parent: host.parentId ? (nodes[host.parentId as AnyNodeId] ?? null) : null,
    siblings: Object.values(nodes).filter(
      (node) => node.type === host.type && node.parentId === host.parentId,
    ),
  }
}

export const cabinetSurfaceProvider: SurfaceProvider = {
  childFrame: 'host-local',
  surfaces(host, ctx) {
    return host.type === 'cabinet' ? getCabinetSurfaces(host, geometryContext(host, ctx)) : []
  },
  resolveHit(host, hit, ctx) {
    if (host.type !== 'cabinet' || !(hit.normalWorldY >= 0.75) || !hit.point.every(Number.isFinite))
      return null
    const surfaces = getCabinetSurfaces(host, geometryContext(host, ctx))
    let nearest: DeclaredHostSurface | null = null
    for (const surface of surfaces) {
      const region = surface.region!
      const [x, z] = [hit.point[0], hit.point[2]]
      const [cx, cz] = region.center!
      const [width, depth] = region.size!
      if (
        Math.abs(x - cx) > width ||
        Math.abs(z - cz) > depth ||
        region.holes?.some((hole) =>
          pointInPolygon2D(
            [x, z],
            hole.map(([hx, hz]) => [hx, hz]),
          ),
        )
      )
        continue
      if (
        !nearest ||
        Math.abs(surface.position[1] - hit.point[1]) < Math.abs(nearest.position[1] - hit.point[1])
      )
        nearest = surface
    }
    return nearest
  },
}

export const cabinetModuleSurfaceProvider: SurfaceProvider = {
  childFrame: 'host-local',
  // Catalog placement has always targeted runs; standalone module hosting belongs to registry movers.
  accepts: (_host, childKind) => childKind !== 'item',
  resolveHit(host, hit, ctx) {
    const parent = host.parentId ? ctx.scene.get(host.parentId as AnyNodeId) : undefined
    // A run owns its counter and cutouts; its module meshes must let the hit bubble.
    if (parent?.type === 'cabinet') return null
    return hitDerivedSurfaceProvider.resolveHit(host, hit, ctx)
  },
}
