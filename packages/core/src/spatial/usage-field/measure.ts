import {
  buildCirculationGraph,
  exteriorEntranceEdges,
} from '../../agent-operations/circulation-graph'
import { floorsOf } from '../../agent-operations/circulation-spaces'
import { isFloorUnderlay } from '../../agent-operations/furniture-kind'
import { area, difference, union } from '../../lib/polygon-boolean'
import { polygonInteriorPoint } from '../../lib/polygon-label'
import type { AnyNode, DoorNode, ItemNode, WallNode } from '../../schema'
import { resolveStairWalkingSurfaces } from '../../systems/stair/stair-clearance'
import { cellX, cellZ, type Grid } from './field'
import {
  BODY_BAND,
  buildField,
  FEET_BAND,
  type FloorGroup,
  floorGroups,
  inRegion,
  maskOf,
} from './level-field'
import {
  boundingObstacles,
  nearestNodes,
  type Obstacle,
  obstacleOf,
  passagePair,
  signedDistance,
} from './obstacles'
import { doorwayRing } from './openings'
import { pathTo, refinePassage, travel, type WindowCache, widestPath } from './path'
import type { Prism, Ring, UsageShapes } from './types'
import type { Nodes } from './walls'

/** A person's trunk needs 0.45 m either side only in the loosest reading; the unit of passage is 0.60 m, so a clearance of 0.30 m. */
export const UNIT_CLEARANCE_M = 0.3
/** A cell with less of its room on the floor than this is not a room (an outdoor zone beside the house). */
const MIN_INDOOR_SHARE = 0.25

export type ObstacleRef = {
  nodeId: string
  kind: Prism['kind']
  shape: Prism['shape']
  why?: string
}

const refOf = (o: Obstacle): ObstacleRef => ({
  nodeId: o.prism.nodeId,
  kind: o.prism.kind,
  shape: o.prism.shape,
  ...(o.prism.why ? { why: o.prism.why } : {}),
})

export type Passage = {
  /** Width of the widest path to the room, refined to the millimetre. */
  width: number
  /** What the grid alone said. */
  grid: number
  at: [number, number]
  /** What bounds the width: the pair whose exact gap it is, or the obstacles a disc of that width touches at the pinch. */
  by: ObstacleRef[]
  /** The door the path starts at (ground floor), or null from a stair arrival. */
  fromDoorId: string | null
}

export type RoomMeasure = {
  roomId: string
  levelId: string
  name: string
  kind: 'room' | 'stair-foot'
  /** A point inside the room, for the finding's place. */
  at: [number, number]
  /** False when no way from the entrance reaches it. */
  reached: boolean
  passage: Passage | null
  /** The same room measured from the best other exterior door, when that is wider. */
  alternative: { doorId: string; width: number } | null
  /** Largest clear circle in the feet band, as a diameter. */
  turning: { diameter: number; at: [number, number]; approximate: boolean } | null
  /** Floor where a unit of passage fits but cannot get out. */
  pocket: {
    isolatedM2: number
    freeM2: number
    whole: boolean
    at: [number, number] | null
    /** The two nearest things around it. */
    by: ObstacleRef[]
  }
}

export type GroupMeasure = {
  levelId: string
  y: number
  source: { kind: 'door' | 'stair-arrival' | 'none'; doorId: string | null }
  rooms: RoomMeasure[]
}

export type UsageMeasure = {
  groups: GroupMeasure[]
  /** The entrance the ground floor was measured from. */
  entranceDoorId: string | null
}

export type MeasureOptions = {
  /** Grid step of the clearance field, metres. 2 cm for checks, 5 cm for the editor. */
  cell?: number
  entranceDoorId?: string
}

const round = (v: number) => Math.round(v * 1000) / 1000

function exteriorDoors(nodes: Nodes): string[] {
  try {
    const graph = buildCirculationGraph(nodes)
    return [
      ...new Set(
        exteriorEntranceEdges(graph).flatMap((edge) =>
          (edge.kind === 'door' || edge.kind === 'opening') && edge.sourceId ? [edge.sourceId] : [],
        ),
      ),
    ]
  } catch {
    return []
  }
}

function chosenEntrance(nodes: Nodes, exterior: string[], given?: string): string | null {
  if (given) return given
  const street = exterior.find((id) => {
    const door = nodes[id]
    return door?.type === 'door' && door.doorCategory !== 'garage'
  })
  return street ?? exterior[0] ?? null
}

function doorCells(
  nodes: Nodes,
  field: { grid: Parameters<typeof maskOf>[0] },
  doorId: string,
): number[] {
  const door = nodes[doorId]
  if (door?.type !== 'door') return []
  const wall = door.parentId ? nodes[door.parentId] : undefined
  if (wall?.type !== 'wall') return []
  const ring = doorwayRing(wall as WallNode, door as DoorNode)
  if (!ring) return []
  const mask = maskOf(field.grid, [{ outer: ring, holes: [] }])
  const cells: number[] = []
  for (let c = 0; c < mask.length; c++) if (mask[c]) cells.push(c)
  return cells
}

/**
 * The stairs that end at this floor: the ring of the top tread, which is the way in from below, and
 * those of every tread, whose plan is the stairwell opening they climb through.
 */
function arrivals(nodes: Nodes, group: FloorGroup): { top: Ring[]; all: Ring[] } {
  const top: Ring[] = []
  const all: Ring[] = []
  for (const node of Object.values(nodes) as AnyNode[]) {
    if (node.type !== 'stair') continue
    try {
      const surfaces = resolveStairWalkingSurfaces(node, nodes)
      if (!surfaces.some((surface) => Math.abs(surface.top - group.y) < 0.06)) continue
      for (const surface of surfaces) {
        all.push(surface.region.outer)
        if (Math.abs(surface.top - group.y) < 0.06) top.push(surface.region.outer)
      }
    } catch {
      // a stair the resolver refuses gives no arrival
    }
  }
  return { top, all }
}

/** A convex ring pushed out by `d` on every side (mitred). */
function grow(ring: Ring, d: number): Ring {
  const n = ring.length
  let turn = 0
  for (let i = 0; i < n; i++) {
    const a = ring[i]!
    const b = ring[(i + 1) % n]!
    turn += a[0] * b[1] - b[0] * a[1]
  }
  const sign = turn >= 0 ? 1 : -1
  const lines = ring.map((a, i) => {
    const b = ring[(i + 1) % n]!
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    const nx = (sign * (b[1] - a[1])) / length
    const nz = (-sign * (b[0] - a[0])) / length
    return {
      p: [a[0] + nx * d, a[1] + nz * d] as [number, number],
      u: [(b[0] - a[0]) / length, (b[1] - a[1]) / length] as [number, number],
    }
  })
  return lines.map((line, i) => {
    const prev = lines[(i + n - 1) % n]!
    const det = prev.u[0] * line.u[1] - prev.u[1] * line.u[0]
    if (Math.abs(det) < 1e-9) return line.p
    const t = ((line.p[0] - prev.p[0]) * line.u[1] - (line.p[1] - prev.p[1]) * line.u[0]) / det
    return [prev.p[0] + prev.u[0] * t, prev.p[1] + prev.u[1] * t] as [number, number]
  })
}

/**
 * The openings in the floor as obstacles, less the stair that climbs through them and the slot
 * around it (stepped over), and the slits too narrow to put a foot in: nobody walks into a hole, and
 * the clearance beside one is what is left of the floor.
 */
function voidPrisms(group: FloorGroup, stair: Ring[]): Prism[] {
  const holes = group.regions.flatMap((region) => region.holes)
  if (holes.length === 0) return []
  const grownStair =
    stair.length > 0
      ? union(stair.map((ring) => ({ outer: grow(ring, STAIRWELL_SLOT_M), holes: [] })))
      : []
  const out: Prism[] = []
  for (const [index, hole] of holes.entries()) {
    const pieces = grownStair.length
      ? difference({ outer: hole, holes: [] }, grownStair)
      : [{ outer: hole, holes: [] as Ring[] }]
    for (const [k, piece] of pieces.entries()) {
      // a slit in the floor (a room boundary's rounding, a gap between two slabs) is stepped over, as the slot round a stair is
      if (slitWidth(piece.outer, area([piece])) < STAIRWELL_SLOT_M) continue
      out.push({
        id: `${group.levelId}#void.${index}.${k}`,
        nodeId: group.regions[0]!.nodeId,
        kind: 'void',
        z0: group.y - 1,
        z1: group.y + 4,
        outer: piece.outer,
        holes: piece.holes,
        shape: 'exact',
      })
    }
  }
  return out
}

/** The short side of the rectangle that has the ring's area and perimeter: a slit's width, whatever angle it runs at. */
function slitWidth(ring: Ring, size: number): number {
  let perimeter = 0
  for (const [i, a] of ring.entries()) {
    const b = ring[(i + 1) % ring.length]!
    perimeter += Math.hypot(b[0] - a[0], b[1] - a[1])
  }
  const half = perimeter / 2
  return (half - Math.sqrt(Math.max(0, half * half - 4 * size))) / 2
}

/** A slot of the floor narrower than this (between a stair and its opening in the slab, or a slit in the slab) is stepped over, not a void. */
const STAIRWELL_SLOT_M = 0.15

/** The cells within `margin` of any of the rings. */
function within(grid: Grid, rings: Ring[], margin: number): Uint8Array {
  const mask = new Uint8Array(grid.W * grid.H)
  for (const ring of rings) {
    const edges = obstacleOf({ outer: ring, holes: [] } as unknown as Prism, 0).edges
    let x0 = Number.POSITIVE_INFINITY
    let z0 = Number.POSITIVE_INFINITY
    let x1 = Number.NEGATIVE_INFINITY
    let z1 = Number.NEGATIVE_INFINITY
    for (const [x, z] of ring) {
      x0 = Math.min(x0, x)
      x1 = Math.max(x1, x)
      z0 = Math.min(z0, z)
      z1 = Math.max(z1, z)
    }
    const i0 = Math.max(0, Math.floor((x0 - margin - grid.x0) / grid.h))
    const i1 = Math.min(grid.W - 1, Math.ceil((x1 + margin - grid.x0) / grid.h))
    const j0 = Math.max(0, Math.floor((z0 - margin - grid.z0) / grid.h))
    const j1 = Math.min(grid.H - 1, Math.ceil((z1 + margin - grid.z0) / grid.h))
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++)
        if (signedDistance(edges, cellX(grid, i), cellZ(grid, j)) <= margin)
          mask[j * grid.W + i] = 1
  }
  return mask
}

/** The 0.70 m strip in front of the first riser of every stair that climbs from this floor. */
function stairFeet(nodes: Nodes, group: FloorGroup): { id: string; name: string; ring: Ring }[] {
  const out: { id: string; name: string; ring: Ring }[] = []
  for (const node of Object.values(nodes) as AnyNode[]) {
    if (node.type !== 'stair' || !node.toLevelId) continue
    try {
      const first = resolveStairWalkingSurfaces(node, nodes)[0]
      if (!first || Math.abs(first.approach - group.y) > 0.06) continue
      const [[ax, , az], [bx, , bz]] = first.walkingLine
      const length = Math.hypot(bx - ax, bz - az)
      if (length < 1e-6) continue
      const dx = (bx - ax) / length
      const dz = (bz - az) / length
      const [p0, p1] = first.region.outer
      if (!(p0 && p1)) continue
      out.push({
        id: `foot|${node.id}`,
        name: `Foot of ${node.name ?? node.id}`,
        ring: [p0, p1, [p1[0] - dx * 0.7, p1[1] - dz * 0.7], [p0[0] - dx * 0.7, p0[1] - dz * 0.7]],
      })
    } catch {
      // see arrivals
    }
  }
  return out
}

/** The field and the floor a person can walk on, for one floor group: shared by the usage measures and the flow's widths. */
export function prepareGroup(
  nodes: Nodes,
  shapes: UsageShapes,
  group: FloorGroup,
  cell: number,
  underlay: (prism: Prism) => boolean,
) {
  const arrival = arrivals(nodes, group)
  const body = buildField(shapes, group, BODY_BAND, cell, underlay, voidPrisms(group, arrival.all))
  const feet = buildField(shapes, group, FEET_BAND, cell, underlay, voidPrisms(group, arrival.top))
  const { grid } = body
  const arrivalCells = new Set<number>()
  const arrivalMask = maskOf(
    grid,
    arrival.top.map((ring) => ({ outer: ring, holes: [] })),
  )
  for (let c = 0; c < arrivalMask.length; c++) if (arrivalMask[c]) arrivalCells.add(c)
  // the plate a person walks on: the floor, an arriving stair and the slot around it, and every doorway
  const plate = Uint8Array.from(body.floor)
  for (const c of arrivalCells) plate[c] = 1
  const stairwell = within(grid, arrival.all, STAIRWELL_SLOT_M)
  for (let c = 0; c < stairwell.length; c++) if (stairwell[c]) plate[c] = 1
  // the stair itself is the way in, not part of any room it climbs through
  const stairMask = maskOf(
    grid,
    arrival.all.map((ring) => ({ outer: ring, holes: [] })),
  )
  const doorsHere = (Object.values(nodes) as AnyNode[]).filter(
    (n): n is DoorNode => n.type === 'door' && nodes[n.parentId ?? '']?.parentId === group.levelId,
  )
  for (const door of doorsHere) for (const c of doorCells(nodes, body, door.id)) plate[c] = 1
  return { arrival, body, feet, grid, arrivalCells, plate, stairMask, doorsHere }
}

/**
 * The widest-path, turning-circle and evacuation measures of every floor of the building, from the
 * shapes `usageShapes` read. The floor is a cell grid of the clearance to the nearest obstacle in a
 * band a body stands in; a passage is the widest path from the entrance to the room, its pinch
 * re-solved on a finer grid to the millimetre; a pocket is floor where a 0.60 m unit fits but
 * cannot get out.
 */
export function measureUsage(
  nodes: Nodes,
  shapes: UsageShapes,
  options: MeasureOptions = {},
): UsageMeasure {
  const cell = options.cell ?? 0.02
  const floors = floorsOf(nodes).floors
  const exterior = exteriorDoors(nodes)
  const entrance = chosenEntrance(nodes, exterior, options.entranceDoorId)
  const underlay = (prism: Prism) => {
    const node = nodes[prism.nodeId]
    return node?.type === 'item' && isFloorUnderlay(node as ItemNode)
  }
  const groups: GroupMeasure[] = []
  const allGroups = floorGroups(shapes)
  for (const group of allGroups) {
    const floor = floors.find((f) => f.id === group.levelId)
    if (!floor) continue
    const { arrival, body, feet, grid, arrivalCells, plate, stairMask, doorsHere } = prepareGroup(
      nodes,
      shapes,
      group,
      cell,
      underlay,
    )

    // sources: the entrance's doorway on the ground floor, the arriving stair above
    const exteriorHere = exterior.filter((id) => doorsHere.some((d) => d.id === id))
    const useDoors = floor.ground && exteriorHere.length > 0
    const fromDoor = useDoors
      ? entrance && exteriorHere.includes(entrance)
        ? entrance
        : exteriorHere[0]!
      : null
    const sourceCells = useDoors
      ? doorCells(nodes, body, fromDoor!).filter((c) => body.F[c]! > 0)
      : [...arrivalCells].filter((c) => body.F[c]! > 0)
    const source: GroupMeasure['source'] = sourceCells.length
      ? useDoors
        ? { kind: 'door', doorId: fromDoor }
        : { kind: 'stair-arrival', doorId: null }
      : { kind: 'none', doorId: null }

    // rooms of this floor: zones whose interior point lies on it and that are mostly floor
    const targets: {
      id: string
      name: string
      kind: RoomMeasure['kind']
      rings: Ring[]
      cells: number[]
      at: [number, number]
    }[] = []
    for (const zone of floor.zones) {
      if (zone.outdoor) continue
      const probe = polygonInteriorPoint({ polygon: zone.polygon, holes: zone.holes }, true)
      if (!group.regions.some((region) => inRegion(probe[0], probe[1], region))) continue
      const mask = maskOf(grid, [{ outer: zone.polygon, holes: zone.holes }])
      const cells: number[] = []
      let all = 0
      for (let c = 0; c < mask.length; c++)
        if (mask[c]) {
          all++
          if (plate[c] && !stairMask[c]) cells.push(c)
        }
      if (all === 0 || cells.length < MIN_INDOOR_SHARE * all) continue
      targets.push({
        id: zone.id,
        name: String(nodes[zone.id]?.name ?? zone.id),
        kind: 'room',
        rings: [zone.polygon, ...zone.holes],
        cells,
        at: probe,
      })
    }
    for (const foot of stairFeet(nodes, group)) {
      const mask = maskOf(grid, [{ outer: foot.ring, holes: [] }])
      const cells: number[] = []
      for (let c = 0; c < mask.length; c++) if (mask[c] && body.F[c]! > 0) cells.push(c)
      if (cells.length)
        targets.push({
          id: foot.id,
          name: foot.name,
          kind: 'stair-foot',
          rings: [foot.ring],
          cells,
          at: [cellX(grid, cells[0]! % grid.W), cellZ(grid, (cells[0]! / grid.W) | 0)],
        })
    }

    // widest path from the source (and from every other exterior door, for the alternative)
    const sourceSet = new Set(sourceCells)
    const widest = sourceCells.length ? widestPath(grid, body.F, plate, sourceCells) : null
    const others = useDoors
      ? exteriorHere
          .filter((id) => id !== fromDoor)
          .map((id) => ({ id, cells: doorCells(nodes, body, id).filter((c) => body.F[c]! > 0) }))
          .filter((o) => o.cells.length)
          .map((o) => ({ ...o, widest: widestPath(grid, body.F, plate, o.cells) }))
      : []

    // evacuation: where a 0.60 m unit fits, reached from the exits
    const pass = new Uint8Array(plate.length)
    for (let c = 0; c < pass.length; c++)
      pass[c] = plate[c] && body.F[c]! >= UNIT_CLEARANCE_M ? 1 : 0
    const exitCells = useDoors
      ? exteriorHere.flatMap((id) => doorCells(nodes, body, id))
      : [...arrivalCells]
    for (const c of exitCells) pass[c] = body.F[c]! > 0 ? 1 : 0
    const reach = travel(grid, pass, exitCells)

    const windows: WindowCache = new Map()
    const rooms: RoomMeasure[] = targets.map((room) => {
      // best target cell by bottleneck
      let best = -1
      if (widest)
        for (const c of room.cells)
          if (
            widest.B[c]! > Number.NEGATIVE_INFINITY &&
            (best < 0 || widest.B[c]! > widest.B[best]!)
          )
            best = c
      const inRoom = (x: number, z: number) =>
        room.rings.length > 0 &&
        inRegion(x, z, { outer: room.rings[0]!, holes: room.rings.slice(1) })
      let passage: Passage | null = null
      if (widest && best >= 0) {
        const path = pathTo(widest.P, body.F, best)
        const refined = refinePassage(
          grid,
          body.F,
          body.index,
          path,
          (c) => sourceSet.has(c),
          inRoom,
        )
        const grided = 2 * body.F[path.cells[path.narrowest]!]!
        const pair = passagePair(body.obstacles, refined.at[0], refined.at[1])
        // the pinch is two outlines: when the pair found at the refined spot agrees with it, their exact gap is the width
        const exact = pair !== null && Math.abs(pair.width - refined.width) < 0.02
        const width = exact ? pair.width : Math.min(refined.width, grided + 2 * grid.h)
        passage = {
          width: round(width),
          grid: round(grided),
          at: [round(refined.at[0]), round(refined.at[1])],
          by: (exact
            ? [pair.a, pair.b]
            : boundingObstacles(body.obstacles, refined.at[0], refined.at[1], width / 2)
          ).map(refOf),
          fromDoorId: fromDoor,
        }
      }
      // the best other exterior door, when it reaches this room more widely
      let alternative: RoomMeasure['alternative'] = null
      if (passage)
        for (const other of others) {
          let b = Number.NEGATIVE_INFINITY
          for (const c of room.cells) b = Math.max(b, other.widest.B[c]!)
          if (2 * b > passage.width + 0.01 && (!alternative || 2 * b > alternative.width))
            alternative = { doorId: other.id, width: round(2 * b) }
        }
      // turning circle: the largest clear circle, found on the grid and then on a 5 mm lattice
      let turning: RoomMeasure['turning'] = null
      let mf = Number.NEGATIVE_INFINITY
      let mc = -1
      for (const c of room.cells)
        if (feet.F[c]! > mf) {
          mf = feet.F[c]!
          mc = c
        }
      if (mc >= 0 && room.kind === 'room') {
        let bestD = mf
        let bat: [number, number] = [cellX(grid, mc % grid.W), cellZ(grid, (mc / grid.W) | 0)]
        const [cx, cz] = bat
        for (let dz = -0.05; dz <= 0.05001; dz += 0.005)
          for (let dx = -0.05; dx <= 0.05001; dx += 0.005) {
            if (!inRoom(cx + dx, cz + dz)) continue
            const d = feet.index.query(cx + dx, cz + dz).d
            if (d > bestD) {
              bestD = d
              bat = [cx + dx, cz + dz]
            }
          }
        const owner = feet.obstacles[feet.index.query(bat[0], bat[1]).arg]
        turning = {
          diameter: round(2 * bestD),
          at: [round(bat[0]), round(bat[1])],
          approximate: owner?.prism.shape === 'approx',
        }
      }
      // pocket: a unit fits, and cannot get out
      let free = 0
      let isolated = 0
      let sx = 0
      let sz = 0
      for (const c of room.cells) {
        if (!pass[c]) continue
        free++
        if (!Number.isFinite(reach[c]!)) {
          isolated++
          sx += cellX(grid, c % grid.W)
          sz += cellZ(grid, (c / grid.W) | 0)
        }
      }
      return {
        roomId: room.id,
        levelId: group.levelId,
        name: room.name,
        kind: room.kind,
        at: room.at,
        reached: passage !== null,
        passage,
        alternative,
        turning,
        pocket: {
          isolatedM2: round(isolated * grid.h * grid.h),
          freeM2: round(free * grid.h * grid.h),
          whole: free > 0 && isolated === free,
          at: isolated ? [round(sx / isolated), round(sz / isolated)] : null,
          by: isolated
            ? nearestNodes(body.obstacles, sx / isolated, sz / isolated, 2).map(refOf)
            : [],
        },
      }
    })
    groups.push({ levelId: group.levelId, y: group.y, source, rooms })
  }
  return { groups, entranceDoorId: entrance }
}
