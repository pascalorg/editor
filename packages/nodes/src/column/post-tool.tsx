'use client'

import {
  type AnyNodeId,
  type ColumnNode,
  ColumnNode as ColumnNodeSchema,
  emitter,
  type GridEvent,
  resolveSupportSlabPatch,
  useScene,
} from '@pascal-app/core'
import {
  getFloorStackPreviewPosition,
  triggerSFX,
  useEditor,
  usePlacementPreview,
  useWallSnapIndicator,
  type WallPlanPoint,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useRef, useState } from 'react'
import type { Group } from 'three'
import {
  type FloorPlacementClickTriggerEvent,
  stopPlacementCommitPropagation,
  subscribeFloorPlacementClicks,
} from '../shared/floor-placement'
import {
  electedPostFoot,
  type FramingPostToolChoices,
  framingPostAt,
  snapPostPoint,
} from './post-placement'
import { ColumnPreview } from './renderer'

type Placed = { point: WallPlanPoint; post: ColumnNode; beamId: string | null }

/**
 * The Post tool: the column tool armed with a framing post (`framingPostToolChoices`). The post
 * snaps under a beam's end, anywhere along a beam, onto another post, else to the grid (Alt free);
 * it stands from what it lands on up to the underside of the beam over it, else to the ceiling
 * plane, and the ghost shows that height before the click. Repeats as the column tool does.
 */
export function FramingPostTool({ choices }: { choices: FramingPostToolChoices }) {
  const levelId = useViewer((state) => state.selection.levelId)
  const cursorRef = useRef<Group>(null)
  const [ghost, setGhost] = useState<ColumnNode | null>(null)

  useEffect(() => {
    if (!levelId) return
    let last: Placed | null = null
    setGhost(null)

    const place = (raw: WallPlanPoint, free: boolean): Placed => {
      const nodes = useScene.getState().nodes
      const { point, snap } = snapPostPoint({ point: raw, nodes, levelId, free })
      if (snap) useWallSnapIndicator.getState().set({ x: point[0], z: point[1], kind: snap })
      else useWallSnapIndicator.getState().clear()
      return {
        point,
        ...framingPostAt({ nodes, levelId, point, choices, foot: electedPostFoot(nodes, levelId) }),
      }
    }
    const show = (placed: Placed) => {
      const visual = getFloorStackPreviewPosition({
        node: placed.post,
        position: placed.post.position,
        rotation: 0,
        levelId,
      })
      cursorRef.current?.position.set(...visual)
      usePlacementPreview.getState().set(placed.post)
      setGhost(placed.post)
    }

    const onMove = (event: GridEvent) => {
      const next = place(
        [event.localPosition[0], event.localPosition[2]],
        event.nativeEvent?.altKey === true,
      )
      if (
        last &&
        last.point[0] === next.point[0] &&
        last.point[1] === next.point[1] &&
        Math.abs(last.post.height - next.post.height) < 1e-6
      )
        return
      if (!last || last.point[0] !== next.point[0] || last.point[1] !== next.point[1])
        triggerSFX('sfx:grid-snap')
      last = next
      show(next)
    }

    const onClick = (event: FloorPlacementClickTriggerEvent) => {
      // A click on a beam or a post is a node event, its point not the level's: use the move's.
      const placed =
        last ??
        place([event.localPosition[0], event.localPosition[2]], event.nativeEvent?.altKey === true)
      stopPlacementCommitPropagation(event)
      const nodes = useScene.getState().nodes
      const posts = Object.values(nodes).filter(
        (node) => node.type === 'column' && node.role === 'post',
      ).length
      const post = ColumnNodeSchema.parse({
        ...placed.post,
        name: `Post ${posts + 1}`,
        ...resolveSupportSlabPatch(placed.post, { ...nodes, [placed.post.id]: placed.post }),
      })
      useScene.getState().createNode(post, levelId as AnyNodeId)
      triggerSFX('sfx:structure-build')
      last = null
      if (useEditor.getState().getContinuation('point') === 'repeat') return
      useViewer.getState().setSelection({ selectedIds: [post.id] })
      usePlacementPreview.getState().clear()
      useEditor.getState().setTool(null)
      useEditor.getState().setMode('select')
    }

    emitter.on('grid:move', onMove)
    const unsubscribeClicks = subscribeFloorPlacementClicks(onClick)
    return () => {
      emitter.off('grid:move', onMove)
      unsubscribeClicks()
      usePlacementPreview.getState().clear()
      useWallSnapIndicator.getState().clear()
    }
  }, [levelId, choices])

  if (!levelId) return null
  return (
    <group ref={cursorRef} visible={ghost !== null}>
      {ghost && <ColumnPreview node={ghost} />}
    </group>
  )
}
