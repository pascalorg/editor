'use client'

import { usePlacementTyping } from '../../../store/use-placement-typing'
import { PlacementCoordinateInput } from '../../tools/shared/placement-coordinate-input'
import { useFloorplanRender, useFloorplanSceneRotation } from '../floorplan-render-context'

const HUD_WIDTH_PX = 236
const HUD_HEIGHT_PX = 64

/**
 * The typed-entry HUD placed in the plan at `x`/`y` (level-local metres).
 * HTML inside a `foreignObject` is laid out in CSS pixels equal to SVG user
 * units, and the plan's `<g>` is zoomed and rotated, so the box is scaled by
 * `unitsPerPixel` and counter-rotated to stay screen-sized and upright.
 */
export function FloorplanPlacementTypingHud({
  placeholders,
  x,
  y,
}: {
  placeholders?: readonly string[]
  x: number
  y: number
}) {
  const isActive = usePlacementTyping((state) => state.isActive)
  const sceneRotationDeg = useFloorplanSceneRotation()
  const scale = Math.max(useFloorplanRender()?.unitsPerPixel ?? 1, 1e-6)
  if (!isActive) return null

  return (
    <g transform={`translate(${x} ${y}) rotate(${-sceneRotationDeg})`}>
      <foreignObject
        height={HUD_HEIGHT_PX * scale}
        overflow="visible"
        pointerEvents="auto"
        style={{ overflow: 'visible' }}
        width={HUD_WIDTH_PX * scale}
        x={(-HUD_WIDTH_PX / 2) * scale}
        y={(-HUD_HEIGHT_PX / 2) * scale}
      >
        <div
          style={{
            alignItems: 'center',
            display: 'flex',
            height: HUD_HEIGHT_PX,
            justifyContent: 'center',
            overflow: 'visible',
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            width: HUD_WIDTH_PX,
          }}
        >
          <PlacementCoordinateInput placeholders={placeholders} />
        </div>
      </foreignObject>
    </g>
  )
}
