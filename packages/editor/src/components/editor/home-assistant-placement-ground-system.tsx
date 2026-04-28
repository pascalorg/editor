'use client'

import { sceneRegistry } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { HOME_ASSISTANT_RTS_PILL_WORLD_HEIGHT } from '@pascal-app/viewer/home-assistant-bindings'
import { useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { Plane, Vector2, Vector3 } from 'three'
import { registerHomeAssistantGroundResolver } from '../../lib/home-assistant-placement-ground'

export function HomeAssistantPlacementGroundSystem() {
  const camera = useThree((state) => state.camera)
  const gl = useThree((state) => state.gl)
  const raycaster = useThree((state) => state.raycaster)
  const selectedLevelId = useViewer((state) => state.selection.levelId)
  const ndc = useMemo(() => new Vector2(), [])
  const floorPlane = useMemo(() => new Plane(new Vector3(0, 1, 0), 0), [])
  const intersection = useMemo(() => new Vector3(), [])
  const pillPoint = useMemo(() => new Vector3(), [])
  const projectedGround = useMemo(() => new Vector3(), [])
  const projectedPill = useMemo(() => new Vector3(), [])

  useEffect(() => {
    return registerHomeAssistantGroundResolver((clientX, clientY) => {
      const rect = gl.domElement.getBoundingClientRect()
      if (
        rect.width <= 0 ||
        rect.height <= 0 ||
        clientX < rect.left ||
        clientX > rect.right ||
        clientY < rect.top ||
        clientY > rect.bottom
      ) {
        return null
      }

      const levelObject = selectedLevelId ? sceneRegistry.nodes.get(selectedLevelId) : null
      const floorY = levelObject?.position.y ?? 0

      ndc.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -(((clientY - rect.top) / rect.height) * 2 - 1),
      )
      floorPlane.constant = -floorY
      camera.updateMatrixWorld()
      raycaster.setFromCamera(ndc, camera)

      const point = raycaster.ray.intersectPlane(floorPlane, intersection)
      if (!point) {
        return null
      }

      projectedGround.copy(point).project(camera)
      pillPoint.set(point.x, point.y + HOME_ASSISTANT_RTS_PILL_WORLD_HEIGHT, point.z)
      projectedPill.copy(pillPoint).project(camera)

      return {
        groundPosition: {
          x: point.x,
          y: point.y,
          z: point.z,
        },
        groundScreenPosition: {
          x: rect.left + (projectedGround.x * 0.5 + 0.5) * rect.width,
          y: rect.top + (-projectedGround.y * 0.5 + 0.5) * rect.height,
        },
        pillScreenPosition: {
          x: rect.left + (projectedGround.x * 0.5 + 0.5) * rect.width,
          y: rect.top + (-projectedPill.y * 0.5 + 0.5) * rect.height,
        },
        visible:
          projectedGround.z >= -1 &&
          projectedGround.z <= 1 &&
          projectedPill.z >= -1 &&
          projectedPill.z <= 1,
      }
    })
  }, [
    camera,
    floorPlane,
    gl,
    intersection,
    ndc,
    pillPoint,
    projectedGround,
    projectedPill,
    raycaster,
    selectedLevelId,
  ])

  return null
}
