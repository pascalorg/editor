/**
 * The marked plan (L53): the plan reference redrawn from its own shapes and texts, thin and grey,
 * each drawn piece boxed in colour with its number, for whoever picks the pieces' items (the
 * agent, a person) to see which number is which. In the plan image's own pixels; the host
 * rasterises it, as it does a facade elevation. Drawn from what the pieces were found in, so
 * nothing is fetched and every lane draws the same picture.
 */

type Pt = [number, number]
export type PlanMark = {
  n: number
  box: { minX: number; minY: number; maxX: number; maxY: number }
}

const MARK_COLOUR = '#e4572e'
const xmlText = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const fixed = (value: number) => Math.round(value * 10) / 10

export function markedPlanSvg({
  width,
  height,
  contours,
  labels,
  marks,
}: {
  width: number
  height: number
  contours: readonly { points: readonly Pt[]; stroke?: boolean }[]
  labels: readonly { text: string; at: Pt }[]
  marks: readonly PlanMark[]
}): string {
  const unit = Math.max(width, height) / 600
  const shapes = contours.map(({ points, stroke }) => {
    const d = `M${points.map(([x, y]) => `${fixed(x)} ${fixed(y)}`).join('L')}${stroke ? '' : 'Z'}`
    return `<path d="${d}" fill="${stroke ? 'none' : '#ececec'}" stroke="#9a9a9a" stroke-width="${fixed(unit)}"/>`
  })
  const texts = labels.map(
    ({ text, at: [x, y] }) =>
      `<text x="${fixed(x)}" y="${fixed(y)}" font-size="${fixed(unit * 7)}" fill="#8a8a8a" font-family="sans-serif" text-anchor="middle">${xmlText(text)}</text>`,
  )
  const badge = unit * 7
  // Each number on its box's top-left corner; where it would cover a number already placed, the
  // nearest free spot round the corner, led back to it by a line (an ensuite's pieces crowd).
  const placed: Pt[] = []
  const free = ([x, y]: Pt) =>
    x >= badge &&
    y >= badge &&
    x <= width - badge &&
    y <= height - badge &&
    placed.every(([px, py]) => Math.hypot(px - x, py - y) >= badge * 2.2)
  const directions: Pt[] = [
    [0, -1],
    [-1, 0],
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 0],
    [0, 1],
    [1, 1],
  ]
  const boxes = marks.map(({ n, box: { minX, minY, maxX, maxY } }) => {
    const corner: Pt = [minX, minY]
    const spot =
      [
        corner,
        ...[3, 5, 7, 9].flatMap((step) =>
          directions.map(
            ([dx, dy]): Pt => [
              minX + (dx * badge * step) / Math.hypot(dx, dy),
              minY + (dy * badge * step) / Math.hypot(dx, dy),
            ],
          ),
        ),
      ].find(free) ?? corner
    placed.push(spot)
    const [x, y] = spot
    return [
      `<rect x="${fixed(minX)}" y="${fixed(minY)}" width="${fixed(maxX - minX)}" height="${fixed(maxY - minY)}" fill="${MARK_COLOUR}" fill-opacity="0.08" stroke="${MARK_COLOUR}" stroke-width="${fixed(unit * 2)}"/>`,
      ...(spot === corner
        ? []
        : [
            `<line x1="${fixed(x)}" y1="${fixed(y)}" x2="${fixed(minX)}" y2="${fixed(minY)}" stroke="${MARK_COLOUR}" stroke-width="${fixed(unit * 1.5)}"/>`,
          ]),
      `<circle cx="${fixed(x)}" cy="${fixed(y)}" r="${fixed(badge)}" fill="${MARK_COLOUR}"/>`,
      `<text x="${fixed(x)}" y="${fixed(y + badge * 0.36)}" font-size="${fixed(badge)}" fill="#ffffff" font-family="sans-serif" font-weight="bold" text-anchor="middle">${n}</text>`,
    ].join('')
  })
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="${width}" height="${height}" fill="#ffffff"/>`,
    ...shapes,
    ...texts,
    ...boxes,
    '</svg>',
  ].join('')
}
