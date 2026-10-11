import type { AnyNode, StairNode, StairSegmentNode } from '../../schema'
import { measureStairDetail } from './stair-detail-budget'
import { createStairFlightFromStair } from './stair-flight'
import { computeSegmentTransforms, rotateXZ } from './stair-footprint'
import { resolveStairArcDimensions } from './stair-layout'
import { stairRailPathVertexBound } from './stair-rail-budget'
import { resolveStairTotalRise } from './stair-rise-query'
import { resolveStairWinder } from './stair-winder'

export type StairRailPath = {
  side: 'left' | 'right'
  nodeIds: string[]
  /** In the parent stair's local frame, before its position and rotation. */
  points: [number, number, number][]
}

/** Exposed boundaries leave the flight entry and arrival portals open. */
export function resolveStairRailPaths(
  stair: StairNode,
  nodes: Record<string, AnyNode>,
  mode = stair.railingMode,
  inset = 0,
): StairRailPath[] {
  if (mode === 'none' || stair.visible === false) return []
  const detail = measureStairDetail(
    stair,
    stair.children
      .map((id) => nodes[id])
      .filter((node): node is StairSegmentNode => node?.type === 'stair-segment'),
  )
  if (detail.error) throw new RangeError(detail.error)
  const segments = stair.children
    .map((id) => nodes[id])
    .filter((node): node is StairSegmentNode => node?.type === 'stair-segment')
  if (stairRailPathVertexBound(stair, segments) * (mode === 'both' ? 2 : 1) > 10_000)
    throw new RangeError(
      'Continuous stair paths exceed the 10,000-point computation budget. The authored dimensions are preserved.',
    )
  const allowed = (side: 'left' | 'right') => mode === 'both' || mode === side
  if (stair.stairType !== 'straight') {
    const layout = resolveStairArcDimensions(stair, resolveStairTotalRise(stair, nodes))
    return (['left', 'right'] as const).filter(allowed).map((side) => {
      const inner = (side === 'left') === layout.sweepAngle >= 0
      const radius = inner ? layout.innerRadius : layout.outerRadius
      const count = Math.max(1, Math.ceil(Math.abs(layout.sweepAngle) / (Math.PI / 36)))
      const points: StairRailPath['points'] = Array.from({ length: count + 1 }, (_, i) => {
        const t = i / count,
          angle = -layout.sweepAngle / 2 + layout.sweepAngle * t
        const y = Math.min(
          layout.riserHeight + t * layout.stepCount * layout.riserHeight,
          layout.stepCount * layout.riserHeight,
        )
        return [Math.cos(angle) * radius, y, Math.sin(angle) * radius]
      })
      if (layout.landingSweep) {
        const count = Math.max(1, Math.ceil(Math.abs(layout.landingSweep) / (Math.PI / 36)))
        for (let i = 1; i <= count; i++) {
          const angle = layout.sweepAngle / 2 + (layout.landingSweep * i) / count
          points.push([
            Math.cos(angle) * radius,
            layout.stepCount * layout.riserHeight,
            Math.sin(angle) * radius,
          ])
        }
      }
      return { side, nodeIds: [stair.id], points }
    })
  }
  const chain = segments.length ? segments : [createStairFlightFromStair(stair, nodes)]
  const transforms = computeSegmentTransforms(chain)
  const layouts = chain.flatMap((segment, index) => {
    if (segment.visible === false) return []
    const transform = transforms[index]!
    const point = (x: number, z: number): [number, number] => {
      const [dx, dz] = rotateXZ(x, z, transform.rotation)
      return [transform.position[0] + dx, transform.position[2] + dz]
    }
    return [
      {
        segment,
        transform,
        polygon: resolveStairWinder(segment)?.footprint.map(([x, z]) => point(x, z)) ?? [
          point(-segment.width / 2, 0),
          point(segment.width / 2, 0),
          point(segment.width / 2, segment.length),
          point(-segment.width / 2, segment.length),
        ],
      },
    ]
  })
  const edges: {
    a: [number, number, number]
    b: [number, number, number]
    side?: 'left' | 'right'
    nodeId: string
    landing?: boolean
  }[] = []
  const local = (layout: (typeof layouts)[number], x: number, z: number) =>
    rotateXZ(
      x - layout.transform.position[0],
      z - layout.transform.position[2],
      -layout.transform.rotation,
    )
  for (const layout of layouts) {
    const { segment, transform } = layout
    const winder = resolveStairWinder(segment)
    if (winder) {
      for (const side of ['left', 'right'] as const) {
        const inner = (side === 'left') === (segment.winder!.turn === 'right')
        const radius = inner
          ? segment.winder!.innerGap + inset
          : segment.winder!.innerGap + segment.width - inset
        const sign = segment.winder!.turn === 'left' ? -1 : 1,
          pivot = sign * (segment.winder!.innerGap + segment.width / 2)
        let points = winder.outerBoundary.map(([outerX, y, outerZ]) => {
          const angle = Math.atan2(outerZ, sign * (pivot - outerX)),
            scale = radius / Math.max(Math.cos(angle), Math.sin(angle))
          const x = pivot - sign * scale * Math.cos(angle),
            z = scale * Math.sin(angle)
          const [dx, dz] = rotateXZ(x, z, transform.rotation)
          return [
            transform.position[0] + dx,
            transform.position[1] +
              Math.min(segment.height, y + segment.height / segment.stepCount),
            transform.position[2] + dz,
          ] as [number, number, number]
        })
        if (radius === 0) points = [points[0]!, points.at(-1)!]
        for (let i = 1; i < points.length; i++)
          if (Math.hypot(...points[i]!.map((value, axis) => value - points[i - 1]![axis]!)) > 1e-10)
            edges.push({ a: points[i - 1]!, b: points[i]!, side, nodeId: segment.id })
      }
      continue
    }
    if (segment.segmentType === 'stair') {
      for (const side of ['left', 'right'] as const) {
        const x = side === 'left' ? segment.width / 2 - inset : -segment.width / 2 + inset
        const stations = [0, segment.length * (1 - 1 / segment.stepCount), segment.length].filter(
          (value, i, array) => i === 0 || value > array[i - 1]!,
        )
        const at = (z: number): [number, number, number] => {
          const [dx, dz] = rotateXZ(x, z, transform.rotation)
          return [
            transform.position[0] + dx,
            transform.position[1] +
              Math.min(
                segment.height,
                (z / segment.length + 1 / segment.stepCount) * segment.height,
              ),
            transform.position[2] + dz,
          ]
        }
        for (let i = 1; i < stations.length; i++)
          edges.push({ a: at(stations[i - 1]!), b: at(stations[i]!), side, nodeId: segment.id })
      }
      continue
    }
    for (let i = 0; i < layout.polygon.length; i++) {
      const a = layout.polygon[i]!,
        b = layout.polygon[(i + 1) % layout.polygon.length]!,
        dx = b[0] - a[0],
        dz = b[1] - a[1],
        lengthSq = dx * dx + dz * dz
      if (!lengthSq) continue
      const stations = [0, 1]
      for (const other of layouts)
        for (const vertex of other.polygon) {
          const t = ((vertex[0] - a[0]) * dx + (vertex[1] - a[1]) * dz) / lengthSq
          if (t > 0 && t < 1 && Math.abs((vertex[0] - a[0]) * dz - (vertex[1] - a[1]) * dx) < 1e-6)
            stations.push(t)
        }
      stations.sort((x, y) => x - y)
      for (let j = 1; j < stations.length; j++) {
        const lo = stations[j - 1]!,
          hi = stations[j]!
        if (hi - lo < 1e-8) continue
        const x = a[0] + (dx * (lo + hi)) / 2,
          z = a[1] + (dz * (lo + hi)) / 2
        const portal = layouts.some((other) => {
          if (other === layout) return false
          const point = local(other, x, z),
            epsilon = 1e-6
          const winder = resolveStairWinder(other.segment)
          if (winder) {
            const exit = rotateXZ(
              point[0] - winder.exit.position[0],
              point[1] - winder.exit.position[2],
              -winder.exit.rotation,
            )
            return (
              (Math.abs(point[0]) <= other.segment.width / 2 + epsilon &&
                Math.abs(point[1]) < epsilon &&
                Math.abs(other.transform.position[1] - transform.position[1]) < epsilon) ||
              (Math.abs(exit[0]) <= other.segment.width / 2 + epsilon &&
                Math.abs(exit[1]) < epsilon &&
                Math.abs(
                  other.transform.position[1] + other.segment.height - transform.position[1],
                ) < epsilon)
            )
          }
          if (Math.abs(point[0]) > other.segment.width / 2 + epsilon) return false
          if (other.segment.segmentType === 'landing')
            return (
              Math.abs(other.transform.position[1] - transform.position[1]) < epsilon &&
              point[1] >= -epsilon &&
              point[1] <= other.segment.length + epsilon
            )
          return (
            (Math.abs(point[1]) < epsilon &&
              Math.abs(other.transform.position[1] - transform.position[1]) < epsilon) ||
            (Math.abs(point[1] - other.segment.length) < epsilon &&
              Math.abs(other.transform.position[1] + other.segment.height - transform.position[1]) <
                epsilon)
          )
        })
        if (portal) continue
        const length = Math.sqrt(lengthSq)
        let nx = -dz / length,
          nz = dx / length
        const [centerX, centerZ] = rotateXZ(0, segment.length / 2, transform.rotation)
        if (
          nx * (transform.position[0] + centerX - x) + nz * (transform.position[2] + centerZ - z) <
          0
        ) {
          nx = -nx
          nz = -nz
        }
        edges.push({
          a: [a[0] + dx * lo + nx * inset, transform.position[1], a[1] + dz * lo + nz * inset],
          b: [a[0] + dx * hi + nx * inset, transform.position[1], a[1] + dz * hi + nz * inset],
          nodeId: segment.id,
          landing: true,
        })
      }
    }
  }
  const paths: StairRailPath[] = []
  const equal = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[2]! - b[2]!) < 0.0002
  while (edges.length) {
    const first = edges.pop()!,
      points = [first.a, first.b],
      nodeIds = [first.nodeId]
    let side = first.side
    for (let progress = true; progress; ) {
      progress = false
      for (let i = edges.length - 1; i >= 0; i--) {
        const edge = edges[i]!
        const index = chain.findIndex((segment) => segment.id === edge.nodeId)
        if (
          !nodeIds.some((id) => {
            const other = chain.findIndex((segment) => segment.id === id)
            return chain
              .slice(Math.min(index, other) + 1, Math.max(index, other))
              .every((segment) => segment.segmentType === 'landing' && segment.visible !== false)
          })
        )
          continue
        if (
          inset &&
          (edge.landing ||
            chain.find((segment) => segment.id === nodeIds.at(-1))?.segmentType === 'landing')
        ) {
          const intersect = (
            a: number[],
            b: number[],
            c: number[],
            d: number[],
          ): [number, number, number] | null => {
            const ux = b[0]! - a[0]!,
              uz = b[2]! - a[2]!,
              vx = d[0]! - c[0]!,
              vz = d[2]! - c[2]!,
              det = ux * vz - uz * vx
            if (Math.abs(det) < 1e-10) return null
            const t = ((c[0]! - a[0]!) * vz - (c[2]! - a[2]!) * vx) / det
            return [a[0]! + t * ux, (b[1]! + c[1]!) / 2, a[2]! + t * uz]
          }
          const near = (a: number[], b: number[]) =>
            Math.hypot(a[0]! - b[0]!, a[2]! - b[2]!) <= inset * 1.5 + 0.0002 &&
            Math.abs(a[1]! - b[1]!) < 0.0002
          let corner: null | [number, number, number] = null
          if (near(points.at(-1)!, edge.a)) {
            corner = intersect(points.at(-2)!, points.at(-1)!, edge.a, edge.b)
            if (corner) {
              points[points.length - 1] = corner
              edge.a = corner
            }
          } else if (near(points.at(-1)!, edge.b)) {
            corner = intersect(points.at(-2)!, points.at(-1)!, edge.b, edge.a)
            if (corner) {
              points[points.length - 1] = corner
              edge.b = corner
            }
          } else if (near(points[0]!, edge.b)) {
            corner = intersect(points[1]!, points[0]!, edge.b, edge.a)
            if (corner) {
              points[0] = corner
              edge.b = corner
            }
          } else if (near(points[0]!, edge.a)) {
            corner = intersect(points[1]!, points[0]!, edge.a, edge.b)
            if (corner) {
              points[0] = corner
              edge.a = corner
            }
          }
        }
        if (equal(points.at(-1)!, edge.a)) points.push(edge.a, edge.b)
        else if (equal(points.at(-1)!, edge.b)) points.push(edge.b, edge.a)
        else if (equal(points[0]!, edge.b)) points.unshift(edge.a, edge.b)
        else if (equal(points[0]!, edge.a)) points.unshift(edge.b, edge.a)
        else continue
        side ??= edge.side
        nodeIds.push(edge.nodeId)
        edges.splice(i, 1)
        progress = true
      }
    }
    side ??= 'left'
    if (allowed(side))
      paths.push({
        side,
        nodeIds: [...new Set(nodeIds)],
        points: points.filter(
          (point, i) =>
            i === 0 ||
            Math.hypot(
              point[0] - points[i - 1]![0],
              point[1] - points[i - 1]![1],
              point[2] - points[i - 1]![2],
            ) > 1e-8,
        ),
      })
  }
  return paths
}

/**
 * A predicate for "this horizontal point, in the stair's local frame, lies on
 * the walkable surface" — the region a guard rail stands at the edge of. A rail
 * guard uses it to tell which side of its path is the walking volume (so a flat
 * glass pane can be held off that side) without re-deriving the footprint. For
 * an arc stair the walkable surface is the annulus between the inner and outer
 * walking radii; for a straight run or a winder it is the flight/landing
 * footprint, with the same winder test the inset handrail uses.
 */
export function resolveStairWalkInside(
  stair: StairNode,
  nodes: Record<string, AnyNode>,
): (x: number, z: number) => boolean {
  if (stair.stairType !== 'straight') {
    const dimensions = resolveStairArcDimensions(stair, resolveStairTotalRise(stair, nodes))
    const inner = Math.min(dimensions.innerRadius, dimensions.outerRadius)
    const outer = Math.max(dimensions.innerRadius, dimensions.outerRadius)
    return (x, z) => {
      const r = Math.hypot(x, z)
      return r > inner && r < outer
    }
  }
  const segments = stair.children
    .map((id) => nodes[id])
    .filter((node): node is StairSegmentNode => node?.type === 'stair-segment')
  const chain = segments.length ? segments : [createStairFlightFromStair(stair, nodes)]
  const transforms = computeSegmentTransforms(chain)
  return (x, z) =>
    chain.some((segment, i) => {
      if (segment.visible === false) return false
      const transform = transforms[i]!,
        local = rotateXZ(x - transform.position[0], z - transform.position[2], -transform.rotation)
      if (segment.winder) {
        const sign = segment.winder.turn === 'left' ? -1 : 1,
          g = segment.winder.innerGap,
          r = Math.max(sign * (sign * (g + segment.width / 2) - local[0]), local[1])
        return (
          sign * (sign * (g + segment.width / 2) - local[0]) > 0 &&
          local[1] > 0 &&
          r > g &&
          r < g + segment.width
        )
      }
      return Math.abs(local[0]) < segment.width / 2 && local[1] > 0 && local[1] < segment.length
    })
}

function resolveInsetHandrailPaths(
  stair: StairNode,
  nodes: Record<string, AnyNode>,
): StairRailPath[] {
  if (!stair.handrail || stair.handrail.mode === 'none') return []
  const offset = stair.handrail.offset
  if (
    stair.stairType === 'straight' &&
    stair.children.some(
      (id) => nodes[id]?.type === 'stair-segment' && (nodes[id] as StairSegmentNode).winder,
    )
  )
    return resolveStairRailPaths(stair, nodes, stair.handrail.mode, offset)
  const paths = resolveStairRailPaths(stair, nodes, stair.handrail.mode)
  if (!offset) return paths
  if (stair.stairType !== 'straight') {
    const dimensions = resolveStairArcDimensions(stair, 0)
    return paths.map((path) => ({
      ...path,
      points: path.points.map(([x, y, z]) => {
        const radius = Math.hypot(x, z),
          direction = radius < dimensions.walkingRadius ? 1 : -1
        const target = radius + direction * offset
        return [(x * target) / radius, y, (z * target) / radius] as [number, number, number]
      }),
    }))
  }
  const segments = stair.children
    .map((id) => nodes[id])
    .filter((node): node is StairSegmentNode => node?.type === 'stair-segment')
  const chain = segments.length ? segments : [createStairFlightFromStair(stair, nodes)]
  const inside = resolveStairWalkInside(stair, nodes)
  return paths.map((path) => {
    const normals = path.points.slice(1).map((point, i) => {
      const previous = path.points[i]!,
        dx = point[0] - previous[0],
        dz = point[2] - previous[2],
        length = Math.hypot(dx, dz)
      const normal: [number, number] = length > 1e-8 ? [-dz / length, dx / length] : [0, 0]
      const epsilon = Math.min(
        0.001,
        ...chain.map((segment) => Math.min(segment.width, segment.length) / 100),
      )
      if (
        !inside(
          (point[0] + previous[0]) / 2 + normal[0] * epsilon,
          (point[2] + previous[2]) / 2 + normal[1] * epsilon,
        )
      ) {
        normal[0] *= -1
        normal[1] *= -1
      }
      return normal
    })
    for (let i = 0; i < normals.length; i++)
      if (normals[i]![0] === 0 && normals[i]![1] === 0)
        normals[i] = normals.slice(i + 1).find((normal) => normal[0] !== 0 || normal[1] !== 0) ??
          normals
            .slice(0, i)
            .reverse()
            .find((normal) => normal[0] !== 0 || normal[1] !== 0) ?? [0, 0]
    const closed =
      Math.hypot(
        path.points[0]![0] - path.points.at(-1)![0],
        path.points[0]![1] - path.points.at(-1)![1],
        path.points[0]![2] - path.points.at(-1)![2],
      ) < 1e-8
    return {
      ...path,
      points: path.points.map(([x, y, z], i) => {
        const a = normals[closed ? (i + normals.length - 1) % normals.length : Math.max(0, i - 1)]!,
          b = normals[closed ? i % normals.length : Math.min(i, normals.length - 1)]!
        const denominator = 1 + a[0] * b[0] + a[1] * b[1]
        const nx = denominator > 1e-6 ? (a[0] + b[0]) / denominator : b[0],
          nz = denominator > 1e-6 ? (a[1] + b[1]) / denominator : b[1]
        return [x + nx * offset, y, z + nz * offset] as [number, number, number]
      }),
    }
  })
}

/** End details are geometric returns; wall/post targets are not hosted connections. */
export function resolveStairHandrailPaths(
  stair: StairNode,
  nodes: Record<string, AnyNode>,
): StairRailPath[] {
  const paths = resolveInsetHandrailPaths(stair, nodes)
  const config = stair.handrail
  if (!config || (!config.bottom && !config.top)) return paths
  const boundaries = resolveStairRailPaths(stair, nodes, config.mode)
  const segments = stair.children
    .map((id) => nodes[id])
    .filter((node): node is StairSegmentNode => node?.type === 'stair-segment')
  const chain = segments.length ? segments : [createStairFlightFromStair(stair, nodes)]
  const transforms = computeSegmentTransforms(chain)
  const bottomY =
    stair.stairType === 'straight'
      ? transforms[0]!.position[1] +
        (chain[0]!.segmentType === 'stair' ? chain[0]!.height / chain[0]!.stepCount : 0)
      : resolveStairArcDimensions(stair, resolveStairTotalRise(stair, nodes)).riserHeight
  const topY =
    stair.stairType === 'straight'
      ? transforms.at(-1)!.position[1] + chain.at(-1)!.height
      : resolveStairArcDimensions(stair, resolveStairTotalRise(stair, nodes)).stepCount *
        resolveStairArcDimensions(stair, resolveStairTotalRise(stair, nodes)).riserHeight
  const result = paths.map((path, pathIndex) => {
    const points = path.points.map((point) => [...point] as [number, number, number])
    if (points.length < 2 || Math.hypot(...points[0]!.map((v, i) => v - points.at(-1)![i]!)) < 1e-8)
      return path
    const bottomIndex = points[0]![1] <= points.at(-1)![1] ? 0 : points.length - 1
    for (const end of ['bottom', 'top'] as const) {
      const detail = config[end]
      if (!detail) continue
      const index = end === 'bottom' ? bottomIndex : path.points.length - 1 - bottomIndex
      const original = path.points[index]!
      if (stair.stairType === 'straight') {
        const portalSegment = end === 'bottom' ? chain[0]! : chain.at(-1)!
        const portalTransform = end === 'bottom' ? transforms[0]! : transforms.at(-1)!
        if (portalSegment.visible === false) continue
        const boundaryPath =
          boundaries.find(
            (boundary) =>
              boundary.side === path.side &&
              boundary.nodeIds.some((id) => path.nodeIds.includes(id)),
          ) ?? boundaries[pathIndex]!
        const firstIsBottom = boundaryPath.points[0]![1] <= boundaryPath.points.at(-1)![1]
        const boundary =
          boundaryPath.points[
            (end === 'bottom') === firstIsBottom ? 0 : boundaryPath.points.length - 1
          ]!
        const [x, z] = rotateXZ(
          boundary[0] - portalTransform.position[0],
          boundary[2] - portalTransform.position[2],
          -portalTransform.rotation,
        )
        const winder = resolveStairWinder(portalSegment)
        const [portalX, portalZ] =
          winder && end === 'top'
            ? rotateXZ(
                x - winder.exit.position[0],
                z - winder.exit.position[2],
                -winder.exit.rotation,
              )
            : [x, z]
        if (
          Math.abs(portalZ - (end === 'bottom' || winder ? 0 : portalSegment.length)) > 0.0002 ||
          Math.abs(Math.abs(portalX) - portalSegment.width / 2) > 0.0002
        )
          continue
      }
      if (Math.abs(original[1] - (end === 'bottom' ? bottomY : topY)) > 0.0002) continue
      const neighbor = path.points[index === 0 ? 1 : index - 1]!
      let dx = original[0] - neighbor[0],
        dz = original[2] - neighbor[2]
      if (stair.stairType !== 'straight') {
        const direction = Math.sign(stair.sweepAngle) * (end === 'bottom' ? -1 : 1)
        dx = -original[2] * direction
        dz = original[0] * direction
      }
      const pivotEndpoint =
        Math.hypot(dx, dz) < 1e-8 &&
        stair.stairType === 'straight' &&
        !!(end === 'bottom' ? chain[0] : chain.at(-1))?.winder
      if (pivotEndpoint) {
        const segment = end === 'bottom' ? chain[0]! : chain.at(-1)!,
          transform = end === 'bottom' ? transforms[0]! : transforms.at(-1)!
        const yaw =
          transform.rotation + (end === 'top' ? resolveStairWinder(segment)!.exit.rotation : 0)
        ;[dx, dz] = rotateXZ(0, end === 'bottom' ? -1 : 1, yaw)
      }
      const length = Math.hypot(dx, dz)
      if (length < 1e-8) continue
      const arc = resolveStairArcDimensions(stair, resolveStairTotalRise(stair, nodes))
      const slope =
        end !== 'bottom'
          ? 0
          : stair.stairType === 'straight'
            ? chain[0]!.segmentType === 'stair'
              ? chain[0]!.winder
                ? pivotEndpoint
                  ? // A zero-radius pivot has no horizontal incline; its extension follows the authored walking line.
                    -chain[0]!.height /
                    (2 * (chain[0]!.winder!.innerGap + chain[0]!.winder!.walkingLineOffset))
                  : -(neighbor[1] - original[1]) / length
                : -chain[0]!.height / chain[0]!.length
              : 0
            : -(arc.stepCount * arc.riserHeight) /
              (Math.hypot(original[0], original[2]) * Math.abs(arc.sweepAngle))
      const extended: [number, number, number] = [
        original[0] + (dx / length) * detail.extension,
        original[1] + slope * detail.extension,
        original[2] + (dz / length) * detail.extension,
      ]
      const sourceY = stair.stairType === 'straight' ? transforms[0]!.position[1] : 0
      if (end === 'bottom' && extended[1] + config.height < sourceY)
        throw new RangeError(
          'The bottom handrail extension crosses below the source floor. Reduce its length or increase the handrail height.',
        )
      const additions: StairRailPath['points'] = detail.extension ? [extended] : []
      if (detail.return !== 'none') {
        const target: [number, number, number] = [...extended]
        if (detail.return === 'floor')
          target[1] =
            (end === 'bottom'
              ? stair.stairType === 'straight'
                ? transforms[0]!.position[1]
                : 0
              : topY) - config.height
        else if (detail.return === 'post') target[1] -= detail.returnLength
        else {
          const boundaryPath =
            boundaries.find(
              (boundary) =>
                boundary.side === path.side &&
                boundary.nodeIds.some((id) => path.nodeIds.includes(id)),
            ) ?? boundaries[pathIndex]!
          const firstIsBottom = boundaryPath.points[0]![1] <= boundaryPath.points.at(-1)![1]
          const boundary =
            boundaryPath.points[
              (end === 'bottom') === firstIsBottom ? 0 : boundaryPath.points.length - 1
            ]!
          let nx = boundary[0] - original[0],
            nz = boundary[2] - original[2]
          let normalLength = Math.hypot(nx, nz)
          if (normalLength < 1e-8) {
            const ascent = end === 'bottom' ? -1 : 1
            const side = path.side === 'left' ? 1 : -1
            const arc = stair.stairType === 'straight' ? 1 : -1
            nx = (dz / length) * ascent * side * arc
            nz = (-dx / length) * ascent * side * arc
            normalLength = 1
          }
          target[0] += (nx / normalLength) * detail.returnLength
          target[2] += (nz / normalLength) * detail.returnLength
        }
        if (Math.hypot(...target.map((v, i) => v - extended[i]!)) > 1e-8) additions.push(target)
      }
      if (index === 0) points.unshift(...additions.reverse())
      else points.push(...additions)
    }
    return { ...path, points }
  })
  if (result.reduce((sum, path) => sum + path.points.length, 0) > 10_000)
    throw new RangeError(
      'Handrail ends exceed the 10,000-point computation budget. The authored dimensions are preserved.',
    )
  return result
}
