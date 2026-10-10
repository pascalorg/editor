export type ReferencePoint = [number, number]

/** SVG exports can contain duplicate corners far below a millimetre. */
export function cleanReferencePoints(
  points: ReferencePoint[],
  metersPerPixel: number,
  closed: boolean,
): ReferencePoint[] {
  if (
    !Number.isFinite(metersPerPixel) ||
    metersPerPixel <= 0 ||
    points.some((p) => p.some((v) => !Number.isFinite(v)))
  )
    throw Error('Use finite coordinates and a positive reference scale.')
  const result: ReferencePoint[] = []
  const threshold = 0.001001 / metersPerPixel
  for (const p of points) {
    const previous = result.at(-1)
    if (!previous || Math.hypot(p[0] - previous[0], p[1] - previous[1]) >= threshold) result.push(p)
  }
  while (
    closed &&
    result.length > 1 &&
    Math.hypot(result[0]![0] - result.at(-1)![0], result[0]![1] - result.at(-1)![1]) < threshold
  )
    result.pop()
  return result
}

export function imagePointToLevel(
  point: ReferencePoint,
  image: { width: number; height: number },
  transform: { metersPerPixel: number; rotation: number; position: ReferencePoint },
): ReferencePoint {
  const x = (point[0] - image.width / 2) * transform.metersPerPixel
  const z = (point[1] - image.height / 2) * transform.metersPerPixel
  const c = Math.cos(transform.rotation),
    s = Math.sin(transform.rotation)
  return [transform.position[0] + x * c + z * s, transform.position[1] - x * s + z * c]
}
