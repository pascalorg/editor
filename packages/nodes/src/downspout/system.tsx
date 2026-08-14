'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type DownspoutNode,
  type GutterNode,
  type RoofSegmentNode,
  resolveAutomaticDownspoutLength,
  type SceneApi,
  usesAutomaticDownspoutLength,
} from '@pascal-app/core'
import { useEffect } from 'react'

function automaticLengthUpdates(nodes: Record<AnyNodeId, AnyNode>) {
  const updates: { id: AnyNodeId; data: Partial<AnyNode> }[] = []
  for (const candidate of Object.values(nodes)) {
    if (candidate.type !== 'downspout' || !usesAutomaticDownspoutLength(candidate)) continue
    const downspout = candidate as DownspoutNode
    const gutter = downspout.gutterId
      ? (nodes[downspout.gutterId as AnyNodeId] as GutterNode | undefined)
      : undefined
    const segment = gutter?.roofSegmentId
      ? (nodes[gutter.roofSegmentId as AnyNodeId] as RoofSegmentNode | undefined)
      : undefined
    const outlet = gutter?.outlets?.find((entry) => entry.id === downspout.outletId)
    if (!(gutter?.type === 'gutter' && segment?.type === 'roof-segment' && outlet)) continue
    const length = resolveAutomaticDownspoutLength(nodes, segment, gutter, outlet.offset)
    if (Math.abs(length - downspout.length) > 1e-6) {
      updates.push({ id: downspout.id as AnyNodeId, data: { length } as Partial<AnyNode> })
    }
  }
  return updates
}

export function initializeAutomaticDownspoutSync(sceneApi: SceneApi) {
  let syncing = false
  const apply = (nodes: Record<AnyNodeId, AnyNode>) => {
    const updates = automaticLengthUpdates(nodes)
    if (updates.length === 0) return
    syncing = true
    sceneApi.pauseHistory()
    try {
      sceneApi.applyChanges?.({ update: updates })
    } finally {
      sceneApi.resumeHistory()
      syncing = false
    }
  }
  apply(sceneApi.nodes() as Record<AnyNodeId, AnyNode>)
  return (
    sceneApi.subscribeNodes?.((nodes) => {
      if (!syncing) apply(nodes as Record<AnyNodeId, AnyNode>)
    }) ?? (() => {})
  )
}

const DownspoutSystem = ({ sceneApi }: { sceneApi: SceneApi }) => {
  useEffect(() => initializeAutomaticDownspoutSync(sceneApi), [sceneApi])
  return null
}

export default DownspoutSystem
