import '../../../three-types'

import {
  COLUMN_PRESETS,
  ColumnNode,
  type ColumnNode as ColumnNodeType,
  type ColumnPresetId,
  emitter,
  type GridEvent,
  type LevelNode,
  useScene,
} from '@pascal-app/core'
import { useEffect, useRef, useState } from 'react'
import type { Group } from 'three'
import { sfxEmitter } from '../../../lib/sfx-bus'
import useEditor from '../../../store/use-editor'
import { CursorSphere } from '../shared/cursor-sphere'

const COLUMN_ICON = (
  // eslint-disable-next-line @next/next/no-img-element
  <img
    alt="Column"
    src="/icons/column.png"
    style={{ width: '100%', height: '100%', objectFit: 'contain' }}
  />
)

const roundToHalf = (value: number) => Math.round(value * 2) / 2
const DEFAULT_COLUMN_PRESET_ID = 'basicPillar' satisfies ColumnPresetId

function createColumnFromPreset(presetId: ColumnPresetId, position: [number, number, number]) {
  const { label, ...preset } = COLUMN_PRESETS[presetId]
  return ColumnNode.parse({
    name: label,
    position,
    rotation: 0,
    ...preset,
  })
}

type ColumnToolProps = {
  currentLevelId: LevelNode['id'] | null
  onPlaced?: (nodeId: ColumnNodeType['id']) => void
}

export const ColumnTool: React.FC<ColumnToolProps> = ({ currentLevelId, onPlaced }) => {
  const [, setCursorPosition] = useState<[number, number, number] | null>(null)
  const cursorRef = useRef<Group>(null)

  useEffect(() => {
    if (!currentLevelId) return

    const onGridMove = (event: GridEvent) => {
      const nextPosition: [number, number, number] = [
        roundToHalf(event.localPosition[0]),
        0,
        roundToHalf(event.localPosition[2]),
      ]
      setCursorPosition(nextPosition)
      cursorRef.current?.position.set(nextPosition[0], event.localPosition[1], nextPosition[2])
    }

    const onGridClick = (event: GridEvent) => {
      const position: [number, number, number] = [
        roundToHalf(event.localPosition[0]),
        0,
        roundToHalf(event.localPosition[2]),
      ]
      const column = createColumnFromPreset(DEFAULT_COLUMN_PRESET_ID, position)
      useScene.getState().createNode(column, currentLevelId)
      onPlaced?.(column.id)
      sfxEmitter.emit('sfx:structure-build')
      useEditor.getState().setTool(null)
      useEditor.getState().setMode('select')
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)

    return () => {
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
    }
  }, [currentLevelId, onPlaced])

  if (!currentLevelId) return null

  return (
    <CursorSphere
      color="#a78bfa"
      height={2.8}
      ref={cursorRef}
      showTooltip
      tooltipContent={COLUMN_ICON}
    />
  )
}
