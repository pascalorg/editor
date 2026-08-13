'use client'

import {
  type AnyNode,
  type AnyNodeId,
  emitter,
  type GridEvent,
  runAsSingleSceneHistoryStep,
  SectionPlaneNode,
  useScene,
} from '@pascal-app/core'
import { triggerSFX, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useState } from 'react'
import { LevelOffsetGroup } from '../shared/level-offset-group'
import { sectionPlaneDefinition } from './definition'
import { buildSectionPlaneGeometry } from './geometry'

/**
 * Where a fresh horizontal cut lands — roughly eye level, which is the height
 * that reads as a floor plan rather than as a shaved-off ceiling.
 */
const DEFAULT_CUT_HEIGHT = 1.2

/**
 * Click-place tool for section planes. A ghost of the plane widget follows the
 * cursor across the floor; clicking drops a horizontal cut at eye level, which
 * the user then slides or rotates with the ordinary move / rotate handles.
 *
 * The new plane becomes the active one — only a single plane cuts, so placing
 * a second while a first is live would otherwise do nothing visible.
 */
const SectionPlaneTool = () => {
  const activeLevelId = useViewer((s) => s.selection.levelId)
  const [cursor, setCursor] = useState<[number, number, number] | null>(null)

  const previewNode = useMemo(
    () => SectionPlaneNode.parse({ ...sectionPlaneDefinition.defaults() }),
    [],
  )
  const ghost = useMemo(() => buildSectionPlaneGeometry(previewNode), [previewNode])

  useEffect(() => {
    if (!activeLevelId) return

    // No grid snap: a cut height of exactly 1.2 m matters more than landing on
    // a grid line, and the plane is infinite in its own directions anyway.
    const onMove = (event: GridEvent) =>
      setCursor([event.localPosition[0], DEFAULT_CUT_HEIGHT, event.localPosition[2]])

    const onClick = (event: GridEvent) => {
      const scene = useScene.getState()
      const plane = SectionPlaneNode.parse({
        ...sectionPlaneDefinition.defaults(),
        name: 'Section Plane',
        position: [event.localPosition[0], DEFAULT_CUT_HEIGHT, event.localPosition[2]],
        active: true,
        parentId: activeLevelId,
      })

      const standDown: Array<{ id: AnyNodeId; data: Partial<AnyNode> }> = []
      for (const node of Object.values(scene.nodes)) {
        if (node.type === 'section-plane' && node.active) {
          standDown.push({ id: node.id, data: { active: false } as Partial<AnyNode> })
        }
      }

      // Creating the plane and standing the previous one down is one action to
      // the user, so it has to be one undo step rather than two.
      runAsSingleSceneHistoryStep(useScene, () => {
        scene.createNode(plane, activeLevelId)
        if (standDown.length > 0) scene.updateNodes(standDown)
      })
      useViewer.getState().setSelection({ selectedIds: [plane.id] })
      useEditor.getState().setTool(null)
      triggerSFX('sfx:item-place')
    }

    emitter.on('grid:move', onMove)
    emitter.on('grid:click', onClick)
    return () => {
      emitter.off('grid:move', onMove)
      emitter.off('grid:click', onClick)
    }
  }, [activeLevelId])

  if (!activeLevelId || !cursor) return null

  return (
    <LevelOffsetGroup>
      <group position={cursor}>
        <primitive object={ghost} />
      </group>
    </LevelOffsetGroup>
  )
}

export default SectionPlaneTool
