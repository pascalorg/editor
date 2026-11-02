import { resolveLevelId } from '../../lib/node-ancestry'
import type { AnyNode, FenceNode } from '../../schema'
import { getLevelElevations } from '../../services/storey'
import { sampleFenceCenterline } from '../../systems/fence/fence-centerline'
import { isSplineFence } from '../../systems/fence/fence-spline'
import {
  fenceBlockCorners,
  fenceBlockSegments,
  fenceMiter,
  type GuardBlock,
  layoutGuardFence,
} from '../../systems/fence/guard-layout'
import { isCurvedWall } from '../../systems/wall/wall-curve'
import { floorUnder, isHidden, type SupportCache } from './support'
import type { Prism, Ring, Skipped } from './types'
import type { Nodes } from './walls'

type Point = [number, number]

/** Samples of a straight stretch carry no information: drop points less than 2 mm off the line around them. */
function thinned(points: Point[]): Point[] {
  const kept: Point[] = [points[0]!]
  for (let i = 1; i < points.length - 1; i++) {
    const a = kept.at(-1)!
    const c = points[i + 1]!
    const dx = c[0] - a[0]
    const dz = c[1] - a[1]
    const length = Math.hypot(dx, dz)
    const off =
      length < 1e-9
        ? 0
        : Math.abs((points[i]![0] - a[0]) * dz - (points[i]![1] - a[1]) * dx) / length
    if (off > 0.002) kept.push(points[i]!)
  }
  kept.push(points.at(-1)!)
  return kept
}
export type FencePrisms = { fenceId: string; levelId: string | null; prisms: Prism[] }

/** A fence's span between arc lengths `from` and `to`, as the centreline points inside it. */
function span(points: Point[], lengths: number[], from: number, to: number): Point[] {
  const at = (s: number): Point => {
    for (let i = 1; i < points.length; i++)
      if (s <= lengths[i]! || i === points.length - 1) {
        const run = lengths[i]! - lengths[i - 1]!
        const t =
          run > 1e-9
            ? (Math.min(Math.max(s, lengths[i - 1]!), lengths[i]!) - lengths[i - 1]!) / run
            : 0
        return [
          points[i - 1]![0] + (points[i]![0] - points[i - 1]![0]) * t,
          points[i - 1]![1] + (points[i]![1] - points[i - 1]![1]) * t,
        ]
      }
    return points[0]!
  }
  const inside = points.filter((_, i) => lengths[i]! > from + 1e-9 && lengths[i]! < to - 1e-9)
  return [at(from), ...inside, at(to)]
}

type Corner = [number, number]

/** The longest a run of a curved guard is drawn straight: the renderer's own. */
const CURVE_SEGMENT_M = 0.18

/** The footprint of a box `w` x `d` centred on (x, z) and turned `rotationY` about the vertical axis, as the renderer turns it. */
function box(x: number, z: number, w: number, d: number, rotationY: number): Ring {
  const cos = Math.cos(rotationY)
  const sin = Math.sin(rotationY)
  return [
    [-w / 2, -d / 2],
    [w / 2, -d / 2],
    [w / 2, d / 2],
    [-w / 2, d / 2],
  ].map(([cx, cz]): Corner => [x + cx! * cos + cz! * sin, z - cx! * sin + cz! * cos])
}

/** The fences that share an end with this one, by end, as the renderer finds them for its corner mitres. */
function cornerNeighbors(
  fence: FenceNode,
  nodes: Nodes,
): Partial<Record<'start' | 'end', FenceNode>> {
  const found: Partial<Record<'start' | 'end', FenceNode>> = {}
  for (const sibling of Object.values(nodes) as AnyNode[]) {
    if (sibling.type !== 'fence' || sibling.id === fence.id || sibling.parentId !== fence.parentId)
      continue
    if (sibling.visible === false) continue
    for (const endpoint of ['start', 'end'] as const) {
      const point = fence[endpoint]
      if (
        [sibling.start, sibling.end].some(
          (other) => Math.hypot(point[0] - other[0], point[1] - other[1]) < 0.001,
        ) &&
        !found[endpoint]
      )
        found[endpoint] = sibling
    }
  }
  return found
}

/**
 * A deck guard as the renderer builds it (`layoutGuardFence`, the same layout its meshes come from):
 * every post, the cap rail and top rail, the bottom rail, and the infill, with the cap and rails
 * mitred where a fence meets another. The infill is taken as one solid strip: balusters, cables and
 * boards stand a hand apart and nothing a person carries goes between them. A pyramid post cap is
 * drawn as its base.
 */
function guardPrisms(
  fence: FenceNode,
  neighbors: Partial<Record<'start' | 'end', FenceNode>>,
  z0: number,
): Prism[] {
  const layout = layoutGuardFence(fence)
  const prisms: Prism[] = []
  const straight = !isSplineFence(fence) && !isCurvedWall(fence)
  // a straight fence stands at one lift (the support at its start); a curved one follows the terrain
  const follows = straight
    ? undefined
    : 'a curved guard follows the terrain: its heights are read at its start'
  const common = { nodeId: fence.id, kind: 'guard' as const, holes: [] }
  const add = (id: string, y0: number, y1: number, outer: Ring, approx?: string) => {
    if (y1 - y0 > 1e-4)
      prisms.push({
        id: `${fence.id}#${id}`,
        ...common,
        z0: z0 + y0,
        z1: z0 + y1,
        outer,
        ...(approx || follows
          ? { shape: 'approx' as const, why: approx ?? follows }
          : { shape: 'exact' as const }),
      })
  }
  for (const [i, post] of layout.posts.entries()) {
    const [x, y, z] = post.position
    const [w, h, d] = post.scale
    if (post.shape === 'pyramid')
      add(
        `post.${i}`,
        y - h / 2,
        y + h / 2,
        box(x, z, w * Math.SQRT1_2, d * Math.SQRT1_2, post.rotationY),
        'a pyramid post cap, drawn as its base',
      )
    else add(`post.${i}`, y - h / 2, y + h / 2, box(x, z, w, d, post.rotationY))
  }
  // a run is one quad on a straight fence and a quad per short segment on a curved one
  const run = (name: string, block: GuardBlock, mitre: boolean) => {
    const segments: [number, number][] = straight
      ? [[block.startT, block.endT]]
      : fenceBlockSegments(fence, block.startT, block.endT, CURVE_SEGMENT_M)
    for (const [k, [a, b]] of segments.entries()) {
      const [startOuter, startInner, endOuter, endInner] = fenceBlockCorners(
        fence,
        a,
        b,
        block.depth,
      )
      const corners = { startOuter, startInner, endOuter, endInner }
      if (mitre)
        for (const endpoint of ['start', 'end'] as const) {
          const neighbor = neighbors[endpoint]
          if (
            !neighbor ||
            Math.abs((endpoint === 'start' ? a : b) - (endpoint === 'start' ? 0 : 1)) > 1e-5
          )
            continue
          for (const { side, reach, ux, uz } of fenceMiter(
            fence,
            endpoint,
            neighbor,
            block.depth,
          ) ?? []) {
            const key = `${endpoint}${side === 1 ? 'Outer' : 'Inner'}` as keyof typeof corners
            corners[key] = [corners[key][0] + ux * reach, corners[key][1] + uz * reach]
          }
        }
      add(`${name}.${k}`, block.centerY - block.height / 2, block.centerY + block.height / 2, [
        corners.startOuter,
        corners.endOuter,
        corners.endInner,
        corners.startInner,
      ])
    }
  }
  for (const [i, block] of layout.rail.entries()) run(`rail.${i}`, block, true)
  for (const [i, block] of layout.base.entries()) run(`base.${i}`, block, true)
  // the infill: one strip, as high as the infill is, as deep as its pieces are
  const infill = layout.infill
  if (infill.length) {
    const y0 = Math.min(...infill.map((b) => b.centerY - b.height / 2))
    const y1 = Math.max(...infill.map((b) => b.centerY + b.height / 2))
    const first = infill[0]!
    run(
      'infill',
      {
        startT: 0,
        endT: 1,
        centerY: (y0 + y1) / 2,
        height: y1 - y0,
        depth: first.depth,
        split: true,
      },
      false,
    )
  }
  return prisms
}

/**
 * A deck guard with nothing cut into it is read part by part (`guardPrisms`). Every other fence is
 * a strip along its centreline, as wide as its thicker of thickness and post, from its support to
 * its height, with a gate or an open passage taken out of it; the infill is not drawn (a picket
 * fence is solid to a person) and the height does not follow terrain, so it is approximate.
 */
export function fenceBodies(nodes: Nodes): { fences: FencePrisms[]; skipped: Skipped[] } {
  const out: FencePrisms[] = []
  const skipped: Skipped[] = []
  const elevations = getLevelElevations(nodes as never)
  const support: SupportCache = new Map()
  for (const node of Object.values(nodes) as AnyNode[]) {
    if (node.type !== 'fence' || isHidden(node, nodes)) continue
    const fence = node
    try {
      const points = thinned(sampleFenceCenterline(fence).map((p): Point => [p.x, p.y]))
      if (points.length < 2) continue
      const lengths = [0]
      for (let i = 1; i < points.length; i++)
        lengths.push(
          lengths[i - 1]! +
            Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]),
        )
      const total = lengths.at(-1)!
      const gaps = (fence.children ?? [])
        .map((id) => nodes[id])
        .flatMap((child) =>
          child?.type === 'fence-gate' || child?.type === 'fence-opening'
            ? [[child.center - child.width / 2, child.center + child.width / 2] as const]
            : [],
        )
        .sort((a, b) => a[0] - b[0])
      const spans: [number, number][] = []
      let from = 0
      for (const [start, end] of gaps) {
        if (start > from) spans.push([from, Math.min(start, total)])
        from = Math.max(from, end)
      }
      if (from < total) spans.push([from, total])
      const levelId = resolveLevelId(fence, nodes as Record<string, AnyNode>)
      const baseY = elevations.get(levelId)?.baseY ?? 0
      const floor = floorUnder(
        fence,
        {
          position: [points[0]![0], 0, points[0]![1]],
          dimensions: [fence.thickness, fence.height, fence.thickness],
          rotation: [0, 0, 0],
        },
        nodes,
        levelId,
        support,
      )
      const half = Math.max(fence.thickness, fence.postSize) / 2
      const z0 = baseY + floor + (fence.supportOffset ?? 0)
      const prisms: Prism[] = []
      // a guard with nothing cut into it is read part by part; any other fence is a strip
      if (fence.style === 'guard' && !fence.children?.length) {
        prisms.push(...guardPrisms(fence, cornerNeighbors(fence, nodes), z0))
      } else {
        for (const [index, [a, b]] of spans.entries()) {
          const run = span(points, lengths, a, b)
          for (let i = 1; i < run.length; i++) {
            const [px, pz] = run[i - 1]!
            const [qx, qz] = run[i]!
            const length = Math.hypot(qx - px, qz - pz)
            if (length < 1e-6) continue
            const nx = ((pz - qz) / length) * half
            const nz = ((qx - px) / length) * half
            prisms.push({
              id: `${fence.id}#fence.${index}.${i}`,
              nodeId: fence.id,
              kind: 'other',
              z0,
              z1: z0 + fence.height,
              outer: [
                [px + nx, pz + nz],
                [qx + nx, qz + nz],
                [qx - nx, qz - nz],
                [px - nx, pz - nz],
              ],
              holes: [],
              shape: 'approx',
              why: 'a fence as a strip along its centreline',
            })
          }
        }
      }
      out.push({ fenceId: fence.id, levelId, prisms })
    } catch (error) {
      skipped.push({
        nodeId: fence.id,
        why: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return { fences: out, skipped }
}
