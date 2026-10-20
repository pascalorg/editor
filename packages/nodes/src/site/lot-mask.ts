import type { Material } from 'three'
import { float, mod, positionLocal, select } from 'three/tsl'
import type { Node, NodeMaterial } from 'three/webgpu'

type Point = readonly [number, number]

/**
 * True for a fragment inside the lot polygon (even-odd crossing count on its
 * local x, z). Unrolled edge by edge into the graph: a parcel has tens of
 * corners, so a loop and a uniform array would buy nothing.
 */
export function insideLotNode(polygon: ReadonlyArray<Point>) {
  const at = positionLocal.xz
  let crossings: Node<'float'> = float(0)
  for (let i = 0; i < polygon.length; i++) {
    const [ax, az] = polygon[i] as Point
    const [bx, bz] = polygon[(i + 1) % polygon.length] as Point
    if (az === bz) continue
    const slope = (bx - ax) / (bz - az)
    const crossesAt = at.y.sub(az).mul(slope).add(ax)
    const crosses = at.y
      .greaterThanEqual(Math.min(az, bz))
      .and(at.y.lessThan(Math.max(az, bz)))
      .and(at.x.lessThan(crossesAt))
    crossings = crossings.add(select(crosses, float(1), float(0)))
  }
  return mod(crossings, float(2)).greaterThan(0.5)
}

/**
 * The ground material cut to the lot: the terrain field is the padded,
 * north-up box around the parcel, and only the parcel itself is ground the
 * project owns. Per fragment, so the edge is the property line exactly and
 * follows a sculpt stroke with no rebuild; the shadow pass honours the mask too.
 */
export function lotMaskedMaterial(material: Material, polygon: ReadonlyArray<Point>): Material {
  const masked = material.clone() as unknown as NodeMaterial
  masked.maskNode = insideLotNode(polygon)
  return masked as unknown as Material
}
