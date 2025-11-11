import { useEditor } from '@/hooks/use-editor'
import { useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { type Object3D, Vector2 } from 'three'

function SelectionManager() {
  const handleElementSelect = useEditor((state) => state.handleElementSelect)

  const controlMode = useEditor((state) => state.controlMode)

  const { camera, scene, gl, raycaster } = useThree()
  const currentFloorId = useEditor((state) => state.selectedFloorId)

  const currentFloor = useMemo(
    () => (currentFloorId ? scene.getObjectByName(currentFloorId) : null),
    [scene, currentFloorId],
  )

  useEffect(() => {
    if (!currentFloor) return
    const handlePointerDown = (event: PointerEvent) => {
      // Convert to NDC coordinates
      const rect = gl.domElement.getBoundingClientRect()
      const x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      const y = -((event.clientY - rect.top) / rect.height) * 2 + 1

      // Single raycast on click
      raycaster.setFromCamera(new Vector2(x, y), camera)
      const intersections = raycaster.intersectObject(currentFloor, true)

      const getNodeInfoFromIntersection = (object: Object3D) => {
        let current: Object3D | null = object
        let nodeObject: Object3D | null = null
        let depth = 0

        // First, find the immediate node object
        while (current && !current.userData?.nodeId) {
          current = current.parent
        }

        if (!current?.userData?.nodeId) return null

        nodeObject = current

        // Now count how many node parents this node has
        current = current.parent
        while (current && current.type !== 'Scene') {
          if (current.userData?.nodeId) {
            depth++
          }
          current = current.parent
        }

        return {
          nodeId: nodeObject.userData.nodeId,
          depth,
        }
      }

      // Then in your click handler
      const candidates = intersections
        .map((hit) => {
          const nodeInfo = getNodeInfoFromIntersection(hit.object)
          return nodeInfo ? { ...nodeInfo, distance: hit.distance } : null
        })
        .filter(Boolean)

      // Then sort by depth (descending) and distance (ascending)
      candidates.sort((a, b) => {
        if (b!.depth !== a!.depth) {
          return b!.depth - a!.depth // Deeper nodes first
        }
        return a!.distance - b!.distance // Closer nodes first
      })

      if (candidates.length > 0) {
        const topCandidate = candidates[0]!
        console.log('Selected nodeId:', topCandidate.nodeId, 'at depth:', topCandidate.depth)
        handleElementSelect(topCandidate.nodeId, event)
      }
      // Process intersections...
    }

    gl.domElement.addEventListener('pointerdown', handlePointerDown)
    return () => gl.domElement.removeEventListener('pointerdown', handlePointerDown)
  }, [camera, scene, gl, raycaster, currentFloor, handleElementSelect])

  return null
}

export default SelectionManager
