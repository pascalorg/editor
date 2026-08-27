export type PlanarPoint = [number, number]

export type PlanarCursorPlacementMode = 'absolute' | 'relative'

type ResolvePlanarCursorPositionArgs = {
  cursor: PlanarPoint
  original: PlanarPoint
  anchor: PlanarPoint | null
  mode: PlanarCursorPlacementMode
  snap?: (value: number) => number
}

type ResolvePlanarCursorPositionResult = {
  point: PlanarPoint
  anchor: PlanarPoint | null
}

type ResolvePrioritizedPlanarCursorPositionArgs = ResolvePlanarCursorPositionArgs & {
  resolveAttachment?: (proposal: PlanarPoint) => PlanarPoint | null
}

type ResolvePrioritizedPlanarCursorPositionResult = ResolvePlanarCursorPositionResult & {
  attachmentSnapped: boolean
}

const identity = (value: number) => value

export function resolvePlanarCursorPosition({
  cursor,
  original,
  anchor,
  mode,
  snap = identity,
}: ResolvePlanarCursorPositionArgs): ResolvePlanarCursorPositionResult {
  if (mode === 'absolute') {
    return {
      point: [snap(cursor[0]), snap(cursor[1])],
      anchor,
    }
  }

  const resolvedAnchor = anchor ?? cursor
  return {
    point: [
      original[0] + snap(cursor[0] - resolvedAnchor[0]),
      original[1] + snap(cursor[1] - resolvedAnchor[1]),
    ],
    anchor: resolvedAnchor,
  }
}

export function resolvePrioritizedPlanarCursorPosition({
  resolveAttachment,
  ...args
}: ResolvePrioritizedPlanarCursorPositionArgs): ResolvePrioritizedPlanarCursorPositionResult {
  const raw = resolvePlanarCursorPosition({ ...args, snap: identity })
  const attached = resolveAttachment?.(raw.point) ?? null
  if (attached) {
    return {
      point: attached,
      anchor: raw.anchor,
      attachmentSnapped: true,
    }
  }

  return {
    ...resolvePlanarCursorPosition(args),
    attachmentSnapped: false,
  }
}
