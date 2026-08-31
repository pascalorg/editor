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

const BROAD_AUTOMATIC_LENGTH_DEPENDENCY_TYPES = new Set<AnyNode['type']>([
  'site',
  'building',
  'level',
  'wall',
  'lean-to-extension',
  'roof',
])

function affectedAutomaticDownspoutIds(
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  previous: Readonly<Record<AnyNodeId, AnyNode>>,
  changedIds: ReadonlySet<AnyNodeId>,
  automaticIds: ReadonlySet<AnyNodeId>,
): Set<AnyNodeId> {
  const affected = new Set<AnyNodeId>()
  for (const id of changedIds) {
    const current = nodes[id]
    const prior = previous[id]
    if (current?.type === 'downspout' && usesAutomaticDownspoutLength(current)) affected.add(id)
    if (prior?.type === 'downspout') affected.add(id)
    const candidate = current ?? prior
    if (!candidate) continue
    if (BROAD_AUTOMATIC_LENGTH_DEPENDENCY_TYPES.has(candidate.type)) {
      for (const automaticId of automaticIds) affected.add(automaticId)
      continue
    }
    if (candidate.type === 'gutter' || candidate.type === 'roof-segment') {
      const segmentId =
        candidate.type === 'roof-segment'
          ? candidate.id
          : (candidate.parentId ?? candidate.roofSegmentId)
      const segment = segmentId
        ? ((nodes[segmentId as AnyNodeId] ?? previous[segmentId as AnyNodeId]) as
            | RoofSegmentNode
            | undefined)
        : undefined
      for (const childId of segment?.children ?? []) {
        const child = nodes[childId as AnyNodeId] ?? previous[childId as AnyNodeId]
        if (child?.type === 'downspout') affected.add(child.id as AnyNodeId)
      }
    }
  }
  return affected
}

function automaticLengthUpdates(
  nodes: Record<AnyNodeId, AnyNode>,
  candidateIds: Iterable<AnyNodeId>,
) {
  const updates: { id: AnyNodeId; data: Partial<AnyNode> }[] = []
  for (const id of candidateIds) {
    const candidate = nodes[id]
    if (candidate?.type !== 'downspout' || !usesAutomaticDownspoutLength(candidate)) continue
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
  const applyChanges = sceneApi.applyChanges
  const subscribeNodes = sceneApi.subscribeNodes
  if (!(applyChanges && subscribeNodes)) return () => {}
  const automaticIds = new Set<AnyNodeId>()
  for (const node of Object.values(sceneApi.nodes())) {
    if (node.type === 'downspout' && usesAutomaticDownspoutLength(node)) {
      automaticIds.add(node.id as AnyNodeId)
    }
  }
  let syncing = false
  const apply = (nodes: Record<AnyNodeId, AnyNode>, candidateIds: Iterable<AnyNodeId>) => {
    const updates = automaticLengthUpdates(nodes, candidateIds)
    if (updates.length === 0) return
    syncing = true
    sceneApi.pauseHistory()
    try {
      applyChanges({ update: updates })
    } finally {
      sceneApi.resumeHistory()
      syncing = false
    }
  }
  apply(sceneApi.nodes() as Record<AnyNodeId, AnyNode>, automaticIds)
  return subscribeNodes((nodes, previous, changedIds) => {
    if (syncing) return
    for (const id of changedIds) {
      const node = nodes[id]
      if (node?.type === 'downspout' && usesAutomaticDownspoutLength(node)) automaticIds.add(id)
      else if (previous[id]?.type === 'downspout') automaticIds.delete(id)
    }
    const affected = affectedAutomaticDownspoutIds(nodes, previous, changedIds, automaticIds)
    if (affected.size > 0) apply(nodes as Record<AnyNodeId, AnyNode>, affected)
  })
}

const DownspoutSystem = ({ sceneApi }: { sceneApi: SceneApi }) => {
  useEffect(() => initializeAutomaticDownspoutSync(sceneApi), [sceneApi])
  return null
}

export default DownspoutSystem
