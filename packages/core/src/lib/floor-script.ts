import type {
  AnyNode,
  CompiledGeometryScript,
  GeometryScriptParamValue,
  ZoneFloorScript,
  ZoneNode,
} from '../schema'
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

type SceneNodes = Readonly<Record<string, AnyNode>>

/**
 * What a room's floor script is built for, in level coordinates and metres: the room's walking
 * floor (its outline inside the wall faces, on its floor plate) as `polygon` with its `holes`, and
 * the plate's top, `elevation`. The module lays its boards on exactly that; clipping is its job.
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

/** 32-bit FNV-1a: a change detector for a floor's inputs, not a content address. */
function fnv1a(text: string, seed: number): string {
  let hash = seed
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** The key a floor script keeps of the floor it was built for (`ZoneFloorScript.inputs`). */
export function floorScriptInputsKey(inputs: FloorScriptInputs): string {
  const text = JSON.stringify([inputs.polygon, inputs.holes, inputs.elevation])
  return fnv1a(text, 0x811c9dc5) + fnv1a(text, 0x050c5d1f)
}

/** A compile as the zone keeps it: its script source and the key of the floor it was built for. */
export function floorScriptRecord(
  compiled: CompiledGeometryScript,
  inputs: FloorScriptInputs,
  previous?: ZoneFloorScript,
): ZoneFloorScript {
  return { ...scriptSource(compiled, {}, previous), inputs: floorScriptInputsKey(inputs) }
}

export type StaleFloorScript = {
  zoneId: string
  script: ZoneFloorScript
  /** The room's floor now, which the script runs again for. */
  inputs: FloorScriptInputs
}

/**
 * The floor scripts whose room's floor is no longer the one they were built for: the structure
 * reconcile re-derived the room's polygon or plate (a wall moved, a room edge pushed, a floor
 * raised), so the key differs. A room with no floor now keeps its script as it was.
 */
export function staleFloorScripts(nodes: SceneNodes): StaleFloorScript[] {
  return Object.values(nodes).flatMap((node) => {
    const script = node.type === 'zone' ? node.floor?.script : undefined
    if (!script) return []
    const inputs = floorScriptInputs(nodes, node.id)
    return inputs && floorScriptInputsKey(inputs) !== script.inputs
      ? [{ zoneId: node.id, script, inputs }]
      : []
  })
}

/**
 * How a host runs a floor script: reads its module back by hash, and compiles and stores it for a
 * floor (`@pascal-app/geometry-script`'s `compileGeometryScript` with `inputs`, then the artifact
 * store), answering the compile with the stored hashes.
 */
export type FloorScriptHost = {
  readScript(sha256: string): Promise<string | null>
  build(input: {
    zoneId: string
    code: string
    params: Record<string, GeometryScriptParamValue>
    inputs: FloorScriptInputs
  }): Promise<CompiledGeometryScript>
}

export type FloorScriptRefresh = {
  /** Each rebuilt room's new `floor`, its other floor fields as they were when the refresh began. */
  update: { id: string; data: Pick<ZoneNode, 'floor'> }[]
  failed: { zoneId: string; error: string }[]
}

/**
 * Runs every stale floor script again for its room's current floor, with its stored params. A host
 * applies an update while that room's floor is still the one it was built for (else a newer
 * refresh follows), and writes only `floor.script` over what the room holds then.
 */
export async function refreshFloorScripts(
  nodes: SceneNodes,
  host: FloorScriptHost,
): Promise<FloorScriptRefresh> {
  const refresh: FloorScriptRefresh = { update: [], failed: [] }
  await Promise.all(
    staleFloorScripts(nodes).map(async ({ zoneId, script, inputs }) => {
      try {
        const code = await host.readScript(script.script)
        if (code === null) throw new Error('its module could not be read')
        const compiled = await host.build({ zoneId, code, params: script.params, inputs })
        const zone = nodes[zoneId] as ZoneNode
        refresh.update.push({
          id: zoneId,
          data: { floor: { ...zone.floor, script: floorScriptRecord(compiled, inputs, script) } },
        })
      } catch (error) {
        refresh.failed.push({
          zoneId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }),
  )
  return refresh
}
