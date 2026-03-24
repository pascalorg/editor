'use client'

import { type AnyNode, type AnyNodeId, useScene, type WallNode } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useCallback } from 'react'
import { formatLength, METERS_PER_INCH } from '../../../lib/measurements'
import { PanelSection } from '../controls/panel-section'
import { MetricControl } from '../controls/metric-control'
import { SliderControl } from '../controls/slider-control'
import { PanelWrapper } from './panel-wrapper'

const DEFAULT_WALL_HEIGHT = 2.5
const DEFAULT_WALL_THICKNESS = 0.1
const VALUE_TOLERANCE = 1e-4

const getWallLength = (wall: WallNode) => {
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  return Math.sqrt(dx * dx + dz * dz)
}

const getUniformValue = (values: number[]) => {
  if (values.length === 0) return null

  const firstValue = values[0]!
  return values.every((value) => Math.abs(value - firstValue) <= VALUE_TOLERANCE) ? firstValue : null
}

export function WallPanel() {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const unitSystem = useViewer((s) => s.unitSystem)
  const setSelection = useViewer((s) => s.setSelection)
  const nodes = useScene((s) => s.nodes)
  const updateNodes = useScene((s) => s.updateNodes)

  const wallNodes = selectedIds
    .map((selectedId) => nodes[selectedId as AnyNode['id']])
    .filter((node): node is WallNode => Boolean(node && node.type === 'wall'))

  const node = wallNodes[0]
  const isSingleWall = wallNodes.length === 1
  const selectionCount = wallNodes.length

  const handleBatchUpdate = useCallback(
    (getUpdates: (wall: WallNode) => Partial<WallNode>) => {
      if (wallNodes.length === 0) return

      updateNodes(wallNodes.map((wall) => ({ id: wall.id, data: getUpdates(wall) })))
      for (const wall of wallNodes) {
        useScene.getState().dirtyNodes.add(wall.id as AnyNodeId)
      }
    },
    [updateNodes, wallNodes],
  )

  const handleClose = useCallback(() => {
    setSelection({ selectedIds: [] })
  }, [setSelection])

  if (!node || wallNodes.length !== selectedIds.length) return null

  const height = getUniformValue(wallNodes.map((wall) => wall.height ?? DEFAULT_WALL_HEIGHT))
  const thickness = getUniformValue(wallNodes.map((wall) => wall.thickness ?? DEFAULT_WALL_THICKNESS))
  const length = getUniformValue(wallNodes.map(getWallLength))
  const hasMixedDimensionValues = height === null || thickness === null
  const title = isSingleWall ? node.name || 'Wall' : `${selectionCount} Walls`

  const handleLengthChange = useCallback(
    (nextLength: number) => {
      const resolvedLength = Math.max(METERS_PER_INCH, nextLength)

      handleBatchUpdate((wall) => {
        const directionX = wall.end[0] - wall.start[0]
        const directionZ = wall.end[1] - wall.start[1]
        const currentLength = Math.hypot(directionX, directionZ)
        const unitX = currentLength > 1e-6 ? directionX / currentLength : 1
        const unitZ = currentLength > 1e-6 ? directionZ / currentLength : 0

        return {
          end: [wall.start[0] + unitX * resolvedLength, wall.start[1] + unitZ * resolvedLength],
        }
      })
    },
    [handleBatchUpdate],
  )

  return (
    <PanelWrapper
      icon="/icons/wall.png"
      onClose={handleClose}
      title={title}
      width={280}
    >
      <PanelSection title="Dimensions">
        {height !== null && (
          <SliderControl
            label="Height"
            max={6}
            min={0.1}
            onChange={(value) =>
              handleBatchUpdate(() => ({ height: Math.max(0.1, value) }))
            }
            precision={2}
            step={0.1}
            unit="m"
            value={Math.round(height * 100) / 100}
          />
        )}
        {thickness !== null && (
          <SliderControl
            label="Thickness"
            max={1}
            min={0.05}
            onChange={(value) =>
              handleBatchUpdate(() => ({ thickness: Math.max(0.05, value) }))
            }
            precision={3}
            step={0.01}
            unit="m"
            value={Math.round(thickness * 1000) / 1000}
          />
        )}
        {!isSingleWall && hasMixedDimensionValues && (
          <p className="px-1 text-muted-foreground text-xs leading-relaxed">
            Only shared wall dimensions are editable in bulk. Mixed values stay read-only until the
            selection matches.
          </p>
        )}
      </PanelSection>

      <PanelSection title="Info">
        {length !== null ? (
          <MetricControl
            editTrigger="doubleClick"
            label="Length"
            max={100}
            min={METERS_PER_INCH}
            onChange={handleLengthChange}
            precision={3}
            step={METERS_PER_INCH}
            unit="m"
            value={length}
          />
        ) : (
          <div className="flex h-10 items-center justify-between rounded-lg border border-border/50 bg-[#2C2C2E] px-3 text-sm">
            <span className="text-muted-foreground">Length</span>
            <span className="font-mono text-muted-foreground">
              Mixed lengths
            </span>
          </div>
        )}
        {!isSingleWall && length !== null && (
          <p className="px-1 text-muted-foreground text-xs leading-relaxed">
            Double-click Length to set every selected wall to {formatLength(length, unitSystem)} and
            then drag or type a new shared value.
          </p>
        )}
      </PanelSection>
    </PanelWrapper>
  )
}
