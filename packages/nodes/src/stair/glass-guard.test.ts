import { describe, expect, test } from 'bun:test'
import { resolveStairRailPaths, StairNode } from '@pascal-app/core'
import { buildGlassGuard, type GlassPanel } from './glass-guard'
import type { GuardBox } from './guard-path'

const UP_ISH = (box: GuardBox) => box.direction[1] > 0.9
const horizontalish = (box: GuardBox) => Math.abs(box.direction[1]) < 0.6
/** A slim 1½ in square post stands plumb at a 0.0381 m section. */
const isPost = (box: GuardBox) =>
  !box.round &&
  UP_ISH(box) &&
  Math.abs(box.size[0] - 0.0381) < 1e-6 &&
  Math.abs(box.size[1] - 0.0381) < 1e-6
/** The flat cap runs along the path, 0.0635 m across and 0.0381 m thick. */
const isCap = (box: GuardBox) =>
  !box.round &&
  !UP_ISH(box) &&
  Math.abs(box.size[0] - 0.0635) < 1e-6 &&
  Math.abs(box.size[1] - 0.0381) < 1e-6
/** A clamp is a small block straddling a pane edge, pointing along the chord. */
const isClamp = (box: GuardBox) =>
  !box.round &&
  horizontalish(box) &&
  Math.abs(box.size[0] - 0.05) < 1e-6 &&
  Math.abs(box.size[1] - 0.03) < 1e-6
const finiteBox = (box: GuardBox) =>
  [...box.center, ...box.size, ...box.direction].every(Number.isFinite)
const finitePanel = (panel: GlassPanel) =>
  [
    ...panel.start,
    panel.yaw,
    panel.run,
    panel.rise,
    panel.bottom,
    panel.top,
    panel.thickness,
  ].every(Number.isFinite)
function straightRun(length: number, rise: number, count: number): [number, number, number][] {
  return Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1)
    return [length * t, rise * t, 0] as [number, number, number]
  })
}

function arcRun(radius: number, sweep: number, rise: number, count: number) {
  return Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1)
    const a = sweep * t
    return [radius * Math.cos(a), rise * t, radius * Math.sin(a)] as [number, number, number]
  })
}

describe('buildGlassGuard', () => {
  test('stands slim posts under a flat cap with one inset pane per bay', () => {
    const { frame, panels } = buildGlassGuard(straightRun(3, 1.5, 2), {
      railHeight: 0.92,
      postSpacing: Number.POSITIVE_INFINITY,
    })
    expect(frame.every(finiteBox)).toBe(true)
    expect(panels.every(finitePanel)).toBe(true)

    const posts = frame.filter(isPost)
    expect(posts).toHaveLength(2)
    const postXs = posts.map((p) => p.center[0]).sort((a, b) => a - b)
    expect(postXs[0]!).toBeCloseTo(0)
    expect(postXs[1]!).toBeCloseTo(3)
    expect(frame.filter(isCap)).toHaveLength(1)

    // One pane between the two posts, inset from each and clear of cap and foot.
    expect(panels).toHaveLength(1)
    const pane = panels[0]!
    expect(pane.run).toBeLessThan(3)
    expect(pane.run).toBeGreaterThan(2.9)
    expect(pane.bottom).toBeCloseTo(0.075)
    expect(pane.top).toBeCloseTo(0.92 - 0.0381 - 0.01)
    expect(pane.top).toBeGreaterThan(pane.bottom)
    expect(pane.thickness).toBeCloseTo(0.0127)
    // Its foot follows the flight's slope: the pane rises over its run.
    expect(pane.rise).toBeGreaterThan(0)

    // Two clamps at each of the pane's two edges.
    expect(frame.filter(isClamp)).toHaveLength(4)
  })

  test('divides a long straight run into one pane per bay between the posts', () => {
    const { frame, panels } = buildGlassGuard(straightRun(10, 0, 2), {
      railHeight: 0.92,
      postSpacing: 1.2192,
    })
    const posts = frame.filter(isPost)
    // Posts stand every ≤ 4 ft (1.2192 m) along the run, both ends included.
    expect(posts.length).toBeGreaterThan(8)
    // One pane per bay, so one fewer than the posts; a clamp pair per edge.
    expect(panels).toHaveLength(posts.length - 1)
    expect(frame.filter(isClamp)).toHaveLength(panels.length * 4)
    // Adjacent panes never share or cross a vertex: each is inset from its posts.
    for (const pane of panels) expect(pane.run).toBeGreaterThan(0)
  })

  // The walking-facing face of a bay's pane, at its deepest (its chord middle),
  // measured as a radius about the sweep centre. The flat pane has real
  // thickness, so this is the mid-plane shifted a half-thickness toward the
  // walking side — the face that would reach a tread, not the chord line.
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
    expect(panels.every(finitePanel)).toBe(true)
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
    expect(inner.panels).toHaveLength(naive.panels.length)
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
    expect(panels.every(finitePanel)).toBe(true)
    for (const pane of panels)
      expect(walkFaceRadius(pane, true)).toBeGreaterThanOrEqual(radius - TESSELLATION)
  })

  test('through-posts carry their own cap; a low guard glazes no pane', () => {
    const through = buildGlassGuard(straightRun(3, 0, 2), {
      railHeight: 0.92,
      postThrough: true,
      postSpacing: Number.POSITIVE_INFINITY,
    })
    // Each post gains a small square cap of its own above the rail cap.
    const postCaps = through.frame.filter(
      (box) => UP_ISH(box) && box.size[0] > 0.0381 && Math.abs(box.size[0] - box.size[2]) < 1e-6,
    )
    expect(postCaps).toHaveLength(2)

    // A guard shorter than the glass foot + cap has no room for a pane.
    const low = buildGlassGuard(straightRun(3, 0, 2), {
      railHeight: 0.1,
      postSpacing: Number.POSITIVE_INFINITY,
    })
    expect(low.panels).toHaveLength(0)
  })

  test('omitting the top post drops it and runs on the shared rail paths', () => {
    const open = buildGlassGuard(straightRun(3, 1.5, 2), {
      railHeight: 0.92,
      topPost: false,
      postSpacing: Number.POSITIVE_INFINITY,
    })
    expect(open.frame.filter(isPost)).toHaveLength(1)

    const stair = StairNode.parse({
      railingMode: 'both',
      railingPath: 'continuous',
      railingStyle: 'glass',
    })
    for (const path of resolveStairRailPaths(stair, { [stair.id]: stair })) {
      const { frame, panels } = buildGlassGuard(path.points, { railHeight: 0.92 })
      expect(frame.every(finiteBox)).toBe(true)
      expect(panels.every(finitePanel)).toBe(true)
    }
  })
})
