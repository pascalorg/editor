'use client'

import { emitter, resolveLevelId, type AnyNodeId, type ItemEvent, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useRef } from 'react'
import { homeAssistantEditorStore, useHomeAssistantEditorStore } from './home-assistant-editor-store'

const HOME_ASSISTANT_PAIR_CURSOR =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 28 28'%3E%3Ccircle cx='8.5' cy='9.5' r='4.5' fill='%230b0f12' stroke='%2322d3ee' stroke-width='1.8'/%3E%3Ccircle cx='19.5' cy='18.5' r='4.5' fill='%230b0f12' stroke='%23fbbf24' stroke-width='1.8'/%3E%3Cpath d='M11.7 12.2L16.4 15.9' stroke='%23ffffff' stroke-width='1.9' stroke-linecap='round'/%3E%3Cpath d='M14.1 6.4h7.5' stroke='%2322d3ee' stroke-width='1.6' stroke-linecap='round' opacity='0.9'/%3E%3Cpath d='M6.3 20.6h7.5' stroke='%23fbbf24' stroke-width='1.6' stroke-linecap='round' opacity='0.9'/%3E%3C/svg%3E\") 8 8, crosshair"

function isPairableHomeAssistantItem(event: ItemEvent) {
  const { node } = event
  if (node.asset.category === 'door' || node.asset.category === 'window') {
    return false
  }

  const selectedLevelId = useViewer.getState().selection.levelId
  if (!selectedLevelId) {
    return true
  }

  return resolveLevelId(node, useScene.getState().nodes) === selectedLevelId
}

function clearPairPreview() {
  useViewer.getState().setPreviewSelectedIds([])
}

export function HomeAssistantPairingSystem() {
  const pairingResourceId = useHomeAssistantEditorStore((state) => state.pairingResourceId)
  const pairingOwnsInteractiveOverlayRef = useRef(false)

  useEffect(() => {
    const previousCursor = typeof document !== 'undefined' ? document.body.style.cursor : ''
    if (typeof document !== 'undefined') {
      document.body.style.cursor = pairingResourceId ? HOME_ASSISTANT_PAIR_CURSOR : previousCursor
    }

    if (pairingResourceId) {
      if (!useViewer.getState().interactiveOverlayActive) {
        useViewer.getState().setInteractiveOverlayActive(true)
        pairingOwnsInteractiveOverlayRef.current = true
      }
    } else {
      if (pairingOwnsInteractiveOverlayRef.current) {
        useViewer.getState().setInteractiveOverlayActive(false)
        pairingOwnsInteractiveOverlayRef.current = false
      }
      clearPairPreview()
    }

    return () => {
      if (typeof document !== 'undefined') {
        document.body.style.cursor = previousCursor
      }
      if (pairingOwnsInteractiveOverlayRef.current) {
        useViewer.getState().setInteractiveOverlayActive(false)
        pairingOwnsInteractiveOverlayRef.current = false
      }
    }
  }, [pairingResourceId])

  useEffect(() => {
    const onEnter = (event: ItemEvent) => {
      if (!homeAssistantEditorStore.pairingResourceId || !isPairableHomeAssistantItem(event)) {
        return
      }

      event.stopPropagation()
      useViewer.getState().setPreviewSelectedIds([event.node.id])
    }

    const onLeave = (event: ItemEvent) => {
      if (!homeAssistantEditorStore.pairingResourceId) {
        return
      }

      event.stopPropagation()
      const previewIds = useViewer.getState().previewSelectedIds
      if (previewIds.length === 1 && previewIds[0] === event.node.id) {
        clearPairPreview()
      }
    }

    const onClick = (event: ItemEvent) => {
      if (!homeAssistantEditorStore.pairingResourceId || !isPairableHomeAssistantItem(event)) {
        return
      }

      event.stopPropagation()
      homeAssistantEditorStore.setPairingTargetItemId(event.node.id as AnyNodeId)
      clearPairPreview()
    }

    const onGridClick = () => {
      if (!homeAssistantEditorStore.pairingResourceId) {
        return
      }

      homeAssistantEditorStore.setPairingResourceId(null)
      homeAssistantEditorStore.setPairingTargetItemId(null)
      clearPairPreview()
    }

    emitter.on('item:enter', onEnter)
    emitter.on('item:leave', onLeave)
    emitter.on('item:click', onClick)
    emitter.on('grid:click', onGridClick)

    return () => {
      emitter.off('item:enter', onEnter)
      emitter.off('item:leave', onLeave)
      emitter.off('item:click', onClick)
      emitter.off('grid:click', onGridClick)
      clearPairPreview()
    }
  }, [])

  return null
}
