'use client'

import { sceneRegistry, useInteractive, useScene } from '@pascal-app/core'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Box3, type Mesh, type Object3D, Vector3 } from 'three'
import { DEFAULT_TEXTURE_LIMIT } from '../../lib/daylight/room-map'
import {
  bakedLevelObjects,
  bakedRoomScene,
  feedLamps,
  lampFeeds,
  liveDoorOpenness,
  liveLevelObjects,
  liveRoomScene,
  syncLampEmitters,
} from '../../lib/daylight/room-scene'
import { daylightRooms } from '../../lib/daylight/rooms'
import { heldReasons } from '../../lib/scene-visibility'
import useViewer from '../../store/use-viewer'

/** Seconds between scene-change checks, and the quiet time before a rebuild. */
const CHECK_INTERVAL = 0.5
const REBUILD_DELAY = 0.4
/** Longest wait for the scene to settle before building anyway (seconds). */
const SETTLE_WAIT = 10
/**
 * Furniture: what the rooms are built from (walls, slabs, ceilings, roofs, doors, windows,
 * zones) never includes it, so moving or placing it doesn't rebuild them (a rebuild casts
 * thousands of rays). A lamp among it is followed by its light's position instead.
 */
const FURNITURE_TYPES = new Set([
  'item',
  'procedural-item',
  'imported-mesh',
  'cabinet',
  'cabinet-module',
  'shelf',
])
const LAMP_POSITION_STEP = 0.05

/**
 * Keeps the daylight room system in step with the scene: rebuilds rooms, portals and lamps
 * after edits (debounced; uniforms and textures only, no recompiles), and every frame feeds it
 * the live level heights, the camera, lamp switches and door openness.
 */
export function useDaylightRooms() {
  const scene = useThree((s) => s.scene)
  const gl = useThree((s) => s.gl)
  const nodesVersion = useRef(0)
  const state = useRef({
    signature: '',
    pendingSince: -1,
    sinceCheck: CHECK_INTERVAL,
    /** Times the scene finished rebuilding geometry (no dirty nodes left), and whether it is now. */
    settles: 0,
    dirty: false,
    dirtyRooms: false,
    /** Dirty nodes left when rooms were last built mid-load (they rebuild as the count falls). */
    builtDirty: Number.POSITIVE_INFINITY,
    /** Level offsets last frame: rays are cast at stacked heights, so no build while levels move. */
    offsets: [] as number[],
    levelsMoved: false,
    live: true,
    bakedRoot: null as Object3D | null,
    levelObjects: [] as (Object3D | undefined)[],
  })

  useEffect(
    () =>
      useScene.subscribe((next, previous) => {
        if (next.nodes !== previous.nodes && roomInputsChanged(next.nodes, previous.nodes))
          nodesVersion.current++
      }),
    [],
  )

  useFrame(({ camera }, delta) => {
    const s = state.current
    const lampDefault = useInteractive.getState().lampDefault
    s.sinceCheck += delta
    // Rooms are built from finished walls, windows and covers: wait for the scene to settle, and
    // build again each time it does (walls and openings finish without a geometry revision).
    const { dirtyNodes, nodes } = useScene.getState()
    const dirty = dirtyNodes.size > 0
    if (dirty && !s.dirtyRooms)
      for (const id of dirtyNodes) {
        const type = nodes[id]?.type
        if (type && !FURNITURE_TYPES.has(type)) {
          s.dirtyRooms = true
          break
        }
      }
    if (s.dirty && !dirty && s.dirtyRooms) {
      s.settles++
      s.dirtyRooms = false
    }
    s.dirty = dirty
    if (s.sinceCheck >= CHECK_INTERVAL) {
      s.sinceCheck = 0
      // Items can swap their materials (edits, loads): keep the lamps' own emitters installed.
      syncLampEmitters()
      const live = (sceneRegistry.byType.zone?.size ?? 0) > 0
      const baked = live ? null : findBakedRoot(scene)
      const feedKeys = feedSignature()
      const signature = live
        ? `live|${roomObjectsSignature()}|${nodesVersion.current}|${useViewer.getState().geometryRevision}|${s.settles}|${feedKeys}`
        : `baked|${baked?.uuid ?? ''}|${baked?.children.length ?? 0}|${feedKeys}`
      if (signature !== s.signature) {
        s.signature = signature
        s.pendingSince = 0
        s.live = live
        s.bakedRoot = baked
      }
    }
    if (s.pendingSince >= 0) {
      s.pendingSince += delta
      const exploded = useViewer.getState().levelMode === 'exploded' || s.levelsMoved
      if (
        s.pendingSince >= REBUILD_DELAY &&
        !exploded &&
        (!(s.live && dirty) || s.pendingSince > SETTLE_WAIT)
      ) {
        s.pendingSince = -1
        const input = s.live
          ? liveRoomScene(lampDefault)
          : s.bakedRoot
            ? bakedRoomScene(s.bakedRoot, lampDefault)
            : null
        daylightRooms.map.textureLimit = textureLimit(gl)
        daylightRooms.build(
          input ?? {
            bounds: emptyBounds,
            levels: [],
            zones: [],
            covers: [],
            walls: [],
            openings: [],
            lamps: feedLamps(),
            virtualLampsOn: lampDefault,
          },
        )
        s.levelObjects = s.live ? liveLevelObjects() : bakedLevelObjects(s.bakedRoot)
        // Built before the scene settled (a large scene still building walls and windows): build
        // again after the next wait while geometry keeps arriving, so the rooms catch up.
        if (s.live && dirty && dirtyNodes.size < s.builtDirty) {
          s.builtDirty = dirtyNodes.size
          s.pendingSince = 0
        } else if (!dirty) s.builtDirty = Number.POSITIVE_INFINITY
        flagGlassMaterials(scene)
        syncLampEmitters()
      }
    }

    // Live level heights (stacked / exploded motion), what is shown, and the camera.
    const levels = daylightRooms.levels
    const offsets = s.levelObjects.map((object, index) =>
      object ? object.getWorldPosition(scratch).y - (levels[index]?.y ?? 0) : 0,
    )
    s.levelsMoved = offsets.some(
      (offset, index) => Math.abs(offset - (s.offsets[index] ?? offset)) > 1e-4,
    )
    s.offsets = offsets
    const shown = s.levelObjects.map((object) => !!object && presented(object))
    const focus = selectedFocusLevel()
    const selected = s.levelObjects.map((object) => !!object && object === focus)
    daylightRooms.setLevelPresentation(offsets, shown, selected)
    daylightRooms.cameraY.value = camera.position.y

    // Lamp switches (fed lamps by key; virtual lamps follow the time-of-day default) and doors.
    const lit = litFeedKeys()
    if (daylightRooms.setLampStates((lamp) => (lamp.itemId ? lit.has(lamp.itemId) : lampDefault)))
      syncLampEmitters()
    if (s.live) daylightRooms.updateDoors(liveDoorOpenness)
  })
}

const emptyBounds = new Box3()
const scratch = new Vector3()

/**
 * Glass is a slot on the mesh, but shaders compile per material (shared by every pane): mark
 * the material itself so the tuned glass applies whichever pane compiles it first.
 */
function flagGlassMaterials(scene: Object3D) {
  scene.traverse((object) => {
    const mesh = object as Mesh
    if (!mesh.isMesh || mesh.userData.slotId !== 'glass') return
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!material || material.userData.isGlass) continue
      material.userData.isGlass = true
      material.needsUpdate = true
    }
  })
}

const feedPosition = new Vector3()

/** The lamps fed to the rooms and where they stand (a moved lamp, or its host, rebuilds). */
function feedSignature(): string {
  let keys = ''
  for (const feed of lampFeeds) {
    for (const light of feed.lights()) {
      keys += `${light.key}`
      if (light.getWorldPosition(feedPosition)) {
        const q = (v: number) => Math.round(v / LAMP_POSITION_STEP)
        keys += `@${q(feedPosition.x)},${q(feedPosition.y)},${q(feedPosition.z)}`
      }
      keys += ';'
    }
  }
  return keys
}

/** Whether a scene edit touched anything the rooms are built from (anything but furniture). Exported for tests. */
export function roomInputsChanged(
  next: Readonly<Record<string, { type: string } | undefined>>,
  previous: Readonly<Record<string, { type: string } | undefined>>,
): boolean {
  for (const id in next) {
    const node = next[id]
    const before = previous[id]
    if (node === before || FURNITURE_TYPES.has((node ?? before)?.type ?? '')) continue
    // A level (or any container) whose child list alone changed: what joined or left it shows up
    // as its own change, so furniture re-parenting under it doesn't rebuild the rooms.
    if (node && before && onlyChildrenDiffer(node, before)) continue
    return true
  }
  for (const id in previous) {
    if (!(id in next) && !FURNITURE_TYPES.has(previous[id]?.type ?? '')) return true
  }
  return false
}

function onlyChildrenDiffer(a: object, b: object): boolean {
  const x = a as Record<string, unknown>
  const y = b as Record<string, unknown>
  for (const key in x) if (key !== 'children' && x[key] !== y[key]) return false
  for (const key in y) if (key !== 'children' && !(key in x)) return false
  return true
}

/** The registered objects the rooms are built from: changes when one mounts, unmounts or is replaced. */
function roomObjectsSignature(): string {
  let count = 0
  let ids = 0
  for (const [type, set] of Object.entries(sceneRegistry.byType)) {
    if (FURNITURE_TYPES.has(type)) continue
    for (const id of set) {
      const object = sceneRegistry.nodes.get(id)
      count++
      if (object) ids += object.id
    }
  }
  return `${count}:${ids}`
}

function litFeedKeys(): Set<string> {
  const lit = new Set<string>()
  for (const feed of lampFeeds)
    for (const light of feed.lights()) if (feed.intensity(light) > 0) lit.add(light.key)
  return lit
}

/** The baked artifact's root (the first object carrying export identities), if any. */
function findBakedRoot(scene: Object3D): Object3D | null {
  let found: Object3D | null = null
  scene.traverse((object) => {
    if (found) return
    const kind = (object.userData as { kind?: string }).kind
    if (kind === 'site' || kind === 'building' || kind === 'level') found = object.parent ?? object
  })
  return found
}

/**
 * On screen: visible through every ancestor (hidden levels are switched off on their group) and
 * not drawn for shadows only (levels hidden above the selection keep shadowing it).
 */
function presented(object: Object3D): boolean {
  for (let x: Object3D | null = object; x; x = x.parent) if (!x.visible) return false
  return !heldReasons(object)?.has('shadow-only')
}

/** The selected level when the levels over it are hidden (solo, or hide-above), else null. */
function selectedFocusLevel(): Object3D | null {
  const viewer = useViewer.getState()
  const hidesAbove = viewer.levelMode === 'solo' || viewer.hideLevelsAboveSelection
  const levelId = viewer.selection.levelId
  if (!hidesAbove || !levelId) return null
  return sceneRegistry.nodes.get(levelId) ?? null
}

/** The device's largest 2D texture side (WebGPU device limits, or the WebGL context's). */
function textureLimit(gl: unknown): number {
  const backend = (gl as { backend?: { device?: GPUDevice; gl?: WebGL2RenderingContext } }).backend
  const limit =
    backend?.device?.limits?.maxTextureDimension2D ??
    (backend?.gl?.getParameter(backend.gl.MAX_TEXTURE_SIZE) as number | undefined)
  return limit && limit > 0 ? limit : DEFAULT_TEXTURE_LIMIT
}
