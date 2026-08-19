'use client'

import {
  type AnyNode,
  type AnyNodeId,
  emitter,
  type LeanToExtensionNode,
  type SceneApi,
  useLiveNodeOverrides,
  type WallEvent,
  type WallNode,
} from '@pascal-app/core'
import { isGridSnapActive, triggerSFX, useEditor } from '@pascal-app/editor'
import { useEffect } from 'react'
import { resolveLeanToEdgeSnapTargets, resolveLeanToMoveCenterX } from './layout'
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

    const resolvePatch = (event: WallEvent) => {
      if (event.node.id !== wall.id) return null
      const rawLocalX = event.localPosition[0]
      const gridStep =
        !event.nativeEvent.altKey && isGridSnapActive() ? useEditor.getState().gridSnapStep : 0
      const nodes = sceneApi.nodes() as Record<AnyNodeId, AnyNode>
      const position: LeanToExtensionNode['position'] = [
        resolveLeanToMoveCenterX(
          node,
          wall,
          rawLocalX,
          gridStep,
          event.nativeEvent.altKey ? [] : resolveLeanToEdgeSnapTargets(node, wall, nodes),
        ),
        node.position[1],
        node.position[2],
      ]
      const candidate = resolveLeanToEndAbutments(
        { ...node, position, autoSpan: false },
        wall,
        nodes,
      )
      const patch: Partial<LeanToExtensionNode> = {
        position,
        autoSpan: false,
        leftEndCondition: candidate.leftEndCondition,
        rightEndCondition: candidate.rightEndCondition,
        downspoutPosition: candidate.downspoutPosition,
      }
      useLiveNodeOverrides.getState().set(node.id as AnyNodeId, patch)
      sceneApi.markDirty(node.id as AnyNodeId)
      lastPatch = leanToPlacementConflicts(candidate, wall, nodes).length === 0 ? patch : null
      return lastPatch
    }

    const onMove = (event: WallEvent) => {
      resolvePatch(event)
    }
    const onClick = (event: WallEvent) => {
      const patch = resolvePatch(event)
      if (!patch) return
      event.stopPropagation()
      useLiveNodeOverrides.getState().clear(node.id as AnyNodeId)
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
      useLiveNodeOverrides.getState().clear(node.id as AnyNodeId)
      sceneApi.markDirty(node.id as AnyNodeId)
      lastPatch = null
    }
  }, [node, sceneApi])

  return null
}

export default MoveLeanToExtensionTool
