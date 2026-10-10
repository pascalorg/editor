import type { AnyNode, FenceNode, SlabNode, WallNode } from '../schema'
import type { FacadeBalconyPlacement } from '../systems/facade/facade-unit'
import { DEFAULT_WALL_THICKNESS } from '../systems/wall/wall-footprint'
import { type BalconyOptions, balconyGuard, balconySlab, DEFAULT_BALCONY } from './balcony'
import type { FacadeRun } from './facade-runs'
import { wallBaseElevationIn } from './wall-support-in'

/**
 * A native slab and three railings for one balcony of a run. `previous` is
 * keyed by `facadeCell`, so a refill keeps each node's id. `metadata.balcony`
 * lets the balcony inspector recognise the deck; `facadeOwner` makes it defer
 * to the facade.
 */
export function facadeBalconyNodes({
  run,
  balcony,
  host,
  cell,
  nodes,
  previous,
}: {
  run: FacadeRun
  balcony: FacadeBalconyPlacement
  /** The wall the balcony belongs to: the one it stands in front of. */
  host: WallNode
  cell: string
  nodes: Record<string, AnyNode>
  previous: ReadonlyMap<string, SlabNode | FenceNode>
}): (SlabNode | FenceNode)[] {
  const { origin, direction, normal } = run
  const point = (along: number, out: number): [number, number] => [
    origin[0] + direction[0] * along + normal[0] * out,
    origin[1] + direction[1] * along + normal[1] * out,
  ]
  const half = (host.thickness ?? DEFAULT_WALL_THICKNESS) / 2
  // The deck starts just inside the face so no seam shows along it.
  const near = half - 0.02
  const far = half + balcony.depth
  const left = run.start + balcony.left
  const right = run.start + balcony.right
  const corners = [point(left, near), point(right, near), point(right, far), point(left, far)]
  // Wind the deck the same way whichever side of the axis the face is on.
  const clockwise = direction[0] * normal[1] - direction[1] * normal[0] < 0
  const options: BalconyOptions = {
    ...DEFAULT_BALCONY,
    depth: balcony.depth,
    railing: balcony.railing,
  }

  const slabCell = `${cell}:slab`
  const old = previous.get(slabCell)
  const slab = balconySlab({
    ...old,
    name: 'Balcony slab',
    parentId: host.parentId,
    polygon: clockwise ? [...corners].reverse() : corners,
    elevation: wallBaseElevationIn(host, nodes),
    thickness: options.thickness,
    slots: { ...old?.slots, ...(balcony.deckMaterial ? { surface: balcony.deckMaterial } : {}) },
    metadata: { ...old?.metadata, facadeOwner: host.id, facadeCell: slabCell },
  })
  slab.metadata = {
    ...slab.metadata,
    balcony: { id: slab.id, source: 'facade', role: 'deck', options },
  }
  const edges: [[number, number], [number, number]][] = [
    [corners[0]!, corners[3]!],
    [corners[3]!, corners[2]!],
    [corners[2]!, corners[1]!],
  ]
  const guards = edges.map(([start, end], index) => {
    const railCell = `${cell}:rail-${index}`
    const oldRail = previous.get(railCell)
    return balconyGuard({
      ...oldRail,
      name: 'Balcony railing',
      parentId: host.parentId,
      start,
      end,
      supportSlabId: slab.id,
      height: options.railingHeight,
      style: balcony.railing,
      ornament: balcony.ornament,
      slots: {
        ...oldRail?.slots,
        ...(balcony.railingMaterial
          ? { posts: balcony.railingMaterial, rail: balcony.railingMaterial }
          : {}),
      },
      metadata: {
        ...oldRail?.metadata,
        facadeOwner: host.id,
        facadeCell: railCell,
        balcony: { id: slab.id, source: 'facade', role: 'guard' },
      },
    })
  })
  return [slab, ...guards]
}
