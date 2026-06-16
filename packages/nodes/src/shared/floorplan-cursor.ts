type PlanarPoint = [number, number]
type PlanarCursorPlacementMode = 'absolute' | 'relative'

type FloorplanCursorResolverOptions = {
  snap?: (value: number) => number
}

function isFreshPlacementMetadata(metadata: unknown): boolean {
  return Boolean(
    metadata &&
      typeof metadata === 'object' &&
      'isNew' in metadata &&
      (metadata as { isNew?: unknown }).isNew === true,
  )
}

function snapDelta(delta: number, snap?: (value: number) => number): number {
  return snap ? snap(delta) : delta
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
    const cursor: PlanarPoint = [planPoint[0], planPoint[1]]

    if (mode === 'absolute') {
      return options.snap ? [options.snap(cursor[0]), options.snap(cursor[1])] : cursor
    }

    if (!anchor) {
      anchor = cursor
      return original
    }

    return [
      original[0] + snapDelta(cursor[0] - anchor[0], options.snap),
      original[1] + snapDelta(cursor[1] - anchor[1], options.snap),
    ]
  }
}
