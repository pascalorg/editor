import { useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { type Object3D, Vector2 } from 'three'
import { useEditor } from '@/hooks/use-editor'
import type { AnyNodeId } from '@/lib/scenegraph/schema/index'

function SelectionManager() {
  const handleNodeSelect = useEditor((state) => state.handleNodeSelect)
  const handleClear = useEditor((state) => state.handleClear)

  const controlMode = useEditor((state) => state.controlMode)

  const { camera, scene, gl, raycaster } = useThree()
  const currentFloorId = useEditor((state) => state.selectedFloorId)

  const currentFloor = useMemo(
    () => (currentFloorId ? scene.getObjectByName(currentFloorId) : null),
    [scene, currentFloorId],
  )

  useEffect(() => {
    if (!currentFloor) return

    const performRaycast = (event: PointerEvent) => {
      // Convert to NDC coordinates
      const rect = gl.domElement.getBoundingClientRect()
      const x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      const y = -((event.clientY - rect.top) / rect.height) * 2 + 1

      // Single raycast on click
      raycaster.setFromCamera(new Vector2(x, y), camera)

      // Prevent selecting when clicking on selection controls
      const selectionControls = scene.getObjectByName('selection-controls')
      if (selectionControls) {
        const selectionControlsIntersection = raycaster.intersectObject(selectionControls, true)
        if (selectionControlsIntersection.length > 0) {
          // Clicked on selection controls, ignore
          return
        }
      }

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

      const allCandidates = intersections
        .map((hit) => {
          const nodeInfo = getNodeInfoFromIntersection(hit.object)
          return nodeInfo ? { ...nodeInfo, distance: hit.distance } : null
        })
        .filter(Boolean)

      // Deduplicate by nodeId, keeping only the closest hit for each node
      const candidatesByNode = new Map<
        string,
        { nodeId: string; depth: number; distance: number }
      >()

      for (const candidate of allCandidates) {
        if (!candidate) continue

        const existing = candidatesByNode.get(candidate.nodeId)
        if (!existing || candidate.distance < existing.distance) {
          candidatesByNode.set(candidate.nodeId, candidate)
        }
      }

      // Convert back to array and filter out level nodes
      const candidates = Array.from(candidatesByNode.values()).filter(
        (candidate) => !candidate.nodeId.startsWith('level_'),
      )

      // Sort by distance first, then by depth if distances are very close
      candidates.sort((a, b) => {
        const distanceDiff = a.distance - b.distance

        // If distance difference is less than 0.5, use depth to break the tie
        if (Math.abs(distanceDiff) < 0.5) {
          return b.depth - a.depth // Deeper nodes first
        }

        return distanceDiff // Closer nodes first
      })

      return candidates
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return // Only left-click
      if (controlMode !== 'select') return

      const candidates = performRaycast(event)

      if (candidates.length > 0) {
        const topCandidate = candidates[0]!
        console.log('Selected nodeId:', topCandidate.nodeId, 'at depth:', topCandidate.depth)
        handleNodeSelect(topCandidate.nodeId, event)
      }
    }

    const handleClick = (event: PointerEvent) => {
      if (event.button !== 0) return // Only left-click
      if (controlMode !== 'select') return

      // Don't clear selection if modifiers are held (user might be trying to multi-select and missed)
      if (event.shiftKey || event.metaKey || event.ctrlKey) return

      const candidates = performRaycast(event)

      // If we didn't hit any selectable node, clear the selection
      if (candidates.length === 0) {
        handleClear()
      }
    }

    gl.domElement.addEventListener('pointerdown', handlePointerDown)
    gl.domElement.addEventListener('click', handleClick)
    return () => {
      gl.domElement.removeEventListener('pointerdown', handlePointerDown)
      gl.domElement.removeEventListener('click', handleClick)
    }
  }, [camera, gl, raycaster, currentFloor, handleNodeSelect, handleClear, controlMode])

  return null
}

export default SelectionManager
