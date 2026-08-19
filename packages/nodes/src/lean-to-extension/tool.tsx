'use client'

import {
  type AnyNode,
  type AnyNodeId,
  emitter,
  getLevelElevations,
  getWallBaseElevationForNodes,
  type WallEvent,
  type WallNode,
} from '@pascal-app/core'
import {
  triggerSFX,
  useEditor,
  useInteractionScope,
  useRegistryToolContext,
} from '@pascal-app/editor'
import { useEffect, useState } from 'react'
import { createLeanToAssembly } from './assembly'
import { leanToExtensionGeometryKey } from './geometry'
import {
  leanToWallLocalPose,
  resolveLeanToWallPlacement,
  resolveLeanToWallSurfaceHit,
} from './layout'
import { leanToPlacementConflicts, resolveLeanToEndAbutments } from './placement-validation'
import LeanToExtensionPreview from './preview'
import {
  applyLeanToAvailableWallSpan,
  applyLeanToRoofAttachment,
  applyLeanToWallAutoSpan,
  clearLeanToRoofAttachment,
  resolveLeanToHostRoof,
  resolveLeanToRoofAttachment,
} from './roof-attachment'
import type { LeanToExtensionNode } from './schema'

type PreviewPose = {
  node: LeanToExtensionNode
  position: [number, number, number]
  rotationY: number
}

const LeanToExtensionTool = () => {
  const { activeLevelId, sceneApi, selectNode } = useRegistryToolContext()
  const viewMode = useEditor((state) => state.viewMode)
  const [preview, setPreview] = useState<PreviewPose | null>(null)

  useEffect(() => {
    if (!(activeLevelId && viewMode === '3d')) return
    useInteractionScope.getState().begin({ kind: 'drafting', tool: 'lean-to-extension' })

    const resolveBaseY = (wall: WallNode) => {
      const nodes = sceneApi.nodes() as Record<AnyNodeId, AnyNode>
      const levelY = wall.parentId ? (getLevelElevations(nodes).get(wall.parentId)?.baseY ?? 0) : 0
      return levelY + getWallBaseElevationForNodes(wall, nodes)
    }

    const updateTarget = (event: WallEvent) => {
      const hit = resolveLeanToWallSurfaceHit(event.node, event.localPosition, event.normal)
      if (!hit) {
        setPreview(null)
        return null
      }
      const wallPlacement = resolveLeanToWallPlacement(event.node, hit.localX, hit.side)
      if (!wallPlacement) {
        setPreview(null)
        return null
      }
      const nodes = sceneApi.nodes() as Record<AnyNodeId, AnyNode>
      const attachment = resolveLeanToRoofAttachment(wallPlacement, event.node, nodes)
      const autoSpannedNode = attachment
        ? applyLeanToRoofAttachment(wallPlacement, attachment)
        : applyLeanToWallAutoSpan(clearLeanToRoofAttachment(wallPlacement), event.node)
      const attachedNode = applyLeanToAvailableWallSpan(
        autoSpannedNode,
        event.node,
        nodes,
        wallPlacement.position[0],
      )
      const node = resolveLeanToEndAbutments(attachedNode, event.node, nodes)
      if (leanToPlacementConflicts(node, event.node, nodes).length > 0) {
        setPreview(null)
        return null
      }
      const pose = leanToWallLocalPose(event.node, node, resolveBaseY(event.node))
      setPreview((current) => ({
        node:
          current && leanToExtensionGeometryKey(current.node) === leanToExtensionGeometryKey(node)
            ? current.node
            : node,
        ...pose,
      }))
      return node
    }

    const onWallMove = (event: WallEvent) => {
      updateTarget(event)
    }
    const onWallLeave = () => {
      setPreview(null)
    }
    const onWallClick = (event: WallEvent) => {
      const node = updateTarget(event)
      if (!node) return
      event.stopPropagation()
      const nodes = sceneApi.nodes() as Record<AnyNodeId, AnyNode>
      const assembly = createLeanToAssembly(node, resolveLeanToHostRoof(node, nodes), nodes)
      sceneApi.createMany?.([
        { node: assembly.extension, parentId: event.node.id },
        ...assembly.children.map((child) => ({
          node: child,
          parentId: (child.parentId as AnyNodeId | null) ?? undefined,
        })),
      ])
      selectNode(assembly.extension.id as AnyNodeId)
      triggerSFX('sfx:structure-build')
      if (useEditor.getState().getContinuation('point') !== 'repeat') {
        useEditor.getState().setTool(null)
        useEditor.getState().setMode('select')
      }
    }

    emitter.on('wall:move', onWallMove)
    emitter.on('wall:enter', onWallMove)
    emitter.on('wall:leave', onWallLeave)
    emitter.on('wall:click', onWallClick)
    return () => {
      emitter.off('wall:move', onWallMove)
      emitter.off('wall:enter', onWallMove)
      emitter.off('wall:leave', onWallLeave)
      emitter.off('wall:click', onWallClick)
      setPreview(null)
      useInteractionScope
        .getState()
        .endIf((scope) => scope.kind === 'drafting' && scope.tool === 'lean-to-extension')
    }
  }, [activeLevelId, sceneApi, selectNode, viewMode])

  if (!preview || viewMode !== '3d') return null
  return (
    <group position={preview.position} rotation={[0, preview.rotationY, 0]}>
      <LeanToExtensionPreview node={preview.node} />
    </group>
  )
}

export default LeanToExtensionTool
