import type { Material } from 'three'
import { float, mod, positionLocal, select } from 'three/tsl'
import type { Node, NodeMaterial } from 'three/webgpu'

type Point = readonly [number, number]

/**
 * True for a fragment inside the lot polygon (even-odd crossing count on its
 * x, z: local, where the geometry is laid out in the site's plan as the
 * terrain is; world for a mesh placed and turned there). Unrolled edge by edge
 * into the graph: a parcel has tens of corners, so a loop and a uniform array
 * would buy nothing.
 */
export function insideLotNode(polygon: ReadonlyArray<Point>, at: Node<'vec2'> = positionLocal.xz) {
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
  // Keep a mask the material already carries (the ground window's): the ground is cut to
  // the lot AND out of the window, not one instead of the other.
  const inside = insideLotNode(polygon)
  masked.maskNode = masked.maskNode ? (masked.maskNode as Node<'bool'>).and(inside) : inside
  return masked as unknown as Material
}
