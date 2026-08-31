import {
  isFreshPlacementMetadata,
  type PlanarCursorPlacementMode,
  type PlanarPoint,
  resolvePlanarCursorPosition,
} from '@pascal-app/editor'

type FloorplanCursorResolverOptions = {
  snap?: (value: number) => number
}

export function createFloorplanCursorResolver(args: {
  original: readonly [number, number]
  metadata?: unknown
  mode?: PlanarCursorPlacementMode
}) {
  const original: PlanarPoint = [args.original[0], args.original[1]]
  const mode = args.mode ?? (isFreshPlacementMetadata(args.metadata) ? 'absolute' : 'relative')
  let anchor: PlanarPoint | null = null

  return (
    planPoint: readonly [number, number],
    options: FloorplanCursorResolverOptions = {},
  ): PlanarPoint => {
    const resolved = resolvePlanarCursorPosition({
      cursor: [planPoint[0], planPoint[1]],
      original,
      anchor,
      mode,
      ...(options.snap ? { snap: options.snap } : {}),
    })
    anchor = resolved.anchor
    return resolved.point
  }
}
