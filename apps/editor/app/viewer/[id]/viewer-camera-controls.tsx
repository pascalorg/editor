'use client'

import { sceneRegistry, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { CameraControls, CameraControlsImpl } from '@react-three/drei'
import { useEffect, useMemo, useRef } from 'react'
import { Box3, Vector3 } from 'three'

const tempBox = new Box3()
const tempCenter = new Vector3()
const tempSize = new Vector3()

export const ViewerCameraControls = () => {
  const controls = useRef<CameraControlsImpl>(null!)
  const selection = useViewer((s) => s.selection)
  const nodes = useScene((s) => s.nodes)
  const cameraMode = useViewer((s) => s.cameraMode)
  const firstLoad = useRef(true)

  // Get the deepest selected node ID (excluding selectedIds)
  const targetNodeId = selection.zoneId ?? selection.levelId ?? selection.buildingId

  // Configure mouse buttons - same as editor
  const mouseButtons = useMemo(() => {
    const wheelAction =
      cameraMode === 'orthographic'
        ? CameraControlsImpl.ACTION.ZOOM
        : CameraControlsImpl.ACTION.DOLLY

    return {
      left: CameraControlsImpl.ACTION.NONE,
      middle: CameraControlsImpl.ACTION.SCREEN_PAN,
      right: CameraControlsImpl.ACTION.ROTATE,
      wheel: wheelAction,
    }
  }, [cameraMode])

  useEffect(() => {
    if (!controls.current) return

    // On first load, set a default camera position
    if (firstLoad.current) {
      firstLoad.current = false
      controls.current.setLookAt(30, 30, 30, 0, 0, 0, false)
    }

    if (!targetNodeId) return

    const node = nodes[targetNodeId]
    if (!node) return

    // Check if node has a saved camera
    if (node.camera) {
      const { position, target } = node.camera
      controls.current.setLookAt(
        position[0],
        position[1],
        position[2],
        target[0],
        target[1],
        target[2],
        true
      )
      return
    }

    // Calculate camera position based on the node's 3D object
    const object3D = sceneRegistry.nodes.get(targetNodeId)
    if (!object3D) return

    // Compute bounding box
    tempBox.setFromObject(object3D)
    tempBox.getCenter(tempCenter)
    tempBox.getSize(tempSize)

    // Calculate a good viewing distance based on the object size
    const maxDim = Math.max(tempSize.x, tempSize.y, tempSize.z)
    const distance = Math.max(maxDim * 2, 15)

    // Position camera at an angle looking at the center
    const cameraPos = new Vector3(
      tempCenter.x + distance * 0.7,
      tempCenter.y + distance * 0.5,
      tempCenter.z + distance * 0.7
    )

    controls.current.setLookAt(
      cameraPos.x,
      cameraPos.y,
      cameraPos.z,
      tempCenter.x,
      tempCenter.y,
      tempCenter.z,
      true
    )
  }, [targetNodeId, nodes])

  return (
    <CameraControls
      ref={controls}
      maxDistance={100}
      minDistance={5}
      maxPolarAngle={Math.PI / 2 - 0.1}
      minPolarAngle={0}
      mouseButtons={mouseButtons}
    />
  )
}
