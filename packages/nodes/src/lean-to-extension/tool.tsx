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
  CursorSphere,
  isGridSnapActive,
  isMagneticSnapActive,
  markToolCancelConsumed,
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
import { leanToWallLocalPose, resolveLeanToWallSurfaceHit } from './layout'
import {
  findLeanToSlabEdgePlacement,
  LEAN_TO_RUN_CONNECT_SNAP_RADIUS,
  LEAN_TO_RUN_MAGNETIC_SNAP_RADIUS,
  type LeanToPlanPlacementTarget,
  nextLeanToCanopyForm,
  nextLeanToPlacementRotation,
  resolveLeanToCommitTarget,
  resolveLeanToFreestandingRunEndpointSnap,
  resolveLeanToFreestandingRunTarget,
  resolveLeanToPlanPlacement,
  resolveLeanToWallPlanTarget,
} from './placement'
import { isLeanToHostOnLevel } from './placement-scope'
import LeanToExtensionPreview from './preview'
import { resolveLeanToHostRoof } from './roof-attachment'
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
  const [chainCursor, setChainCursor] = useState<[number, number, number] | null>(null)
  const [runSnap, setRunSnap] = useState<[number, number, number] | null>(null)

  useEffect(() => {
    if (!(activeLevelId && viewMode === '3d')) return
    useInteractionScope.getState().begin({ kind: 'drafting', tool: 'lean-to-extension' })
    let lastMeshEventTime = -1
    let freestandingRotationY = 0
    let freestandingCanopyForm: LeanToExtensionNode['canopyForm'] = 'mono'
    let lastFreestandingEvent: GridEvent | SlabEvent | null = null
    let lastPreviewTarget: PlacementCommitTarget | null = null
    let chainStart: [number, number] | null = null
    let chainEnd: [number, number] | null = null
    let chainEndSnapped = false
    let chainFlipProjection = false
    let lastRunSnapKey: string | null = null
    let commitQueued = false

    const isContinuous = () => useEditor.getState().getContinuation('canopy') === 'continuous'

    const snapPoint = (point: readonly [number, number], altKey: boolean): [number, number] => {
      const step = !altKey && isGridSnapActive() ? useEditor.getState().gridSnapStep : 0
      const snap = (value: number) => (step > 0 ? Math.round(value / step) * step : value)
      return [snap(point[0]), snap(point[1])]
    }

    const setChainCursorPreview = (point: readonly [number, number] | null) => {
      if (!point) {
        setChainCursor(null)
        return
      }
      const position = new Vector3(point[0], 0, point[1])
      sceneRegistry.nodes.get(activeLevelId)?.localToWorld(position)
      setChainCursor([position.x, position.y, position.z])
    }

    const setRunSnapPreview = (
      snap: { nodeId: string; point: [number, number]; side: 'left' | 'right' } | null,
    ) => {
      const key = snap ? `${snap.nodeId}:${snap.side}` : null
      if (key && key !== lastRunSnapKey) triggerSFX('sfx:grid-snap')
      lastRunSnapKey = key
      if (!snap) {
        setRunSnap(null)
        return
      }
      const position = new Vector3(snap.point[0], 0.06, snap.point[1])
      sceneRegistry.nodes.get(activeLevelId)?.localToWorld(position)
      setRunSnap([position.x, position.y, position.z])
    }

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
      if (!isContinuous()) {
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
      return {
        node,
        position: [position.x, position.y, position.z],
        rotationY,
        valid: true,
      }
    }

    const updateContinuousTarget = (point: [number, number], altKey = false) => {
      if (!chainStart) return null
      const nodes = sceneApi.nodes() as Record<AnyNodeId, AnyNode>
      const snap = altKey
        ? null
        : resolveLeanToFreestandingRunEndpointSnap({
            activeLevelId,
            canopyForm: freestandingCanopyForm,
            flipProjection: chainFlipProjection,
            maxDistance: isMagneticSnapActive()
              ? LEAN_TO_RUN_MAGNETIC_SNAP_RADIUS
              : LEAN_TO_RUN_CONNECT_SNAP_RADIUS,
            nodes,
            proposedEnd: point,
            start: chainStart,
          })
      const end = snap?.point ?? point
      setChainCursorPreview(end)
      const target = resolveLeanToFreestandingRunTarget({
        activeLevelId,
        canopyForm: freestandingCanopyForm,
        start: chainStart,
        end,
        flipProjection: chainFlipProjection,
        nodes,
      })
      chainEnd = end
      chainEndSnapped = Boolean(snap)
      setRunSnapPreview(snap)
      lastPreviewTarget = target?.node.parentId
        ? { node: target.node, parentId: target.node.parentId as AnyNodeId, valid: target.valid }
        : null
      setPreview(target ? levelPreviewPose(target.node) : null)
      return target
    }

    const pointFromObjectEvent = (
      event: WallEvent | DoorEvent | RoofEvent | RoofSegmentEvent | SlabEvent,
    ): [number, number] => {
      const position = event.object.localToWorld(new Vector3(...event.localPosition))
      sceneRegistry.nodes.get(activeLevelId)?.worldToLocal(position)
      return snapPoint([position.x, position.z], event.nativeEvent.altKey)
    }

    const updateContinuousObjectTarget = (
      event: WallEvent | DoorEvent | RoofEvent | RoofSegmentEvent | SlabEvent,
    ) => updateContinuousTarget(pointFromObjectEvent(event), event.nativeEvent.altKey)

    const finishRun = () => {
      chainStart = null
      chainEnd = null
      chainEndSnapped = false
      chainFlipProjection = false
      lastPreviewTarget = null
      setChainCursorPreview(null)
      setRunSnapPreview(null)
      setPreview(null)
    }

    const advanceRun = () => {
      if (!chainEnd) return
      if (chainEndSnapped) {
        finishRun()
        return
      }
      chainStart = chainEnd
      chainEnd = null
      chainEndSnapped = false
      setRunSnapPreview(null)
      setChainCursorPreview(chainStart)
    }

    const updateFreeTarget = (event: GridEvent | SlabEvent) => {
      const point = snapPoint(
        [event.localPosition[0], event.localPosition[2]],
        event.nativeEvent.altKey,
      )
      if (chainStart && isContinuous()) {
        lastFreestandingEvent = event
        return updateContinuousTarget(point, event.nativeEvent.altKey)
      }
      if (chainStart) finishRun()
      const nodes = sceneApi.nodes() as Record<AnyNodeId, AnyNode>
      const target = resolveLeanToPlanPlacement({
        activeLevelId,
        freestandingPoint: point,
        freestandingRotationY,
        freestandingCanopyForm,
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

    const updateSlabTarget = (event: SlabEvent): LeanToPlanPlacementTarget | null => {
      if (chainStart && isContinuous()) {
        return updateContinuousObjectTarget(event)
      }
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
      if (chainStart && isContinuous()) return updateContinuousObjectTarget(event)
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
      if (chainStart && isContinuous()) return updateContinuousObjectTarget(event)
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
      if (chainStart && isContinuous()) return updateContinuousObjectTarget(event)
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
      const target = resolveLeanToWallPlanTarget(event.node, hit.localX, hit.side, nodes)
      if (!target) {
        lastPreviewTarget = null
        setPreview(null)
        return null
      }
      const pose = leanToWallLocalPose(event.node, target.node, resolveBaseY(event.node))
      lastPreviewTarget = {
        node: target.node,
        parentId: event.node.id as AnyNodeId,
        valid: target.valid,
      }
      setPreview((current) => ({
        node:
          current &&
          leanToExtensionGeometryKey(current.node) === leanToExtensionGeometryKey(target.node)
            ? current.node
            : target.node,
        ...pose,
        valid: target.valid,
      }))
      return target.valid ? target.node : null
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
      if (chainStart) advanceRun()
    }

    const onDoorMove = (event: DoorEvent) => {
      lastMeshEventTime = event.nativeEvent.timeStamp
      if (chainStart && isContinuous()) {
        updateContinuousObjectTarget(event)
        return
      }
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
      if (chainStart) advanceRun()
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
      if (chainStart) advanceRun()
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
      if (chainStart) advanceRun()
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
      if (chainStart) advanceRun()
    }
    const onGridMove = (event: GridEvent) => {
      if (event.nativeEvent.timeStamp === lastMeshEventTime) return
      updateFreeTarget(event)
    }
    const onGridClick = (event: GridEvent) => {
      if (event.nativeEvent.timeStamp === lastMeshEventTime) return
      if (isContinuous() && !chainStart) {
        chainStart = snapPoint(
          [event.localPosition[0], event.localPosition[2]],
          event.nativeEvent.altKey,
        )
        lastFreestandingEvent = event
        lastPreviewTarget = null
        setChainCursorPreview(chainStart)
        setPreview(null)
        triggerSFX('sfx:structure-build-start')
        return
      }
      const visibleTarget = lastPreviewTarget
      updateFreeTarget(event)
      const target = resolveLeanToCommitTarget(visibleTarget, lastPreviewTarget)
      if (!target?.valid) return
      commitNode(target.node, target.parentId)
      if (chainStart) advanceRun()
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        (event.target instanceof HTMLElement && event.target.isContentEditable)
      ) {
        return
      }
      if (event.key === 'Escape' && chainStart) {
        event.preventDefault()
        event.stopImmediatePropagation()
        markToolCancelConsumed()
        finishRun()
        return
      }
      if (
        chainStart &&
        (event.key === 'r' || event.key === 'R' || event.key === 't' || event.key === 'T')
      ) {
        event.preventDefault()
        chainFlipProjection = !chainFlipProjection
        triggerSFX('sfx:item-rotate')
        if (chainEnd) updateContinuousTarget(chainEnd)
        return
      }
      const nextRotation = nextLeanToPlacementRotation(
        freestandingRotationY,
        event.key,
        event.metaKey || event.ctrlKey,
      )
      const nextForm = nextLeanToCanopyForm(freestandingCanopyForm, event.key)
      if (nextRotation === freestandingRotationY && nextForm === freestandingCanopyForm) return

      event.preventDefault()
      freestandingRotationY = nextRotation
      freestandingCanopyForm = nextForm
      triggerSFX('sfx:item-rotate')
      if (chainStart && chainEnd) updateContinuousTarget(chainEnd)
      else if (lastFreestandingEvent) updateFreeTarget(lastFreestandingEvent)
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
    window.addEventListener('keydown', onKeyDown, true)
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
      window.removeEventListener('keydown', onKeyDown, true)
      setPreview(null)
      setChainCursor(null)
      setRunSnap(null)
      useInteractionScope
        .getState()
        .endIf((scope) => scope.kind === 'drafting' && scope.tool === 'lean-to-extension')
    }
  }, [activeLevelId, sceneApi, selectNode, viewMode])

  if (viewMode !== '3d') return null
  return (
    <>
      {chainCursor ? (
        <CursorSphere
          color="#0ea5e9"
          height={preview?.node.highEdgeHeight ?? 2.8}
          position={chainCursor}
          showTooltip={false}
        />
      ) : null}
      {runSnap ? (
        <mesh position={runSnap} renderOrder={1001} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.13, 0.2, 24]} />
          <meshBasicMaterial color="#22c55e" depthTest={false} side={2} />
        </mesh>
      ) : null}
      {preview ? (
        <group position={preview.position} rotation={[0, preview.rotationY, 0]}>
          <LeanToExtensionPreview invalid={!preview.valid} node={preview.node} />
        </group>
      ) : null}
    </>
  )
}

export default LeanToExtensionTool
