import { getWallBaseElevationForNodes } from '../../hooks/spatial-grid/spatial-grid-manager'
import { heightAt } from '../../lib/terrain-field'
import { persistedTerrainFieldOf } from '../../lib/terrain-source'
import { getLevelElevations } from '../../services/storey'
import type { AnyNode, AnyNodeId } from '../types'
import type { BuildingNode } from './building'
import type { DownspoutNode } from './downspout'
import { computeGutterEaveY, type GutterNode } from './gutter'
import type { LeanToExtensionNode } from './lean-to-extension'
import type { LevelNode } from './level'
import type { RoofNode } from './roof'
import type { RoofSegmentNode } from './roof-segment'
import type { SiteNode } from './site'
import type { WallNode } from './wall'

const DEFAULT_MAX_RUN_PER_DOWNSPOUT_M = 10
const OUTLET_END_INSET_M = 0.16
const CONNECTION_TOLERANCE_M = 0.1
const CONNECTION_TOLERANCE_SQ = CONNECTION_TOLERANCE_M * CONNECTION_TOLERANCE_M
const FLAT_GROUND_Y = 0

type Point2D = readonly [number, number]
type GutterEnd = {
  gutterIndex: number
  offset: number
  point: Point2D
}

export type AutoDownspoutPlacement = {
  gutterId: GutterNode['id']
  offset: number
}

export type AutomaticDownspoutInput = {
  segments: readonly RoofSegmentNode[]
  gutters: readonly GutterNode[]
  downspouts: readonly DownspoutNode[]
  maxRunPerDownspout?: number
}

// A point on the gutter's own mesh, expressed in gutter-mesh-local
// coordinates: `alongX` is the signed distance from the gutter center along
// its length, `outwardZ` the outward offset from the eave line. For a curved
// run the flat (alongX, outwardZ) is bent onto the concentric arc descriptor
// (matches the mapping the outlet lookup + gutter geometry use); a straight
// gutter passes through unchanged.
function gutterMeshPoint(gutter: GutterNode, alongX: number, outwardZ: number): Point2D {
  const arc = gutter.arc
  if (!arc) return [alongX, outwardZ]
  const signedRef = (Math.sign(arc.centerZ) || 1) * arc.radius
  if (Math.abs(signedRef) < 1e-9) return [alongX, outwardZ]
  const phi = (alongX - arc.centerX) / signedRef
  const radial = outwardZ - arc.centerZ
  return [arc.centerX - radial * Math.sin(phi), arc.centerZ + radial * Math.cos(phi)]
}

function gutterPointInRoofFrame(
  gutter: GutterNode,
  segment: RoofSegmentNode | undefined,
  offset: number,
): Point2D {
  const gutterRotation = gutter.rotation ?? 0
  const [meshX, meshZ] = gutterMeshPoint(gutter, offset, 0)
  const localX =
    gutter.position[0] + Math.cos(gutterRotation) * meshX + Math.sin(gutterRotation) * meshZ
  const localZ =
    gutter.position[2] - Math.sin(gutterRotation) * meshX + Math.cos(gutterRotation) * meshZ
  if (!segment) return [localX, localZ]

  const segmentRotation = segment.rotation ?? 0
  const cos = Math.cos(segmentRotation)
  const sin = Math.sin(segmentRotation)
  return [
    (segment.position?.[0] ?? 0) + localX * cos + localZ * sin,
    (segment.position?.[2] ?? 0) - localX * sin + localZ * cos,
  ]
}

function rotateAndTranslate(
  point: Point2D,
  position: readonly [number, number, number] | undefined,
  rotation: number,
): Point2D {
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  return [
    (position?.[0] ?? 0) + point[0] * cos + point[1] * sin,
    (position?.[2] ?? 0) - point[0] * sin + point[1] * cos,
  ]
}

function gutterFloorMidZ(gutter: GutterNode): number {
  const size = Math.max(0.04, gutter.size)
  if (gutter.profile === 'half-round') return size
  if (gutter.profile === 'box') return size / 2
  return size * 0.4
}

// The gutter's mount height in the host segment's local frame. Lean-to gutters
// can be raised to a shared eave line (stored as `leanToGutterEaveY` metadata by
// the lean-to assembly); the renderer mounts there rather than at the segment's
// own eave, so the outlet elevation must read the prescribed value when present.
function prescribedGutterEaveY(gutter: GutterNode): number | null {
  const metadata = gutter.metadata
  if (!(metadata && typeof metadata === 'object' && !Array.isArray(metadata))) return null
  const value = (metadata as Record<string, unknown>).leanToGutterEaveY
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function resolveAutomaticDownspoutLength(
  nodes: Record<AnyNodeId, AnyNode>,
  segment: RoofSegmentNode,
  gutter: GutterNode,
  outletOffset: number,
): number {
  const roofCandidate = segment.parentId ? nodes[segment.parentId as AnyNodeId] : undefined
  const roof = roofCandidate?.type === 'roof' ? (roofCandidate as RoofNode) : undefined
  const roofParent = roof?.parentId ? nodes[roof.parentId as AnyNodeId] : undefined
  const leanTo =
    roofParent?.type === 'lean-to-extension' ? (roofParent as LeanToExtensionNode) : undefined
  const wallCandidate = leanTo?.parentId ? nodes[leanTo.parentId as AnyNodeId] : undefined
  const wall = wallCandidate?.type === 'wall' ? (wallCandidate as WallNode) : undefined
  const levelCandidate = wall?.parentId ? nodes[wall.parentId as AnyNodeId] : roofParent
  const level = levelCandidate?.type === 'level' ? (levelCandidate as LevelNode) : undefined
  const buildingCandidate = level?.parentId ? nodes[level.parentId as AnyNodeId] : undefined
  const building =
    buildingCandidate?.type === 'building' ? (buildingCandidate as BuildingNode) : undefined

  const gutterRotation = gutter.rotation ?? 0
  const gutterFloorPoint = rotateAndTranslate(
    gutterMeshPoint(gutter, outletOffset, gutterFloorMidZ(gutter)),
    gutter.position,
    gutterRotation,
  )
  const roofPoint = rotateAndTranslate(gutterFloorPoint, segment.position, segment.rotation ?? 0)
  const leanToPoint = rotateAndTranslate(roofPoint, roof?.position, roof?.rotation ?? 0)
  const wallLocalPoint = leanTo
    ? rotateAndTranslate(leanToPoint, leanTo.position, leanTo.rotation[1])
    : leanToPoint
  const wallAngle = wall ? Math.atan2(wall.end[1] - wall.start[1], wall.end[0] - wall.start[0]) : 0
  const levelPoint = wall
    ? rotateAndTranslate(wallLocalPoint, [wall.start[0], 0, wall.start[1]], -wallAngle)
    : wallLocalPoint
  const buildingRotation = building?.rotation?.[1] ?? 0
  const worldPoint = rotateAndTranslate(levelPoint, building?.position, buildingRotation)

  const site = Object.values(nodes).find((node): node is SiteNode => node?.type === 'site')
  const terrain = persistedTerrainFieldOf(site)
  const groundY = terrain ? heightAt(terrain, worldPoint[0], worldPoint[1]) : FLAT_GROUND_Y
  const levelBaseY = level ? (getLevelElevations(nodes).get(level.id)?.baseY ?? 0) : 0
  const outletWorldY =
    (building?.position?.[1] ?? 0) +
    levelBaseY +
    (wall ? getWallBaseElevationForNodes(wall, nodes) : 0) +
    (leanTo?.position[1] ?? 0) +
    (roof?.position?.[1] ?? 0) +
    (segment.position?.[1] ?? 0) +
    (prescribedGutterEaveY(gutter) ?? computeGutterEaveY(segment)) -
    Math.max(0.04, gutter.size)

  return Math.max(0.1, outletWorldY - groundY)
}

function distanceSquared(a: Point2D, b: Point2D) {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2
}

function find(parent: number[], value: number): number {
  let root = value
  while (parent[root] !== root) root = parent[root]!
  while (parent[value] !== value) {
    const next = parent[value]!
    parent[value] = root
    value = next
  }
  return root
}

function union(parent: number[], a: number, b: number) {
  const rootA = find(parent, a)
  const rootB = find(parent, b)
  if (rootA !== rootB) parent[rootB] = rootA
}

function addUniquePlacement(
  placements: AutoDownspoutPlacement[],
  seen: Set<string>,
  gutter: GutterNode,
  offset: number,
) {
  const key = `${gutter.id}:${offset.toFixed(6)}`
  if (seen.has(key)) return
  seen.add(key)
  placements.push({ gutterId: gutter.id, offset })
}

export function planAutomaticDownspouts({
  segments,
  gutters,
  downspouts,
  maxRunPerDownspout = DEFAULT_MAX_RUN_PER_DOWNSPOUT_M,
}: AutomaticDownspoutInput): AutoDownspoutPlacement[] {
  if (gutters.length === 0) return []

  const segmentById = new Map<string, RoofSegmentNode>(
    segments.map((segment) => [segment.id, segment]),
  )
  const parent = gutters.map((_, index) => index)
  const ends: GutterEnd[] = []
  for (let gutterIndex = 0; gutterIndex < gutters.length; gutterIndex++) {
    const gutter = gutters[gutterIndex]!
    const halfLength = Math.max(0, gutter.length) / 2
    const segment = gutter.roofSegmentId ? segmentById.get(gutter.roofSegmentId) : undefined
    ends.push(
      {
        gutterIndex,
        offset: halfLength,
        point: gutterPointInRoofFrame(gutter, segment, halfLength),
      },
      {
        gutterIndex,
        offset: -halfLength,
        point: gutterPointInRoofFrame(gutter, segment, -halfLength),
      },
    )
  }

  const connectedEnds = new Set<number>()
  for (let i = 0; i < ends.length; i++) {
    for (let j = i + 1; j < ends.length; j++) {
      const a = ends[i]!
      const b = ends[j]!
      if (a.gutterIndex === b.gutterIndex) continue
      if (distanceSquared(a.point, b.point) > CONNECTION_TOLERANCE_SQ) continue
      connectedEnds.add(i)
      connectedEnds.add(j)
      union(parent, a.gutterIndex, b.gutterIndex)
    }
  }

  const componentIndices = new Map<number, number[]>()
  for (let index = 0; index < gutters.length; index++) {
    const root = find(parent, index)
    const indices = componentIndices.get(root) ?? []
    indices.push(index)
    componentIndices.set(root, indices)
  }

  const gutterIndexById = new Map<string, number>(
    gutters.map((gutter, index) => [gutter.id, index]),
  )
  const placements: AutoDownspoutPlacement[] = []
  const seen = new Set<string>()
  const safeMaxRun = Math.max(0.5, maxRunPerDownspout)

  for (const indices of componentIndices.values()) {
    const indexSet = new Set(indices)
    const totalLength = indices.reduce(
      (sum, index) => sum + Math.max(0, gutters[index]?.length ?? 0),
      0,
    )
    const requiredCount = Math.max(1, Math.ceil(totalLength / safeMaxRun))
    const manualCount = downspouts.filter((downspout) => {
      if (!downspout.gutterId) return false
      const gutterIndex = gutterIndexById.get(downspout.gutterId)
      if (gutterIndex === undefined || !indexSet.has(gutterIndex)) return false
      const gutter = gutters[gutterIndex]
      return Boolean(
        gutter &&
          downspout.outletId &&
          (gutter.outlets ?? []).some((outlet) => outlet.id === downspout.outletId),
      )
    }).length
    let remaining = Math.max(0, requiredCount - manualCount)
    if (remaining === 0) continue

    const freeEnds = ends.filter(
      (end, endIndex) => indexSet.has(end.gutterIndex) && !connectedEnds.has(endIndex),
    )
    for (const end of freeEnds) {
      if (remaining === 0) break
      const gutter = gutters[end.gutterIndex]!
      const bound = Math.max(0, gutter.length / 2 - OUTLET_END_INSET_M)
      addUniquePlacement(placements, seen, gutter, end.offset >= 0 ? bound : -bound)
      remaining--
    }

    if (remaining === 0) continue

    const componentGutters = indices
      .map((index) => gutters[index]!)
      .sort((a, b) => b.length - a.length || a.id.localeCompare(b.id))
    const interiorCandidates: AutoDownspoutPlacement[] = []
    let round = 0
    while (interiorCandidates.length < remaining) {
      let addedThisRound = 0
      for (const gutter of componentGutters) {
        const interiorSlots = Math.max(1, Math.ceil(gutter.length / safeMaxRun) - 1)
        if (round >= interiorSlots) continue
        const offset = -gutter.length / 2 + (gutter.length * (round + 1)) / (interiorSlots + 1)
        interiorCandidates.push({ gutterId: gutter.id, offset })
        addedThisRound++
      }
      if (addedThisRound === 0) break
      round++
    }

    for (const candidate of interiorCandidates) {
      if (remaining === 0) break
      const gutter = gutters[gutterIndexById.get(candidate.gutterId)!]!
      addUniquePlacement(placements, seen, gutter, candidate.offset)
      remaining--
    }
  }

  return placements
}
