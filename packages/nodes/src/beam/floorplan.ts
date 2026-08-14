import type { FloorplanGeometry, FloorplanPoint, GeometryContext } from '@pascal-app/core'
import { pickBeamAngleLabel } from './angle-label'
import type { BeamNode } from './schema'

/**
 * Stage C floor-plan builder for beam — the centreline element drawn as a
 * plan band at its actual width, like a wall footprint but without
 * miters or assembly layers (the beam's shutter is hosted formwork, not a
 * wall assembly).
 *
 *   1. The band polygon — start/end offset by ±width/2 along the
 *      centreline normal. Themed fill + stroke; white fill when selected.
 *   2. A transparent hit-line on the centreline so the user can grab the
 *      beam body easily.
 *   3. Endpoint handles (start + end) when selected, driving the
 *      `move-endpoint` affordance — the 2D twin of the 3D endpoint tool.
 *   4. Two side move-arrows at the midpoint, routing through
 *      `beamFloorplanMoveTarget` like the wall/fence body moves.
 *   5. A centred length label when selected.
 */
export function buildBeamFloorplan(node: BeamNode, ctx: GeometryContext): FloorplanGeometry | null {
  const startX = node.start[0]
  const startY = node.start[1]
  const endX = node.end[0]
  const endY = node.end[1]
  const length = Math.hypot(endX - startX, endY - startY)
  if (length <= 1e-6) return null

  const view = ctx.viewState
  const palette = view?.palette
  const isSelected = view?.selected ?? false
  const isHighlighted = view?.highlighted ?? false
  const isHovered = view?.hovered ?? false
  const showSelectedChrome = isSelected || isHighlighted

  const stroke =
    showSelectedChrome && palette
      ? palette.selectedStroke
      : isHovered && palette
        ? palette.wallHoverStroke
        : '#1f2937'
  const fill = showSelectedChrome ? '#ffffff' : '#374151'

  const halfWidth = (node.width ?? 0.3) / 2
  const tx = (endX - startX) / length
  const ty = (endY - startY) / length
  const nx = -ty
  const ny = tx

  const points: FloorplanPoint[] = [
    [startX + nx * halfWidth, startY + ny * halfWidth],
    [endX + nx * halfWidth, endY + ny * halfWidth],
    [endX - nx * halfWidth, endY - ny * halfWidth],
    [startX - nx * halfWidth, startY - ny * halfWidth],
  ]

  const children: FloorplanGeometry[] = [
    {
      kind: 'polygon',
      points,
      fill,
      stroke,
      strokeWidth: showSelectedChrome ? 0.03 : 0.02,
      opacity: 0.92,
      // Once selected, the body keeps catching the pointer so the cursor
      // stays neutral; only the side-arrows and endpoint handles start a
      // drag. Same treatment as the selected wall.
      cursor: isSelected ? 'default' : undefined,
    },
  ]

  // Hit-line on the centreline. Skipped while selected — the endpoint
  // handles + side-arrows take over, matching the wall.
  if (!isSelected) {
    children.push({
      kind: 'hit-line',
      x1: startX,
      y1: startY,
      x2: endX,
      y2: endY,
      strokeWidthPx: 18,
      cursor: 'pointer',
    })
  }

  if (isSelected) {
    children.push({
      kind: 'endpoint-handle',
      point: [startX, startY],
      state: 'idle',
      affordance: 'move-endpoint',
      payload: { beamId: node.id, endpoint: 'start' as const },
    })
    children.push({
      kind: 'endpoint-handle',
      point: [endX, endY],
      state: 'idle',
      affordance: 'move-endpoint',
      payload: { beamId: node.id, endpoint: 'end' as const },
    })

    // Side move arrows at the midpoint, offset past the beam's width —
    // routes through `beamFloorplanMoveTarget` via the registry move
    // overlay (same shape as the wall/fence side arrows).
    {
      const midX = (startX + endX) / 2
      const midY = (startY + endY) / 2
      const offset = halfWidth + 0.05
      children.push({
        kind: 'move-arrow',
        point: [midX + nx * offset, midY + ny * offset],
        angle: Math.atan2(ny, nx),
      })
      children.push({
        kind: 'move-arrow',
        point: [midX - nx * offset, midY - ny * offset],
        angle: Math.atan2(-ny, -nx),
      })
    }

    if (length >= 0.1) {
      children.push({
        kind: 'dimension-label',
        cx: (startX + endX) / 2,
        cy: (startY + endY) / 2,
        text: `${Number.parseFloat(length.toFixed(2))}m`,
        angle: Math.atan2(endY - startY, endX - startX),
      })
    }

    // Junction angle — the 2D twin of the 3D endpoint-drag angle pill. When
    // a sibling beam shares an endpoint, the plan shows the angle between
    // the two at the shared corner, oriented along the beam's heading.
    // Computed from `ctx.siblings` (same kind, same level) so no scene
    // access is needed here.
    const siblingBeams = ctx.siblings.filter(
      (sibling): sibling is BeamNode => sibling.type === 'beam',
    )
    const angle = pickBeamAngleLabel({
      start: [startX, startY],
      end: [endX, endY],
      segments: siblingBeams.map((beam) => ({
        id: beam.id,
        start: [beam.start[0], beam.start[1]],
        end: [beam.end[0], beam.end[1]],
      })),
    })
    if (angle) {
      children.push({
        kind: 'dimension-label',
        cx: angle.position[0],
        cy: angle.position[2],
        text: angle.label,
        angle: Math.atan2(endY - startY, endX - startX),
      })
    }
  }

  return { kind: 'group', children }
}
