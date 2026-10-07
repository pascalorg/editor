'use client'

import { sceneRegistry } from '@pascal-app/core'
import { type ThreeEvent, useThree } from '@react-three/fiber'
import { useState } from 'react'
import { OrthographicCamera, Plane, type Ray, Vector2, Vector3 } from 'three'
import { runWallPushDrag, type WallPushHandle } from '../../lib/room-handle-drag'
import { getSpatialPointerId } from '../../lib/spatial-pointer-input'
import { suppressBoxSelectForPointer } from '../tools/select/box-select-state'
import { ARROW_SCALE, HandleArrow } from './handles/handle-arrow'

/**
 * The push/pull arrow of a wall stretch — a selected wall's side arrows and a
 * selected room's boundary arrows are this one component, driven by the one
 * `runWallPushDrag`. Rendered in the level frame. `zoneId` binds a room's
 * arrow to its room.
 */
export function WallPushArrow({
  handle,
  levelId,
  zoneId,
}: {
  handle: WallPushHandle
  levelId: string
  zoneId?: string
}) {
  const [hover, setHover] = useState(false)
  const { camera, raycaster, gl } = useThree()
  const zoom = camera instanceof OrthographicCamera ? 1 / camera.zoom : 1
  const onPointerDown = (event: ThreeEvent<PointerEvent>) => {
    if (event.button !== 0) return
    event.stopPropagation()
    suppressBoxSelectForPointer(event)
    const level = sceneRegistry.nodes.get(levelId)
    if (!level) return
    level.updateWorldMatrix(true, false)
    const toLocal = level.matrixWorld.clone().invert()
    const origin = new Vector3(handle.position[0], handle.height, handle.position[1]).applyMatrix4(
      level.matrixWorld,
    )
    const up = new Vector3(0, 1, 0).transformDirection(level.matrixWorld)
    const plane = new Plane().setFromNormalAndCoplanarPoint(up, origin)
    const along = (ray: Ray) => {
      const hit = ray.intersectPlane(plane, new Vector3())
      if (!hit) return null
      const local = hit.applyMatrix4(toLocal)
      return (
        (local.x - handle.position[0]) * handle.outward[0] +
        (local.z - handle.position[1]) * handle.outward[1]
      )
    }
    const rayAt = (clientX: number, clientY: number) => {
      const rect = gl.domElement.getBoundingClientRect()
      raycaster.setFromCamera(
        new Vector2(
          ((clientX - rect.left) / rect.width) * 2 - 1,
          -((clientY - rect.top) / rect.height) * 2 + 1,
        ),
        camera,
      )
      return raycaster.ray
    }
    const spatialPointerId = getSpatialPointerId(event.nativeEvent)
    const from = along(
      spatialPointerId ? event.ray : rayAt(event.nativeEvent.clientX, event.nativeEvent.clientY),
    )
    if (from === null) return
    runWallPushDrag({
      handle,
      levelId,
      zoneId,
      from,
      along: (clientX, clientY) => along(rayAt(clientX, clientY)),
      spatial: spatialPointerId ? { pointerId: spatialPointerId, along } : undefined,
    })
  }
  return (
    <HandleArrow
      cursor="grab"
      hover={hover}
      onHoverChange={setHover}
      onPointerDown={onPointerDown}
      placement={{
        position: [handle.position[0], handle.height, handle.position[1]],
        rotation: [0, Math.atan2(-handle.outward[1], handle.outward[0]), 0],
        baseScale: zoom * ARROW_SCALE,
      }}
      shape="chevron"
      thin
    />
  )
}
