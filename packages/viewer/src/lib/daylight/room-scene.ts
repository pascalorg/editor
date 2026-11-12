import {
  type AnyNode,
  type AnyNodeId,
  getLevelElevations,
  sceneRegistry,
  useInteractive,
  useScene,
} from '@pascal-app/core'
import { Box3, Color, type Material, MathUtils, type Mesh, type Object3D, Vector3 } from 'three'
import { materialEmissive, smoothstep, uniform, vec3 } from 'three/tsl'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { isHighlight } from '../editor-highlight'
import { setSurfaceRaycastLayers } from '../layers'
import type { MapLevel } from './room-map'
import type { RoomLamp, RoomOpeningRoot, RoomSceneInput, RoomZone } from './rooms'
import { daylightUniforms } from './runtime'

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
  /** The lamp's item: its node id (live) or object (baked). */
  nodeId?: string
  object?: Object3D
  /** A spotlight's cone (angle in degrees, full cone; softness = penumbra) and its aim. */
  spot?: { direction?: readonly [number, number, number]; angle?: number; softness?: number }
  getWorldDirection?: (out: Vector3) => void
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
        candela: Math.max(0, peak),
        range: MathUtils.clamp(light.distance || 5.5, 2.5, 9),
        on: feed.intensity(light) > 0,
        spot: light.spot ? lampSpot(light) : undefined,
      })
    }
  }
  return lamps
}

/** A spot's cone, as the light pools read it (half-angle = angle / 2, penumbra = softness). */
function lampSpot(light: LampFeedLight): RoomLamp['spot'] {
  const direction = new Vector3(...(light.spot?.direction ?? [0, -1, 0]))
  if (light.getWorldDirection) light.getWorldDirection(direction)
  const half = Math.min(Math.PI / 2, MathUtils.degToRad((light.spot?.angle ?? 60) / 2))
  const penumbra = MathUtils.clamp(light.spot?.softness ?? 0, 0, 1)
  return {
    direction: direction.normalize(),
    cosOuter: Math.cos(half),
    cosInner: Math.cos(half * (1 - penumbra)),
  }
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

/** Every live level, in one stable order: its building and assembled world floor height. */
function liveLevels(): { ids: string[]; levels: MapLevel[] } {
  const { nodes } = useScene.getState()
  const elevations = getLevelElevations(nodes as Record<AnyNodeId, AnyNode>)
  const buildings = new Map<string | null, number>()
  const ids: string[] = []
  const levels: MapLevel[] = []
  for (const node of Object.values(nodes)) {
    if (node?.type !== 'level') continue
    const elevation = elevations.get(node.id)
    const buildingId = elevation?.buildingId ?? null
    if (!buildings.has(buildingId)) buildings.set(buildingId, buildings.size)
    const building = buildingId ? nodes[buildingId as AnyNodeId] : undefined
    const siteY = building?.type === 'building' ? building.position[1] : 0
    ids.push(node.id)
    levels.push({ y: siteY + (elevation?.baseY ?? 0), building: buildings.get(buildingId)! })
  }
  return { ids, levels }
}

/** The live parametric scene (registry + node data), or null while it has no zones. */
export function liveRoomScene(virtualLampsOn: boolean): RoomSceneInput | null {
  const zoneIds = sceneRegistry.byType.zone
  if (!zoneIds || zoneIds.size === 0) return null
  const { nodes } = useScene.getState()
  const { ids, levels } = liveLevels()
  const levelIndex = new Map<string, number>(ids.map((id, index) => [id, index]))

  const zones: RoomZone[] = []
  const point = new Vector3()
  for (const id of zoneIds) {
    const node = nodes[id as AnyNodeId] as
      | (AnyNode & {
          polygon?: [number, number][]
          holes?: [number, number][][]
          parentId?: string | null
          visible?: boolean
        })
      | undefined
    const object = sceneRegistry.nodes.get(id)
    if (!node?.polygon || node.polygon.length < 3 || !object || node.visible === false) continue
    object.updateWorldMatrix(true, false)
    const toWorld = (ring: [number, number][]) =>
      ring.map(([x, z]) => {
        object.localToWorld(point.set(x, 0, z))
        return [point.x, point.z] as [number, number]
      })
    zones.push({
      id,
      polygon: toWorld(node.polygon),
      holes: (node.holes ?? []).filter((hole) => hole.length >= 3).map(toWorld),
      levelIndex: levelIndex.get(node.parentId ?? '') ?? 0,
    })
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
  const walls: RoomSceneInput['walls'] = []
  for (const id of sceneRegistry.byType.wall ?? []) {
    const object = sceneRegistry.nodes.get(id)
    if (!object) continue
    const wallLevel = levelIndex.get(nodes[id as AnyNodeId]?.parentId ?? '') ?? 0
    // Doors, windows and items hang under their wall: a closed leaf mustn't close its doorway.
    for (const mesh of meshesOf(object, (child) => registered.has(child)))
      walls.push({ object: mesh, levelIndex: wallLevel })
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
    levels,
    zones,
    covers,
    walls,
    openings,
    lamps: feedLamps(),
    virtualLampsOn,
    configureRaycaster: (raycaster) => setSurfaceRaycastLayers(raycaster.layers),
  }
}

/** Live level objects in the room system's level order (explode offsets, visibility, focus). */
export function liveLevelObjects(): (Object3D | undefined)[] {
  return liveLevels().ids.map((id) => sceneRegistry.nodes.get(id))
}

/** A baked artifact's levels: their objects and, per level, its building and floor height. */
function bakedLevels(root: Object3D): { objects: Object3D[]; levels: MapLevel[] } {
  const objects: Object3D[] = []
  root.traverse((object) => {
    if ((object.userData as BakedExtras).kind === 'level') objects.push(object)
  })
  root.updateWorldMatrix(true, true)
  const buildings = new Map<Object3D | null, number>()
  const point = new Vector3()
  const levels = objects.map((object) => {
    let building = object.parent
    while (building && (building.userData as BakedExtras).kind !== 'building')
      building = building.parent
    if (!buildings.has(building)) buildings.set(building, buildings.size)
    return { y: object.getWorldPosition(point).y, building: buildings.get(building)! }
  })
  return { objects, levels }
}

/** A baked artifact's level objects in the room system's level order. */
export function bakedLevelObjects(root: Object3D | null): Object3D[] {
  return root ? bakedLevels(root).objects : []
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
  holes?: [number, number][][]
}

/** A baked artifact's identity tree (levels, zones, covers, walls, openings), or null. */
export function bakedRoomScene(root: Object3D, virtualLampsOn: boolean): RoomSceneInput | null {
  const zoneObjects: Object3D[] = []
  const covers: RoomSceneInput['covers'] = []
  const wallRoots: Object3D[] = []
  const openings: RoomOpeningRoot[] = []
  root.traverse((object) => {
    const extras = object.userData as BakedExtras
    switch (extras.kind) {
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
  const levels = bakedLevels(root)
  const levelOf = (object: Object3D) => {
    for (let x: Object3D | null = object; x; x = x.parent) {
      const index = levels.objects.indexOf(x)
      if (index >= 0) return { index, frame: x }
    }
    return { index: 0, frame: null }
  }
  const point = new Vector3()
  const zones: RoomZone[] = []
  for (const object of zoneObjects) {
    const { polygon, holes } = object.userData as BakedExtras
    if (!polygon || polygon.length < 3) continue
    const level = levelOf(object)
    // Polygons are level-local [x, z]: bring them to world XZ through the level's frame.
    const frame = level.frame ?? object.parent ?? object
    const toWorld = (ring: [number, number][]) =>
      ring.map(([x, z]) => {
        point.set(x, 0, z).applyMatrix4(frame.matrixWorld)
        return [point.x, point.z] as [number, number]
      })
    zones.push({
      id: (object.userData as BakedExtras).pascalId ?? object.uuid,
      polygon: toWorld(polygon),
      holes: (holes ?? []).filter((hole) => hole.length >= 3).map(toWorld),
      levelIndex: level.index,
    })
  }
  if (!zones.length) return null
  const isIdentity = (object: Object3D) => {
    const kind = (object.userData as BakedExtras).kind
    return kind === 'door' || kind === 'window' || kind === 'item'
  }
  const walls = wallRoots.flatMap((object) => {
    const levelIndex = levelOf(object).index
    return meshesOf(object, isIdentity).map((mesh) => ({ object: mesh, levelIndex }))
  })
  const bounds = new Box3()
  for (const zone of zones)
    for (const [x, z] of zone.polygon) bounds.expandByPoint(point.set(x, 0, z))
  return {
    bounds,
    levels: levels.levels,
    zones,
    covers,
    walls,
    openings,
    lamps: feedLamps(),
    virtualLampsOn,
    configureRaycaster: (raycaster) => setSurfaceRaycastLayers(raycaster.layers),
  }
}

type EmitterMaterial = Material & {
  emissive?: { getHex(): number }
  emissiveIntensity?: number
}

function isEmitter(material: EmitterMaterial): boolean {
  return (
    !material.transparent &&
    // An editor highlight's tint isn't a glow: a selected lamp's frame must not light up.
    !isHighlight(material) &&
    !!material.emissive &&
    material.emissive.getHex() !== 0 &&
    (material.emissiveIntensity ?? 1) > 0
  )
}

function emissiveMeshes(root: Object3D): Mesh[] {
  const out: Mesh[] = []
  root.traverse((object) => {
    const mesh = object as Mesh
    if (!mesh.isMesh || !mesh.material) return
    const materials = (
      Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    ) as EmitterMaterial[]
    if (materials.some(isEmitter)) out.push(mesh)
  })
  return out
}

/**
 * A lamp's private emitter material: the exported hue at a fixed display brightness (× display
 * white, ÷ exposure) while its lamp is on — always reads as lit and blooms; dark when off, even
 * by day. Dark emissive parts (cords, trims) stay dark.
 */
function lampEmitterMaterial(source: EmitterMaterial, on: { value: number }): Material {
  const material = new MeshStandardNodeMaterial()
  for (const key of Object.keys(source)) {
    if (key === 'type' || key === 'uuid' || key === 'id' || key === 'defines') continue
    ;(material as unknown as Record<string, unknown>)[key] = (
      source as unknown as Record<string, unknown>
    )[key]
  }
  material.name = source.name
  material.userData = { ...source.userData, daylightLampMaterial: true }
  const emissive: any = materialEmissive
  const lum = emissive.dot(vec3(0.2126, 0.7152, 0.0722)).max(1e-4)
  material.emissiveNode = emissive
    .div(lum)
    .mul(smoothstep(0.02, 0.08, lum))
    .mul(on)
    .mul(daylightUniforms.emitterDisplay)
    .mul(daylightUniforms.emitterExpInv)
  return material
}

type LampEmitter = {
  original: Material | Material[]
  installed: Material | Material[]
  clones: Material[]
  on: ReturnType<typeof uniform>
}
const lampEmitters = new Map<Mesh, LampEmitter>()

/**
 * Lamp shades and bulbs follow their own lamp (the enhanced viewer's isolated emitters): each
 * lamp's emissive meshes get private materials whose emission follows that lamp's switch. A light
 * can sit on a child item while the glowing mesh belongs to its parent item: search the item, then
 * its nearest item ancestor. Re-installed if the item swaps its materials.
 */
export function syncLampEmitters(): void {
  const registered = new Set(sceneRegistry.nodes.values())
  for (const feed of lampFeeds) {
    for (const light of feed.lights()) {
      const root =
        light.object ?? (light.nodeId ? sceneRegistry.nodes.get(light.nodeId) : undefined)
      if (!root) continue
      let meshes = emissiveMeshes(root)
      for (let parent = root.parent; !meshes.length && parent; parent = parent.parent) {
        const extras = parent.userData as { pascalId?: string; kind?: string }
        if (extras.pascalId || registered.has(parent)) {
          if (extras.kind === undefined || extras.kind === 'item') meshes = emissiveMeshes(parent)
          break
        }
      }
      const on = feed.intensity(light) > 0 ? 1 : 0
      for (const mesh of meshes) {
        let emitter = lampEmitters.get(mesh)
        if (emitter && mesh.material !== emitter.installed) {
          for (const clone of emitter.clones) clone.dispose()
          emitter = undefined
        }
        if (!emitter) {
          const lit = uniform(on)
          const originals = (
            Array.isArray(mesh.material) ? mesh.material : [mesh.material]
          ) as EmitterMaterial[]
          const clones: Material[] = []
          const next = originals.map((material) => {
            if (!isEmitter(material)) return material
            const clone = lampEmitterMaterial(material, lit)
            clones.push(clone)
            return clone
          })
          const installed = Array.isArray(mesh.material) ? next : next[0]!
          emitter = { original: mesh.material, installed, clones, on: lit }
          lampEmitters.set(mesh, emitter)
          mesh.material = installed
        }
        emitter.on.value = on
      }
    }
  }
}

/** The lamps' own materials back (the daylight look left). */
export function restoreLampEmitters(): void {
  for (const [mesh, emitter] of lampEmitters) {
    if (mesh.material === emitter.installed) mesh.material = emitter.original
    for (const clone of emitter.clones) clone.dispose()
  }
  lampEmitters.clear()
}
