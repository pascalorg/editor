'use client'

import { type DoorNode, sceneRegistry, useScene } from '@pascal-app/core'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import useViewer, {
  computeCurrentRatio,
  DOOR_MAX_ANGLE,
  DOOR_OPEN_DURATION_MS,
} from '../../store/use-viewer'

const MAX_INTERACTION_DISTANCE = 2.5
/** Cadence for garbage-collecting `doorAnim` entries whose door was
 *  deleted. Running every 60 frames (~1s at 60fps) is plenty — entries
 *  are tiny and the cost of the O(n) walk is negligible. */
const PRUNE_EVERY_N_FRAMES = 60
const _raycaster = new THREE.Raycaster()
const _screenCenter = new THREE.Vector2(0, 0)

/**
 * Runs the interactive side of doors in both walkthrough and editor modes:
 *
 *   1. Animation tick — every frame, each entry in `useViewer.doorAnim` has
 *      its current eased ratio recomputed from wall-clock time and pushed
 *      to the matching door mesh's `leafPivot` rotation. The store is only
 *      written to when the user toggles a door, so subscribers don't
 *      re-render during the swing.
 *
 *   2. Crosshair targeting (walkthrough only) — a raycast from the camera
 *      forward finds the nearest door within `MAX_INTERACTION_DISTANCE`
 *      and records its id as `useViewer.crosshairHoveredDoorId`. Consumed
 *      by the F-key handler and by the "Press F" hint overlay.
 *
 *   3. F-key handler — toggles whichever door is currently targeted. In
 *      walkthrough mode that's the crosshair-hovered door; in editor mode
 *      it falls back to whatever the pointer-event `hoveredId` is, so a
 *      user hovering a door with the mouse can still open it with F.
 *
 * Lives in the viewer package (not apps/editor) so the read-only
 * `/viewer/[id]` route gets interactive doors too, without the editor
 * needing to wire anything up.
 */
export const DoorInteractiveSystem = () => {
  const camera = useThree((s) => s.camera)
  const walkthroughMode = useViewer((s) => s.walkthroughMode)
  const frameCount = useRef(0)

  // F-key handler — always mounted so F works in both modes; internally
  // branches on walkthrough state to pick the right hovered-id source.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key.toLowerCase() !== 'f') return

      const state = useViewer.getState()
      let targetId: string | null = null
      if (state.walkthroughMode) {
        targetId = state.crosshairHoveredDoorId
      } else {
        // Editor mode — only act if the pointer-hovered node is a door.
        const hovered = state.hoveredId
        if (hovered && sceneRegistry.byType.door.has(hovered as never)) {
          targetId = hovered
        }
      }
      if (!targetId) return
      e.preventDefault()
      state.toggleDoor(targetId)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useFrame(() => {
    // ── Walkthrough crosshair raycast ──
    if (walkthroughMode) {
      const meshes: THREE.Object3D[] = []
      const doorIdByObject = new Map<THREE.Object3D, string>()
      sceneRegistry.byType.door.forEach((id) => {
        const obj = sceneRegistry.nodes.get(id as never)
        if (obj) {
          meshes.push(obj)
          doorIdByObject.set(obj, id)
        }
      })
      _raycaster.setFromCamera(_screenCenter, camera)
      _raycaster.far = MAX_INTERACTION_DISTANCE
      const hits = _raycaster.intersectObjects(meshes, true)
      let hoveredDoorId: string | null = null
      if (hits.length > 0) {
        // Walk up the hit ancestry to find the registered door root.
        let node: THREE.Object3D | null = hits[0]!.object
        while (node) {
          const matched = doorIdByObject.get(node)
          if (matched) {
            hoveredDoorId = matched
            break
          }
          node = node.parent
        }
      }
      const prev = useViewer.getState().crosshairHoveredDoorId
      if (prev !== hoveredDoorId) {
        useViewer.getState().setCrosshairHoveredDoorId(hoveredDoorId)
      }
    } else if (useViewer.getState().crosshairHoveredDoorId) {
      useViewer.getState().setCrosshairHoveredDoorId(null)
    }

    // ── Animation tick ──
    const anims = useViewer.getState().doorAnim
    const ids = Object.keys(anims)
    frameCount.current = (frameCount.current + 1) % PRUNE_EVERY_N_FRAMES
    if (ids.length === 0) return
    const now = performance.now()
    const nodes = useScene.getState().nodes
    for (const id of ids) {
      const anim = anims[id]!
      const mesh = sceneRegistry.nodes.get(id as never)
      if (!mesh) continue
      const pivot = mesh.getObjectByName('leafPivot') as THREE.Object3D | undefined
      if (!pivot) continue
      const node = nodes[id as never] as DoorNode | undefined
      if (!node || node.type !== 'door') continue
      const ratio = computeCurrentRatio(anim, now, DOOR_OPEN_DURATION_MS)
      // Swing sign matches the 2D floorplan arc convention (see the door
      // branch of `floorplan-panel.tsx`): "inward" swings the free edge
      // toward the wall's interior-side perpendicular, "outward" the
      // opposite way. `hingesSide` picks which edge is the pivot; the
      // swing direction combined with the hinge side gives the rotation
      // sign below. Kept consistent with the floorplan so toggling
      // either field in the door panel updates both views the same way.
      const hingeSign = node.hingesSide === 'right' ? 1 : -1
      const swingSign = node.swingDirection === 'inward' ? 1 : -1
      pivot.rotation.y = ratio * DOOR_MAX_ANGLE * hingeSign * swingSign
    }

    // Periodic cleanup: drop animation entries for doors that have been
    // deleted from the scene. Batched to once a second so the O(n) walk
    // doesn't run every frame.
    if (frameCount.current === 0) {
      const aliveIds = new Set<string>()
      for (const id of sceneRegistry.byType.door) {
        aliveIds.add(id)
      }
      useViewer.getState().pruneDoorAnim(aliveIds)
    }
  })

  return null
}
