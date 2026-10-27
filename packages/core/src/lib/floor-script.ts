import type { AnyNode, CompiledGeometryScript, SlabNode, ZoneFloorScript } from '../schema'
import { DEFAULT_SLAB_ELEVATION } from '../schema/nodes/slab'
import { scriptSource } from './geometry-script-node'
import { levelWallCover, plateLevelContext } from './plate-surface'
import {
  area,
  containsPoint,
  difference,
  intersection,
  type MultiPolygon,
  type Ring,
  union,
} from './polygon-boolean'
import { roomFloorPlate } from './room-floor-plate'
import { scriptInputsKey } from './script-inputs-key'

type SceneNodes = Readonly<Record<string, AnyNode>>

/**
 * What a room's floor script is built for, in metres: the room's walking floor (its outline inside
 * the wall faces, on its floor plate) as `polygon` with its `holes`, in the level's plan x/z. The
 * build's y = 0 is the floor's surface: the module lays its boards from there up, Pascal stands the
 * build on the plate's top (`floorScriptSurface`) and cuts it to the polygon less its holes. A plate
 * raised or lowered moves the build without running the module again.
 */
export type FloorScriptInputs = {
  polygon: [number, number][]
  holes: [number, number][][]
}

const round = (value: number) => Math.round(value * 1e4) / 1e4
const roundRing = (ring: Ring): [number, number][] => ring.map(([x, z]) => [round(x), round(z)])

/** Inputs by wall cover (memoised per wall signature in `levelWallCover`), then by room and plate. */
const inputsByCover = new WeakMap<MultiPolygon, Map<string, FloorScriptInputs | null>>()

/** The room's floor plate with its level's walls; null for a node that is no room on a level. */
function roomPlate(nodes: SceneNodes, zoneId: string) {
  const zone = nodes[zoneId]
  if (zone?.type !== 'zone' || !zone.parentId) return null
  const context = plateLevelContext(nodes[zone.parentId] ?? null, (id) => nodes[id])
  const plate = roomFloorPlate(context.slabs, zone.id)
  return plate ? { zone, plate, walls: context.walls } : null
}

/** Over the floor plate's top, so the plate's own finish never shows through the boards. */
export const FLOOR_SCRIPT_LIFT = 0.001

const plateTop = (plate: SlabNode) => round(plate.elevation ?? DEFAULT_SLAB_ELEVATION)

/**
 * The height, in level coordinates, of the floor surface a room's floor script stands on (its
 * floor plate's top), where the build's y = 0 is drawn; null when the room has no floor plate.
 */
export function floorScriptSurface(nodes: SceneNodes, zoneId: string): number | null {
  const plate = roomPlate(nodes, zoneId)?.plate
  return plate ? plateTop(plate) : null
}

/**
 * Where a plan point standing on `slabId` finds a room's floor finish its script built: the top of
 * that build, in level coordinates, so a rug or a sofa stands on the boards rather than in them.
 * Null where no script builds on that plate there. Reads the level's children, and its slabs only
 * once a scripted room holds the point.
 */
export function floorFinishTopAt(
  nodes: SceneNodes,
  levelId: string,
  slabId: string,
  x: number,
  z: number,
): number | null {
  const level = nodes[levelId]
  if (level?.type !== 'level') return null
  let slabs: SlabNode[] | undefined
  for (const id of level.children) {
    const zone = nodes[id]
    if (zone?.type !== 'zone' || !zone.floor?.script) continue
    if (!containsPoint([{ outer: zone.polygon, holes: zone.holes ?? [] }], [x, z])) continue
    slabs ??= level.children.flatMap((child) => {
      const node = nodes[child]
      return node?.type === 'slab' ? [node] : []
    })
    const plate = roomFloorPlate(slabs, zone.id)
    if (plate?.id !== slabId) continue
    const height = Math.max(0, zone.floor.script.manifest.bounds.max[1])
    return plateTop(plate) + FLOOR_SCRIPT_LIFT + height
  }
  return null
}

/**
 * The floor a room's script builds on, or null when the room has none (no floor plate: `hasFloor`
 * false, or not enclosed yet). Several pieces (a floor cut through by a wall) give the largest.
 */
export function floorScriptInputs(nodes: SceneNodes, zoneId: string): FloorScriptInputs | null {
  const room = roomPlate(nodes, zoneId)
  if (!room || room.zone.polygon.length < 3 || room.plate.polygon.length < 3) return null
  const { zone, plate } = room
  const cover = levelWallCover(room.walls)
  const cache = inputsByCover.get(cover) ?? new Map<string, FloorScriptInputs | null>()
  inputsByCover.set(cover, cache)
  const key = JSON.stringify([zone.polygon, zone.holes, plate.polygon, plate.holes])
  if (cache.has(key)) return cache.get(key)!

  const outline = union([{ outer: zone.polygon, holes: zone.holes ?? [] }])
  const floor = intersection(
    cover.length ? difference(outline, cover) : outline,
    union([{ outer: plate.polygon, holes: plate.holes ?? [] }]),
  )
  let largest: MultiPolygon[number] | undefined
  for (const piece of floor) if (!largest || area([piece]) > area([largest])) largest = piece
  const inputs = largest
    ? { polygon: roundRing(largest.outer), holes: largest.holes.map(roundRing) }
    : null
  if (cache.size > 64) cache.delete(cache.keys().next().value!)
  cache.set(key, inputs)
  return inputs
}

/** The key a floor script keeps of the floor it was built for (`ZoneFloorScript.inputs`). */
export function floorScriptInputsKey(inputs: FloorScriptInputs): string {
  return scriptInputsKey(JSON.stringify([inputs.polygon, inputs.holes]))
}

/** A compile as the zone keeps it: its script source and the key of the floor it was built for. */
export function floorScriptRecord(
  compiled: CompiledGeometryScript,
  inputs: FloorScriptInputs,
  previous?: ZoneFloorScript,
): ZoneFloorScript {
  return { ...scriptSource(compiled, {}, previous), inputs: floorScriptInputsKey(inputs) }
}
