import { sceneRegistry, useScene, type WallNode } from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import { float, mix, positionLocal } from 'three/tsl'

import { type Mesh, MeshStandardNodeMaterial, Vector3 } from 'three/webgpu'

const tmpVec = new Vector3()
const u = new Vector3()
const v = new Vector3()

const invsibleWallMaterial = new MeshStandardNodeMaterial({
  // opacity: 0.1,
  transparent: true,
  opacityNode: mix(float(1), float(0.1), positionLocal.y.add(0.1)),
})
const wallMaterial = new MeshStandardNodeMaterial({
  color: 'white',
})

export const WallCutout = () => {
  const lastCameraPosition = useRef(new Vector3())
  const lastCameraTarget = useRef(new Vector3())

  useFrame(({ camera }) => {
    const currentCameraPosition = camera.position
    camera.getWorldDirection(tmpVec)
    tmpVec.add(currentCameraPosition)

    if (
      !currentCameraPosition.equals(lastCameraPosition.current) ||
      !tmpVec.equals(lastCameraTarget.current)
    ) {
      // Camera has moved, update cutout logic here

      // Update last known positions
      lastCameraPosition.current.copy(currentCameraPosition)
      lastCameraTarget.current.copy(tmpVec)
      camera.getWorldDirection(u)
      // TODO: Debounce
      const walls = sceneRegistry.byType.wall
      walls.forEach((wallId) => {
        const wallMesh = sceneRegistry.nodes.get(wallId)
        if (!wallMesh) return
        const wallNode = useScene.getState().nodes[wallId as WallNode['id']]
        if (!wallNode || wallNode.type !== 'wall') return
        wallMesh.getWorldDirection(v)
        let hideWall = wallNode.frontSide === 'interior' && wallNode.backSide === 'interior'
        if (v.dot(u) < 0) {
          // Front side
          if (wallNode.frontSide === 'exterior') {
            hideWall = true
          }
        } else {
          // Back side
          if (wallNode.backSide === 'exterior') {
            hideWall = true
          }
        }
        ;(wallMesh as Mesh).material = hideWall ? invsibleWallMaterial : wallMaterial
      })
    }
  })
  return null
}
