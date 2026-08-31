'use client'

import {
  type AnyNode,
  type AnyNodeId,
  emitter,
  type GridEvent,
  getLevelElevations,
  getWallBaseElevationForNodes,
  type LeanToExtensionNode,
  type SceneApi,
  sceneRegistry,
  useLiveNodeOverrides,
  type WallEvent,
  type WallNode,
} from '@pascal-app/core'
import { isGridSnapActive, triggerSFX, useEditor } from '@pascal-app/editor'
import { useLayoutEffect, useState } from 'react'
import { leanToExtensionGeometryKey } from './geometry'
import {
  leanToWallLocalPose,
  resolveLeanToEdgeSnapTargets,
  resolveLeanToMoveProposal,
} from './layout'
import { moveLeanToAlongSlabEdge, resolveLeanToPlanPosition } from './placement'
import { leanToPlacementConflicts, resolveLeanToEndAbutments } from './placement-validation'
import LeanToExtensionPreview from './preview'

type MoveLeanToExtensionProps = {
  node: LeanToExtensionNode
  sceneApi: SceneApi
}

type MovePreview = {
  node: LeanToExtensionNode
  position: [number, number, number]
  rotationY: number
  valid: boolean
}

const MoveLeanToExtensionTool = ({ node, sceneApi }: MoveLeanToExtensionProps) => {
  const [preview, setPreview] = useState<MovePreview | null>(null)

  useLayoutEffect(() => {
    const parent = node.parentId ? sceneApi.get(node.parentId as AnyNodeId) : undefined
    const wall = parent?.type === 'wall' ? (parent as WallNode) : null
    const levelHosted =
      parent?.type === 'level' &&
      (node.hostKind === 'freestanding' || node.hostKind === 'slab-edge')
    if (!(wall || levelHosted)) return

    let lastPatch: Partial<LeanToExtensionNode> | null = null
    let dragStartLocalY: number | null = null
    const movedObject = sceneRegistry.nodes.get(node.id)
    const movedObjectVisible = movedObject?.visible
    if (movedObject) movedObject.visible = false
    const restoreRaycasts: Array<() => void> = []
    movedObject?.traverse((child) => {
      const original = child.raycast
      child.raycast = () => {}
      restoreRaycasts.push(() => {
        child.raycast = original
      })
    })

    const liveOverrides = useLiveNodeOverrides.getState()
    const previousVisibleOverride = liveOverrides.get(node.id)?.visible
    liveOverrides.set(node.id, { visible: false })

    const resolveBaseY = () => {
      if (!wall) return 0
      const nodes = sceneApi.nodes() as Record<AnyNodeId, AnyNode>
      const levelY = wall.parentId ? (getLevelElevations(nodes).get(wall.parentId)?.baseY ?? 0) : 0
      return levelY + getWallBaseElevationForNodes(wall, nodes)
    }

    const publishPatch = (patch: Partial<LeanToExtensionNode>, valid = true) => {
      const candidate = { ...node, ...patch } as LeanToExtensionNode
      const pose = wall
        ? leanToWallLocalPose(wall, candidate, resolveBaseY())
        : { position: candidate.position, rotationY: candidate.rotation[1] }
      setPreview((current) => ({
        node:
          current &&
          leanToExtensionGeometryKey(current.node) === leanToExtensionGeometryKey(candidate)
            ? current.node
            : candidate,
        ...pose,
        valid,
      }))
      lastPatch = valid ? patch : null
      return valid ? patch : null
    }

    publishPatch({})

    const restoreSource = () => {
      if (movedObject && movedObjectVisible !== undefined) movedObject.visible = movedObjectVisible
      const overrides = useLiveNodeOverrides.getState()
      if (previousVisibleOverride === undefined) {
        overrides.clearFields(node.id, ['visible'])
      } else {
        overrides.set(node.id, { visible: previousVisibleOverride })
      }
    }

    const commit = () => {
      if (!lastPatch) return
      sceneApi.update(node.id as AnyNodeId, lastPatch as Partial<AnyNode>)
      triggerSFX('sfx:structure-build')
      useEditor.getState().setMovingNode(null)
    }

    const cleanUp = () => {
      restoreSource()
      for (const restore of restoreRaycasts) restore()
      lastPatch = null
    }

    if (wall) {
      const resolvePatch = (event: WallEvent) => {
        if (event.node.id !== wall.id) return null
        dragStartLocalY ??= event.localPosition[1]
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
          rawLocalX: event.localPosition[0],
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
        if (
          !event.nativeEvent.altKey &&
          leanToPlacementConflicts(candidate, wall, nodes).length > 0
        ) {
          publishPatch(patch, false)
          return null
        }
        return publishPatch(patch)
      }
      const onMove = (event: WallEvent) => {
        resolvePatch(event)
      }
      const onClick = (event: WallEvent) => {
        if (!resolvePatch(event)) return
        event.stopPropagation()
        commit()
      }
      emitter.on('wall:move', onMove)
      emitter.on('wall:enter', onMove)
      emitter.on('wall:click', onClick)
      return () => {
        emitter.off('wall:move', onMove)
        emitter.off('wall:enter', onMove)
        emitter.off('wall:click', onClick)
        cleanUp()
      }
    }

    if (
      parent?.type === 'level' &&
      (node.hostKind === 'freestanding' || node.hostKind === 'slab-edge')
    ) {
      const resolvePatch = (event: GridEvent): Partial<LeanToExtensionNode> | null => {
        if (node.hostKind === 'slab-edge') {
          const resolved = moveLeanToAlongSlabEdge(
            node,
            [event.localPosition[0], event.localPosition[2]],
            sceneApi.nodes(),
          )
          if (!resolved) return null
          return publishPatch({
            hostSlabEdgeT: resolved.hostSlabEdgeT,
            position: resolved.position,
            rotation: resolved.rotation,
            span: resolved.span,
            highEdgeHeight: resolved.highEdgeHeight,
            lowEdgeHeight: resolved.lowEdgeHeight,
          })
        }
        const step =
          !event.nativeEvent.altKey && isGridSnapActive() ? useEditor.getState().gridSnapStep : 0
        const snap = (value: number) => (step > 0 ? Math.round(value / step) * step : value)
        return publishPatch({
          position: resolveLeanToPlanPosition(node, [
            snap(event.localPosition[0]),
            snap(event.localPosition[2]),
          ]),
        })
      }
      const onMove = (event: GridEvent) => {
        resolvePatch(event)
      }
      const onClick = (event: GridEvent) => {
        if (!resolvePatch(event)) return
        commit()
      }
      emitter.on('grid:move', onMove)
      emitter.on('grid:click', onClick)
      return () => {
        emitter.off('grid:move', onMove)
        emitter.off('grid:click', onClick)
        cleanUp()
      }
    }

    return cleanUp
  }, [node, sceneApi])

  if (!preview) return null
  return (
    <group position={preview.position} rotation={[0, preview.rotationY, 0]}>
      <LeanToExtensionPreview invalid={!preview.valid} node={preview.node} />
    </group>
  )
}

export default MoveLeanToExtensionTool
