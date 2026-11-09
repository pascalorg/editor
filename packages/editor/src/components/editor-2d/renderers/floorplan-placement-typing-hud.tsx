'use client'

import { usePlacementTyping } from '../../../store/use-placement-typing'
import { PlacementCoordinateInput } from '../../tools/shared/placement-coordinate-input'

const HUD_WIDTH_PX = 236
const HUD_HEIGHT_PX = 64
const HUD_LIFT_PX = 14

/**
 * The typed-entry HUD placed in the plan at `x`/`y` (level-local metres).
 * HTML inside a `foreignObject` is laid out in CSS pixels equal to SVG user
 * units, and the plan's `<g>` is zoomed and rotated, so the box is scaled by
 * `unitsPerPixel` and counter-rotated to stay screen-sized and upright. Both
 * come from the caller: the wall draft renders outside `FloorplanRenderProvider`.
 * It sits just above its anchor, and only the HUD itself takes the pointer, so
 * clicks on the ghost or the draft under it still land on the plan.
 */
export function FloorplanPlacementTypingHud({
  placeholders,
  sceneRotationDeg,
  unitsPerPixel,
  x,
  y,
}: {
  placeholders?: readonly string[]
  sceneRotationDeg: number
  unitsPerPixel: number
  x: number
  y: number
}) {
  const isActive = usePlacementTyping((state) => state.isActive)
  const scale = Math.max(unitsPerPixel, 1e-6)
  if (!isActive) return null

  return (
    <g transform={`translate(${x} ${y}) rotate(${-sceneRotationDeg})`}>
      <foreignObject
        height={HUD_HEIGHT_PX * scale}
        overflow="visible"
        pointerEvents="none"
        style={{ overflow: 'visible' }}
        width={HUD_WIDTH_PX * scale}
        x={(-HUD_WIDTH_PX / 2) * scale}
        y={-(HUD_HEIGHT_PX + HUD_LIFT_PX) * scale}
      >
        <div
          style={{
            alignItems: 'flex-end',
            display: 'flex',
            height: HUD_HEIGHT_PX,
            justifyContent: 'center',
            overflow: 'visible',
            pointerEvents: 'none',
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
