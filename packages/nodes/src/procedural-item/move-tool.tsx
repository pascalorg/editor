'use client'
import {
  type AnyNode,
  type AnyNodeId,
  emitter,
  type GridEvent,
  holdHiddenWallPointerEvents,
  sceneRegistry,
  useLiveNodeOverrides,
  useScene,
  type WallEvent,
} from '@pascal-app/core'
import { type ProceduralItemNode, queryProceduralItem } from '@pascal-app/core/procedural-items'
import {
  clearPlacementSurface,
  commitFreshPlacementSubtree,
  consumePlacementDragRelease,
  getSideFromNormal,
  isFreshPlacementMetadata,
  isValidWallSideFace,
  MoveRegistryNodeTool,
  publishPlacementSurface,
  triggerSFX,
  useEditor,
  usePlacementPreview,
  useRegistryToolContext,
} from '@pascal-app/editor'
import { useEffect, useMemo, useState } from 'react'
import { Vector3 } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { beginOpeningMoveHistorySession } from '../shared/opening-move-history'
import { acquireProceduralGeometry } from './geometry'
import { createProceduralWallMoveSession } from './move-session'

export default function MoveProceduralItem({ node }: { node: ProceduralItemNode }) {
  return node.recipe.mounting ? (
    <WallMove node={node} />
  ) : (
    <MoveRegistryNodeTool node={node as unknown as AnyNode} />
  )
}
function WallMove({ node }: { node: ProceduralItemNode }) {
  const { activeLevelId, isCameraDragging, selectNode } = useRegistryToolContext()
  const [valid, setValid] = useState(false)
  useEffect(() => {
    if (!activeLevelId) return
    const session = createProceduralWallMoveSession(node, activeLevelId)
    const releaseWallEvents = holdHiddenWallPointerEvents()
    let wallAt = -Infinity
    let finished = false
    const onWall = (event: WallEvent) => {
      if (useEditor.getState().isFloorplanHovered || !isValidWallSideFace(event.normal)) return
      wallAt = performance.now()
      session.wall(
        event.node,
        event.localPosition[0],
        event.localPosition[1],
        getSideFromNormal(event.normal),
        event.nativeEvent.altKey,
      )
      setValid(session.canCommit())
      const normal = new Vector3(...(event.normal ?? [0, 0, 1]))
      const wall = sceneRegistry.nodes.get(event.node.id)
      if (wall) normal.transformDirection(wall.matrixWorld)
      publishPlacementSurface(new Vector3(...event.position), normal)
    }
    const onGrid = (event: GridEvent) => {
      if (useEditor.getState().isFloorplanHovered || performance.now() - wallAt < 64) return
      session.apply({
        planPoint: [event.position[0], event.position[2]],
        modifiers: event.nativeEvent,
      })
      setValid(session.canCommit())
      if (!session.candidate) clearPlacementSurface()
    }
    const commit = () => {
      if (finished || isCameraDragging() || !session.canCommit()) return
      const history = beginOpeningMoveHistorySession()
      let id: AnyNodeId | null = node.id as AnyNodeId
      try {
        if (isFreshPlacementMetadata(node.metadata)) {
          session.commit()
          id = commitFreshPlacementSubtree(node.id as AnyNodeId, { visible: true })
        } else history.commitStep(() => session.commit())
        finished = true
      } finally {
        history.end()
      }
      if (id) selectNode(id)
      triggerSFX('sfx:item-place')
      useEditor.getState().setMovingNode(null)
    }
    const clickWall = (event: WallEvent) => {
      onWall(event)
      if (session.canCommit()) {
        event.stopPropagation()
        commit()
      }
    }
    const clickGrid = (event: GridEvent) => {
      onGrid(event)
      commit()
    }
    const cancel = () => {
      usePlacementPreview.getState().clear()
      useLiveNodeOverrides.getState().clear(node.id as AnyNodeId)
      useEditor.getState().setMovingNode(null)
    }
    const release = (event: PointerEvent) => {
      if (consumePlacementDragRelease(event)) commit()
    }
    const key = (event: KeyboardEvent) => {
      if (useEditor.getState().isFloorplanHovered || event.repeat || event.metaKey || event.ctrlKey)
        return
      if ((event.target as HTMLElement)?.closest('input,textarea,[contenteditable="true"]')) return
      if (event.key.toLowerCase() === 'r') {
        event.preventDefault()
        session.flipSide?.()
        setValid(session.canCommit())
      }
    }
    emitter.on('wall:enter', onWall)
    emitter.on('wall:move', onWall)
    emitter.on('wall:click', clickWall)
    emitter.on('grid:move', onGrid)
    emitter.on('grid:click', clickGrid)
    emitter.on('tool:cancel', cancel)
    window.addEventListener('pointerup', release)
    window.addEventListener('keydown', key)
    return () => {
      emitter.off('wall:enter', onWall)
      emitter.off('wall:move', onWall)
      emitter.off('wall:click', clickWall)
      emitter.off('grid:move', onGrid)
      emitter.off('grid:click', clickGrid)
      emitter.off('tool:cancel', cancel)
      window.removeEventListener('pointerup', release)
      window.removeEventListener('keydown', key)
      useLiveNodeOverrides.getState().clear(node.id as AnyNodeId)
      usePlacementPreview.getState().clear()
      clearPlacementSurface()
      releaseWallEvents()
    }
  }, [node, activeLevelId, isCameraDragging, selectNode])
  return <WallGhost node={node} valid={valid} levelId={activeLevelId} />
}
function WallGhost({
  node,
  valid,
  levelId,
}: {
  node: ProceduralItemNode
  valid: boolean
  levelId: AnyNodeId | null
}) {
  const preview = usePlacementPreview((s) =>
    s.node?.id === node.id ? (s.node as unknown as ProceduralItemNode) : null,
  )
  const [built, setBuilt] = useState<ReturnType<typeof acquireProceduralGeometry>['value'] | null>(
    null,
  )
  useEffect(() => {
    const lease = acquireProceduralGeometry(node)
    setBuilt(lease.value)
    return lease.release
  }, [node.recipe, node.parameters, node])
  const material = useMemo(
    () =>
      new MeshBasicNodeMaterial({
        color: valid ? '#86efac' : '#f87171',
        transparent: true,
        opacity: 0.65,
        depthWrite: false,
      }),
    [valid],
  )
  useEffect(() => () => material.dispose(), [material])
  if (!preview || !built) return null
  const { frame } = queryProceduralItem(preview, useScene.getState().nodes)
  const position = [...frame.position] as [number, number, number]
  position[1] += levelId ? (sceneRegistry.nodes.get(levelId)?.position.y ?? 0) : 0
  const yaw = Math.atan2(frame.axes[2][0], frame.axes[2][2])
  return (
    <group position={position} rotation-y={yaw}>
      {built.batches.map((batch) => (
        <mesh
          key={batch.slot}
          geometry={batch.geometry}
          material={material}
          dispose={null}
          raycast={() => {}}
        />
      ))}
    </group>
  )
}
