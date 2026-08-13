'use client'

import {
  type AnyNodeId,
  emitter,
  sceneRegistry,
  spatialGridManager,
  useScene,
  type WallEvent,
  type WallNode,
} from '@pascal-app/core'
import {
  getSideFromNormal,
  isValidWallSideFace,
  triggerSFX,
  useEditor,
  useInteractionScope,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useState } from 'react'
import { createLeanToAssembly } from './assembly'
import { leanToExtensionGeometryKey } from './geometry'
import { leanToWallLocalPose, resolveLeanToWallPlacement } from './layout'
import LeanToExtensionPreview from './preview'
import type { LeanToExtensionNode } from './schema'

type PreviewPose = {
  node: LeanToExtensionNode
  position: [number, number, number]
  rotationY: number
}

const LeanToExtensionTool = () => {
  const activeLevelId = useViewer((state) => state.selection.levelId)
  const viewMode = useEditor((state) => state.viewMode)
  const [preview, setPreview] = useState<PreviewPose | null>(null)

  useEffect(() => {
    if (!(activeLevelId && viewMode === '3d')) return
    useInteractionScope.getState().begin({ kind: 'drafting', tool: 'lean-to-extension' })

    const resolveBaseY = (wall: WallNode) => {
      const levelY = sceneRegistry.nodes.get(activeLevelId)?.position.y ?? 0
      const slabY = spatialGridManager.getSlabElevationForWall(
        wall.parentId ?? '',
        wall.start,
        wall.end,
        wall.curveOffset ?? 0,
        wall.thickness,
        wall.supportSlabId,
      )
      return levelY + slabY
    }

    const updateTarget = (event: WallEvent) => {
      if (!isValidWallSideFace(event.normal)) {
        setPreview(null)
        return null
      }
      const node = resolveLeanToWallPlacement(
        event.node,
        event.localPosition[0],
        getSideFromNormal(event.normal),
      )
      if (!node) {
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
      const assembly = createLeanToAssembly(node)
      useScene.getState().createNodes([
        { node: assembly.extension, parentId: event.node.id },
        ...assembly.children.map((child) => ({
          node: child,
          parentId: (child.parentId as AnyNodeId | null) ?? undefined,
        })),
      ])
      useViewer.getState().setSelection({ selectedIds: [assembly.extension.id] })
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
  }, [activeLevelId, viewMode])

  if (!preview || viewMode !== '3d') return null
  return (
    <group position={preview.position} rotation={[0, preview.rotationY, 0]}>
      <LeanToExtensionPreview node={preview.node} />
    </group>
  )
}

export default LeanToExtensionTool
