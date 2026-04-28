'use client'

import { type ItemNode, useInteractive, useScene } from '@pascal-app/core'
import { useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'

export const InteractiveSystem = () => {
  const interactiveNodes = useScene(
    useShallow((state) =>
      Object.values(state.nodes).filter(
        (node): node is ItemNode =>
          node.type === 'item' && (node.asset.interactive?.controls?.length ?? 0) > 0,
      ),
    ),
  )
  const initItem = useInteractive((state) => state.initItem)

  useEffect(() => {
    for (const node of interactiveNodes) {
      const interactive = node.asset.interactive
      const controls = interactive?.controls ?? []
      if (interactive && controls.length > 0) {
        initItem(node.id, interactive)
      }
    }
  }, [initItem, interactiveNodes])

  return null
}
