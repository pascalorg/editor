'use client'

import { sceneRegistry, useInteractive, useScene } from '@pascal-app/core'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Box3, type Mesh, type Object3D, Vector3 } from 'three'
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
import useViewer from '../../store/use-viewer'

/** Seconds between scene-change checks, and the quiet time before a rebuild. */
const CHECK_INTERVAL = 0.5
const REBUILD_DELAY = 0.4
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
  const nodesVersion = useRef(0)
  const state = useRef({
    signature: '',
    pendingSince: -1,
    sinceCheck: CHECK_INTERVAL,
    live: true,
    bakedRoot: null as Object3D | null,
    levelObjects: [] as Object3D[][],
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
    if (s.sinceCheck >= CHECK_INTERVAL) {
      s.sinceCheck = 0
      // Items can swap their materials (edits, loads): keep the lamps' own emitters installed.
      syncLampEmitters()
      const live = (sceneRegistry.byType.zone?.size ?? 0) > 0
      const baked = live ? null : findBakedRoot(scene)
      const feedKeys = feedSignature()
      const signature = live
        ? `live|${roomObjectsSignature()}|${nodesVersion.current}|${useViewer.getState().geometryRevision}|${feedKeys}`
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
      if (s.pendingSince >= REBUILD_DELAY) {
        s.pendingSince = -1
        const input = s.live
          ? liveRoomScene(lampDefault)
          : s.bakedRoot
            ? bakedRoomScene(s.bakedRoot, lampDefault)
            : null
        daylightRooms.build(
          input ?? {
            bounds: emptyBounds,
            levelY: [0],
            zones: [],
            covers: [],
            walls: [],
            openings: [],
            lamps: feedLamps(),
            virtualLampsOn: lampDefault,
          },
        )
        s.levelObjects = s.live ? liveLevelObjects() : bakedLevelObjects(s.bakedRoot)
        flagGlassMaterials(scene)
        syncLampEmitters()
      }
    }

    // Live level heights (stacked / exploded motion) and the camera, in assembled space.
    const offsets = s.levelObjects.map((objects, index) =>
      objects[0] ? objects[0].getWorldPosition(scratch).y - (daylightRooms.levelY[index] ?? 0) : 0,
    )
    daylightRooms.setLevelOffsets(offsets)
    const focused = focusedLevelIndex(s.levelObjects)
    daylightRooms.levelShown = s.levelObjects.map(
      (objects, index) => (focused < 0 || index <= focused) && objects.some(shownInScene),
    )
    daylightRooms.cameraY.value = camera.position.y - (offsets[0] ?? 0)
    daylightRooms.focusedLevel.value = focused

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

/** Visible itself and through every ancestor (hidden levels are switched off on their group). */
function shownInScene(object: Object3D): boolean {
  for (let x: Object3D | null = object; x; x = x.parent) if (!x.visible) return false
  return true
}

/**
 * The level whose rooms open to the sky because the levels above it are hidden (solo level, or
 * levels above the selection hidden) — the enhanced viewer's "focus level". −1 otherwise.
 */
function focusedLevelIndex(levelObjects: Object3D[][]): number {
  const viewer = useViewer.getState()
  const hidesAbove = viewer.levelMode === 'solo' || viewer.hideLevelsAboveSelection
  const levelId = viewer.selection.levelId
  if (!hidesAbove || !levelId) return -1
  const object = sceneRegistry.nodes.get(levelId)
  return object ? levelObjects.findIndex((objects) => objects.includes(object)) : -1
}
