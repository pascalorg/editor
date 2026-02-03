import { sceneRegistry, useScene, type WallNode } from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import { Fn, float, fract, length, mix, positionLocal, smoothstep, step, vec2 } from 'three/tsl'

import { type Mesh, MeshStandardNodeMaterial, Vector3 } from 'three/webgpu'
import useViewer from '../../store/use-viewer'

const tmpVec = new Vector3()
const u = new Vector3()
const v = new Vector3()

// Dot pattern shader
const dotPattern = Fn(() => {
  // Create a repeating grid pattern based on world position
  const scale = float(0.1) // Dot grid spacing (10cm)
  const dotSize = float(0.3) // Size of dots relative to grid

  // Use XY coordinates for pattern on wall face
  const uv = vec2(positionLocal.x, positionLocal.y).div(scale)
  const gridUV = fract(uv)

  // Distance from center of grid cell (creates circular dots)
  const dist = length(gridUV.sub(0.5))

  // Create dots: 1 where we want dots, 0 elsewhere
  const dots = step(dist, dotSize.mul(0.5))

  // Vertical fade: fade out as Y increases (from bottom to top)
  const fadeHeight = float(2.5) // Fade over 2.5 meters
  const yFade = float(1).sub(smoothstep(float(0), fadeHeight, positionLocal.y))

  return dots.mul(yFade)
})

const invsibleWallMaterial = new MeshStandardNodeMaterial({
  transparent: true,
  opacityNode: mix(float(0.0), float(0.24), dotPattern()),
  color: 'white',
  depthWrite: false,
  emissive: 'white',
})
const wallMaterial = new MeshStandardNodeMaterial({
  color: 'white',
})

export const WallCutout = () => {
  const lastCameraPosition = useRef(new Vector3())
  const lastCameraTarget = useRef(new Vector3())
  const lastUpdateTime = useRef(0)
  const lastWallMode = useRef<string>(useViewer.getState().wallMode)
  const lastNumberOfWalls = useRef(0)

  useFrame(({ camera, clock }) => {
    const wallMode = useViewer.getState().wallMode
    const currentTime = clock.elapsedTime
    const currentCameraPosition = camera.position
    camera.getWorldDirection(tmpVec)
    tmpVec.add(currentCameraPosition)

    // Throttle: only update if camera moved significantly AND enough time passed
    const distanceMoved = currentCameraPosition.distanceTo(lastCameraPosition.current)
    const directionChanged = tmpVec.distanceTo(lastCameraTarget.current)
    const timeSinceUpdate = currentTime - lastUpdateTime.current

    // Update if moved > 0.5m OR direction changed > 0.3 AND at least 100ms passed
    if (
      ((distanceMoved > 0.5 || directionChanged > 0.3) && timeSinceUpdate > 0.1) ||
      lastWallMode.current !== wallMode ||
      sceneRegistry.byType.wall.size !== lastNumberOfWalls.current
    ) {
      // Camera has moved, update cutout logic here

      // Update last known positions and time
      lastCameraPosition.current.copy(currentCameraPosition)
      lastCameraTarget.current.copy(tmpVec)
      lastUpdateTime.current = currentTime
      camera.getWorldDirection(u)

      const walls = sceneRegistry.byType.wall
      walls.forEach((wallId) => {
        const wallMesh = sceneRegistry.nodes.get(wallId)
        if (!wallMesh) return
        const wallNode = useScene.getState().nodes[wallId as WallNode['id']]
        if (!wallNode || wallNode.type !== 'wall') return
        let hideWall = wallNode.frontSide === 'interior' && wallNode.backSide === 'interior'

        if (wallMode === 'up') {
          hideWall = false
        } else if (wallMode === 'down') {
          hideWall = true
        } else {
          wallMesh.getWorldDirection(v) 
          if (v.dot(u) < 0) {
            // Front side
            if (wallNode.frontSide === 'exterior' && wallNode.backSide !== 'exterior') {
              hideWall = true
            }
          } else {
            // Back side
            if (wallNode.backSide === 'exterior' && wallNode.frontSide !== 'exterior') {
              hideWall = true
            }
          }
        }
        ;(wallMesh as Mesh).material = hideWall ? invsibleWallMaterial : wallMaterial
      })
      lastWallMode.current = wallMode
      lastNumberOfWalls.current = sceneRegistry.byType.wall.size
    }
  })
  return null
}
