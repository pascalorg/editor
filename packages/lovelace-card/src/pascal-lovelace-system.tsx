'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type Collection,
  getHomeAssistantBindingNodeMap,
  useInteractive,
  useScene,
} from '@pascal-app/core'
import { useEffect, useMemo } from 'react'
import { useViewer } from '@pascal-app/viewer'
import { summarizeBindingControl } from './artifact'
import type { HomeAssistantLike } from './types'

const ACTIVE_DOMAINS = new Set(['fan', 'light', 'media_player', 'switch'])

function getResourceDomain(resourceId: string | null | undefined) {
  return typeof resourceId === 'string' ? resourceId.split('.', 1)[0] : null
}

function getCollectionAnchorItemIds(
  collection: Collection | undefined,
  sceneNodes: Record<AnyNodeId, AnyNode>,
) {
  const candidateIds = collection?.controlNodeId
    ? [collection.controlNodeId, ...collection.nodeIds]
    : (collection?.nodeIds ?? [])

  return Array.from(new Set(candidateIds)).filter((nodeId): nodeId is AnyNodeId => {
    const node = sceneNodes[nodeId as AnyNodeId]
    return node?.type === 'item'
  })
}

function getInteractiveControlIndexes(node: AnyNode | undefined) {
  if (node?.type !== 'item') {
    return { brightness: -1, toggle: -1 }
  }

  const controls = node.asset.interactive?.controls ?? []
  return {
    brightness: controls.findIndex((control) => control.kind === 'slider'),
    toggle: controls.findIndex((control) => control.kind === 'toggle'),
  }
}

export function PascalLovelaceHomeAssistantSystem({
  hass,
}: {
  hass: HomeAssistantLike | null
}) {
  const sceneNodes = useScene((state) => state.nodes)
  const collections = useScene((state) => state.collections)
  const setControlValue = useInteractive((state) => state.setControlValue)
  const bindings = useMemo(() => getHomeAssistantBindingNodeMap(sceneNodes), [sceneNodes])

  const controls = useMemo(
    () =>
      Object.values(bindings).map((binding) =>
        summarizeBindingControl(hass, collections, binding),
      ),
    [bindings, collections, hass],
  )

  useEffect(() => {
    const viewer = useViewer.getState()
    for (const control of controls) {
      const collection = collections[control.binding.collectionId]
      const anchorIds = getCollectionAnchorItemIds(collection, sceneNodes)
      const domain = getResourceDomain(control.state.primaryEntityId)

      for (const itemId of anchorIds) {
        const { brightness, toggle } = getInteractiveControlIndexes(sceneNodes[itemId])
        if (toggle >= 0) {
          setControlValue(itemId, toggle, control.state.isOn)
        }
        if (brightness >= 0 && typeof control.state.brightnessPct === 'number') {
          setControlValue(itemId, brightness, control.state.brightnessPct)
        }

        if (domain === 'media_player' || ACTIVE_DOMAINS.has(domain ?? '')) {
          if (control.state.isOn) {
            viewer.triggerItemEffect(itemId)
          } else {
            viewer.clearItemEffect(itemId)
          }
        }
      }
    }
  }, [collections, controls, sceneNodes, setControlValue])

  return null
}
