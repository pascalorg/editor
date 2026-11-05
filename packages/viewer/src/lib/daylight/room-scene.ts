import {
  type AnyNode,
  type AnyNodeId,
  getLevelElevations,
  sceneRegistry,
  useInteractive,
  useScene,
} from '@pascal-app/core'
import { Box3, Color, MathUtils, type Object3D, Vector3 } from 'three'
import { setSurfaceRaycastLayers } from '../layers'
import type { RoomLamp, RoomOpeningRoot, RoomSceneInput, RoomZone } from './rooms'

/**
 * Builds the room system's input from a scene: the live parametric graph (scene registry +
 * node data) or a baked artifact (identity `userData` stamped by the GLB export).
 */

/** A lamp as the item-light pools see it (live catalog/procedural items and baked items alike). */
export type LampFeedLight = {
  key: string
  color: string
  distance: number
  /** Fully-on intensity. */
  peak?: number
  getWorldPosition: (out: Vector3) => boolean
}

type LampFeed = {
  lights: () => Iterable<LampFeedLight>
  intensity: (light: LampFeedLight) => number
}

/** Item-light pools hand their lamps to the room system while the daylight look is active. */
export const lampFeeds = new Set<LampFeed>()

const COVER_TYPES = {
  ceiling: 'ceiling',
  roof: 'roof',
  'roof-segment': 'roof',
  slab: 'slab',
} as const
const OPENING_TYPES = ['window', 'door'] as const

/** Lamps from every registered feed, in the room system's units. */
export function feedLamps(): RoomLamp[] {
  const lamps: RoomLamp[] = []
  const position = new Vector3()
  for (const feed of lampFeeds) {
    for (const light of feed.lights()) {
      if (!light.getWorldPosition(position)) continue
      // Light effects mix conventions: artist numbers (0.6–2) and physical-looking ones
      // (110, 1800 cd with 55 m reach). Log-compress so both land in a sane band; rooms are
      // soft-capped later.
      const peak = light.peak ?? 1
      lamps.push({
        itemId: light.key,
        position: position.clone(),
        color: new Color(light.color || '#ffe6c4'),
        intensity: 4 + 3 * Math.log2(1 + Math.max(0, peak)),
        range: MathUtils.clamp(light.distance || 5.5, 2.5, 9),
        on: feed.intensity(light) > 0,
      })
    }
  }
  return lamps
}

/** Current on/off of a fed lamp (by key). */
export function feedLampOn(key: string): boolean | undefined {
  for (const feed of lampFeeds) {
    for (const light of feed.lights()) if (light.key === key) return feed.intensity(light) > 0
  }
  return undefined
}

/** Meshes under a root, minus skipped subtrees and invisible helpers (hole-less collision proxies). */
function meshesOf(root: Object3D, skip: (object: Object3D) => boolean): Object3D[] {
  const out: Object3D[] = []
  const visit = (object: Object3D, isRoot: boolean) => {
    if (!isRoot && (skip(object) || !object.visible)) return
    if ((object as { isMesh?: boolean }).isMesh) out.push(object)
    for (const child of object.children) visit(child, false)
  }
  visit(root, true)
  return out
}

/** The live parametric scene (registry + node data), or null while it has no zones. */
export function liveRoomScene(virtualLampsOn: boolean): RoomSceneInput | null {
  const zoneIds = sceneRegistry.byType.zone
  if (!zoneIds || zoneIds.size === 0) return null
  const { nodes } = useScene.getState()
  const elevations = getLevelElevations(nodes as Record<AnyNodeId, AnyNode>)
  const levels = Object.values(nodes)
    .filter((node): node is AnyNode & { type: 'level' } => node?.type === 'level')
    .map((node) => ({ id: node.id, y: elevations.get(node.id)?.baseY ?? 0 }))
    .sort((a, b) => a.y - b.y)
  const levelIndex = new Map<string, number>(levels.map((level, index) => [level.id, index]))

  const zones: RoomZone[] = []
  const point = new Vector3()
  for (const id of zoneIds) {
    const node = nodes[id as AnyNodeId] as
      | (AnyNode & { polygon?: [number, number][]; parentId?: string | null; visible?: boolean })
      | undefined
    const object = sceneRegistry.nodes.get(id)
    if (!node?.polygon || node.polygon.length < 3 || !object || node.visible === false) continue
    object.updateWorldMatrix(true, false)
    const polygon = node.polygon.map(([x, z]) => {
      object.localToWorld(point.set(x, 0, z))
      return [point.x, point.z] as [number, number]
    })
    zones.push({ id, polygon, levelIndex: levelIndex.get(node.parentId ?? '') ?? 0 })
  }
  if (!zones.length) return null

  const registered = new Set(sceneRegistry.nodes.values())
  const covers: RoomSceneInput['covers'] = []
  for (const [type, kind] of Object.entries(COVER_TYPES)) {
    for (const id of sceneRegistry.byType[type] ?? []) {
      const object = sceneRegistry.nodes.get(id)
      if (object) covers.push({ object, kind })
    }
  }
  const walls: Object3D[] = []
  for (const id of sceneRegistry.byType.wall ?? []) {
    const object = sceneRegistry.nodes.get(id)
    // Doors, windows and items hang under their wall: a closed leaf mustn't close its doorway.
    if (object) walls.push(...meshesOf(object, (child) => registered.has(child)))
  }
  const openings: RoomOpeningRoot[] = []
  for (const kind of OPENING_TYPES) {
    for (const id of sceneRegistry.byType[kind] ?? []) {
      const object = sceneRegistry.nodes.get(id)
      if (object) openings.push({ object, kind, id })
    }
  }

  const bounds = new Box3()
  for (const zone of zones)
    for (const [x, z] of zone.polygon) bounds.expandByPoint(point.set(x, 0, z))
  return {
    bounds,
    levelY: levels.map((level) => level.y),
    zones,
    covers,
    walls,
    openings,
    lamps: feedLamps(),
    virtualLampsOn,
    configureRaycaster: (raycaster) => setSurfaceRaycastLayers(raycaster.layers),
  }
}

/** Live level objects in the room system's level order (for explode offsets). */
export function liveLevelObjects(): Object3D[] {
  const { nodes } = useScene.getState()
  const elevations = getLevelElevations(nodes as Record<AnyNodeId, AnyNode>)
  return Object.values(nodes)
    .filter((node): node is AnyNode & { type: 'level' } => node?.type === 'level')
    .sort((a, b) => (elevations.get(a.id)?.baseY ?? 0) - (elevations.get(b.id)?.baseY ?? 0))
    .map((node) => sceneRegistry.nodes.get(node.id))
    .filter((object): object is Object3D => !!object)
}

/** How open a live door is (0 closed … 1 fully open), the transient state first. */
export function liveDoorOpenness(id: string): number {
  const node = useScene.getState().nodes[id as AnyNodeId] as
    | { doorType?: string; operationState?: number; swingAngle?: number }
    | undefined
  const transient = (
    useInteractive.getState().doors as Record<
      string,
      { swingAngle?: number; operationState?: number } | undefined
    >
  )[id]
  const swing = transient?.swingAngle ?? node?.swingAngle ?? 0
  const operation = transient?.operationState ?? node?.operationState ?? 0
  return Math.max(operation, swing / (Math.PI / 2))
}

type BakedExtras = {
  kind?: string
  pascalId?: string
  polygon?: [number, number][]
}

/** A baked artifact's identity tree (levels, zones, covers, walls, openings), or null. */
export function bakedRoomScene(root: Object3D, virtualLampsOn: boolean): RoomSceneInput | null {
  const levelObjects: Object3D[] = []
  const zoneObjects: Object3D[] = []
  const covers: RoomSceneInput['covers'] = []
  const wallRoots: Object3D[] = []
  const openings: RoomOpeningRoot[] = []
  root.traverse((object) => {
    const extras = object.userData as BakedExtras
    switch (extras.kind) {
      case 'level':
        levelObjects.push(object)
        break
      case 'zone':
        zoneObjects.push(object)
        break
      case 'ceiling':
      case 'roof':
      case 'roof-segment':
      case 'slab':
        covers.push({ object, kind: COVER_TYPES[extras.kind] })
        break
      case 'wall':
        wallRoots.push(object)
        break
      case 'window':
      case 'door':
        openings.push({ object, kind: extras.kind, id: extras.pascalId ?? object.uuid })
        break
    }
  })
  if (!zoneObjects.length) return null
  root.updateWorldMatrix(true, true)
  const levels = levelObjects
    .map((object) => ({ object, y: object.getWorldPosition(new Vector3()).y }))
    .sort((a, b) => a.y - b.y)
  const levelOf = (object: Object3D) => {
    for (let x: Object3D | null = object; x; x = x.parent) {
      const index = levels.findIndex((level) => level.object === x)
      if (index >= 0) return index
    }
    return 0
  }
  const point = new Vector3()
  const zones: RoomZone[] = []
  for (const object of zoneObjects) {
    const polygon = (object.userData as BakedExtras).polygon
    if (!polygon || polygon.length < 3) continue
    const levelIndex = levelOf(object)
    // Polygons are level-local [x, z]: bring them to world XZ through the level's frame.
    const frame = levels[levelIndex]?.object ?? object.parent ?? object
    zones.push({
      id: (object.userData as BakedExtras).pascalId ?? object.uuid,
      polygon: polygon.map(([x, z]) => {
        point.set(x, 0, z).applyMatrix4(frame.matrixWorld)
        return [point.x, point.z] as [number, number]
      }),
      levelIndex,
    })
  }
  if (!zones.length) return null
  const isIdentity = (object: Object3D) => {
    const kind = (object.userData as BakedExtras).kind
    return kind === 'door' || kind === 'window' || kind === 'item'
  }
  const walls = wallRoots.flatMap((object) => meshesOf(object, isIdentity))
  const bounds = new Box3()
  for (const zone of zones)
    for (const [x, z] of zone.polygon) bounds.expandByPoint(point.set(x, 0, z))
  return {
    bounds,
    levelY: levels.map((level) => level.y),
    zones,
    covers,
    walls,
    openings,
    lamps: feedLamps(),
    virtualLampsOn,
    configureRaycaster: (raycaster) => setSurfaceRaycastLayers(raycaster.layers),
  }
}
