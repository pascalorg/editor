'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type DoorEvent,
  emitter,
  getLevelElevations,
  getWallBaseElevationForNodes,
  type RoofEvent,
  type RoofSegmentEvent,
  sceneRegistry,
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
import { Euler, Quaternion, Vector3 } from 'three'
import { createLeanToAssembly } from './assembly'
import { isConicalLeanToHostOccupied, resolveConicalLeanToSurfaceHit } from './conical-host'
import { leanToExtensionGeometryKey } from './geometry'
import {
  leanToWallLocalPose,
  resolveLeanToWallPlacement,
  resolveLeanToWallSurfaceHit,
} from './layout'
import { isLeanToHostOnLevel } from './placement-scope'
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
import { resolveLeanToDoorWallTarget } from './wall-target'

type PreviewPose = {
  node: LeanToExtensionNode
  position: [number, number, number]
  rotationY: number
  valid: boolean
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

    const commitNode = (node: LeanToExtensionNode, parentId: AnyNodeId) => {
      const nodes = sceneApi.nodes() as Record<AnyNodeId, AnyNode>
      const assembly = createLeanToAssembly(node, resolveLeanToHostRoof(node, nodes), nodes)
      sceneApi.createMany?.([
        { node: assembly.extension, parentId },
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

    const worldPreviewPose = (
      event: RoofEvent | RoofSegmentEvent,
      node: LeanToExtensionNode,
      localPosition: readonly [number, number, number],
      extraRotationY = 0,
      valid = true,
    ): PreviewPose => {
      const position = event.object.localToWorld(new Vector3(...localPosition))
      const rotationY =
        new Euler().setFromQuaternion(event.object.getWorldQuaternion(new Quaternion()), 'YXZ').y +
        extraRotationY
      return {
        node,
        position: [position.x, position.y, position.z],
        rotationY,
        valid,
      }
    }

    const updateConicalSegmentTarget = (event: RoofSegmentEvent) => {
      const nodes = sceneApi.nodes() as Record<AnyNodeId, AnyNode>
      if (!isLeanToHostOnLevel(event.node, nodes, activeLevelId)) {
        setPreview(null)
        return null
      }
      const node = resolveConicalLeanToSurfaceHit(event.node, event.localPosition, event.normal)
      if (!node) {
        setPreview(null)
        return null
      }
      const valid = !isConicalLeanToHostOccupied(event.node.id, nodes)
      setPreview(worldPreviewPose(event, node, node.position, 0, valid))
      return valid ? node : null
    }

    const updateConicalRoofTarget = (event: RoofEvent) => {
      const nodes = sceneApi.nodes() as Record<AnyNodeId, AnyNode>
      if (
        !isLeanToHostOnLevel(event.node, nodes, activeLevelId) ||
        event.object.name !== 'merged-roof'
      ) {
        setPreview(null)
        return null
      }
      for (const childId of event.node.children) {
        const segment = nodes[childId as AnyNodeId]
        if (segment?.type !== 'roof-segment' || segment.roofType !== 'conical') continue
        const cos = Math.cos(segment.rotation)
        const sin = Math.sin(segment.rotation)
        const dx = event.localPosition[0] - segment.position[0]
        const dy = event.localPosition[1] - segment.position[1]
        const dz = event.localPosition[2] - segment.position[2]
        const localPosition: [number, number, number] = [
          dx * cos - dz * sin,
          dy,
          dx * sin + dz * cos,
        ]
        const normal = event.normal
          ? ([
              event.normal[0] * cos - event.normal[2] * sin,
              event.normal[1],
              event.normal[0] * sin + event.normal[2] * cos,
            ] as [number, number, number])
          : undefined
        const node = resolveConicalLeanToSurfaceHit(segment, localPosition, normal)
        if (!node) continue
        const valid = !isConicalLeanToHostOccupied(segment.id, nodes)
        const crownX = segment.position[0] + node.position[0] * cos + node.position[2] * sin
        const crownZ = segment.position[2] - node.position[0] * sin + node.position[2] * cos
        setPreview(
          worldPreviewPose(
            event,
            node,
            [crownX, segment.position[1] + node.position[1], crownZ],
            segment.rotation,
            valid,
          ),
        )
        return valid ? node : null
      }
      setPreview(null)
      return null
    }

    const updateTarget = (event: WallEvent) => {
      const nodes = sceneApi.nodes() as Record<AnyNodeId, AnyNode>
      if (!isLeanToHostOnLevel(event.node, nodes, activeLevelId)) {
        setPreview(null)
        return null
      }
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
      const valid = leanToPlacementConflicts(node, event.node, nodes).length === 0
      const pose = leanToWallLocalPose(event.node, node, resolveBaseY(event.node))
      setPreview((current) => ({
        node:
          current && leanToExtensionGeometryKey(current.node) === leanToExtensionGeometryKey(node)
            ? current.node
            : node,
        ...pose,
        valid,
      }))
      return valid ? node : null
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
      commitNode(node, event.node.id as AnyNodeId)
    }

    const onDoorMove = (event: DoorEvent) => {
      const wallId = event.node.wallId ?? event.node.parentId
      const wall = wallId ? sceneApi.get<WallNode>(wallId as AnyNodeId) : undefined
      const wallObject = wall ? sceneRegistry.nodes.get(wall.id) : undefined
      if (!(wall?.type === 'wall' && wallObject)) {
        setPreview(null)
        return
      }
      updateTarget(resolveLeanToDoorWallTarget(event, wall, wallObject))
    }

    const onDoorClick = (event: DoorEvent) => {
      const wallId = event.node.wallId ?? event.node.parentId
      const wall = wallId ? sceneApi.get<WallNode>(wallId as AnyNodeId) : undefined
      const wallObject = wall ? sceneRegistry.nodes.get(wall.id) : undefined
      if (!(wall?.type === 'wall' && wallObject)) return

      const target = resolveLeanToDoorWallTarget(event, wall, wallObject)
      const node = updateTarget(target)
      if (!node) return
      event.stopPropagation()
      commitNode(node, wall.id as AnyNodeId)
    }

    const onDoorLeave = () => {
      setPreview(null)
    }

    const onRoofSegmentMove = (event: RoofSegmentEvent) => {
      updateConicalSegmentTarget(event)
    }
    const onRoofSegmentClick = (event: RoofSegmentEvent) => {
      const node = updateConicalSegmentTarget(event)
      if (!node) return
      event.stopPropagation()
      commitNode(node, event.node.id as AnyNodeId)
    }
    const onRoofMove = (event: RoofEvent) => {
      updateConicalRoofTarget(event)
    }
    const onRoofClick = (event: RoofEvent) => {
      const node = updateConicalRoofTarget(event)
      if (!node) return
      const segment = node.parentId ? sceneApi.get(node.parentId as AnyNodeId) : undefined
      if (segment?.type !== 'roof-segment') return
      event.stopPropagation()
      commitNode(node, segment.id as AnyNodeId)
    }

    emitter.on('wall:move', onWallMove)
    emitter.on('wall:enter', onWallMove)
    emitter.on('wall:leave', onWallLeave)
    emitter.on('wall:click', onWallClick)
    emitter.on('door:move', onDoorMove)
    emitter.on('door:enter', onDoorMove)
    emitter.on('door:leave', onDoorLeave)
    emitter.on('door:click', onDoorClick)
    emitter.on('roof-segment:move', onRoofSegmentMove)
    emitter.on('roof-segment:enter', onRoofSegmentMove)
    emitter.on('roof-segment:leave', onWallLeave)
    emitter.on('roof-segment:click', onRoofSegmentClick)
    emitter.on('roof:move', onRoofMove)
    emitter.on('roof:enter', onRoofMove)
    emitter.on('roof:leave', onWallLeave)
    emitter.on('roof:click', onRoofClick)
    return () => {
      emitter.off('wall:move', onWallMove)
      emitter.off('wall:enter', onWallMove)
      emitter.off('wall:leave', onWallLeave)
      emitter.off('wall:click', onWallClick)
      emitter.off('door:move', onDoorMove)
      emitter.off('door:enter', onDoorMove)
      emitter.off('door:leave', onDoorLeave)
      emitter.off('door:click', onDoorClick)
      emitter.off('roof-segment:move', onRoofSegmentMove)
      emitter.off('roof-segment:enter', onRoofSegmentMove)
      emitter.off('roof-segment:leave', onWallLeave)
      emitter.off('roof-segment:click', onRoofSegmentClick)
      emitter.off('roof:move', onRoofMove)
      emitter.off('roof:enter', onRoofMove)
      emitter.off('roof:leave', onWallLeave)
      emitter.off('roof:click', onRoofClick)
      setPreview(null)
      useInteractionScope
        .getState()
        .endIf((scope) => scope.kind === 'drafting' && scope.tool === 'lean-to-extension')
    }
  }, [activeLevelId, sceneApi, selectNode, viewMode])

  if (!preview || viewMode !== '3d') return null
  return (
    <group position={preview.position} rotation={[0, preview.rotationY, 0]}>
      <LeanToExtensionPreview invalid={!preview.valid} node={preview.node} />
    </group>
  )
}

export default LeanToExtensionTool
