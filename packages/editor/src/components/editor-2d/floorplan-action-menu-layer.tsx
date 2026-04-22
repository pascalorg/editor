'use client'

import { memo, type MouseEvent as ReactMouseEvent } from 'react'
import useEditor from '../../store/use-editor'
import { NodeActionMenu } from '../editor/node-action-menu'

type SvgPoint = {
  x: number
  y: number
}

export type FloorplanActionMenuHandler = (event: ReactMouseEvent<HTMLButtonElement>) => void

export type FloorplanActionMenuEntry = {
  position: SvgPoint | null
  onDelete: FloorplanActionMenuHandler
  onMove: FloorplanActionMenuHandler
  onDuplicate?: FloorplanActionMenuHandler
}

type FloorplanActionMenuLayerProps = {
  item: FloorplanActionMenuEntry
  wall: FloorplanActionMenuEntry
  slab: FloorplanActionMenuEntry
  ceiling: FloorplanActionMenuEntry
  opening: FloorplanActionMenuEntry
  stair: FloorplanActionMenuEntry
  offsetY?: number
}

export const FloorplanActionMenuLayer = memo(function FloorplanActionMenuLayer({
  item,
  wall,
  slab,
  ceiling,
  opening,
  stair,
  offsetY = 10,
}: FloorplanActionMenuLayerProps) {
  const isFloorplanHovered = useEditor((state) => state.isFloorplanHovered)
  const movingNode = useEditor((state) => state.movingNode)
  const curvingWall = useEditor((state) => state.curvingWall)
  const curvingFence = useEditor((state) => state.curvingFence)

  if (!isFloorplanHovered || movingNode || curvingWall || curvingFence) {
    return null
  }

  const entries: FloorplanActionMenuEntry[] = [item, wall, slab, ceiling, opening, stair]

  return (
    <>
      {entries.map((entry, index) =>
        entry.position ? (
          <div
            className="absolute z-30"
            key={index}
            style={{
              left: entry.position.x,
              top: entry.position.y,
              transform: `translate(-50%, calc(-100% - ${offsetY}px))`,
            }}
          >
            <NodeActionMenu
              onDelete={entry.onDelete}
              onDuplicate={entry.onDuplicate}
              onMove={entry.onMove}
              onPointerDown={(event) => event.stopPropagation()}
              onPointerUp={(event) => event.stopPropagation()}
            />
          </div>
        ) : null,
      )}
    </>
  )
})
