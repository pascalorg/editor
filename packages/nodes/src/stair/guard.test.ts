import { describe, expect, test } from 'bun:test'
import {
  buildBalusterGuard,
  buildBoardsGuard,
  buildCableGuard,
  buildGlassGuard,
  buildMetalGuard,
  buildPostAndRailGuard,
  guardBoxGeometry,
} from '../index'
import type { GlassPanel } from './glass-guard'
import type { GuardBox, Vec3 } from './guard-path'

const styles = ['balusters', 'post-and-rail', 'cable', 'boards', 'glass', 'metal'] as const
function build(style: (typeof styles)[number], points: Vec3[], extra = {}) {
  const options = { railHeight: 0.92, postSpacing: 1.2192, pickets: 0.127, ...extra }
  if (style === 'glass') return buildGlassGuard(points, options)
  const builder = {
    balusters: buildBalusterGuard,
    'post-and-rail': buildPostAndRailGuard,
    cable: buildCableGuard,
    boards: buildBoardsGuard,
    metal: buildMetalGuard,
  }[style]
  return { frame: builder(points, options), panels: [] as GlassPanel[] }
}
function straightRun(count: number): Vec3[] {
  return Array.from({ length: count }, (_, i) => [(4 * i) / (count - 1), 0, 0])
}
function arcRun(radius: number, sweep: number, rise: number, count: number): Vec3[] {
  return Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1),
      angle = sweep * t
    return [radius * Math.cos(angle), rise * t, radius * Math.sin(angle)]
  })
}
const plumb = (box: GuardBox) => box.direction[1] > 0.99 && box.size[2] > 0.2
const finite = (box: GuardBox) =>
  [...box.center, ...box.size, ...box.direction].every(Number.isFinite)
function largestGap(intervals: [number, number][], lo: number, hi: number) {
  let end = lo,
    gap = 0
  for (const [a, b] of intervals.sort((a, b) => a[0] - b[0])) {
    gap = Math.max(gap, a - end)
    end = Math.max(end, b)
  }
  return Math.max(gap, hi - end)
}

for (const style of styles)
  describe(`${style} guard`, () => {
    test('infill leaves no gap wider than a four-inch sphere', () => {
      const { frame, panels } = build(
        style,
        [
          [0, 0, 0],
          [3, 0, 0],
        ],
        { railHeight: 1 },
      )
      let gap: number
      if (style === 'cable' || style === 'boards') {
        const rails = frame.filter((box) => Math.abs(box.direction[0]) > 0.99)
        gap = largestGap(
          rails.map((box) => [box.center[1] - box.size[1] / 2, box.center[1] + box.size[1] / 2]),
          0,
          1,
        )
      } else {
        const intervals: [number, number][] = frame
          .filter(plumb)
          .map((box) => [box.center[0] - box.size[0] / 2, box.center[0] + box.size[0] / 2])
        for (const pane of panels) intervals.push([pane.start[0], pane.start[0] + pane.run])
        gap = largestGap(intervals, 0, 3)
      }
      expect(gap).toBeLessThanOrEqual(0.1016)
    })

    test('post and infill stations follow run length regardless of tessellation', () => {
      const coarse = build(style, straightRun(2)),
        fine = build(style, straightRun(81))
      const stations = (boxes: GuardBox[]) => boxes.filter(plumb).map((box) => box.center[0])
      expect(stations(fine.frame)).toEqual(stations(coarse.frame))
      expect(fine.panels).toEqual(coarse.panels)
      expect(fine.frame.every(finite)).toBe(true)
    })

    test('supports turning paths, arcs and vertical pivots with finite members', () => {
      for (const points of [
        [
          [0, 0, 0],
          [2, 1, 0],
          [2, 1, 2],
        ] as Vec3[],
        arcRun(2, Math.PI, 2, 41),
        [
          [0, 0, 0],
          [0, 2, 0],
        ] as Vec3[],
      ]) {
        const { frame, panels } = build(style, points, { postThrough: true })
        expect(frame.length).toBeGreaterThan(0)
        expect(frame.every(finite)).toBe(true)
        expect(frame.every((box) => box.size.every((dimension) => dimension > 0))).toBe(true)
        expect(
          panels.every((pane) =>
            [pane.run, pane.rise, pane.yaw, ...pane.start].every(Number.isFinite),
          ),
        ).toBe(true)
        const tops = frame.filter(plumb).map((box) => box.center[1] + box.size[2] / 2)
        expect(Math.max(...tops)).toBeGreaterThanOrEqual(
          Math.max(...points.map((point) => point[1])) + 0.92,
        )
      }
    })

    test('tops, omitted terminal posts and reach obey the requested dimensions', () => {
      const normal = build(style, straightRun(2)),
        through = build(style, straightRun(2), { postThrough: true })
      const highest = (frame: GuardBox[]) =>
        Math.max(...frame.filter(plumb).map((box) => box.center[1] + box.size[2] / 2))
      expect(highest(normal.frame)).toBeGreaterThan(0.85)
      expect(highest(normal.frame)).toBeLessThan(1.02)
      expect(highest(through.frame)).toBeGreaterThan(highest(normal.frame))
      const open = build(style, straightRun(2), { topPost: false, reach: 0.3 })
      expect(open.frame.filter(plumb).some((box) => Math.abs(box.center[0] - 4) < 0.01)).toBe(false)
      expect(Math.max(...open.frame.map((box) => box.center[0]))).toBeGreaterThan(4)
    })

    test('emits metre-scale UVs on rectangular and round members', () => {
      const { frame } = build(style, [
        [0, 0, 0],
        [3, 1.5, 0],
      ])
      for (const box of frame.slice(0, 8)) {
        const geometry = guardBoxGeometry(box)
        const uv = geometry.getAttribute('uv'),
          position = geometry.getAttribute('position')
        expect(uv.count).toBe(position.count)
        expect(Array.from(uv.array).every(Number.isFinite)).toBe(true)
        let checked = false
        const count = geometry.index?.count ?? position.count
        const vertex = (i: number) => (geometry.index ? geometry.index.getX(i) : i)
        for (let i = 0; i < count; i += 3) {
          const a = vertex(i)
          for (let j = i + 1; j < Math.min(i + 3, count); j++) {
            const b = vertex(j)
            const world = Math.hypot(
              position.getX(b) - position.getX(a),
              position.getY(b) - position.getY(a),
              position.getZ(b) - position.getZ(a),
            )
            const texture = Math.hypot(uv.getX(b) - uv.getX(a), uv.getY(b) - uv.getY(a))
            if (world > 1e-6) {
              expect(texture / world).toBeGreaterThan(0.97)
              expect(texture / world).toBeLessThan(1.04)
              checked = true
            }
          }
        }
        expect(checked).toBe(true)
        geometry.dispose()
      }
    })
  })

test('cable infill spans straight post-to-post chords with round members', () => {
  const { frame } = build('cable', arcRun(2, Math.PI, 1.5, 41))
  const cables = frame.filter((box) => box.round)
  expect(cables.length).toBeGreaterThan(0)
  expect(cables.every(finite)).toBe(true)
  expect(cables.some((box) => box.size[2] > 0.5)).toBe(true)
})

test('steel posts mount above the walking surface', () => {
  const { frame } = build('metal', straightRun(2))
  expect(
    frame.every((box) => box.center[1] - (plumb(box) ? box.size[2] : box.size[1]) / 2 >= -1e-8),
  ).toBe(true)
})

const walkFaceRadius = (pane: GlassPanel, walkingInside: boolean) => {
  const midX = pane.start[0] + Math.cos(pane.yaw) * (pane.run / 2)
  const midZ = pane.start[2] + Math.sin(pane.yaw) * (pane.run / 2)
  const half = pane.thickness / 2
  const nx = -Math.sin(pane.yaw),
    nz = Math.cos(pane.yaw)
  const a = Math.hypot(midX + nx * half, midZ + nz * half)
  const b = Math.hypot(midX - nx * half, midZ - nz * half)
  return walkingInside ? Math.min(a, b) : Math.max(a, b)
}

// The guard clears the rail polyline it is handed; that polyline is itself a
// hair inside the ideal arc (its own tessellation sagitta), so the face lands
// within a tolerance of the ideal radius, not exactly on it — far from the
// tens of centimetres a chord laid on the posts would sag.
const TESSELLATION = 1.5e-3

test('shifts an outer-rail pane out so its face clears the rail line', () => {
  const radius = 2
  // The sweep centre is the origin; on an outer rail the walkable surface is
  // inside the arc, so a flat chord laid on the posts sags toward it.
  const insideWalk = (x: number, z: number) => Math.hypot(x, z) < radius
  const { panels } = buildGlassGuard(arcRun(radius, Math.PI, 1.5, 90), {
    railHeight: 0.95,
    postSpacing: 1.2192,
    insideWalk,
  })
  expect(panels.length).toBeGreaterThan(1)
  // Every pane's walking-facing face sits at or outside the rail line across
  // the whole bay — the chord sag no longer bulges onto the tread.
  for (const pane of panels)
    expect(walkFaceRadius(pane, true)).toBeGreaterThanOrEqual(radius - TESSELLATION)

  // Without the walk side the pane stays on the posts and its face intrudes
  // tens of millimetres — the condition the shift exists to remove.
  const naive = buildGlassGuard(arcRun(radius, Math.PI, 1.5, 90), {
    railHeight: 0.95,
    postSpacing: 1.2192,
  })
  expect(Math.min(...naive.panels.map((pane) => walkFaceRadius(pane, true)))).toBeLessThan(
    radius - 0.03,
  )
})

test('leaves an inner-rail pane on the line: its sag falls into the void', () => {
  const radius = 2
  // On an inner rail the walkable surface is outside the arc; the chord sags
  // away from it, so there is nothing to clear and the pane is not shifted.
  const insideWalk = (x: number, z: number) => Math.hypot(x, z) > radius
  const common = { railHeight: 0.95, postSpacing: 1.2192 }
  const inner = buildGlassGuard(arcRun(radius, Math.PI, 1.5, 90), { ...common, insideWalk })
  const naive = buildGlassGuard(arcRun(radius, Math.PI, 1.5, 90), common)
  for (const [i, pane] of inner.panels.entries()) {
    // No shift: identical to the un-sided build.
    expect(pane.start).toEqual(naive.panels[i]!.start)
    // And the pane never crosses the rail line into the walking volume.
    expect(walkFaceRadius(pane, false)).toBeLessThanOrEqual(radius + 1e-9)
  }
})

test('clears the face on a tight radius without NaN or a runaway shift', () => {
  const radius = 0.4
  const insideWalk = (x: number, z: number) => Math.hypot(x, z) < radius
  const { panels } = buildGlassGuard(arcRun(radius, Math.PI, 0.9, 90), {
    railHeight: 0.95,
    postSpacing: 1.2192,
    insideWalk,
  })
  expect(panels.length).toBeGreaterThan(0)
  for (const pane of panels)
    expect(walkFaceRadius(pane, true)).toBeGreaterThanOrEqual(radius - TESSELLATION)
})
