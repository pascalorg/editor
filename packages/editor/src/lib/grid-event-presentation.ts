import type { GridEvent } from '@pascal-app/core'

export type GridEventScreenProjection = {
  pointer: [number, number]
  localToScreen: [number, number, number, number, number, number]
}

export type EditorGridEvent = GridEvent & {
  screenProjection?: GridEventScreenProjection
}

export function getGridEventScreenProjection(
  event: GridEvent,
): GridEventScreenProjection | undefined {
  return (event as EditorGridEvent).screenProjection
}
