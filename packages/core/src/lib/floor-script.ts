import type { AnyNode, CompiledGeometryScript, ZoneFloorScript } from '../schema'
import { DEFAULT_SLAB_ELEVATION } from '../schema/nodes/slab'
import { scriptSource } from './geometry-script-node'
import { levelWallCover, plateLevelContext } from './plate-surface'
import {
  area,
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
 * What a room's floor script is built for, in level coordinates and metres: the room's walking
 * floor (its outline inside the wall faces, on its floor plate) as `polygon` with its `holes`, and
 * the plate's top, `elevation`. The module lays its boards out over it; the compiler cuts the build
 * to the polygon less its holes.
 */
export type FloorScriptInputs = {
  polygon: [number, number][]
  holes: [number, number][][]
  elevation: number
}

const round = (value: number) => Math.round(value * 1e4) / 1e4
const roundRing = (ring: Ring): [number, number][] => ring.map(([x, z]) => [round(x), round(z)])

/** Inputs by wall cover (memoised per wall signature in `levelWallCover`), then by room and plate. */
const inputsByCover = new WeakMap<MultiPolygon, Map<string, FloorScriptInputs | null>>()

/**
 * The floor a room's script builds on, or null when the room has none (no floor plate: `hasFloor`
 * false, or not enclosed yet). Several pieces (a floor cut through by a wall) give the largest.
 */
export function floorScriptInputs(nodes: SceneNodes, zoneId: string): FloorScriptInputs | null {
  const zone = nodes[zoneId]
  if (zone?.type !== 'zone' || zone.polygon.length < 3 || !zone.parentId) return null
  const context = plateLevelContext(nodes[zone.parentId] ?? null, (id) => nodes[id])
  const plate = roomFloorPlate(context.slabs, zone.id)
  if (!plate || plate.polygon.length < 3) return null
  const cover = levelWallCover(context.walls)
  const cache = inputsByCover.get(cover) ?? new Map<string, FloorScriptInputs | null>()
  inputsByCover.set(cover, cache)
  const elevation = round(plate.elevation ?? DEFAULT_SLAB_ELEVATION)
  const key = JSON.stringify([zone.polygon, zone.holes, plate.polygon, plate.holes, elevation])
  if (cache.has(key)) return cache.get(key)!

  const room = union([{ outer: zone.polygon, holes: zone.holes ?? [] }])
  const floor = intersection(
    cover.length ? difference(room, cover) : room,
    union([{ outer: plate.polygon, holes: plate.holes ?? [] }]),
  )
  let largest: MultiPolygon[number] | undefined
  for (const piece of floor) if (!largest || area([piece]) > area([largest])) largest = piece
  const inputs = largest
    ? { polygon: roundRing(largest.outer), holes: largest.holes.map(roundRing), elevation }
    : null
  if (cache.size > 64) cache.delete(cache.keys().next().value!)
  cache.set(key, inputs)
  return inputs
}

/** The key a floor script keeps of the floor it was built for (`ZoneFloorScript.inputs`). */
export function floorScriptInputsKey(inputs: FloorScriptInputs): string {
  return scriptInputsKey(JSON.stringify([inputs.polygon, inputs.holes, inputs.elevation]))
}

/** A compile as the zone keeps it: its script source and the key of the floor it was built for. */
export function floorScriptRecord(
  compiled: CompiledGeometryScript,
  inputs: FloorScriptInputs,
  previous?: ZoneFloorScript,
): ZoneFloorScript {
  return { ...scriptSource(compiled, {}, previous), inputs: floorScriptInputsKey(inputs) }
}
