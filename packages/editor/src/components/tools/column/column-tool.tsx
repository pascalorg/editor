import '../../../three-types'

import {
  COLUMN_PRESETS,
  ColumnNode,
  type ColumnNode as ColumnNodeType,
  type ColumnPresetId,
  collectAlignmentAnchors,
  emitter,
  type GridEvent,
  type LevelNode,
  resolveAlignment,
  useAlignmentGuides,
  useScene,
} from '@pascal-app/core'
import { useEffect, useRef, useState } from 'react'
import type { Group } from 'three'
import { sfxEmitter } from '../../../lib/sfx-bus'
import { CursorSphere } from '../shared/cursor-sphere'

/** Figma-style alignment-snap threshold (meters), matching the move tools. */
const ALIGNMENT_THRESHOLD_M = 0.08

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

    // Alignment candidates — anchors of every alignable object; refreshed
    // after each placement so a newly-placed column is a target too.
    let alignmentCandidates = collectAlignmentAnchors(useScene.getState().nodes, '')
    // Snap the column origin onto another object's nearest real anchor and
    // publish the guide. The probe is the RAW cursor, NOT the 0.5m-grid-snapped
    // point: resolving against the grid point would only ever catch anchors
    // that happen to sit on a grid line, so off-grid items (furniture, angled
    // walls) would never surface a guide. The matched axis locks exactly to the
    // candidate's coordinate; the other axis keeps its grid snap. Alt bypasses.
    const alignPoint = (
      gridX: number,
      gridZ: number,
      rawX: number,
      rawZ: number,
      bypass: boolean,
    ): [number, number] => {
      if (bypass || alignmentCandidates.length === 0) {
        useAlignmentGuides.getState().clear()
        return [gridX, gridZ]
      }
      const ar = resolveAlignment({
        moving: [{ nodeId: '__column-draft__', kind: 'corner', x: rawX, z: rawZ }],
        candidates: alignmentCandidates,
        threshold: ALIGNMENT_THRESHOLD_M,
      })
      if (ar.guides.length === 0) {
        useAlignmentGuides.getState().clear()
        return [gridX, gridZ]
      }
      useAlignmentGuides.getState().set(ar.guides)
      let x = gridX
      let z = gridZ
      for (const guide of ar.guides) {
        if (guide.axis === 'x') x = guide.coord
        else z = guide.coord
      }
      return [x, z]
    }

    const onGridMove = (event: GridEvent) => {
      const [ax, az] = alignPoint(
        roundToHalf(event.localPosition[0]),
        roundToHalf(event.localPosition[2]),
        event.localPosition[0],
        event.localPosition[2],
        event.nativeEvent?.altKey === true,
      )
      const nextPosition: [number, number, number] = [ax, 0, az]
      setCursorPosition(nextPosition)
      cursorRef.current?.position.set(nextPosition[0], event.localPosition[1], nextPosition[2])
    }

    const onGridClick = (event: GridEvent) => {
      const [ax, az] = alignPoint(
        roundToHalf(event.localPosition[0]),
        roundToHalf(event.localPosition[2]),
        event.localPosition[0],
        event.localPosition[2],
        event.nativeEvent?.altKey === true,
      )
      const column = createColumnFromPreset(DEFAULT_COLUMN_PRESET_ID, [ax, 0, az])
      useScene.getState().createNode(column, currentLevelId)
      onPlaced?.(column.id)
      sfxEmitter.emit('sfx:structure-build')
      alignmentCandidates = collectAlignmentAnchors(useScene.getState().nodes, '')
      useAlignmentGuides.getState().clear()
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)

    return () => {
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
      useAlignmentGuides.getState().clear()
    }
  }, [currentLevelId, onPlaced])

  if (!currentLevelId) return null

  return (
    <CursorSphere
      color="#a78bfa"
      height={2.5}
      ref={cursorRef}
      showTooltip
      tooltipContent={COLUMN_ICON}
    />
  )
}
