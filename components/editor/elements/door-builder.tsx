'use client'

import { emitter, type GridEvent, type WallEvent } from '@/events/bus'
import { type DoorNode, useEditor } from '@/hooks/use-editor'
import { canPlaceGridItemOnWall } from '@/lib/utils'
import { useEffect } from 'react'

export function DoorBuilder() {
  const addNode = useEditor((state) => state.addNode)
  const updateNode = useEditor((state) => state.updateNode)
  const deleteNode = useEditor((state) => state.deleteNode)
  const selectedFloorId = useEditor((state) => state.selectedFloorId)

  useEffect(() => {
    if (!selectedFloorId) return // Only register events if a floor is selected

    let ignoreGridMove = false
    let previewDoor: DoorNode | null = null
    let lastPosition: [number, number] | null = null
    let lastRotation = 0
    let canPlace = false

    const handleWallClick = (e: WallEvent) => {
      if (previewDoor && canPlace) {
        // Commit the door placement
        updateNode(previewDoor.id, {
          preview: false,
          name: 'Door',
        })
        previewDoor = null
      }
    }

    const handleGridMove = (e: GridEvent) => {
      if (ignoreGridMove) {
        return
      }
      if (lastPosition && lastPosition[0] === e.position[0] && lastPosition[1] === e.position[1]) {
        return // Avoid computing for same position
      }

      const [x, y] = e.position
      lastPosition = [x, y]
      canPlace = false
      if (previewDoor) {
        previewDoor.position = [x, y]
        previewDoor.rotation = lastRotation

        updateNode(previewDoor.id, previewDoor)
      } else {
        previewDoor = {
          type: 'door',
          name: 'Door Preview',
          position: [x, y],
          rotation: lastRotation,
          size: [1, 2] as [number, number],
          visible: true,
          opacity: 100,
          preview: true,
          children: [],
          canPlace,
        } as DoorNode
        previewDoor.id = addNode(
          previewDoor,
          selectedFloorId, // Parent is either wall or level
        )
      }
    }

    const handleWallEnter = (e: WallEvent) => {
      if (previewDoor) {
        deleteNode(previewDoor.id)
      }
      ignoreGridMove = true
      lastRotation = e.node.rotation
      previewDoor = {
        parent: e.node.id,
        type: 'door',
        name: 'Door Preview',
        position: [e.gridPosition.x, e.gridPosition.z],
        rotation: e.node.rotation,
        size: [1, 2] as [number, number],
        visible: true,
        opacity: 100,
        preview: true,
        children: [],
        canPlace,
      } as DoorNode
      canPlace = canPlaceGridItemOnWall(e.node, previewDoor, 2)
      previewDoor.canPlace = canPlace
      previewDoor.id = addNode(
        previewDoor,
        e.node.id, // Parent is either wall or level
      )
    }

    const handleWallMove = (e: WallEvent) => {
      if (
        lastPosition &&
        lastPosition[0] === e.gridPosition.x &&
        lastPosition[1] === e.gridPosition.z
      ) {
        return // Avoid computing for same position
      }

      ignoreGridMove = true
      if (previewDoor && e.node.id !== previewDoor.parent) {
        // Wall changed, remove old preview
        deleteNode(previewDoor.id)
        previewDoor = null
      }
      lastPosition = [e.gridPosition.x, e.gridPosition.z]
      if (previewDoor) {
        previewDoor.position = [e.gridPosition.x, e.gridPosition.z]
        previewDoor.rotation = e.node.rotation
        canPlace = canPlaceGridItemOnWall(e.node, previewDoor, 2)
        previewDoor.canPlace = canPlace
        updateNode(previewDoor.id, previewDoor)
      } else {
        previewDoor = {
          parent: e.node.id,
          type: 'door',
          name: 'Door Preview',
          position: [e.gridPosition.x, e.gridPosition.z],
          rotation: e.node.rotation,
          size: [1, 2] as [number, number],
          visible: true,
          opacity: 100,
          preview: true,
          children: [],
          canPlace: true,
        } as DoorNode

        canPlace = canPlaceGridItemOnWall(e.node, previewDoor, 2)
        previewDoor.canPlace = canPlace
        previewDoor.id = addNode(
          previewDoor,
          e.node.id, // Parent is either wall or level
        )
      }
    }

    const handleWallLeave = (e: WallEvent) => {
      if (previewDoor) {
        deleteNode(previewDoor.id)
        previewDoor = null
      }
      ignoreGridMove = false
    }

    // Register event listeners
    emitter.on('wall:click', handleWallClick)
    emitter.on('grid:move', handleGridMove)
    emitter.on('wall:enter', handleWallEnter)
    emitter.on('wall:move', handleWallMove)
    emitter.on('wall:leave', handleWallLeave)

    // Cleanup event listeners
    return () => {
      emitter.off('wall:click', handleWallClick)
      emitter.off('grid:move', handleGridMove)
      emitter.off('wall:enter', handleWallEnter)
      emitter.off('wall:move', handleWallMove)
      emitter.off('wall:leave', handleWallLeave)

      if (previewDoor) {
        deleteNode(previewDoor.id)
        previewDoor = null
      }
    }
  }, [addNode, updateNode, deleteNode, selectedFloorId])

  return <></>
}
