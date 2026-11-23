import {
  getWallTrimFaces,
  WALL_TRIM_DEFAULTS,
  type WallFace,
  type WallNode,
  WallTrimConfig,
  type WallTrimKind,
  type WallTrimSpan,
} from '../../schema/nodes/wall'

/**
 * A wall's skirting, crown or chair rail with `patch` applied over what it shows now (its stored
 * config over the kind's defaults): the one write the wall panel and the agent operations share.
 */
export function wallTrimPatch<K extends WallTrimKind>(
  wall: Partial<Pick<WallNode, K>>,
  kind: K,
  patch: Partial<WallTrimConfig>,
): Record<K, WallTrimConfig> {
  return {
    [kind]: WallTrimConfig.parse({ ...WALL_TRIM_DEFAULTS[kind], ...wall[kind], ...patch }),
  } as Record<K, WallTrimConfig>
}

/** Visible intervals on one face, clipped and unioned without changing stored bounds. */
export function wallTrimRanges(
  trim: WallTrimConfig | undefined,
  face: WallFace,
  length: number,
): [number, number][] {
  if (!trim?.enabled || !getWallTrimFaces(trim.sides).includes(face)) return []
  const spans: WallTrimSpan[] = trim.spans ?? getWallTrimFaces(trim.sides).map((face) => ({ face }))
  const ranges = spans
    .filter((span) => span.face === face)
    .map((span): [number, number] => [
      Math.max(0, span.u0 ?? 0),
      Math.min(length, span.u1 ?? length),
    ])
    .filter(([a, b]) => b - a > 1e-6)
    .sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const [a, b] of ranges) {
    const last = merged.at(-1)
    if (last && a <= last[1] + 1e-6) last[1] = Math.max(last[1], b)
    else merged.push([a, b])
  }
  return merged
}

/** Remove only the named stretches; used by room hiding and conflict detection. */
export function subtractTrimSpans(
  spans: readonly WallTrimSpan[],
  removed: readonly WallTrimSpan[],
  length: number,
): WallTrimSpan[] {
  return spans.flatMap((span) => {
    let pieces = [span]
    for (const cut of removed.filter((cut) => cut.face === span.face)) {
      pieces = pieces.flatMap((piece) => {
        const [a, b] = [piece.u0 ?? 0, piece.u1 ?? length]
        const [lo, hi] = [Math.max(a, cut.u0 ?? 0), Math.min(b, cut.u1 ?? length)]
        if (hi - lo <= 1e-6) return [piece]
        return [
          ...(lo - a > 1e-6 ? [{ ...piece, u1: lo }] : []),
          ...(b - hi > 1e-6 ? [{ ...piece, u0: hi }] : []),
        ]
      })
    }
    return pieces
  })
}

/** A straight wall piece keeps only its own trim, remeasured from its new start. */
export function wallTrimPiece(wall: WallNode, from: number, to: number): Partial<WallNode> {
  return Object.fromEntries(
    (['skirting', 'crown', 'chairRail'] as const).flatMap((kind) => {
      const trim = wall[kind]
      if (!trim?.spans) return []
      const spans = trim.spans.flatMap((span) => {
        const a = Math.max(from, span.u0 ?? from)
        const b = Math.min(to, span.u1 ?? to)
        return b - a > 1e-6
          ? [
              {
                face: span.face,
                ...(span.u0 === undefined ? {} : { u0: a - from }),
                ...(span.u1 === undefined ? {} : { u1: b - from }),
              },
            ]
          : []
      })
      return [[kind, { ...trim, spans }]]
    }),
  )
}
