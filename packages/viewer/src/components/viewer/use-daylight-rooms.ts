'use client'

import { sceneRegistry, useInteractive, useScene } from '@pascal-app/core'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Box3, type Mesh, type Object3D, Vector3 } from 'three'
import {
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
    levelObjects: [] as Object3D[],
  })

  useEffect(
    () =>
      useScene.subscribe((next, previous) => {
        if (next.nodes !== previous.nodes) nodesVersion.current++
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
        ? `live|${sceneRegistry.revision}|${nodesVersion.current}|${useViewer.getState().geometryRevision}|${feedKeys}`
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
        s.levelObjects = s.live ? liveLevelObjects() : bakedLevels(s.bakedRoot)
        flagGlassMaterials(scene)
        syncLampEmitters()
      }
    }

    // Live level heights (stacked / exploded motion) and the camera, in assembled space.
    const offsets = s.levelObjects.map(
      (object, index) => object.getWorldPosition(scratch).y - (daylightRooms.levelY[index] ?? 0),
    )
    daylightRooms.setLevelOffsets(offsets)
    const focused = focusedLevelIndex(s.levelObjects)
    daylightRooms.levelShown = s.levelObjects.map(
      (object, index) => (focused < 0 || index <= focused) && shownInScene(object),
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

function feedSignature(): string {
  let keys = ''
  for (const feed of lampFeeds) for (const light of feed.lights()) keys += `${light.key},`
  return keys
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

function bakedLevels(root: Object3D | null): Object3D[] {
  if (!root) return []
  const levels: Object3D[] = []
  root.traverse((object) => {
    if ((object.userData as { kind?: string }).kind === 'level') levels.push(object)
  })
  return levels.sort((a, b) => a.position.y - b.position.y)
}

/**
 * The level whose rooms open to the sky because the levels above it are hidden (solo level, or
 * levels above the selection hidden) — the enhanced viewer's "focus level". −1 otherwise.
 */
function focusedLevelIndex(levelObjects: Object3D[]): number {
  const viewer = useViewer.getState()
  const hidesAbove = viewer.levelMode === 'solo' || viewer.hideLevelsAboveSelection
  const levelId = viewer.selection.levelId
  if (!hidesAbove || !levelId) return -1
  const object = sceneRegistry.nodes.get(levelId)
  return object ? levelObjects.indexOf(object) : -1
}
