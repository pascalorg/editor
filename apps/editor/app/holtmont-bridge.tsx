'use client'

import { useScene } from '@pascal-app/core'
import { useEffect } from 'react'

export function HoltmontBridge() {
  useEffect(() => {
    const isIframe = window.parent !== window.self

    function postToParent(payload: Record<string, unknown>) {
      if (isIframe) {
        window.parent.postMessage(payload, '*')
      }
    }

    function handleMessage(event: MessageEvent) {
      const data = event.data as Record<string, unknown> | null
      if (!data || data.type !== 'HOLTMONT_3D_IMPORT') return

      try {
        const projectData = data.projectData as Record<string, unknown> | undefined
        if (!projectData?.nodes) {
          console.warn('[HoltmontBridge] HOLTMONT_3D_IMPORT: missing projectData.nodes — ignored')
          return
        }

        const nodes = projectData.nodes as Record<string, unknown>
        const rootNodeIds = Array.isArray(projectData.rootNodeIds)
          ? (projectData.rootNodeIds as string[])
          : []
        const collections =
          projectData.collections && typeof projectData.collections === 'object'
            ? (projectData.collections as Record<string, unknown>)
            : {}

        console.log('[HoltmontBridge] Received HOLTMONT_3D_IMPORT:', {
          nodeCount: Object.keys(nodes).length,
          rootNodeIds,
        })

        // setScene runs migrations, removes orphans, marks all nodes dirty, notifies subscribers
        useScene.getState().setScene(nodes as any, rootNodeIds)

        // setScene always resets collections to {}; restore them if present
        if (Object.keys(collections).length > 0) {
          useScene.setState({ collections: collections as any })
        }

        console.log('[HoltmontBridge] Scene applied — sending HOLTMONT_3D_IMPORT_ACK')
        postToParent({ type: 'HOLTMONT_3D_IMPORT_ACK' })
      } catch (err) {
        console.error('[HoltmontBridge] Failed to apply imported scene:', err)
      }
    }

    window.addEventListener('message', handleMessage)

    // Signal to parent that the editor is ready to receive scenes
    postToParent({ type: 'PASCAL_READY' })
    console.log('[HoltmontBridge] Listener mounted — PASCAL_READY sent')

    return () => {
      window.removeEventListener('message', handleMessage)
    }
  }, [])

  return null
}
