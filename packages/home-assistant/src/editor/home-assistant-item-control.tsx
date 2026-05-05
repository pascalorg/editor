'use client'

import type { ItemNode } from '@pascal-app/core'
import type { MouseEventHandler } from 'react'
import { useCallback, useMemo } from 'react'
import { getHomeAssistantLink } from '../home-assistant'
import { HomeAssistantActionIconView } from '../components/home-assistant-action-icon'
import { useHomeAssistantEditorStore } from './home-assistant-editor-store'
import { HomeAssistantConnectivityPanel } from './home-assistant-connectivity-panel'

export function useHomeAssistantItemControl(item: ItemNode | null | undefined) {
  const controlItemId = useHomeAssistantEditorStore((state) => state.controlItemId)
  const setControlItemId = useHomeAssistantEditorStore((state) => state.setControlItemId)
  const link = useMemo(() => (item ? getHomeAssistantLink(item.metadata) : null), [item])
  const isLinked = Boolean(item && link?.haEntityId)
  const isOpen = Boolean(isLinked && item && controlItemId === item.id)

  const close = useCallback(() => {
    setControlItemId(null)
  }, [setControlItemId])

  const toggle = useCallback<MouseEventHandler<HTMLButtonElement>>(
    (event) => {
      event.stopPropagation()
      if (!(item && link?.haEntityId)) {
        return
      }

      setControlItemId(controlItemId === item.id ? null : String(item.id))
    },
    [controlItemId, item, link, setControlItemId],
  )

  return {
    actionIcon: isLinked ? <HomeAssistantActionIconView icon="connectivity" /> : undefined,
    actionLabel: isLinked ? 'Home Assistant' : undefined,
    onAction: isLinked ? toggle : undefined,
    panel:
      isOpen && item && link ? (
        <HomeAssistantConnectivityPanel item={item} link={link} onClose={close} />
      ) : null,
  }
}
