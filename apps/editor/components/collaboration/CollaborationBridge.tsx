'use client'

import { useEffect, useRef } from 'react'
import { useScene, type SceneState } from '@pascal-app/core'
import { getSocket, joinProject } from '@/lib/socket'

interface Props {
  projectId: string
  userId: string
}

export function CollaborationBridge({ projectId, userId }: Props) {
  const isRemoteChange = useRef(false)

  useEffect(() => {
    const socket = getSocket()
    joinProject(projectId)

    // 1. Listen for remote changes
    socket.on('node-update', (data) => {
      if (data.projectId !== projectId) return
      isRemoteChange.current = true
      useScene.getState().updateNode(data.nodeId, data.updates)
      isRemoteChange.current = false
    })

    socket.on('node-create', (data) => {
      if (data.projectId !== projectId) return
      isRemoteChange.current = true
      useScene.getState().createNode(data.node, data.parentId)
      isRemoteChange.current = false
    })

    socket.on('node-delete', (data) => {
      if (data.projectId !== projectId) return
      isRemoteChange.current = true
      useScene.getState().deleteNode(data.nodeId)
      isRemoteChange.current = false
    })

    // 2. Subscribe to local changes and emit
    const unsub = useScene.subscribe((state: SceneState, prevState: SceneState) => {
      if (isRemoteChange.current) return

      // Find what changed
      // This is a simplified diff. In a real app, we'd use a more robust way to detect the specific action.
      // For now, we'll use a simple strategy: check nodes count and then individual nodes.
      
      const currNodes = state.nodes
      const prevNodes = prevState.nodes

      // Check for updates
      for (const id in currNodes) {
        if (prevNodes[id] && currNodes[id] !== prevNodes[id]) {
          // Node updated
          socket.emit('node-update', {
            projectId,
            nodeId: id,
            updates: currNodes[id] // Or a real diff
          })
        }
      }

      // Check for creations
      for (const id in currNodes) {
        if (!prevNodes[id]) {
          socket.emit('node-create', {
            projectId,
            node: currNodes[id],
            parentId: currNodes[id].parentId
          })
        }
      }

      // Check for deletions
      for (const id in prevNodes) {
        if (!currNodes[id]) {
          socket.emit('node-delete', {
            projectId,
            nodeId: id
          })
        }
      }
    })

    return () => {
      unsub()
      socket.off('node-update')
      socket.off('node-create')
      socket.off('node-delete')
    }
  }, [projectId])

  return null
}
