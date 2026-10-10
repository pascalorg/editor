import type { WorldBox } from '../../store/use-point-ask'

/**
 * The box the overlay frames for a pointed element: its own world box, except a room, whose box
 * spans the storey but which the person means as a floor. A flat footprint keeps the corner
 * brackets on the ground and the bubble beside the room, not up in the air.
 */
export function outlineBox(type: string, box: WorldBox): WorldBox {
  if (type !== 'zone') return box
  return { min: [...box.min], max: [box.max[0], box.min[1] + 0.02, box.max[2]] }
}
