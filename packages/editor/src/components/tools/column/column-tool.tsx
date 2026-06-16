import '../../../three-types'

import {
  type ColumnNode as ColumnNodeType,
  emitter,
  type GridEvent,
  type LevelNode,
  useScene,
} from '@pascal-app/core'
import { useEffect, useMemo, useRef, useState } from 'react'
import type * as THREE from 'three'
import { sfxEmitter } from '../../../lib/sfx-bus'
import { CursorSphere } from '../shared/cursor-sphere'
import { createColumnFromPreset, DEFAULT_COLUMN_PRESET_ID } from './column-defaults'

const COLUMN_ICON = (
  // eslint-disable-next-line @next/next/no-img-element
  <img
    alt="Column"
    src="/icons/column.png"
    style={{ width: '100%', height: '100%', objectFit: 'contain' }}
  />
)

const GRID_OFFSET = 0.02
const roundToHalf = (value: number) => Math.round(value * 2) / 2
const disablePreviewRaycast = () => null

type ColumnToolProps = {
  currentLevelId: LevelNode['id'] | null
  onPlaced?: (nodeId: ColumnNodeType['id']) => void
}

export const ColumnTool: React.FC<ColumnToolProps> = ({ currentLevelId, onPlaced }) => {
  const [, setCursorPosition] = useState<[number, number, number] | null>(null)
  const cursorRef = useRef<THREE.Group>(null)
  const previewRef = useRef<THREE.Group>(null)
  const previewColumn = useMemo(
    () => createColumnFromPreset(DEFAULT_COLUMN_PRESET_ID, [0, 0, 0]),
    [],
  )
  const isRoundPreview =
    previewColumn.crossSection === 'round' ||
    previewColumn.crossSection === 'octagonal' ||
    previewColumn.crossSection === 'sixteen-sided'
  const previewSegments =
    previewColumn.crossSection === 'octagonal'
      ? 8
      : previewColumn.crossSection === 'sixteen-sided'
        ? 16
        : 32
  const previewWidth = isRoundPreview ? previewColumn.radius * 2 : previewColumn.width
  const previewDepth = isRoundPreview ? previewColumn.radius * 2 : previewColumn.depth

  useEffect(() => {
    if (!currentLevelId) return

    const onGridMove = (event: GridEvent) => {
      const nextPosition: [number, number, number] = [
        roundToHalf(event.localPosition[0]),
        0,
        roundToHalf(event.localPosition[2]),
      ]
      setCursorPosition(nextPosition)
      cursorRef.current?.position.set(
        nextPosition[0],
        event.localPosition[1] + GRID_OFFSET,
        nextPosition[2],
      )
      previewRef.current?.position.set(nextPosition[0], event.localPosition[1], nextPosition[2])
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
    <group>
      <CursorSphere
        color="#a78bfa"
        height={previewColumn.height}
        ref={cursorRef}
        showTooltip
        tooltipContent={COLUMN_ICON}
      />
      <group ref={previewRef}>
        <mesh
          castShadow
          position={[0, previewColumn.height / 2, 0]}
          raycast={disablePreviewRaycast}
        >
          {isRoundPreview ? (
            <cylinderGeometry
              args={[
                previewColumn.radius,
                previewColumn.radius,
                previewColumn.height,
                previewSegments,
              ]}
            />
          ) : (
            <boxGeometry args={[previewWidth, previewColumn.height, previewDepth]} />
          )}
          <meshStandardMaterial color="#a78bfa" depthWrite={false} opacity={0.35} transparent />
        </mesh>
      </group>
    </group>
  )
}
