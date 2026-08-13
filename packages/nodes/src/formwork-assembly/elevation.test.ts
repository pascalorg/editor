import { describe, expect, test } from 'bun:test'
import type { GeometryContext, WallNode } from '@pascal-app/core'
import { elevationCaveats, partByMark, type ShutterElevation } from '@pascal-app/core/formwork'
import { elevationShapes, elevationSvg } from './elevation-drawing'
import { buildFormwork } from './geometry'
import type { FormworkAssemblyNode } from './schema'

/**
 * The drawing against the shutter it was drawn from.
 *
 * Two things can be wrong here and nothing about either looks wrong. The first is a piece on
 * the wall and not on the drawing, or the reverse — the whole reason the elevation is emitted
 * out of the build rather than derived from the layout a second time, and the invariant that
 * arrangement buys has to be asserted from the outside. The second is the frame: every figure
 * being 2400 mm out because the lift's base was read as the level's is the one error on this
 * drawing that reads as correct.
 */

function makeWall(overrides: Partial<WallNode> = {}): WallNode {
  return {
    object: 'node',
    id: 'wall_test',
    type: 'wall',
    parentId: 'level_test',
    visible: true,
    metadata: {},
    children: [],
    start: [0, 0],
    end: [3, 0],
    thickness: 0.2,
    height: 2.4,
    frontSide: 'unknown',
    backSide: 'unknown',
    formworkType: 'plywood',
    tieSpacing: 0.6,
    walerSpacing: 0.9,
    ...overrides,
  } as WallNode
}

function makeNode(overrides: Partial<FormworkAssemblyNode> = {}): FormworkAssemblyNode {
  return {
    object: 'node',
    id: 'formwork-assembly_test',
    type: 'formwork-assembly',
    parentId: 'wall_test',
    visible: true,
    metadata: {},
    children: [],
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    panelWidth: 0.6,
    segmentIndex: 0,
    liftIndex: 0,
    ...overrides,
  } as FormworkAssemblyNode
}

function makeOpening(overrides: Record<string, unknown> = {}) {
  return {
    object: 'node',
    id: 'window_a',
    type: 'window',
    parentId: 'wall_test',
    wallId: 'wall_test',
    visible: true,
    metadata: {},
    position: [1.5, 1.5, 0],
    rotation: [0, 0, 0],
    width: 1.2,
    height: 1.5,
    ...overrides,
  }
}

function drawn(
  wall: WallNode,
  node: FormworkAssemblyNode = makeNode(),
  neighbours: Array<Record<string, unknown>> = [],
) {
  const level = {
    object: 'node',
    id: 'level_test',
    type: 'level',
    children: [wall.id as string, ...neighbours.map((n) => n.id as string)],
  }
  const byId = new Map<string, unknown>([
    [level.id, level],
    [wall.id as string, wall],
    ...neighbours.map((n) => [n.id as string, n] as [string, unknown]),
  ])
  const built = buildFormwork(node, {
    parent: wall,
    resolve: (id: string) => byId.get(id),
  } as unknown as GeometryContext)
  if (!built) throw new Error('nothing built')
  return built
}

function requireElevation(
  wall: WallNode,
  node?: FormworkAssemblyNode,
  neighbours?: Array<Record<string, unknown>>,
) {
  const built = drawn(wall, node, neighbours)
  if (!built.elevation) throw new Error('the wall drew no elevation')
  return { ...built, elevation: built.elevation }
}

describe('the wall draws its own faces', () => {
  test('both skins, and every mark on the drawing is a part on the wall', () => {
    const { elevation, parts } = requireElevation(makeWall())

    expect(elevation.faces.map((face) => face.role)).toEqual(['side-a', 'side-b'])
    for (const face of elevation.faces) {
      expect(face.pieces.length).toBeGreaterThan(0)
      // The mark is carried out of the emit rather than rebuilt from the rectangle, so a
      // dangling one is a drawing labelled with a part nobody ordered.
      for (const piece of face.pieces) {
        expect(partByMark(parts, piece.mark)).toBeDefined()
      }
    }
  })

  test('every shutter piece on a face is on that face’s drawing, and only those', () => {
    // The invariant the emit-from-the-build arrangement exists for. A rectangle count is not
    // a part count — two bands of one panel share a mark — so the comparison is over the set
    // of marks rather than over the lengths.
    const { elevation, parts } = requireElevation(makeWall({ height: 3 }), makeNode(), [
      makeOpening(),
    ])
    const drawnMarks = new Set(elevation.faces.flatMap((face) => face.pieces.map((p) => p.mark)))
    const shutterMarks = parts
      .filter((part) => part.kind === 'panel' || part.kind === 'corner')
      .filter((part) => part.locus.on === 'run' || part.locus.on === 'facet')
      .map((part) => part.mark)

    expect([...drawnMarks].sort()).toEqual([...new Set(shutterMarks)].sort())
  })

  test('a panel crossed by a window is two bands sharing one mark', () => {
    const { elevation } = requireElevation(makeWall({ height: 3 }), makeNode(), [makeOpening()])
    const face = elevation.faces[0]
    if (!face) throw new Error('no face')
    const byMark = new Map<string, number>()
    for (const piece of face.pieces) byMark.set(piece.mark, (byMark.get(piece.mark) ?? 0) + 1)
    const split = [...byMark.entries()].filter(([, count]) => count > 1)

    expect(split.length).toBeGreaterThan(0)
    // And the two bands straddle the void: one finishes at or below the sill and the other
    // starts at or above the head. A single band spanning it would be a panel drawn through
    // a window.
    const opening = elevation.openings[0]
    if (!opening) throw new Error('no opening drawn')
    const bands = face.pieces.filter((piece) => piece.mark === split[0]?.[0])
    expect(bands.some((band) => band.yMm + band.heightMm <= opening.yMm + 1)).toBe(true)
    expect(bands.some((band) => band.yMm >= opening.yMm + opening.heightMm - 1)).toBe(true)
  })
})

describe('the frame', () => {
  test('a lift starts at zero, not at its height up the wall', () => {
    // The error that reads as correct. A wall in two lifts draws two elevations, and the
    // upper one starting at 2400 would be an elevation of the whole wall with the bottom
    // half missing.
    const tall = makeWall({ height: 5, maxLiftHeight: 2.5 })
    const lower = requireElevation(tall, makeNode({ liftIndex: 0 })).elevation
    const upper = requireElevation(tall, makeNode({ liftIndex: 1 })).elevation

    // The bottom lift stands on the kicker cast with the slab; the one above it stands on
    // the pour below, and its shutter starts at its own base rather than at 2500.
    expect(lower.formBaseMm).toBeGreaterThan(0)
    expect(upper.formBaseMm).toBeCloseTo(0, 3)
    for (const face of upper.faces) {
      for (const piece of face.pieces) expect(piece.yMm).toBeGreaterThanOrEqual(-1)
    }
    expect(upper.concreteTopMm).toBeLessThan(3000)
  })

  test('a pour that starts partway along the wall starts at zero too', () => {
    const long = makeWall({ end: [12, 0], maxPourLength: 6 })
    const second = requireElevation(long, makeNode({ segmentIndex: 1 })).elevation

    expect(second.runMm).toBeCloseTo(6000, 0)
    for (const face of second.faces) {
      // Corner legs excepted — an outside leg wraps the core it turns onto, which is past
      // this pour's own start, so a negative station is the leg and not a stray figure.
      for (const piece of face.pieces.filter((p) => p.kind !== 'corner')) {
        expect(piece.xMm).toBeGreaterThanOrEqual(-1)
        expect(piece.xMm + piece.widthMm).toBeLessThanOrEqual(second.runMm + 1)
      }
    }
  })

  test('the pieces reach the concrete, and the courses agree with them', () => {
    const { elevation } = requireElevation(makeWall({ height: 2.4 }))
    const face = elevation.faces[0]
    if (!face) throw new Error('no face')
    const top = Math.max(...face.pieces.map((piece) => piece.yMm + piece.heightMm))

    expect(top).toBeGreaterThanOrEqual(elevation.concreteTopMm - 1)
    expect(top).toBeCloseTo(elevation.formTopMm, 0)
    // A course is a band of the same panels, so the stack's own extent is the shutter's.
    const courseTop = Math.max(...elevation.courses.map((course) => course.topMm))
    expect(courseTop).toBeCloseTo(elevation.formTopMm, 0)
  })
})

describe('the ties', () => {
  test('every drawn tie is a rod on the wall, and says where it came from', () => {
    const { elevation, parts } = requireElevation(makeWall())

    expect(elevation.ties.length).toBeGreaterThan(0)
    expect(['drilled-holes', 'solved-spacing']).toContain(elevation.tiesFrom)
    for (const tie of elevation.ties) expect(partByMark(parts, tie.mark)).toBeDefined()
    expect(parts.filter((part) => part.kind === 'tie')).toHaveLength(elevation.ties.length)
  })

  test('a station inside an opening is drawn as dropped rather than left off', () => {
    // The drawing's load-bearing absence: this station is on the engineer's drawing, and no
    // rod and no cross here is what gets queried a fortnight later.
    const wide = makeOpening({ id: 'window_b', width: 2, height: 2.4, position: [1.5, 1.5, 0] })
    const { elevation } = requireElevation(makeWall({ height: 3 }), makeNode(), [wide])
    const dropped = elevation.tiesDropped.filter((tie) => tie.because === 'opening')

    expect(dropped.length).toBeGreaterThan(0)
    const opening = elevation.openings[0]
    if (!opening) throw new Error('no opening drawn')
    for (const tie of dropped) {
      expect(tie.xMm).toBeGreaterThan(opening.xMm)
      expect(tie.xMm).toBeLessThan(opening.xMm + opening.widthMm)
    }
    // And a dropped station is not also a drawn one — a rod counted twice on two symbols.
    for (const tie of dropped) {
      expect(
        elevation.ties.some(
          (drawnTie) =>
            Math.abs(drawnTie.xMm - tie.xMm) < 1 && Math.abs(drawnTie.yMm - tie.yMm) < 1,
        ),
      ).toBe(false)
    }
  })

  test('a single-sided pour has no ties and says so', () => {
    const { elevation } = requireElevation(makeWall({ formworkMode: 'single-sided-a' }))

    expect(elevation.ties).toEqual([])
    expect(elevation.tiesFrom).toBe('none')
    // One skin only — a drawing of a back face nobody forms is a drawing of nothing.
    expect(elevation.faces.map((face) => face.role)).toEqual(['side-a'])
  })
})

describe('elevationShapes', () => {
  test('draws every piece, marks the ones with room, and flips the wall the right way up', () => {
    const { elevation } = requireElevation(makeWall())
    const face = elevation.faces[0]
    if (!face) throw new Error('no face')
    const shapes = elevationShapes(elevation, face)
    const rects = shapes.filter((shape) => shape.kind === 'piece')
    const marks = shapes.filter((shape) => shape.kind === 'label' && shape.role === 'mark')

    expect(rects).toHaveLength(face.pieces.length)
    expect(marks.length).toBeGreaterThan(0)
    // The base of the wall is the bottom of the drawing. Y counts up on the wall and down in
    // SVG, so the piece lowest on the wall is the one furthest down the sheet — and a drawing
    // built without the flip would put it at the top, which looks like a wall upside down.
    const lowest = face.pieces.reduce((low, piece) => (piece.yMm < low.yMm ? piece : low))
    const highest = face.pieces.reduce((high, piece) =>
      piece.yMm + piece.heightMm > high.yMm + high.heightMm ? piece : high,
    )
    const top = Math.max(elevation.formTopMm, elevation.concreteTopMm)
    const bottomOfSheet = Math.max(
      ...rects.map((rect) => (rect.kind === 'piece' ? rect.yMm + rect.heightMm : 0)),
    )
    expect(bottomOfSheet).toBeCloseTo(top - lowest.yMm, 0)
    expect(Math.min(...rects.map((rect) => rect.yMm))).toBeCloseTo(
      top - highest.yMm - highest.heightMm,
      0,
    )
  })

  test('draws the concrete line only where the panels run past it', () => {
    const { elevation } = requireElevation(makeWall({ height: 2.35 }))
    const face = elevation.faces[0]
    if (!face) throw new Error('no face')
    const shapes = elevationShapes(elevation, face)

    // A 2.35 m pour in 2.4 m panels: the top 50 mm is freeboard, and a pour quoted to the
    // top of the shutter is quoted 50 mm high.
    expect(elevation.formTopMm).toBeGreaterThan(elevation.concreteTopMm)
    expect(shapes.some((shape) => shape.kind === 'concrete')).toBe(true)
    expect(
      shapes.some(
        (shape) =>
          shape.kind === 'label' && shape.role === 'concrete' && shape.text.includes('freeboard'),
      ),
    ).toBe(true)
  })

  test('draws one joint line fewer than there are courses', () => {
    // A line at the base and the top of the stack would draw over the shutter's own outline
    // and read as two joints the wall does not have.
    const { elevation } = requireElevation(makeWall({ height: 4.8 }))
    const face = elevation.faces[0]
    if (!face) throw new Error('no face')
    const joints = elevationShapes(elevation, face).filter((shape) => shape.kind === 'course')

    expect(elevation.courses.length).toBeGreaterThan(1)
    expect(joints).toHaveLength(elevation.courses.length - 1)
  })

  test('a dropped station draws as a cross and a rod as a circle', () => {
    const wide = makeOpening({ id: 'window_b', width: 2, height: 2.4 })
    const { elevation } = requireElevation(makeWall({ height: 3 }), makeNode(), [wide])
    const face = elevation.faces[0]
    if (!face) throw new Error('no face')
    const ties = elevationShapes(elevation, face).filter((shape) => shape.kind === 'tie')

    expect(ties.filter((tie) => tie.kind === 'tie' && tie.dropped)).toHaveLength(
      elevation.tiesDropped.length,
    )
    expect(ties.filter((tie) => tie.kind === 'tie' && !tie.dropped)).toHaveLength(
      elevation.ties.length,
    )
  })

  test('the openings are drawn over the boards they interrupt', () => {
    const { elevation } = requireElevation(makeWall({ height: 3 }), makeNode(), [makeOpening()])
    const face = elevation.faces[0]
    if (!face) throw new Error('no face')
    const shapes = elevationShapes(elevation, face)
    const firstVoid = shapes.findIndex((shape) => shape.kind === 'opening')
    const lastPiece = shapes.reduce((at, shape, index) => (shape.kind === 'piece' ? index : at), -1)

    expect(firstVoid).toBeGreaterThan(lastPiece)
  })
})

describe('elevationSvg', () => {
  test('carries every face of every pour, and the caveats with them', () => {
    const tall = makeWall({ height: 5, maxLiftHeight: 2.5 })
    const pages = [0, 1].map((liftIndex) => ({
      title: `Pour 1, lift ${liftIndex + 1}`,
      elevation: requireElevation(tall, makeNode({ liftIndex })).elevation,
    }))
    const svg = elevationSvg(pages, 'Wall W1')

    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).toContain('Shutter elevation — Wall W1')
    expect(svg).toContain('Pour 1, lift 1 — Front face')
    expect(svg).toContain('Pour 1, lift 2 — Back face')
    // The frame travels with the file, because this is the copy that gets emailed on and a
    // caveat on the screen only is a caveat that did not arrive.
    for (const page of pages) {
      for (const line of elevationCaveats(page.elevation)) {
        expect(svg).toContain(line.replace(/&/g, '&amp;').replace(/</g, '&lt;'))
      }
    }
  })

  test('every mark on the drawing is in the file', () => {
    const built = requireElevation(makeWall())
    const svg = elevationSvg([{ title: 'Pour 1, lift 1', elevation: built.elevation }], 'W1')

    for (const face of built.elevation.faces) {
      for (const piece of face.pieces) expect(svg).toContain(piece.mark)
    }
  })

  test('escapes a subject that would otherwise break the file', () => {
    const bare: ShutterElevation = {
      runMm: 1200,
      formBaseMm: 0,
      concreteTopMm: 2400,
      formTopMm: 2400,
      courses: [{ baseMm: 0, topMm: 2400 }],
      openings: [],
      ties: [],
      tiesDropped: [],
      tiesFrom: 'none',
      faces: [
        {
          role: 'side-a',
          pieces: [{ mark: 'P<A>', kind: 'panel', xMm: 0, yMm: 0, widthMm: 1200, heightMm: 2400 }],
        },
      ],
    }
    const svg = elevationSvg([{ title: 'Pour 1 & 2', elevation: bare }], 'Level 1 & 2')

    expect(svg).toContain('Level 1 &amp; 2')
    expect(svg).toContain('Pour 1 &amp; 2')
    expect(svg).toContain('P&lt;A&gt;')
    expect(svg).not.toContain('P<A>')
  })
})
