'use client'

import { memo, type MouseEvent as ReactMouseEvent } from 'react'
import useEditor from '../../store/use-editor'
import {
  useEndpointReshape,
  useIsCurveReshape,
  useMovingNode,
} from '../../store/use-interaction-scope'
import { NodeActionMenu } from '../editor/node-action-menu'

type SvgPoint = {
  x: number
  y: number
}

export type FloorplanActionMenuHandler = (event: ReactMouseEvent<HTMLButtonElement>) => void

export type FloorplanActionMenuEntry = {
  position: SvgPoint | null
  onDelete: FloorplanActionMenuHandler
  onMove?: FloorplanActionMenuHandler
  onAddHole?: FloorplanActionMenuHandler
  onCurve?: FloorplanActionMenuHandler
  onDuplicate?: FloorplanActionMenuHandler
}

type FloorplanActionMenuLayerProps = {
  elevator: FloorplanActionMenuEntry
  item: FloorplanActionMenuEntry
  wall: FloorplanActionMenuEntry
  fence: FloorplanActionMenuEntry
  slab: FloorplanActionMenuEntry
  ceiling: FloorplanActionMenuEntry
  opening: FloorplanActionMenuEntry
  spawn: FloorplanActionMenuEntry
  stair: FloorplanActionMenuEntry
  roof: FloorplanActionMenuEntry
  offsetY?: number
}

export const FloorplanActionMenuLayer = memo(function FloorplanActionMenuLayer({
  elevator,
  item,
  wall,
  fence,
  slab,
  ceiling,
  opening,
  spawn,
  stair,
  roof,
  offsetY = 10,
}: FloorplanActionMenuLayerProps) {
  const isFloorplanHovered = useEditor((state) => state.isFloorplanHovered)
  const movingNode = useMovingNode()
  const endpointReshape = useEndpointReshape()
  const isCurveReshape = useIsCurveReshape()

  if (!isFloorplanHovered || movingNode || endpointReshape || isCurveReshape) {
    return null
  }

  const entries: FloorplanActionMenuEntry[] = [
    elevator,
    item,
    wall,
    fence,
    slab,
    ceiling,
    opening,
    spawn,
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
            <NodeActionMenu
              onAddHole={entry.onAddHole}
              onCurve={entry.onCurve}
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
