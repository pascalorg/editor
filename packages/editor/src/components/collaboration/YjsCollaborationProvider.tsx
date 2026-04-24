'use client'

import { createContext, useContext, useEffect, useMemo, ReactNode } from 'react'
import * as Y from 'yjs'
import * as AwarenessProtocol from 'y-protocols/awareness'
import { bindSceneStoreToYjs } from '@pascal-app/core'

interface CollaborationContextType {
  doc: Y.Doc
  awareness: AwarenessProtocol.Awareness
}

const CollaborationContext = createContext<CollaborationContextType | null>(null)

export const useCollaboration = () => {
  const context = useContext(CollaborationContext)
  if (!context) {
    throw new Error('useCollaboration must be used within a YjsCollaborationProvider')
  }
  return context
}

interface Props {
  projectId: string
  userId: string
  userName?: string
  userColor?: string
  socket: any
  children?: ReactNode
}

export function YjsCollaborationProvider({ 
  projectId, 
  userId, 
  userName = 'User', 
  userColor = '#6366f1',
  socket,
  children
}: Props) {
  const doc = useMemo(() => new Y.Doc(), [projectId])
  const awareness = useMemo(() => new AwarenessProtocol.Awareness(doc), [doc])

  useEffect(() => {
    if (!socket || !projectId) return

    console.log('[Collaboration] Connecting to project:', projectId)

    // 1. Bind Zustand to Yjs
    const unbind = bindSceneStoreToYjs(doc)

    // 2. Handle Socket.io Transport for Yjs
    const onSyncStep1 = (serverStateVector: Uint8Array) => {
      console.log('[Collaboration] Received sync-step-1 from server')
      
      // A. Send client's missing data to the server
      const clientUpdate = Y.encodeStateAsUpdate(doc, new Uint8Array(serverStateVector))
      socket.emit('yjs-update', clientUpdate)

      // B. Ask server for missing data by sending client's state vector
      const clientStateVector = Y.encodeStateVector(doc)
      socket.emit('yjs-sync-step-1', clientStateVector)
    }

    const onSyncStep2 = (update: Uint8Array) => {
      console.log('[Collaboration] Received sync-step-2 (initial state) from server')
      Y.applyUpdate(doc, new Uint8Array(update), 'remote')
    }

    const onUpdate = (update: Uint8Array) => {
      console.log('[Collaboration] Received real-time update from server')
      Y.applyUpdate(doc, new Uint8Array(update), 'remote')
    }

    const onAwarenessUpdate = (update: Uint8Array) => {
      AwarenessProtocol.applyAwarenessUpdate(awareness, new Uint8Array(update), 'remote')
    }

    socket.on('yjs-sync-step-1', onSyncStep1)
    socket.on('yjs-sync-step-2', onSyncStep2)
    socket.on('yjs-update', onUpdate)
    socket.on('awareness-update', onAwarenessUpdate)

    // Send local updates to server
    doc.on('update', (update, origin) => {
      if (origin !== 'remote') {
        console.log('[Collaboration] Sending local update to server')
        socket.emit('yjs-update', update)
      }
    })

    awareness.on('update', ({ added, updated, removed }) => {
      const changedClients = added.concat(updated).concat(removed)
      const update = AwarenessProtocol.encodeAwarenessUpdate(awareness, changedClients)
      socket.emit('awareness-update', update)
    })

    // Join room and start sync
    socket.emit('join-project', projectId)

    // Set local awareness state
    awareness.setLocalStateField('user', {
      userId,
      name: userName,
      color: userColor,
      cursor: [0, 0, 0], // Default cursor
    })

    return () => {
      unbind()
      socket.off('yjs-sync-step-1')
      socket.off('yjs-sync-step-2')
      socket.off('yjs-update')
      socket.off('awareness-update')
      doc.destroy()
      awareness.destroy()
    }
  }, [doc, awareness, socket, projectId, userId, userName, userColor])

  const value = useMemo(() => ({ doc, awareness }), [doc, awareness])

  return (
    <CollaborationContext.Provider value={value}>
      {children}
    </CollaborationContext.Provider>
  )
}
