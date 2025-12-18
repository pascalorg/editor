import { useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { type Object3D, Vector2 } from 'three'
import { useEditor } from '@/hooks/use-editor'

function SelectionManager() {
  const handleNodeSelect = useEditor((state) => state.handleNodeSelect)
  const handleClear = useEditor((state) => state.handleClear)

  const controlMode = useEditor((state) => state.controlMode)

  const { camera, scene, gl, raycaster } = useThree()
  const currentFloorId = useEditor((state) => state.selectedFloorId)
  const rootId = useEditor((state) => state.scene.root.children?.[0]?.id)
  const pointerDownPos = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const targetId = rootId || currentFloorId
    if (!targetId) return

    const targetObject = scene.getObjectByName(targetId)

    const performRaycast = (event: PointerEvent) => {
      if (!targetObject) {
        console.warn(`[SelectionManager] Target object with ID ${targetId} not found in scene.`)
        return
      }
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
          return null // We don't want to deselect when we click on the controls
        }
      }

      const intersections = raycaster.intersectObject(targetObject, true)

      // Get the graph to check node visibility
      const { graph } = useEditor.getState()

      const isObjectVisible = (obj: Object3D | null) => {
        let current = obj
        while (current) {
          if (current.visible === false) return false
          current = current.parent
        }
        return true
      }

      const getNodeInfoFromIntersection = (object: Object3D) => {
        // Double-check visibility of the object hierarchy
        if (!isObjectVisible(object)) return null

        let current: Object3D | null = object
        let nodeObject: Object3D | null = null
        let depth = 0

        // First, find the immediate node object
        while (current && !current.userData?.nodeId) {
          current = current.parent
        }

        if (!current?.userData?.nodeId) return null

        nodeObject = current
        const nodeId = nodeObject.userData.nodeId

        // Check if the node is visible - skip invisible nodes
        const handle = graph.getNodeById(nodeId)
        if (handle) {
          const nodeData = handle.data() as any
          if (nodeData?.visible === false) {
            return null // Node is not visible, skip it
          }
          // Skip preview nodes
          if (nodeData?.editor?.preview) {
            return null
          }
        }

        // Now count how many node parents this node has
        current = current.parent
        while (current && current.type !== 'Scene') {
          if (current.userData?.nodeId) {
            depth++
          }
          current = current.parent
        }

        return {
          nodeId,
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
        (candidate) =>
          !(
            candidate.nodeId.startsWith('level_') ||
            candidate.nodeId.startsWith('ceiling_') ||
            candidate.nodeId.startsWith('site_')
          ),
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

      pointerDownPos.current = { x: event.clientX, y: event.clientY }
    }

    const handleClick = (event: PointerEvent) => {
      if (event.button !== 0) return // Only left-click
      if (controlMode !== 'select') return

      // Check for drag to prevent accidental selection/deselection after dragging
      if (pointerDownPos.current) {
        const dx = event.clientX - pointerDownPos.current.x
        const dy = event.clientY - pointerDownPos.current.y
        pointerDownPos.current = null
        // If moved more than 5 pixels, consider it a drag and ignore click
        if (dx * dx + dy * dy > 25) {
          return
        }
      }

      const candidates = performRaycast(event)

      // If candidates is null, it means we clicked on a UI element in the scene (like controls)
      // so we should ignore this click entirely
      if (candidates === null) return

      if (candidates && candidates.length > 0) {
        const topCandidate = candidates[0]!
        console.log('Selected nodeId:', topCandidate.nodeId, 'at depth:', topCandidate.depth)
        handleNodeSelect(topCandidate.nodeId, event)
      } else {
        // Don't clear selection if modifiers are held (user might be trying to multi-select and missed)
        if (event.shiftKey || event.metaKey || event.ctrlKey) return

        handleClear()

        // Cancel add-to-collection mode if active
        const { addToCollectionState, cancelAddToCollection } = useEditor.getState()
        if (addToCollectionState.isActive) {
          cancelAddToCollection()
        }
      }
    }

    gl.domElement.addEventListener('pointerdown', handlePointerDown)
    gl.domElement.addEventListener('click', handleClick)
    return () => {
      gl.domElement.removeEventListener('pointerdown', handlePointerDown)
      gl.domElement.removeEventListener('click', handleClick)
    }
  }, [camera, gl, raycaster, currentFloorId, rootId, handleNodeSelect, handleClear, controlMode])

  return null
}

export default SelectionManager
