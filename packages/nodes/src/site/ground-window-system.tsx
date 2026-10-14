'use client'

import { type GroundBox, terrainBetweenEyeAndBox, useScene } from '@pascal-app/core'
import {
  groundWindowBoxNow,
  groundWindowContains,
  setGroundWindow,
  siteGround,
  useViewer,
} from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import type { Intersection, Mesh, Raycaster } from 'three'
import { Vector3 } from 'three'

/** How often the CPU word is re-asked, and how far the eye must move to ask it sooner. */
const CHECK_INTERVAL_S = 0.2
const EYE_MOVE_M = 0.25

/**
 * Keeps the ground window (viewer `lib/ground-window`) matched to the eye: a few throttled
 * CPU sight lines decide whether sculpted ground stands between the camera and the shown
 * box at all — that word opens the window (`Ground: Auto` permitting) and is what the view
 * bar reports — while the window's shape is drawn per fragment in TSL. Re-asked when the
 * eye moves, the scene or the box changes, or the person flips the ground mode.
 */
export function GroundWindowSystem() {
  const last = useRef({
    at: Number.NEGATIVE_INFINITY,
    eye: new Vector3(Number.POSITIVE_INFINITY, 0, 0),
    box: null as GroundBox | null,
    mode: '',
    nodes: null as unknown,
  })
  const picks = useRef(new Map<Mesh, Mesh['raycast']>())
  useFrame(({ camera, clock }) => {
    const viewer = useViewer.getState()
    const nodes = useScene.getState().nodes
    const box = viewer.groundWindowBox
    const check = last.current
    const due =
      clock.elapsedTime - check.at > CHECK_INTERVAL_S ||
      camera.position.distanceTo(check.eye) > EYE_MOVE_M ||
      box !== check.box ||
      nodes !== check.nodes ||
      viewer.groundMode !== check.mode
    if (!due) return
    check.at = clock.elapsedTime
    check.eye.copy(camera.position)
    check.box = box
    check.mode = viewer.groundMode
    check.nodes = nodes
    const eye: [number, number, number] = [camera.position.x, camera.position.y, camera.position.z]
    const inTheWay = box !== null && terrainBetweenEyeAndBox(nodes, eye, box)
    if (viewer.groundWindowVeiled !== inTheWay) useViewer.setState({ groundWindowVeiled: inTheWay })
    const open = inTheWay && viewer.groundMode === 'auto' ? box : null
    if (groundWindowBoxNow() !== open) setGroundWindow(open)
    keepPicksHonest(picks.current, open !== null)
  })
  useEffect(
    () => () => {
      keepPicksHonest(picks.current, false)
      setGroundWindow(null)
      if (useViewer.getState().groundWindowVeiled) useViewer.setState({ groundWindowVeiled: false })
    },
    [],
  )
  return null
}

/**
 * Picks agree with the window: while it is open, a hit on solid ground the window veils is
 * dropped, so the click reaches what the window reveals. The wrap reads the window's own
 * CPU word (`groundWindowContains`) against the picking ray, and every original raycast is
 * given back when the window closes.
 */
function keepPicksHonest(wrapped: Map<Mesh, Mesh['raycast']>, open: boolean): void {
  if (!open) {
    for (const [mesh, raycast] of wrapped) mesh.raycast = raycast
    wrapped.clear()
    return
  }
  for (const surface of siteGround().solid) {
    const mesh = surface as Mesh
    if (!mesh.isMesh || wrapped.has(mesh)) continue
    const original = mesh.raycast
    wrapped.set(mesh, original)
    mesh.raycast = (raycaster: Raycaster, intersects: Intersection[]) => {
      const before = intersects.length
      original.call(mesh, raycaster, intersects)
      for (let index = intersects.length - 1; index >= before; index -= 1) {
        const hit = intersects[index]
        if (hit && groundWindowContains(raycaster.ray.origin, hit.point))
          intersects.splice(index, 1)
      }
    }
  }
}
