'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type DoorEvent,
  emitter,
  type GridEvent,
  getLevelElevations,
  getWallBaseElevationForNodes,
  type RoofEvent,
  type RoofSegmentEvent,
  type SlabEvent,
  sceneRegistry,
  type WallEvent,
  type WallNode,
} from '@pascal-app/core'
import {
  isGridSnapActive,
  triggerSFX,
  useEditor,
  useInteractionScope,
  useRegistryToolContext,
} from '@pascal-app/editor'
import { useEffect, useState } from 'react'
import { Euler, Quaternion, Vector3 } from 'three'
import { stopPlacementCommitPropagation } from '../shared/floor-placement'
import { createLeanToAssembly } from './assembly'
import { isConicalLeanToHostOccupied, resolveConicalLeanToSurfaceHit } from './conical-host'
import { leanToExtensionGeometryKey } from './geometry'
import {
  leanToWallLocalPose,
  resolveLeanToWallPlacement,
  resolveLeanToWallSurfaceHit,
} from './layout'
import {
  findLeanToSlabEdgePlacement,
  type LeanToPlanPlacementTarget,
  nextLeanToPlacementRotation,
  resolveLeanToCommitTarget,
  resolveLeanToPlanPlacement,
} from './placement'
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

type PlacementCommitTarget = {
  node: LeanToExtensionNode
  parentId: AnyNodeId
  valid: boolean
}

const LeanToExtensionTool = () => {
  const { activeLevelId, sceneApi, selectNode } = useRegistryToolContext()
  const viewMode = useEditor((state) => state.viewMode)
  const [preview, setPreview] = useState<PreviewPose | null>(null)

  useEffect(() => {
    if (!(activeLevelId && viewMode === '3d')) return
    useInteractionScope.getState().begin({ kind: 'drafting', tool: 'lean-to-extension' })
    let lastMeshEventTime = -1
    let freestandingRotationY = 0
    let lastFreestandingEvent: GridEvent | SlabEvent | null = null
    let lastPreviewTarget: PlacementCommitTarget | null = null
    let commitQueued = false

    const resolveBaseY = (wall: WallNode) => {
      const nodes = sceneApi.nodes() as Record<AnyNodeId, AnyNode>
      const levelY = wall.parentId ? (getLevelElevations(nodes).get(wall.parentId)?.baseY ?? 0) : 0
      return levelY + getWallBaseElevationForNodes(wall, nodes)
    }

    const commitNode = (node: LeanToExtensionNode, parentId: AnyNodeId) => {
      if (!sceneApi.createMany || commitQueued) return
      commitQueued = true
      queueMicrotask(() => {
        commitQueued = false
      })
      const nodes = sceneApi.nodes() as Record<AnyNodeId, AnyNode>
      const assembly = createLeanToAssembly(node, resolveLeanToHostRoof(node, nodes), nodes)
      sceneApi.createMany([
        { node: assembly.extension, parentId },
        ...assembly.children.map((child) => ({
          node: child,
          parentId: (child.parentId as AnyNodeId | null) ?? undefined,
        })),
      ])
      lastPreviewTarget = null
      setPreview(null)
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

    const levelPreviewPose = (node: LeanToExtensionNode): PreviewPose => {
      const levelObject = sceneRegistry.nodes.get(activeLevelId)
      if (!levelObject) {
        return {
          node,
          position: node.position,
          rotationY: node.rotation[1],
          valid: true,
        }
      }
      const position = levelObject.localToWorld(new Vector3(...node.position))
      const rotationY =
        new Euler().setFromQuaternion(levelObject.getWorldQuaternion(new Quaternion()), 'YXZ').y +
        node.rotation[1]
      return { node, position: [position.x, position.y, position.z], rotationY, valid: true }
    }

    const updateFreeTarget = (event: GridEvent | SlabEvent) => {
      const step =
        !event.nativeEvent.altKey && isGridSnapActive() ? useEditor.getState().gridSnapStep : 0
      const snap = (value: number) => (step > 0 ? Math.round(value / step) * step : value)
      const nodes = sceneApi.nodes() as Record<AnyNodeId, AnyNode>
      const target = resolveLeanToPlanPlacement({
        activeLevelId,
        freestandingPoint: [snap(event.localPosition[0]), snap(event.localPosition[2])],
        freestandingRotationY,
        nodes,
        point: [event.localPosition[0], event.localPosition[2]],
      })
      lastPreviewTarget = target.node.parentId
        ? {
            node: target.node,
            parentId: target.node.parentId as AnyNodeId,
            valid: target.valid,
          }
        : null
      lastFreestandingEvent = target.node.hostKind === 'freestanding' ? event : null
      if (target.wall) {
        const pose = leanToWallLocalPose(target.wall, target.node, resolveBaseY(target.wall))
        setPreview((current) => ({
          node:
            current &&
            leanToExtensionGeometryKey(current.node) === leanToExtensionGeometryKey(target.node)
              ? current.node
              : target.node,
          ...pose,
          valid: target.valid,
        }))
      } else {
        setPreview({ ...levelPreviewPose(target.node), valid: target.valid })
      }
      return target
    }

    const updateSlabTarget = (event: SlabEvent): LeanToPlanPlacementTarget => {
      const nodes = sceneApi.nodes() as Record<AnyNodeId, AnyNode>
      const node = findLeanToSlabEdgePlacement(
        [event.localPosition[0], event.localPosition[2]],
        nodes,
        activeLevelId,
      )
      if (!node || node.hostSlabId !== event.node.id) return updateFreeTarget(event)
      lastFreestandingEvent = null
      lastPreviewTarget = node.parentId
        ? { node, parentId: node.parentId as AnyNodeId, valid: true }
        : null
      setPreview(levelPreviewPose(node))
      return { node, valid: true }
    }

    const updateConicalSegmentTarget = (event: RoofSegmentEvent) => {
      lastFreestandingEvent = null
      const nodes = sceneApi.nodes() as Record<AnyNodeId, AnyNode>
      if (!isLeanToHostOnLevel(event.node, nodes, activeLevelId)) {
        lastPreviewTarget = null
        setPreview(null)
        return null
      }
      const node = resolveConicalLeanToSurfaceHit(event.node, event.localPosition, event.normal)
      if (!node) {
        lastPreviewTarget = null
        setPreview(null)
        return null
      }
      const valid = !isConicalLeanToHostOccupied(event.node.id, nodes)
      lastPreviewTarget = { node, parentId: event.node.id as AnyNodeId, valid }
      setPreview(worldPreviewPose(event, node, node.position, 0, valid))
      return valid ? node : null
    }

    const updateConicalRoofTarget = (event: RoofEvent) => {
      lastFreestandingEvent = null
      const nodes = sceneApi.nodes() as Record<AnyNodeId, AnyNode>
      if (
        !isLeanToHostOnLevel(event.node, nodes, activeLevelId) ||
        event.object.name !== 'merged-roof'
      ) {
        lastPreviewTarget = null
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
        lastPreviewTarget = { node, parentId: segment.id as AnyNodeId, valid }
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
      lastPreviewTarget = null
      setPreview(null)
      return null
    }

    const updateTarget = (event: WallEvent) => {
      lastFreestandingEvent = null
      const nodes = sceneApi.nodes() as Record<AnyNodeId, AnyNode>
      if (!isLeanToHostOnLevel(event.node, nodes, activeLevelId)) {
        lastPreviewTarget = null
        setPreview(null)
        return null
      }
      const hit = resolveLeanToWallSurfaceHit(event.node, event.localPosition, event.normal)
      if (!hit) {
        lastPreviewTarget = null
        setPreview(null)
        return null
      }
      const wallPlacement = resolveLeanToWallPlacement(event.node, hit.localX, hit.side)
      if (!wallPlacement) {
        lastPreviewTarget = null
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
      lastPreviewTarget = { node, parentId: event.node.id as AnyNodeId, valid }
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
      lastMeshEventTime = event.nativeEvent.timeStamp
      updateTarget(event)
    }
    const onWallLeave = () => {
      lastFreestandingEvent = null
      lastPreviewTarget = null
      setPreview(null)
    }
    const onWallClick = (event: WallEvent) => {
      lastMeshEventTime = event.nativeEvent.timeStamp
      const visibleTarget = lastPreviewTarget
      updateTarget(event)
      const target = resolveLeanToCommitTarget(visibleTarget, lastPreviewTarget)
      if (!target?.valid) return
      stopPlacementCommitPropagation(event)
      commitNode(target.node, target.parentId)
    }

    const onDoorMove = (event: DoorEvent) => {
      lastMeshEventTime = event.nativeEvent.timeStamp
      const wallId = event.node.wallId ?? event.node.parentId
      const wall = wallId ? sceneApi.get<WallNode>(wallId as AnyNodeId) : undefined
      const wallObject = wall ? sceneRegistry.nodes.get(wall.id) : undefined
      if (!(wall?.type === 'wall' && wallObject)) {
        lastPreviewTarget = null
        setPreview(null)
        return
      }
      updateTarget(resolveLeanToDoorWallTarget(event, wall, wallObject))
    }

    const onDoorClick = (event: DoorEvent) => {
      lastMeshEventTime = event.nativeEvent.timeStamp
      const visibleTarget = lastPreviewTarget
      const wallId = event.node.wallId ?? event.node.parentId
      const wall = wallId ? sceneApi.get<WallNode>(wallId as AnyNodeId) : undefined
      const wallObject = wall ? sceneRegistry.nodes.get(wall.id) : undefined
      if (!(wall?.type === 'wall' && wallObject)) return

      const target = resolveLeanToDoorWallTarget(event, wall, wallObject)
      updateTarget(target)
      const commitTarget = resolveLeanToCommitTarget(visibleTarget, lastPreviewTarget)
      if (!commitTarget?.valid) return
      stopPlacementCommitPropagation(event)
      commitNode(commitTarget.node, commitTarget.parentId)
    }

    const onDoorLeave = () => {
      lastPreviewTarget = null
      setPreview(null)
    }

    const onRoofSegmentMove = (event: RoofSegmentEvent) => {
      lastMeshEventTime = event.nativeEvent.timeStamp
      updateConicalSegmentTarget(event)
    }
    const onRoofSegmentClick = (event: RoofSegmentEvent) => {
      lastMeshEventTime = event.nativeEvent.timeStamp
      const visibleTarget = lastPreviewTarget
      updateConicalSegmentTarget(event)
      const target = resolveLeanToCommitTarget(visibleTarget, lastPreviewTarget)
      if (!target?.valid) return
      stopPlacementCommitPropagation(event)
      commitNode(target.node, target.parentId)
    }
    const onRoofMove = (event: RoofEvent) => {
      lastMeshEventTime = event.nativeEvent.timeStamp
      updateConicalRoofTarget(event)
    }
    const onRoofClick = (event: RoofEvent) => {
      lastMeshEventTime = event.nativeEvent.timeStamp
      const visibleTarget = lastPreviewTarget
      updateConicalRoofTarget(event)
      const target = resolveLeanToCommitTarget(visibleTarget, lastPreviewTarget)
      if (!target?.valid) return
      stopPlacementCommitPropagation(event)
      commitNode(target.node, target.parentId)
    }
    const onSlabMove = (event: SlabEvent) => {
      lastMeshEventTime = event.nativeEvent.timeStamp
      updateSlabTarget(event)
    }
    const onSlabClick = (event: SlabEvent) => {
      lastMeshEventTime = event.nativeEvent.timeStamp
      const visibleTarget = lastPreviewTarget
      updateSlabTarget(event)
      const target = resolveLeanToCommitTarget(visibleTarget, lastPreviewTarget)
      stopPlacementCommitPropagation(event)
      if (!target?.valid) return
      commitNode(target.node, target.parentId)
    }
    const onGridMove = (event: GridEvent) => {
      if (event.nativeEvent.timeStamp === lastMeshEventTime) return
      updateFreeTarget(event)
    }
    const onGridClick = (event: GridEvent) => {
      if (event.nativeEvent.timeStamp === lastMeshEventTime) return
      const visibleTarget = lastPreviewTarget
      updateFreeTarget(event)
      const target = resolveLeanToCommitTarget(visibleTarget, lastPreviewTarget)
      if (!target?.valid) return
      commitNode(target.node, target.parentId)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        (event.target instanceof HTMLElement && event.target.isContentEditable)
      ) {
        return
      }
      if (!lastFreestandingEvent) return

      const nextRotation = nextLeanToPlacementRotation(
        freestandingRotationY,
        event.key,
        event.metaKey || event.ctrlKey,
      )
      if (nextRotation === freestandingRotationY) return

      event.preventDefault()
      freestandingRotationY = nextRotation
      triggerSFX('sfx:item-rotate')
      updateFreeTarget(lastFreestandingEvent)
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
    emitter.on('slab:move', onSlabMove)
    emitter.on('slab:enter', onSlabMove)
    emitter.on('slab:leave', onWallLeave)
    emitter.on('slab:click', onSlabClick)
    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)
    window.addEventListener('keydown', onKeyDown)
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
      emitter.off('slab:move', onSlabMove)
      emitter.off('slab:enter', onSlabMove)
      emitter.off('slab:leave', onWallLeave)
      emitter.off('slab:click', onSlabClick)
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
      window.removeEventListener('keydown', onKeyDown)
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
