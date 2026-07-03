import type { NudgeDelta } from '@pascal-app/core'

type SegmentNode = {
  start: readonly [number, number]
  end: readonly [number, number]
}

type PolylineNode = {
  points: ReadonlyArray<readonly [number, number, number]>
}

export const ROUTE_ENDPOINT_Y_OFFSET = 0.35

export function nudgeSegmentPlan<N extends SegmentNode>(node: N, delta: NudgeDelta): Partial<N> {
  return {
    start: [node.start[0] + delta[0], node.start[1] + delta[2]],
    end: [node.end[0] + delta[0], node.end[1] + delta[2]],
  } as unknown as Partial<N>
}

export function nudgePolylinePlan<N extends PolylineNode>(node: N, delta: NudgeDelta): Partial<N> {
  return {
    points: node.points.map(([x, y, z]) => [x + delta[0], y, z + delta[2]]),
  } as unknown as Partial<N>
}

export function segmentEndpointLocalPosition(
  node: SegmentNode & { elevation?: number },
  endpoint: 'start' | 'end',
): readonly [number, number, number] {
  const point = endpoint === 'start' ? node.start : node.end
  return [point[0], (node.elevation ?? 0) + ROUTE_ENDPOINT_Y_OFFSET, point[1]]
}

export function routeEndpointLabel(
  keyNoun: string,
  labelNoun: string,
  endpoint: 'start' | 'end',
  { detachHint = false }: { detachHint?: boolean } = {},
) {
  const endpointLabel = endpoint === 'start' ? 'start' : 'end'
  const suffix = detachHint ? ' (Alt to detach)' : ''
  return {
    key: `actionMenu.move${keyNoun}${endpoint === 'start' ? 'Start' : 'End'}${
      detachHint ? 'Detach' : ''
    }`,
    fallback: `Move ${labelNoun} ${endpointLabel}${suffix}`,
  }
}
