'use client'

import { type SeparatorNode, sceneRegistry } from '@pascal-app/core'
import { type ThreeEvent, useThree } from '@react-three/fiber'
import { useState } from 'react'
import { OrthographicCamera, Plane, Vector2, Vector3 } from 'three'
import { runSeparatorEndDrag } from '../../lib/separator-edit'
import { suppressBoxSelectForPointer } from '../tools/select/box-select-state'
import { HandleArrow } from './handles/handle-arrow'

/**
 * An invisible wall's 3D end grip, the twin of its end handle on the plan: a
 * cube at the end, on the floor at `height`. Dragging it moves the end across
 * that floor (`runSeparatorEndDrag`), the invisible walls joined there
 * following. Rendered in the level frame.
 */
export function SeparatorEndGrip({
  separator,
  endpoint,
  height,
  levelId,
}: {
  separator: SeparatorNode
  endpoint: 'start' | 'end'
  height: number
  levelId: string
}) {
  const [hover, setHover] = useState(false)
  const { camera, raycaster, gl } = useThree()
  const zoom = camera instanceof OrthographicCamera ? 1 / camera.zoom : 1
  const [x, z] = separator[endpoint]
  const onPointerDown = (event: ThreeEvent<PointerEvent>) => {
    if (event.button !== 0) return
    event.stopPropagation()
    suppressBoxSelectForPointer(event)
    const level = sceneRegistry.nodes.get(levelId)
    if (!level) return
    level.updateWorldMatrix(true, false)
    const toLocal = level.matrixWorld.clone().invert()
    const floor = new Plane().setFromNormalAndCoplanarPoint(
      new Vector3(0, 1, 0).transformDirection(level.matrixWorld),
      new Vector3(x, height, z).applyMatrix4(level.matrixWorld),
    )
    runSeparatorEndDrag({
      separatorId: separator.id,
      endpoint,
      levelId,
      toPlan: (clientX, clientY) => {
        const rect = gl.domElement.getBoundingClientRect()
        raycaster.setFromCamera(
          new Vector2(
            ((clientX - rect.left) / rect.width) * 2 - 1,
            -((clientY - rect.top) / rect.height) * 2 + 1,
          ),
          camera,
        )
        const hit = raycaster.ray.intersectPlane(floor, new Vector3())
        if (!hit) return null
        const local = hit.applyMatrix4(toLocal)
        return [local.x, local.z]
      },
    })
  }
  return (
    <HandleArrow
      cursor="grab"
      hover={hover}
      onHoverChange={setHover}
      onPointerDown={onPointerDown}
      placement={{ position: [x, height, z], baseScale: zoom }}
      shape="tracker"
    />
  )
}
