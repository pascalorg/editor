'use client'

import { DataWidgetNode, emitter, type GridEvent, sceneRegistry, useScene } from '@pascal-app/core'
import { CursorSphere, triggerSFX, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useRef } from 'react'
import { type Group, Vector3 } from 'three'

const roundToHalf = (value: number) => Math.round(value * 2) / 2
const worldVector = new Vector3()

function getLevelLocalPosition(levelId: string, event: GridEvent): [number, number, number] {
  const levelObject = sceneRegistry.nodes.get(levelId)
  if (!levelObject) {
    return [
      roundToHalf(event.localPosition[0]),
      event.localPosition[1] + 2,
      roundToHalf(event.localPosition[2]),
    ]
  }
  worldVector.set(event.position[0], event.position[1] + 2, event.position[2])
  levelObject.updateWorldMatrix(true, false)
  levelObject.worldToLocal(worldVector)
  return [roundToHalf(worldVector.x), worldVector.y, roundToHalf(worldVector.z)]
}

export default function DataWidgetTool() {
  const activeLevelId = useViewer((state) => state.selection.levelId)
  const cursorRef = useRef<Group>(null)

  useEffect(() => {
    if (!activeLevelId) return

    const onGridMove = (event: GridEvent) => {
      cursorRef.current?.position.set(
        roundToHalf(event.localPosition[0]),
        event.localPosition[1] + 2,
        roundToHalf(event.localPosition[2]),
      )
    }

    const onGridClick = (event: GridEvent) => {
      const widget = DataWidgetNode.parse({
        name: '\u5355\u6807\u7b7e',
        position: getLevelLocalPosition(activeLevelId, event),
        widgetType: 'label',
        dataKey: 'machine.temperature',
        template: '{label}: {value}{unit}',
      })

      useScene.getState().createNode(widget, activeLevelId)
      useViewer.getState().setSelection({ selectedIds: [widget.id] })
      triggerSFX('sfx:structure-build')
      useEditor.getState().setTool(null)
      useEditor.getState().setMode('select')
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)
    return () => {
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
    }
  }, [activeLevelId])

  if (!activeLevelId) return null
  return <CursorSphere color="#38bdf8" height={2} ref={cursorRef} />
}
