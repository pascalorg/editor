'use client'

import {
  type ComponentProps,
  memo,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react'
import useEditor from '../../store/use-editor'
import { NodeActionMenu } from '../editor/node-action-menu'

type SvgPoint = {
  x: number
  y: number
}

export type FloorplanActionMenuHandler = (event: ReactMouseEvent<HTMLButtonElement>) => void
type NodeActionMenuProps = ComponentProps<typeof NodeActionMenu>

export type FloorplanActionMenuEntry = {
  position: SvgPoint | null
  customContent?: ReactNode
  extraActionIcon?: NodeActionMenuProps['extraActionIcon']
  extraActionLabel?: string
  onDelete: FloorplanActionMenuHandler
  onMove: FloorplanActionMenuHandler
  onDuplicate?: FloorplanActionMenuHandler
  onExtraAction?: FloorplanActionMenuHandler
}

type FloorplanActionMenuLayerProps = {
  item: FloorplanActionMenuEntry
  wall: FloorplanActionMenuEntry
  fence: FloorplanActionMenuEntry
  slab: FloorplanActionMenuEntry
  ceiling: FloorplanActionMenuEntry
  opening: FloorplanActionMenuEntry
  stair: FloorplanActionMenuEntry
  roof: FloorplanActionMenuEntry
  offsetY?: number
}

export const FloorplanActionMenuLayer = memo(function FloorplanActionMenuLayer({
  item,
  wall,
  fence,
  slab,
  ceiling,
  opening,
  stair,
  roof,
  offsetY = 10,
}: FloorplanActionMenuLayerProps) {
  const isFloorplanHovered = useEditor((state) => state.isFloorplanHovered)
  const movingNode = useEditor((state) => state.movingNode)
  const movingFenceEndpoint = useEditor((state) => state.movingFenceEndpoint)
  const curvingWall = useEditor((state) => state.curvingWall)
  const curvingFence = useEditor((state) => state.curvingFence)

  if (!isFloorplanHovered || movingNode || movingFenceEndpoint || curvingWall || curvingFence) {
    return null
  }

  const entries: FloorplanActionMenuEntry[] = [
    item,
    wall,
    fence,
    slab,
    ceiling,
    opening,
    stair,
    roof,
  ]

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
            {entry.customContent ? (
              entry.customContent
            ) : (
              <NodeActionMenu
                extraActionIcon={entry.extraActionIcon}
                extraActionLabel={entry.extraActionLabel}
                onDelete={entry.onDelete}
                onDuplicate={entry.onDuplicate}
                onExtraAction={entry.onExtraAction}
                onMove={entry.onMove}
                onPointerDown={(event) => event.stopPropagation()}
                onPointerUp={(event) => event.stopPropagation()}
              />
            )}
          </div>
        ) : null,
      )}
    </>
  )
})
