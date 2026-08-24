'use client'

import {
  type AnyNode,
  type AnyNodeId,
  emitter,
  type LeanToExtensionNode,
  type SceneApi,
  sceneRegistry,
  useLiveNodeOverrides,
  type WallEvent,
  type WallNode,
} from '@pascal-app/core'
import { isGridSnapActive, triggerSFX, useEditor } from '@pascal-app/editor'
import { useEffect } from 'react'
import { resolveLeanToEdgeSnapTargets, resolveLeanToMoveProposal } from './layout'
import { leanToManagedPreviewOverrides } from './managed-preview'
import { leanToPlacementConflicts, resolveLeanToEndAbutments } from './placement-validation'

type MoveLeanToExtensionProps = {
  node: LeanToExtensionNode
  sceneApi: SceneApi
}

const MoveLeanToExtensionTool = ({ node, sceneApi }: MoveLeanToExtensionProps) => {
  useEffect(() => {
    const parent = node.parentId ? sceneApi.get(node.parentId as AnyNodeId) : undefined
    if (parent?.type !== 'wall') return
    const wall = parent as WallNode
    let lastPatch: Partial<LeanToExtensionNode> | null = null
    let dragStartLocalY: number | null = null
    const previewIds = new Set<AnyNodeId>()
    const movedObject = sceneRegistry.nodes.get(node.id)
    const restoreRaycasts: Array<() => void> = []
    movedObject?.traverse((child) => {
      const original = child.raycast
      child.raycast = () => {}
      restoreRaycasts.push(() => {
        child.raycast = original
      })
    })

    const resolvePatch = (event: WallEvent) => {
      if (event.node.id !== wall.id) return null
      dragStartLocalY ??= event.localPosition[1]
      const rawLocalX = event.localPosition[0]
      const rawHighEdgeHeight = Math.max(
        0.8,
        Math.min(10, node.highEdgeHeight + event.localPosition[1] - dragStartLocalY),
      )
      const gridStep =
        !event.nativeEvent.altKey && isGridSnapActive() ? useEditor.getState().gridSnapStep : 0
      const nodes = sceneApi.nodes() as Record<AnyNodeId, AnyNode>
      const proposal = resolveLeanToMoveProposal({
        node,
        wall,
        rawLocalX,
        rawHighEdgeHeight,
        snapStep: gridStep,
        edgeSnapTargets: event.nativeEvent.altKey
          ? []
          : resolveLeanToEdgeSnapTargets(node, wall, nodes),
      })
      const position: LeanToExtensionNode['position'] = [
        proposal.centerX,
        node.position[1],
        node.position[2],
      ]
      const connectionOffset =
        node.connectionMode === 'auto'
          ? Math.max(
              -1,
              Math.min(1, node.connectionOffset + proposal.highEdgeHeight - node.highEdgeHeight),
            )
          : node.connectionOffset
      const candidate = resolveLeanToEndAbutments(
        {
          ...node,
          position,
          highEdgeHeight: proposal.highEdgeHeight,
          lowEdgeHeight: proposal.lowEdgeHeight,
          connectionOffset,
          autoSpan: false,
        },
        wall,
        nodes,
      )
      const patch: Partial<LeanToExtensionNode> = {
        position,
        highEdgeHeight: proposal.highEdgeHeight,
        lowEdgeHeight: proposal.lowEdgeHeight,
        connectionOffset,
        autoSpan: false,
        leftEndCondition: candidate.leftEndCondition,
        rightEndCondition: candidate.rightEndCondition,
        downspoutPosition: candidate.downspoutPosition,
      }
      const previewEntries: ReadonlyArray<readonly [AnyNodeId, Partial<AnyNode>]> = [
        [node.id as AnyNodeId, patch as Partial<AnyNode>],
        ...leanToManagedPreviewOverrides(node, patch, sceneApi),
      ]
      useLiveNodeOverrides.getState().setMany(previewEntries)
      for (const [id] of previewEntries) {
        previewIds.add(id)
        sceneApi.markDirty(id)
      }
      lastPatch =
        event.nativeEvent.altKey || leanToPlacementConflicts(candidate, wall, nodes).length === 0
          ? patch
          : null
      return lastPatch
    }

    const onMove = (event: WallEvent) => {
      resolvePatch(event)
    }
    const onClick = (event: WallEvent) => {
      const patch = resolvePatch(event)
      if (!patch) return
      event.stopPropagation()
      for (const id of previewIds) useLiveNodeOverrides.getState().clear(id)
      sceneApi.update(node.id as AnyNodeId, patch as Partial<AnyNode>)
      triggerSFX('sfx:structure-build')
      useEditor.getState().setMovingNode(null)
    }

    emitter.on('wall:move', onMove)
    emitter.on('wall:enter', onMove)
    emitter.on('wall:click', onClick)
    return () => {
      emitter.off('wall:move', onMove)
      emitter.off('wall:enter', onMove)
      emitter.off('wall:click', onClick)
      for (const id of previewIds) {
        useLiveNodeOverrides.getState().clear(id)
        sceneApi.markDirty(id)
      }
      for (const restore of restoreRaycasts) restore()
      lastPatch = null
    }
  }, [node, sceneApi])

  return null
}

export default MoveLeanToExtensionTool
