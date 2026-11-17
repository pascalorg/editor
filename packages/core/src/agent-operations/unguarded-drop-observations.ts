import { floorConstructionLift, liftedManualSlab } from '../lib/floor-construction-lift'
import { withHostedCutterHoles } from '../lib/object-cuts'
import { getOpeningWallCut, wallSupportForNodes } from '../lib/opening-floor-datum'
import {
  containsPoint,
  difference,
  distanceToBoundary,
  type MultiPolygon,
  type Ring,
} from '../lib/polygon-boolean'
import { getRenderableSlabPolygon, slabPolygonContextForLevel } from '../lib/slab-polygon'
import { heightAt } from '../lib/terrain-field'
import { persistedTerrainFieldOf } from '../lib/terrain-source-persisted'
import { levelBaseElevationAt } from '../lib/terrain-support-query'
import { rotateVector } from '../procedural-items/spatial'
import { queryNodes } from '../runtime/node-queries'
import type { AnyNode, SlabNode } from '../schema'
import { getLevelElevations, getWallTopLowest } from '../services/storey'
import { sampleFenceCenterline } from '../systems/fence/fence-centerline'
import { resolveStairWalkingSurfaces } from '../systems/stair/stair-clearance'
import { sampleWallCenterline } from '../systems/wall/wall-curve'
import { getWallThickness } from '../systems/wall/wall-footprint'
import { getWallBodyCenterOffset } from '../systems/wall/wall-frame'
import { scriptItemBoundsInLevel } from './layout-clearance'
import { levelIdOf } from './scene-queries'

type Point = [number, number]
type Interval = [number, number]
type Surface = {
  slab: SlabNode
  levelId: string
  buildingId: string | null
  top: number
  solid: MultiPolygon
}
export type SlabSurface = Surface
type Guard = {
  id: string
  levelId: string
  start: Point
  end: Point
  bottom: number
  top: number
  lateral: number
  evidence: 'geometry' | 'bounds' | 'unknown'
}

export type UnguardedDropObservation = {
  type: 'unguarded_drop'
  severity: 'info'
  message: string
  slabId: string
  levelId: string
  openingIds: string[]
  edgeKind: 'perimeter' | 'opening'
  coordinateFrame: 'building'
  start: Point
  end: Point
  walkingElevationMeters: number
  dropThresholdMeters: number
  minimumDropMeters: number
  maximumDropMeters: number
  exposedLengthMeters: number
  guardedLengthMeters: number
  unguardedLengthMeters: number
  unguardedSpans: { start: Point; end: Point; lengthMeters: number }[]
  guardPresent: boolean
  guardIds: string[]
  boundsGuardIds: string[]
  /** What fences it: a fact about the tool, in the form a coherence item states its moves. */
  moves: { label: string; note: string }[]
}

/** The tool that fences the unguarded spans of slabs, as a move of an unguarded_drop. */
export function guardEdgesMove(slabIds: readonly string[]): { label: string; note: string } {
  const named = slabIds.length === 1 ? slabIds[0] : `${slabIds.length} slabs`
  return {
    label: `Fence the unguarded spans of ${named}`,
    note: `guard_edges({ "slabIds": ${JSON.stringify(slabIds)} }) builds a guard fence along every span verify_scene reports as an unguarded_drop for ${slabIds.length === 1 ? 'the slab' : 'those slabs'} (their unguardedSpans), in one call; its answer states the guarded length and how many unguarded_drop observations remain.`,
  }
}

/** The fall past which an unguarded slab edge is worth naming, metres. Shared
 * with describe_terrain_under_house as a threshold only: that fact compares
 * slab top against terrain alone, where this check also weighs landings,
 * neighbouring surfaces and existing guards, so the flagged edges can differ. */
export const UNGUARDED_DROP_THRESHOLD_M = 0.5
const DROP_THRESHOLD = UNGUARDED_DROP_THRESHOLD_M
const GUARD_HEIGHT = 0.5
const LATERAL_TOLERANCE = 0.1
const EPSILON = 1e-6
const OUTSIDE_PROBE = 0.01
/**
 * How far from a stair's walking surface a fall still lands on it: a person at a rim steps onto the
 * flight across the clearance a stair well leaves beside it (a few centimetres), as a tread's
 * stringer or a handrail leaves. Surfaces of slabs are not reached across a gap.
 */
const STAIR_REACH = 0.1
const cross = (a: Point, b: Point) => a[0] * b[1] - a[1] * b[0]
const subtract = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]]
const mix = (a: Point, b: Point, t: number): Point => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
]
const length = (a: Point, b: Point) => Math.hypot(b[0] - a[0], b[1] - a[1])
const edges = (ring: Ring) => ring.map((a, i): [Point, Point] => [a, ring[(i + 1) % ring.length]!])

function breakpoints(start: Point, end: Point, solid: MultiPolygon): number[] {
  const direction = subtract(end, start)
  const result = [0, 1]
  for (const polygon of solid)
    for (const ring of [polygon.outer, ...polygon.holes])
      for (const [a, b] of edges(ring)) {
        const edge = subtract(b, a),
          delta = subtract(a, start),
          denominator = cross(direction, edge)
        if (Math.abs(denominator) <= EPSILON) continue
        const t = cross(delta, edge) / denominator,
          u = cross(delta, direction) / denominator
        if (t > 0 && t < 1 && u >= -EPSILON && u <= 1 + EPSILON) result.push(t)
      }
  return result
}

function merged(intervals: Interval[]): Interval[] {
  const result: Interval[] = []
  for (const [a, b] of intervals.sort((a, b) => a[0] - b[0])) {
    if (b - a <= EPSILON) continue
    const last = result.at(-1)
    if (last && a <= last[1] + EPSILON) last[1] = Math.max(last[1], b)
    else result.push([a, b])
  }
  return result
}

function guardSpan(start: Point, end: Point, guard: Guard): Interval | undefined {
  const size = length(start, end),
    direction = subtract(end, start)
  const otherSize = length(guard.start, guard.end)
  if (size < EPSILON || otherSize < EPSILON) return
  // Crossing posts and perpendicular partitions do not cover an edge's length.
  if (Math.abs(cross(direction, subtract(guard.end, guard.start))) / (size * otherSize) > 0.02)
    return
  const a = subtract(guard.start, start),
    b = subtract(guard.end, start)
  if (Math.max(Math.abs(cross(direction, a)), Math.abs(cross(direction, b))) / size > guard.lateral)
    return
  const project = (p: Point) => (p[0] * direction[0] + p[1] * direction[1]) / (size * size)
  const low = Math.max(0, Math.min(project(a), project(b))),
    high = Math.min(1, Math.max(project(a), project(b)))
  return high - low > EPSILON ? [low, high] : undefined
}

export function slabSurfaces(nodes: Record<string, AnyNode>): SlabSurface[] {
  const elevations = getLevelElevations(nodes)
  return queryNodes(nodes, { type: 'slab' }).flatMap((original) => {
    if (original.type !== 'slab' || original.recessed || !original.parentId) return []
    const level = elevations.get(original.parentId),
      parent = nodes[original.parentId]
    if (!level || parent?.type !== 'level') return []
    try {
      const slab = liftedManualSlab(nodes, original)
      const outer = getRenderableSlabPolygon(
        slab,
        slabPolygonContextForLevel(parent, (id) => nodes[id]),
      )
      const holes = withHostedCutterHoles(original, nodes).holes
      const solid = holes.length
        ? difference(
            outer,
            holes.map((outer) => ({ outer, holes: [] })),
            { throwOnError: true },
          )
        : difference(outer, [])
      const top = level.baseY + slab.elevation
      return Number.isFinite(top) && solid.length
        ? [{ slab, levelId: parent.id, buildingId: level.buildingId, top, solid }]
        : []
    } catch {
      // An unsupported polygon supplies no edge evidence.
      return []
    }
  })
}

function guardsForScene(nodes: Record<string, AnyNode>, surfaces: Surface[]): Guard[] {
  const result: Guard[] = [],
    elevations = getLevelElevations(nodes)
  for (const node of queryNodes(nodes, {})) {
    const levelId = levelIdOf(nodes, node.id),
      level = levelId ? elevations.get(levelId) : undefined
    if (!levelId || !level) continue
    if (node.type === 'wall') {
      const unknownCuts = queryNodes(nodes, { type: 'item', parentId: node.id }).some(
        (child) =>
          child.parentId === node.id &&
          child.type === 'item' &&
          child.source?.manifest.cutters?.length,
      )
      const base = wallSupportForNodes(node, nodes).elevation,
        top = getWallTopLowest(node, levelId, nodes, base)
      const points = sampleWallCenterline(node, node.curveOffset ? 64 : 1)
      const offset = getWallBodyCenterOffset(node)
      const cuts = unknownCuts
        ? []
        : queryNodes(nodes, { type: ['door', 'window'] }).flatMap((child) =>
            child.parentId === node.id && (child.type === 'door' || child.type === 'window')
              ? [
                  {
                    child,
                    cut: getOpeningWallCut(node, child, nodes),
                    glazing:
                      child.type === 'window' &&
                      child.openingKind !== 'opening' &&
                      !(child.operationState > 0),
                  },
                ]
              : [],
          )
      let distance = 0
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1]!,
          b = points[i]!,
          span = Math.hypot(b.x - a.x, b.y - a.y)
        if (span <= EPSILON) continue
        const normal: Point = [-(b.y - a.y) / span, (b.x - a.x) / span]
        const start: Point = [a.x + normal[0] * offset, a.y + normal[1] * offset],
          end: Point = [b.x + normal[0] * offset, b.y + normal[1] * offset]
        const breaks = [
          0,
          1,
          ...cuts
            .flatMap(({ child }) =>
              [child.position[0] - child.width / 2, child.position[0] + child.width / 2].map(
                (x) => (x - distance) / span,
              ),
            )
            .filter((t) => t > 0 && t < 1),
        ].sort((a, b) => a - b)
        for (let j = 1; j < breaks.length; j++) {
          const from = breaks[j - 1]!,
            to = breaks[j]!,
            mid = distance + ((from + to) / 2) * span
          const cut = cuts.find(({ child }) => Math.abs(mid - child.position[0]) < child.width / 2)
          const halfThickness = getWallThickness(node) / 2
          const guardStart = mix(start, end, from === 0 && i === 1 ? -halfThickness / span : from)
          const guardEnd = mix(
            start,
            end,
            to === 1 && i === points.length - 1 ? 1 + halfThickness / span : to,
          )
          // The remaining sill below a doorway is geometry, not a closed-door guard.
          result.push({
            id: cut?.glazing ? cut.child.id : node.id,
            levelId,
            start: guardStart,
            end: guardEnd,
            bottom: level.baseY + base,
            top: level.baseY + (cut && !cut.glazing ? Math.min(top, cut.cut.bottom) : top),
            lateral: halfThickness + LATERAL_TOLERANCE,
            evidence: unknownCuts ? 'unknown' : 'geometry',
          })
          if (cut && !cut.glazing && cut.cut.top < top)
            result.push({
              id: node.id,
              levelId,
              start: guardStart,
              end: guardEnd,
              bottom: level.baseY + Math.max(base, cut.cut.top),
              top: level.baseY + top,
              lateral: halfThickness + LATERAL_TOLERANCE,
              evidence: 'geometry',
            })
        }
        distance += span
      }
    } else if (node.type === 'fence' && node.style === 'guard' && !node.supportSurfaceNodeId) {
      const points = sampleFenceCenterline(node, node.path || node.curveOffset ? 64 : 1)
      let distance = 0
      const openings = queryNodes(nodes, { type: ['fence-opening', 'fence-gate'] }).filter(
        (n) =>
          n.parentId === node.id &&
          (n.type === 'fence-opening' || (n.type === 'fence-gate' && (n.openAngle ?? 0) > 0)),
      )
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1]!,
          b = points[i]!,
          start: Point = [a.x, a.y],
          end: Point = [b.x, b.y],
          span = length(start, end),
          mid = mix(start, end, 0.5)
        const followsTerrain =
          (node.path?.length ?? 0) >= 2 || Math.abs(node.curveOffset ?? 0) > 1e-4
        const sample = node.surfaceMode === 'level' || !followsTerrain ? node.start : mid
        const hosts = surfaces.filter(
          (s) => s.levelId === levelId && containsPoint(s.solid, sample),
        )
        const host =
          node.supportSlabId && node.supportSlabId !== 'ground'
            ? surfaces.find((s) => s.slab.id === node.supportSlabId && s.levelId === levelId)
            : node.supportSlabId || !followsTerrain
              ? undefined
              : hosts.sort((a, b) => b.top - a.top)[0]
        const base =
          (host?.top ??
            level.baseY +
              levelBaseElevationAt(nodes, levelId, sample[0], sample[1]) +
              floorConstructionLift(nodes, node)) + (node.supportOffset ?? 0)
        const breaks = [
          0,
          1,
          ...openings
            .flatMap((n) =>
              'center' in n && 'width' in n
                ? [n.center - n.width / 2, n.center + n.width / 2].map((x) => (x - distance) / span)
                : [],
            )
            .filter((t) => t > 0 && t < 1),
        ].sort((a, b) => a - b)
        for (let j = 1; j < breaks.length; j++) {
          const from = breaks[j - 1]!,
            to = breaks[j]!,
            center = distance + ((from + to) / 2) * span
          if (
            openings.some(
              (n) => 'center' in n && 'width' in n && Math.abs(center - n.center) < n.width / 2,
            )
          )
            continue
          result.push({
            id: node.id,
            levelId,
            start: mix(start, end, from),
            end: mix(start, end, to),
            bottom: base + node.groundClearance,
            top: base + node.height,
            lateral: node.thickness / 2 + LATERAL_TOLERANCE,
            evidence: 'geometry',
          })
        }
        distance += span
      }
    } else if (node.type === 'slab' && node.railing?.length) {
      const surface = surfaces.find((s) => s.slab.id === node.id)
      if (surface)
        for (const rail of node.railing)
          result.push({
            id: node.id,
            levelId,
            ...rail,
            bottom: surface.top,
            top: surface.top + 1.1,
            lateral: LATERAL_TOLERANCE,
            evidence: 'geometry',
          })
    } else if (
      node.type === 'item' &&
      /\b(railing|balustrade|guardrail|glazing)\b/i.test(
        `${node.asset.category} ${node.name ?? node.asset.name}`,
      )
    ) {
      const resolved = scriptItemBoundsInLevel(node, nodes)
      if (!resolved) continue
      // Bounds near an edge identify a modeled guard object, not continuous infill or mesh safety.
      const manifest = node.source!.manifest
      const corrected = (point: [number, number, number]) => {
        const asset = rotateVector(
          point.map((v, i) => v * (node.asset.scale?.[i] ?? 1)) as [number, number, number],
          node.asset.rotation,
        )
        return rotateVector(
          asset.map((v, i) => (v + node.asset.offset[i]!) * node.scale[i]!) as [
            number,
            number,
            number,
          ],
          node.rotation,
        )
      }
      const first = corrected(manifest.bounds.min)
      const origin = resolved.corners[0]!.map((v, i) => v - first[i]!)
      const guardParts = new Set(
        (manifest.parts ?? [])
          .filter((part) => /^(railing|balustrade|guardrail|glazing)$/.test(part.type ?? ''))
          .map((part) => part.id),
      )
      const rings = (manifest.surfaces ?? []).flatMap((surface) => {
        if (!surface.part || !guardParts.has(surface.part)) return []
        const polygon: Ring = surface.polygon.map(([x, z]) => {
          const point = corrected([x, surface.y, z])
          return [point[0] + origin[0]!, point[2] + origin[2]!]
        })
        return polygon.length >= 3 && polygon.every((p) => p.every(Number.isFinite))
          ? [polygon]
          : []
      })
      if (!rings.length) rings.push(planHull(resolved.corners.map(([x, , z]): Point => [x, z])))
      for (const [start, end] of rings.flatMap(edges))
        result.push({
          id: node.id,
          levelId,
          start,
          end,
          bottom: level.baseY + resolved.bounds.min[1],
          top: level.baseY + resolved.bounds.max[1],
          lateral: LATERAL_TOLERANCE,
          evidence: 'bounds',
        })
    }
  }
  return result
}

function planHull(points: Ring): Ring {
  const sorted = points.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const half = (list: Ring) => {
    const hull: Ring = []
    for (const p of list) {
      while (
        hull.length >= 2 &&
        cross(subtract(hull.at(-1)!, hull.at(-2)!), subtract(p, hull.at(-1)!)) <= 0
      )
        hull.pop()
      hull.push(p)
    }
    return hull.slice(0, -1)
  }
  return [...half(sorted), ...half([...sorted].reverse())]
}

const pointsMeet = (a: Point, b: Point) => length(a, b) < 1e-6

/** What a report says of one edge: its unguarded length, the fall along it, and the guard it has. */
function observationMessage(
  observation: Pick<
    UnguardedDropObservation,
    | 'slabId'
    | 'edgeKind'
    | 'unguardedLengthMeters'
    | 'minimumDropMeters'
    | 'maximumDropMeters'
    | 'guardedLengthMeters'
    | 'boundsGuardIds'
  >,
): string {
  const { unguardedLengthMeters, minimumDropMeters, maximumDropMeters } = observation
  return `Slab ${observation.slabId} ${observation.edgeKind} edge has ${unguardedLengthMeters.toFixed(3)} m without a modeled guard along a drop of ${minimumDropMeters.toFixed(3)}–${maximumDropMeters.toFixed(3)} m (threshold ${DROP_THRESHOLD.toFixed(2)} m); ${observation.guardedLengthMeters.toFixed(3)} m has guard geometry or labeled guard bounds${observation.boundsGuardIds.length ? '; object bounds are not continuous-infill evidence' : ''}`
}

/** An edge this short is a facet of a rounded corner, not a span anyone guards on its own. */
const TINY_EDGE_M = 0.1

function absorb(host: UnguardedDropObservation, piece: UnguardedDropObservation) {
  host.unguardedSpans.push(...piece.unguardedSpans)
  host.exposedLengthMeters += piece.exposedLengthMeters
  host.guardedLengthMeters += piece.guardedLengthMeters
  host.unguardedLengthMeters += piece.unguardedLengthMeters
  host.minimumDropMeters = Math.min(host.minimumDropMeters, piece.minimumDropMeters)
  host.maximumDropMeters = Math.max(host.maximumDropMeters, piece.maximumDropMeters)
  host.guardIds = [...new Set([...host.guardIds, ...piece.guardIds])].sort()
  host.boundsGuardIds = [...new Set([...host.boundsGuardIds, ...piece.boundsGuardIds])].sort()
  host.openingIds = [...new Set([...host.openingIds, ...piece.openingIds])].sort()
  host.guardPresent = host.guardIds.length > 0
  host.message = observationMessage(host)
}

/**
 * The observations of one ring, in ring order, with the facets of its rounded corners folded into
 * the straight edge they join (before it, else after it): a corner is part of the edge's guard.
 * A piece that joins no straight edge stays as it is.
 */
function foldTinyEdges(pieces: UnguardedDropObservation[]): UnguardedDropObservation[] {
  const tiny = (piece: UnguardedDropObservation) => length(piece.start, piece.end) < TINY_EDGE_M
  const folded = new Set<UnguardedDropObservation>()
  let host: UnguardedDropObservation | undefined
  let reach: Point | undefined
  for (const piece of pieces) {
    if (!tiny(piece)) {
      host = piece
      reach = piece.end
    } else if (host && reach && pointsMeet(reach, piece.start)) {
      absorb(host, piece)
      folded.add(piece)
      reach = piece.end
    } else {
      host = undefined
    }
  }
  let next: UnguardedDropObservation | undefined
  let back: Point | undefined
  for (const piece of [...pieces].reverse()) {
    if (folded.has(piece)) continue
    if (!tiny(piece)) {
      next = piece
      back = piece.start
    } else if (next && back && pointsMeet(back, piece.end)) {
      absorb(next, piece)
      folded.add(piece)
      back = piece.start
    } else {
      next = undefined
    }
  }
  return pieces.filter((piece) => !folded.has(piece))
}

/** Edge-length evidence on solid walking plates; this is not guard adequacy or code certification. */
export function unguardedDropObservations(
  nodes: Record<string, AnyNode>,
): UnguardedDropObservation[] {
  const surfaces = slabSurfaces(nodes),
    guards = guardsForScene(nodes, surfaces),
    elevations = getLevelElevations(nodes)
  const stairSurfaces = queryNodes(nodes, { type: 'stair' }).flatMap((node) => {
    if (node.type !== 'stair') return []
    const levelId = levelIdOf(nodes, node.id),
      buildingId = levelId ? elevations.get(levelId)?.buildingId : null
    try {
      return resolveStairWalkingSurfaces(node, nodes).map((surface) => ({
        levelId,
        buildingId,
        top: surface.top,
        solid: [surface.region],
        reach: STAIR_REACH,
      }))
    } catch {
      // Over-budget or unresolved stair detail is not a measured landing surface.
      return []
    }
  })
  const observations: UnguardedDropObservation[] = []
  for (const surface of surfaces) {
    const peers = [
      ...surfaces.filter((s) => s.slab.id !== surface.slab.id).map((s) => ({ ...s, reach: 0 })),
      ...stairSurfaces,
    ].filter(
      (s) =>
        s.levelId === surface.levelId ||
        (surface.buildingId && s.buildingId === surface.buildingId),
    )
    const building = surface.buildingId ? nodes[surface.buildingId] : undefined
    if (building?.type !== 'building' || building.rotation[0] || building.rotation[2]) continue
    const site = building.parentId ? nodes[building.parentId] : undefined
    const field = site?.type === 'site' ? persistedTerrainFieldOf(site, nodes) : null
    if (site?.type === 'site' && site.terrain && !field) continue
    for (const polygon of surface.solid)
      for (const [ringIndex, ring] of [polygon.outer, ...polygon.holes].entries()) {
        const pieces: UnguardedDropObservation[] = []
        for (const [start, end] of edges(ring)) {
          const size = length(start, end)
          if (size < EPSILON) continue
          // Boolean rings have the solid to their left, including clockwise hole rims.
          const outward: Point = [
            ((end[1] - start[1]) / size) * OUTSIDE_PROBE,
            (-(end[0] - start[0]) / size) * OUTSIDE_PROBE,
          ]
          const outsideStart: Point = [start[0] + outward[0], start[1] + outward[1]],
            outsideEnd: Point = [end[0] + outward[0], end[1] + outward[1]]
          // A flight beside the edge splits it where its treads begin, along a line within reach.
          const reachStart: Point = [
            start[0] + (outward[0] / OUTSIDE_PROBE) * STAIR_REACH,
            start[1] + (outward[1] / OUTSIDE_PROBE) * STAIR_REACH,
          ]
          const reachEnd: Point = [
            end[0] + (outward[0] / OUTSIDE_PROBE) * STAIR_REACH,
            end[1] + (outward[1] / OUTSIDE_PROBE) * STAIR_REACH,
          ]
          const breaks = [
            ...new Set(
              peers
                .flatMap((s) => [
                  ...breakpoints(outsideStart, outsideEnd, s.solid),
                  ...(s.reach > 0 ? breakpoints(reachStart, reachEnd, s.solid) : []),
                ])
                .concat([0, 1]),
            ),
          ].sort((a, b) => a - b)
          const exposed: { from: number; to: number; drop: number }[] = []
          for (let i = 1; i < breaks.length; i++) {
            const from = breaks[i - 1]!,
              to = breaks[i]!,
              point = mix(outsideStart, outsideEnd, (from + to) / 2)
            const angle = building.rotation[1]
            const worldX =
              Math.cos(angle) * point[0] + Math.sin(angle) * point[1] + building.position[0]
            const worldZ =
              -Math.sin(angle) * point[0] + Math.cos(angle) * point[1] + building.position[2]
            let landing = (field ? heightAt(field, worldX, worldZ) : 0) - building.position[1]
            for (const peer of peers)
              if (
                peer.top <= surface.top + DROP_THRESHOLD + EPSILON &&
                (containsPoint(peer.solid, point) ||
                  (peer.reach > 0 && distanceToBoundary(peer.solid, point) <= peer.reach))
              )
                landing = Math.max(landing, peer.top)
            const drop = surface.top - landing
            if (drop > DROP_THRESHOLD + EPSILON) exposed.push({ from, to, drop })
          }
          if (!exposed.length) continue
          const covering = guards.flatMap((guard) => {
            if (
              guard.levelId !== surface.levelId ||
              guard.bottom > surface.top + LATERAL_TOLERANCE ||
              guard.top < surface.top + GUARD_HEIGHT - EPSILON
            )
              return []
            const span = guardSpan(start, end, guard)
            return span ? [{ guard, span }] : []
          })
          if (
            covering.some(
              ({ guard, span }) =>
                guard.evidence === 'unknown' &&
                exposed.some(
                  ({ from, to }) => Math.min(to, span[1]) > Math.max(from, span[0]) + EPSILON,
                ),
            )
          )
            continue
          const unguarded: Interval[] = [],
            guarded: Interval[] = [],
            guardIds = new Set<string>(),
            boundsIds = new Set<string>()
          for (const { from, to } of exposed) {
            const coverage = merged(
              covering.flatMap(({ guard, span }) => {
                const a = Math.max(from, span[0]),
                  b = Math.min(to, span[1])
                if (b - a <= EPSILON) return []
                guardIds.add(guard.id)
                if (guard.evidence === 'bounds') boundsIds.add(guard.id)
                return [[a, b] as Interval]
              }),
            )
            let cursor = from
            for (const [a, b] of coverage) {
              if (a > cursor + EPSILON) unguarded.push([cursor, a])
              guarded.push([a, b])
              cursor = b
            }
            if (cursor < to - EPSILON) unguarded.push([cursor, to])
          }
          const unguardedLength = unguarded.reduce((sum, [a, b]) => sum + (b - a) * size, 0)
          if (unguardedLength <= EPSILON) continue
          const openingIds = queryNodes(nodes, { type: 'floor-opening', parentId: surface.levelId })
            .filter(
              (n) =>
                n.type === 'floor-opening' &&
                n.parentId === surface.levelId &&
                n.drawnOn === 'floor' &&
                containsPoint([{ outer: n.polygon, holes: [] }], mix(start, end, 0.5)),
            )
            .map((n) => n.id)
            .sort()
          const minimumDrop = Math.min(...exposed.map((s) => s.drop)),
            maximumDrop = Math.max(...exposed.map((s) => s.drop)),
            guardedLength = guarded.reduce((sum, [a, b]) => sum + (b - a) * size, 0)
          const piece: UnguardedDropObservation = {
            type: 'unguarded_drop',
            severity: 'info',
            message: '',
            slabId: surface.slab.id,
            levelId: surface.levelId,
            openingIds,
            edgeKind: ringIndex ? 'opening' : 'perimeter',
            coordinateFrame: 'building',
            start,
            end,
            walkingElevationMeters: surface.top,
            dropThresholdMeters: DROP_THRESHOLD,
            minimumDropMeters: minimumDrop,
            maximumDropMeters: maximumDrop,
            exposedLengthMeters: exposed.reduce((sum, s) => sum + (s.to - s.from) * size, 0),
            guardedLengthMeters: guardedLength,
            unguardedLengthMeters: unguardedLength,
            unguardedSpans: merged(unguarded).map(([a, b]) => ({
              start: mix(start, end, a),
              end: mix(start, end, b),
              lengthMeters: (b - a) * size,
            })),
            guardPresent: guardIds.size > 0,
            guardIds: [...guardIds].sort(),
            boundsGuardIds: [...boundsIds].sort(),
            moves: [guardEdgesMove([surface.slab.id])],
          }
          piece.message = observationMessage(piece)
          pieces.push(piece)
        }
        observations.push(...foldTinyEdges(pieces))
      }
  }
  return observations
}
