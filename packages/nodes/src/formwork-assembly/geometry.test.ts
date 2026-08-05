import { describe, expect, test } from 'bun:test'
import type { GeometryContext, WallNode } from '@pascal-app/core'
import { DOKA_FRAMAX_XLIFE } from '@pascal-app/core/formwork'
import type { Group } from 'three'
import { buildFormworkGeometry } from './geometry'
import type { FormworkAssemblyNode } from './schema'

function makeWall(overrides: Partial<WallNode> = {}): WallNode {
  return {
    object: 'node',
    id: 'wall_test',
    type: 'wall',
    parentId: null,
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

describe('buildFormworkGeometry', () => {
  test('no host wall -> empty group', () => {
    const ctx = { parent: null } as GeometryContext
    const group = buildFormworkGeometry(makeNode(), ctx)
    expect(group.children.length).toBe(0)
  })

  test('formworkType none -> empty group', () => {
    const ctx = { parent: makeWall({ formworkType: 'none' }) } as unknown as GeometryContext
    const group = buildFormworkGeometry(makeNode(), ctx)
    expect(group.children.length).toBe(0)
  })

  test('tiles panels on both faces, generates ties + walers on both faces', () => {
    const ctx = { parent: makeWall() } as unknown as GeometryContext
    const group = buildFormworkGeometry(makeNode(), ctx)
    const frontPanels = group.children.filter((c) => c.name.startsWith('panel-front-'))
    const backPanels = group.children.filter((c) => c.name.startsWith('panel-back-'))
    const ties = group.children.filter((c) => c.name.startsWith('tie-'))
    const frontWalers = group.children.filter((c) => c.name.startsWith('waler-front-'))
    const backWalers = group.children.filter((c) => c.name.startsWith('waler-back-'))
    expect(frontPanels.length).toBe(5) // 3m / 0.6m
    expect(backPanels.length).toBe(5)
    expect(ties.length).toBeGreaterThan(0)
    expect(frontWalers.length).toBeGreaterThan(0)
    expect(backWalers.length).toBeGreaterThan(0)
  })

  test('scaffoldRequired false -> no scaffold members', () => {
    const ctx = { parent: makeWall({ scaffoldRequired: false }) } as unknown as GeometryContext
    const group = buildFormworkGeometry(makeNode(), ctx)
    expect(group.children.some((c) => c.name.startsWith('scaffold-'))).toBe(false)
  })

  test('scaffoldRequired true -> scaffold posts/ledgers/braces on both faces', () => {
    const ctx = {
      parent: makeWall({ scaffoldRequired: true, height: 4 }),
    } as unknown as GeometryContext
    const group = buildFormworkGeometry(makeNode(), ctx)
    const posts = group.children.filter((c) => c.name.startsWith('scaffold-post-'))
    const ledgers = group.children.filter((c) => c.name.startsWith('scaffold-ledger-'))
    const braces = group.children.filter((c) => c.name.startsWith('scaffold-brace-'))
    expect(posts.some((c) => c.name.includes('front'))).toBe(true)
    expect(posts.some((c) => c.name.includes('back'))).toBe(true)
    expect(ledgers.length).toBeGreaterThan(0)
    expect(braces.length).toBeGreaterThan(0)
  })
})

/** Level context so the coverage engine can see the wall's neighbours. */
function makeLevelCtx(wall: WallNode, neighbours: Array<Record<string, unknown>> = []) {
  const level = {
    object: 'node',
    id: 'level_test',
    type: 'level',
    children: [wall.id, ...neighbours.map((n) => n.id as string)],
  }
  const byId = new Map<string, unknown>([
    [level.id, level],
    [wall.id, wall],
    ...neighbours.map((n) => [n.id as string, n] as [string, unknown]),
  ])
  return {
    parent: wall,
    resolve: (id: string) => byId.get(id),
  } as unknown as GeometryContext
}

function makeColumn(id: string, x: number, castOrder?: number) {
  return {
    object: 'node',
    id,
    type: 'column',
    parentId: 'level_test',
    visible: true,
    metadata: {},
    position: [x, 0, 0],
    rotation: 0,
    crossSection: 'square',
    width: 0.4,
    depth: 0.4,
    radius: 0.2,
    height: 2.4,
    castOrder,
  }
}

/** A column as the host of its own shutter, rather than a wall's neighbour. */
function makeColumnHost(overrides: Record<string, unknown> = {}) {
  return {
    ...makeColumn('column_host', 0),
    children: [],
    crossSection: 'rectangular',
    formworkType: 'plywood',
    ...overrides,
  }
}

function makeColumnCtx(column: Record<string, unknown>) {
  const level = {
    object: 'node',
    id: 'level_test',
    type: 'level',
    children: [column.id as string],
  }
  const byId = new Map<string, unknown>([
    [level.id, level],
    [column.id as string, column],
  ])
  return {
    parent: column,
    resolve: (id: string) => byId.get(id),
  } as unknown as GeometryContext
}

/**
 * A column's clamps are not evenly spaced. It is short and filled fast, so the
 * pressure is triangular over its whole height and the spacing a clamp can take
 * goes as `1/h` — which is the whole reason the builder asks `clampSchedule`
 * rather than dividing the height.
 */
describe('column box form', () => {
  const clampYs = (group: { children: Array<{ name: string; position: { y: number } }> }) =>
    [
      ...new Set(group.children.filter((c) => /^clamp-/.test(c.name)).map((c) => c.position.y)),
    ].sort((a, b) => a - b)

  const boxOf = (c: { geometry?: { parameters?: Record<string, number> } }) =>
    (c as { geometry?: { parameters?: Record<string, number> } }).geometry?.parameters ?? {}

  test('boxes all four faces of a freestanding column', () => {
    const group = buildFormworkGeometry(makeNode(), makeColumnCtx(makeColumnHost()))
    for (const face of ['column-face-1', 'column-face-2', 'column-face-3', 'column-face-4']) {
      expect(group.children.some((c) => c.name === `panel-${face}-0`)).toBe(true)
    }
    // Four clamps per row — the two pairs of yokes that close the box.
    const rows = clampYs(group)
    expect(rows.length).toBeGreaterThan(1)
    expect(group.children.filter((c) => /^clamp-/.test(c.name))).toHaveLength(rows.length * 4)
  })

  test('sets the form to the catalog increment, not to the concrete’s dimension', () => {
    // 337 mm of concrete is formed at 350; the box laps the extra at its corners.
    const group = buildFormworkGeometry(
      makeNode(),
      makeColumnCtx(makeColumnHost({ width: 0.337, depth: 0.337 })),
    )
    const face = group.children.find((c) => c.name === 'panel-column-face-1-0')
    // One panel at the form's size rather than several strips of the concrete's.
    expect(group.children.filter((c) => c.name.startsWith('panel-column-face-1-'))).toHaveLength(1)
    expect(boxOf(face as never).width).toBeCloseTo(0.35 - 0.005, 6)
  })

  test('sets each face to its own size on a rectangular column', () => {
    const group = buildFormworkGeometry(
      makeNode(),
      makeColumnCtx(makeColumnHost({ width: 0.4, depth: 0.6 })),
    )
    // Face 1 runs along X and carries the width; face 2 runs along Z and the depth.
    expect(
      boxOf(group.children.find((c) => c.name === 'panel-column-face-1-0') as never).width,
    ).toBeCloseTo(0.4 - 0.005, 6)
    expect(
      boxOf(group.children.find((c) => c.name === 'panel-column-face-2-0') as never).depth,
    ).toBeCloseTo(0.6 - 0.005, 6)
  })

  test('stands the form on a kicker and closes the clamps at the pour top', () => {
    // A column kicker is 75 mm, and the first clamp goes 100 mm above it — the base
    // band is the most heavily loaded and where the form is levered hardest.
    const group = buildFormworkGeometry(makeNode(), makeColumnCtx(makeColumnHost()))
    const panelBottom = Math.min(
      ...group.children
        .filter((c) => c.name.startsWith('panel-column-face-'))
        .map((c) => c.position.y - (boxOf(c as never).height ?? 0) / 2),
    )
    expect(panelBottom).toBeCloseTo(0.075, 6)
    const rows = clampYs(group)
    expect(rows[0]).toBeCloseTo(0.175, 6)
    expect(rows.at(-1)).toBeCloseTo(2.4, 6)
  })

  test('starts off the slab where the kicker is omitted', () => {
    const group = buildFormworkGeometry(
      makeNode(),
      makeColumnCtx(makeColumnHost({ kickerMode: 'kickerless' })),
    )
    const panelBottom = Math.min(
      ...group.children
        .filter((c) => c.name.startsWith('panel-column-face-'))
        .map((c) => c.position.y - (boxOf(c as never).height ?? 0) / 2),
    )
    expect(panelBottom).toBeCloseTo(0, 6)
    expect(clampYs(group)[0]).toBeCloseTo(0.1, 6)
  })

  test('has no kicker at a lift joint — the concrete below is the column', () => {
    const tall = makeColumnHost({ height: 6, maxLiftHeight: 3 })
    const upper = buildFormworkGeometry(makeNode({ liftIndex: 1 }), makeColumnCtx(tall))
    const panelBottom = Math.min(
      ...upper.children
        .filter((c) => c.name.startsWith('panel-column-face-'))
        .map((c) => c.position.y - (boxOf(c as never).height ?? 0) / 2),
    )
    expect(panelBottom).toBeCloseTo(3, 6)
    expect(clampYs(upper)[0]).toBeCloseTo(3.1, 6)
    expect(clampYs(upper).at(-1)).toBeCloseTo(6, 6)
  })

  test('tightens the clamps at the base where the pressure governs', () => {
    // A 600 mm section 6 m tall: the base band is clamp-limited, and the spacing
    // opens out going up as the head above each row falls. A uniform division would
    // be either unsafe at the base or wasteful at the top.
    const group = buildFormworkGeometry(
      makeNode(),
      makeColumnCtx(makeColumnHost({ width: 0.6, depth: 0.6, height: 6 })),
    )
    const rows = clampYs(group)
    const gaps = rows.slice(1, -1).map((y, i) => y - (rows[i] as number))
    expect(gaps.length).toBeGreaterThan(3)
    for (let i = 1; i < gaps.length; i++) {
      expect(gaps[i] as number).toBeGreaterThanOrEqual((gaps[i - 1] as number) - 1e-9)
    }
    expect(gaps.at(-1) as number).toBeGreaterThan(gaps[0] as number)
  })

  test('uses a clamp spacing the job specified rather than deriving one', () => {
    const group = buildFormworkGeometry(
      makeNode(),
      makeColumnCtx(makeColumnHost({ tieSpacing: 0.3 })),
    )
    const rows = clampYs(group)
    const gaps = rows.slice(1, -1).map((y, i) => y - (rows[i] as number))
    expect(gaps.length).toBeGreaterThan(2)
    for (const gap of gaps) expect(gap).toBeCloseTo(0.3, 6)
  })

  test('bands a round shaft at the same schedule rather than yoking it', () => {
    const group = buildFormworkGeometry(
      makeNode(),
      makeColumnCtx(makeColumnHost({ crossSection: 'round', radius: 0.2 })),
    )
    expect(group.children.filter((c) => c.name.startsWith('panel-shaft-'))).toHaveLength(24)
    expect(group.children.some((c) => c.name.startsWith('panel-column-face-'))).toBe(false)
    const rows = clampYs(group)
    expect(rows[0]).toBeCloseTo(0.175, 6)
    expect(group.children.filter((c) => /^clamp-/.test(c.name))).toHaveLength(rows.length * 24)
  })
})

describe('cast-order-aware coverage', () => {
  test('freestanding wall gets stop-ends at both ends — all four sides formed', () => {
    const wall = makeWall({ parentId: 'level_test' })
    const group = buildFormworkGeometry(makeNode(), makeLevelCtx(wall))
    expect(group.children.some((c) => c.name === 'stop-end-start')).toBe(true)
    expect(group.children.some((c) => c.name === 'stop-end-end')).toBe(true)
    expect(group.children.filter((c) => c.name.startsWith('panel-front-')).length).toBe(5)
    expect(group.children.filter((c) => c.name.startsWith('panel-back-')).length).toBe(5)
  })

  test('wall between two earlier-cast columns drops both stop-ends', () => {
    const wall = makeWall({ parentId: 'level_test', castOrder: 2 })
    const ctx = makeLevelCtx(wall, [makeColumn('column_a', 0, 1), makeColumn('column_b', 3, 1)])
    const group = buildFormworkGeometry(makeNode(), ctx)
    expect(group.children.some((c) => c.name.startsWith('stop-end-'))).toBe(false)
    // Both side faces still shuttered — concrete pushes on them regardless.
    expect(group.children.filter((c) => c.name.startsWith('panel-front-')).length).toBe(5)
    expect(group.children.filter((c) => c.name.startsWith('panel-back-')).length).toBe(5)
  })

  test('wall cast before its columns keeps both stop-ends', () => {
    const wall = makeWall({ parentId: 'level_test', castOrder: 0 })
    const ctx = makeLevelCtx(wall, [makeColumn('column_a', 0, 1), makeColumn('column_b', 3, 1)])
    const group = buildFormworkGeometry(makeNode(), ctx)
    expect(group.children.filter((c) => c.name.startsWith('stop-end-')).length).toBe(2)
  })

  test('single-sided pour builds one skin and no through-ties', () => {
    const wall = makeWall({ parentId: 'level_test', formworkMode: 'single-sided-a' })
    const group = buildFormworkGeometry(makeNode(), makeLevelCtx(wall))
    expect(group.children.filter((c) => c.name.startsWith('panel-front-')).length).toBe(5)
    expect(group.children.filter((c) => c.name.startsWith('panel-back-')).length).toBe(0)
    expect(group.children.filter((c) => c.name.startsWith('waler-back-')).length).toBe(0)
    expect(group.children.some((c) => c.name.startsWith('tie-'))).toBe(false)
  })

  test('cuts panels around a window and forms all four reveals', () => {
    const wall = makeWall({ parentId: 'level_test', height: 3 })
    const window = {
      object: 'node',
      id: 'window_a',
      type: 'window',
      parentId: wall.id,
      wallId: wall.id,
      visible: true,
      metadata: {},
      position: [1.5, 1.5, 0],
      rotation: [0, 0, 0],
      width: 1.2,
      height: 1.5,
    }
    const wallWithChild = { ...wall, children: [window.id] } as WallNode
    const ctx = makeLevelCtx(wallWithChild, [window])
    const group = buildFormworkGeometry(makeNode(), ctx)

    // The columns crossing the void are split into a sill band and a head band
    // instead of spanning it — the trailing index is the band.
    expect(group.children.some((c) => /^panel-front-c\d+-\d+-\d+$/.test(c.name))).toBe(true)
    const boxOut = group.children.filter((c) => c.name.startsWith('box-out-window_a-'))
    expect(boxOut.map((c) => c.name.split('-').pop()).sort()).toEqual([
      'end',
      'head',
      'sill',
      'start',
    ])
  })

  test('a floor-level door gets three reveals — there is no sill to form', () => {
    const wall = makeWall({ parentId: 'level_test', height: 3 })
    const door = {
      object: 'node',
      id: 'door_a',
      type: 'door',
      parentId: wall.id,
      wallId: wall.id,
      visible: true,
      metadata: {},
      position: [1.5, 1.05, 0],
      rotation: [0, 0, 0],
      width: 0.9,
      height: 2.1,
    }
    const wallWithChild = { ...wall, children: [door.id] } as WallNode
    const group = buildFormworkGeometry(makeNode(), makeLevelCtx(wallWithChild, [door]))
    const boxOut = group.children.filter((c) => c.name.startsWith('box-out-door_a-'))
    expect(boxOut).toHaveLength(3)
    expect(boxOut.some((c) => c.name.endsWith('sill'))).toBe(false)
  })

  test('drops ties that would land in an opening', () => {
    const wall = makeWall({ parentId: 'level_test', height: 3 })
    const opening = {
      object: 'node',
      id: 'window_b',
      type: 'window',
      parentId: wall.id,
      wallId: wall.id,
      visible: true,
      metadata: {},
      position: [1.5, 1.5, 0],
      rotation: [0, 0, 0],
      width: 2,
      height: 2.4,
    }
    const bare = buildFormworkGeometry(makeNode(), makeLevelCtx(wall))
    const withOpening = buildFormworkGeometry(
      makeNode(),
      makeLevelCtx({ ...wall, children: [opening.id] } as WallNode, [opening]),
    )
    const tiesIn = (group: { children: Array<{ name: string }> }) =>
      group.children.filter((c) => c.name.startsWith('tie-')).length
    expect(tiesIn(withOpening)).toBeLessThan(tiesIn(bare))
  })

  test('monolithic neighbour needs no stop-end at the shared end', () => {
    const wall = makeWall({ parentId: 'level_test', castOrder: 1, pourId: 'P1' })
    const neighbour = {
      ...makeWall({ parentId: 'level_test', castOrder: 1, pourId: 'P1' }),
      id: 'wall_other',
      start: [3, 0],
      end: [3, 3],
    }
    const group = buildFormworkGeometry(
      makeNode(),
      makeLevelCtx(wall, [neighbour as unknown as Record<string, unknown>]),
    )
    expect(group.children.some((c) => c.name === 'stop-end-end')).toBe(false)
    expect(group.children.some((c) => c.name === 'stop-end-start')).toBe(true)
  })
})

/**
 * Corner units are the junction's hardware, not either wall's, and the panel run
 * on each leg starts clear of them — "start from the corners, work toward the
 * middle", so the make-up piece lands mid-run rather than against the corner.
 */
describe('corner units at a junction', () => {
  /** An L whose two walls are poured together, so the corner is turned. */
  function monolithicCorner(overrides: Record<string, unknown> = {}) {
    const wall = makeWall({
      parentId: 'level_test',
      castOrder: 1,
      pourId: 'P1',
    } as Partial<WallNode>)
    const neighbour = {
      ...makeWall({ parentId: 'level_test', castOrder: 1, pourId: 'P1' } as Partial<WallNode>),
      id: 'wall_other',
      start: [3, 0],
      end: [3, 3],
      ...overrides,
    }
    return makeLevelCtx(wall, [neighbour as unknown as Record<string, unknown>])
  }

  test('turns the corner on both skins — one inside leg, one outside', () => {
    const group = buildFormworkGeometry(makeNode(), monolithicCorner())
    const legs = group.children.filter((c) => c.name.startsWith('corner-'))
    expect(legs.filter((c) => c.name.startsWith('corner-inside-'))).toHaveLength(1)
    expect(legs.filter((c) => c.name.startsWith('corner-outside-'))).toHaveLength(1)
  })

  test('makes the outside leg longer than the inside one by the core it wraps', () => {
    const group = buildFormworkGeometry(makeNode(), monolithicCorner())
    const widthOf = (prefix: string) =>
      (
        group.children.find((c) => c.name.startsWith(prefix)) as unknown as {
          geometry?: { parameters?: { width?: number } }
        }
      )?.geometry?.parameters?.width ?? 0
    expect(widthOf('corner-outside-') - widthOf('corner-inside-')).toBeCloseTo(0.2, 6)
  })

  test('starts both skins’ panel runs at the same station, so ties pass through square', () => {
    // The inside leg is measured from the neighbour's inner face and the outside
    // one from its outer face, which is what aligns the two first joints. Placing
    // both from the junction point staggers the skins by the wall thickness.
    const group = buildFormworkGeometry(makeNode(), monolithicCorner())
    const runEnd = (side: string) =>
      Math.max(
        ...group.children
          .filter((c) => c.name.startsWith(`panel-${side}-`))
          .map(
            (c) =>
              c.position.x +
              ((c as unknown as { geometry?: { parameters?: { width?: number } } }).geometry
                ?.parameters?.width ?? 0) /
                2,
          ),
      )
    expect(runEnd('front')).toBeCloseTo(runEnd('back'), 6)
  })

  test('starts the panel run clear of the corner, not at the junction point', () => {
    const group = buildFormworkGeometry(makeNode(), monolithicCorner())
    const panelEnd = Math.max(
      ...group.children
        .filter((c) => c.name.startsWith('panel-front-'))
        .map(
          (c) =>
            c.position.x +
            ((c as unknown as { geometry?: { parameters?: { width?: number } } }).geometry
              ?.parameters?.width ?? 0) /
              2,
        ),
    )
    // The wall is 3 m long and the placeholder inside leg 300 mm, measured from
    // the neighbour's inner face at 2.9 m.
    expect(panelEnd).toBeCloseTo(2.6, 2)
  })

  test('leaves the make-up piece mid-run rather than at the corner', () => {
    // The panels are real catalog widths, so the run does not divide evenly and one
    // piece is narrower than the rest. That piece belongs in the middle: a poor
    // joint beside the corner unit is where the form is hardest to keep tight and
    // where anyone looking at the wall sees it first.
    const group = buildFormworkGeometry(makeNode(), monolithicCorner())
    const widths = group.children
      .filter((c) => /^(panel|filler|cut)-front-/.test(c.name))
      .map(
        (c) =>
          (c as unknown as { geometry?: { parameters?: { width?: number } } }).geometry?.parameters
            ?.width ?? 0,
      )
    expect(widths.length).toBeGreaterThan(2)
    const narrowest = Math.min(...widths)
    const at = widths.indexOf(narrowest)
    expect(at).toBeGreaterThan(0)
    expect(at).toBeLessThan(widths.length - 1)
    // Widest at the ends, which is also how a gang is craned in.
    expect(widths[0]).toBeCloseTo(Math.max(...widths), 6)
    expect(widths.at(-1)).toBeCloseTo(Math.max(...widths), 6)
    expect(Math.max(...widths)).toBeLessThanOrEqual(0.6)
  })

  test('turns no corner where the walls are cast in sequence', () => {
    // The later wall butts hardened concrete: nothing turns the corner, and the
    // panels run up to that face.
    const wall = makeWall({ parentId: 'level_test', castOrder: 2 } as Partial<WallNode>)
    const neighbour = {
      ...makeWall({ parentId: 'level_test', castOrder: 1 } as Partial<WallNode>),
      id: 'wall_other',
      start: [3, 0],
      end: [3, 3],
    }
    const group = buildFormworkGeometry(
      makeNode(),
      makeLevelCtx(wall, [neighbour as unknown as Record<string, unknown>]),
    )
    expect(group.children.some((c) => c.name.startsWith('corner-'))).toBe(false)
  })

  test('stops the walers at the corner unit rather than running them over it', () => {
    const bare = buildFormworkGeometry(
      makeNode(),
      makeLevelCtx(makeWall({ parentId: 'level_test' })),
    )
    const cornered = buildFormworkGeometry(makeNode(), monolithicCorner())
    const walerEnd = (group: { children: Array<{ name: string; position: { x: number } }> }) =>
      Math.max(
        ...group.children
          .filter((c) => c.name.startsWith('waler-front-'))
          .map(
            (c) =>
              c.position.x +
              ((c as unknown as { geometry?: { parameters?: { width?: number } } }).geometry
                ?.parameters?.width ?? 0) /
                2,
          ),
      )
    expect(walerEnd(bare)).toBeCloseTo(3, 6)
    expect(walerEnd(cornered)).toBeCloseTo(2.6, 2)
  })

  test('puts no tie on the stretch a corner unit takes', () => {
    // The unit ties through its own holes at the catalog's spacing, so a tie on the
    // wall's own stations there would bear on hardware rather than on a panel. The
    // wall is 3 m and the inside leg reaches back to 2.6 m from the neighbour's
    // inner face, so nothing may land beyond it.
    const cornered = buildFormworkGeometry(makeNode(), monolithicCorner())
    const xs = cornered.children.filter((c) => c.name.startsWith('tie-')).map((c) => c.position.x)
    expect(xs.length).toBeGreaterThan(0)
    expect(Math.max(...xs)).toBeLessThan(2.6)
  })

  test('ties only where both skins are drilled through, so a rod can pass', () => {
    // Two faces divided differently have holes that miss each other, and a tie
    // drawn there would pass through a steel frame. A T is the case: the stem's
    // unit takes a stretch out of the inner face and none out of the outer one.
    const wall = makeWall({ parentId: 'level_test', castOrder: 1, pourId: 'P1', end: [6, 0] })
    const stem = {
      ...makeWall({ parentId: 'level_test', castOrder: 1, pourId: 'P1' }),
      id: 'wall_stem',
      start: [3, 0],
      end: [3, 3],
    }
    const group = buildFormworkGeometry(
      makeNode(),
      makeLevelCtx(wall, [stem as unknown as Record<string, unknown>]),
    )
    const edgesOf = (side: string) =>
      new Set(
        group.children
          .filter((c) => new RegExp(`^(panel|filler|cut)-${side}-`).test(c.name))
          .map((c) =>
            (
              c.position.x -
              ((c as unknown as { geometry?: { parameters?: { width?: number } } }).geometry
                ?.parameters?.width ?? 0) /
                2
            ).toFixed(3),
          ),
      )
    // The outer skin has joints of its own across the stretch the units take out of
    // the inner one — it is panelled there and the inner face is not. What has to
    // hold is that it repeats every station the inner face uses, because that is
    // what puts a hole opposite a hole.
    const outer = edgesOf('back')
    for (const edge of edgesOf('front')) expect(outer).toContain(edge)
    // Which is only worth asserting because it is what buys the ties: divided
    // independently the two skins share almost no station, and a 6 m wall comes back
    // with a handful of rods at the ends.
    const ties = group.children.filter((c) => c.name.startsWith('tie-'))
    expect(ties.length).toBeGreaterThan(8)
  })

  test('marks whose bill each leg is on, so one unit is one BOM line', () => {
    const ctx = monolithicCorner()
    const group = buildFormworkGeometry(makeNode(), ctx)
    const legs = group.children.filter((c) => c.name.startsWith('corner-'))
    expect(legs.length).toBeGreaterThan(0)
    // Both walls draw their own leg; the suffix says which one pays.
    for (const leg of legs) {
      expect(/-(owned|shared)-/.test(leg.name)).toBe(true)
    }
  })
})

/**
 * A tall wall is not shuttered in one go. Each assembly covers one lift, so the
 * geometry has to sit inside that lift rather than spanning the element — the
 * whole point of `liftIndex`.
 */
describe('lift-scoped assemblies', () => {
  const tall = () =>
    makeWall({
      parentId: 'level_test',
      height: 9,
      end: [3, 0],
      maxLiftHeight: 3,
    } as Partial<WallNode>)

  function yRange(
    group: { children: Array<{ name: string; position: { y: number } }> },
    prefix: string,
  ) {
    const ys = group.children.filter((c) => c.name.startsWith(prefix)).map((c) => c.position.y)
    return { min: Math.min(...ys), max: Math.max(...ys) }
  }

  test('builds the bottom lift inside the bottom third of the wall', () => {
    const group = buildFormworkGeometry(makeNode({ liftIndex: 0 }), makeLevelCtx(tall()))
    const { min, max } = yRange(group, 'panel-front-')
    expect(min).toBeGreaterThanOrEqual(0)
    expect(max).toBeLessThanOrEqual(3)
  })

  test('builds the top lift inside the top third of the wall', () => {
    const group = buildFormworkGeometry(makeNode({ liftIndex: 2 }), makeLevelCtx(tall()))
    const { min, max } = yRange(group, 'panel-front-')
    expect(min).toBeGreaterThanOrEqual(6)
    expect(max).toBeLessThanOrEqual(9)
  })

  test('each lift gets its own tie grid rather than one spanning the wall', () => {
    const bottom = buildFormworkGeometry(makeNode({ liftIndex: 0 }), makeLevelCtx(tall()))
    const middle = buildFormworkGeometry(makeNode({ liftIndex: 1 }), makeLevelCtx(tall()))
    expect(yRange(bottom, 'tie-').max).toBeLessThanOrEqual(3)
    expect(yRange(middle, 'tie-').min).toBeGreaterThanOrEqual(3)
  })

  test('stands the shutter proud of the lift joint rather than short of it', () => {
    // A steel-framed panel is not cut down to suit a lift. The 3 m lift is formed
    // with one 3.30 m course, so the form runs past the joint — which is what gives
    // the last of the pour a side. Stopping short of the joint would leave it open.
    const middle = buildFormworkGeometry(makeNode({ liftIndex: 1 }), makeLevelCtx(tall()))
    const panels = middle.children.filter((c) => /^(panel|filler|cut)-front-/.test(c.name))
    const top = Math.max(
      ...panels.map(
        (p) =>
          p.position.y +
          ((p as { geometry?: { parameters?: { height?: number } } }).geometry?.parameters
            ?.height ?? 0) /
            2,
      ),
    )
    expect(top).toBeGreaterThanOrEqual(6)
    expect(top).toBeCloseTo(6.3, 6)
  })

  test('starts the bottom lift off the kicker, and the ones above off the concrete', () => {
    // The kicker is cast with the slab and is part of the wall, so the form stands
    // on top of it. At a lift joint there is no kicker: the concrete below is this
    // same wall and the next course starts on it.
    const baseOf = (liftIndex: number) => {
      const group = buildFormworkGeometry(makeNode({ liftIndex }), makeLevelCtx(tall()))
      return Math.min(
        ...group.children
          .filter((c) => /^(panel|filler|cut)-front-/.test(c.name))
          .map(
            (p) =>
              p.position.y -
              ((p as { geometry?: { parameters?: { height?: number } } }).geometry?.parameters
                ?.height ?? 0) /
                2,
          ),
      )
    }
    expect(baseOf(0)).toBeCloseTo(0.1, 6)
    expect(baseOf(1)).toBeCloseTo(3, 6)
  })

  test('an unsplit wall still builds the whole element from one assembly', () => {
    const group = buildFormworkGeometry(
      makeNode(),
      makeLevelCtx(makeWall({ parentId: 'level_test' })),
    )
    expect(group.children.filter((c) => c.name.startsWith('panel-front-')).length).toBe(5)
  })

  test('falls back to the whole element when the scope names no live unit', () => {
    // The lift cap was relaxed after the assemblies were created, so lift 2 no
    // longer exists. Building nothing would hide the shutter with no explanation.
    const group = buildFormworkGeometry(
      makeNode({ liftIndex: 7 }),
      makeLevelCtx(makeWall({ parentId: 'level_test' })),
    )
    expect(group.children.filter((c) => c.name.startsWith('panel-front-')).length).toBe(5)
  })
})

describe('segment-scoped assemblies', () => {
  const long = () => makeWall({ parentId: 'level_test', end: [40, 0] } as Partial<WallNode>)

  test('builds a bulkhead at an expansion joint inside the wall', () => {
    const joint = {
      object: 'node',
      id: 'construction-joint_a',
      type: 'construction-joint',
      parentId: 'level_test',
      visible: true,
      metadata: {},
      children: [],
      kind: 'expansion',
      elementIds: ['wall_test'],
      along: 15,
      treatments: [],
      solverPlaced: false,
    }
    const ctx = makeLevelCtx(long(), [joint])
    const first = buildFormworkGeometry(makeNode({ segmentIndex: 0 }), ctx)
    const second = buildFormworkGeometry(makeNode({ segmentIndex: 1 }), ctx)

    // Both segments close at the joint, and each spans only its own bay.
    expect(first.children.find((c) => c.name === 'stop-end-end')?.position.x).toBeCloseTo(15.01, 2)
    expect(second.children.find((c) => c.name === 'stop-end-start')?.position.x).toBeCloseTo(
      14.99,
      2,
    )
    const firstPanels = first.children.filter((c) => c.name.startsWith('panel-front-'))
    expect(Math.max(...firstPanels.map((p) => p.position.x))).toBeLessThan(15)
  })
})

/**
 * The tie and waler grid is solved, not assumed. `wallDesign` runs the lateral
 * chain — pressure → sheathing → studs → walers → ties — where each member's
 * allowable span is the next one's load, so the grid follows from the pour instead
 * of from a pair of constants that cannot know the lift height.
 */
describe('wall tie and waler chain', () => {
  /**
   * A carpenter's shutter: the yard supplies none of the catalog panels, so the face
   * is boarded with ply cut on site. This is the path where the solved grid actually
   * places the ties, because there the crew drills the sheathing where the
   * calculation asks rather than where a factory already drilled it.
   */
  const conventional = () =>
    makeNode({ avoidedPanelIds: DOKA_FRAMAX_XLIFE.panels.map((panel) => panel.id) })

  /** Unstated spacings, so the design chooses them rather than reporting against them. */
  const unstated = (overrides: Partial<WallNode> = {}) =>
    makeWall({
      parentId: 'level_test',
      tieSpacing: undefined,
      walerSpacing: undefined,
      ...overrides,
    } as Partial<WallNode>)

  const at = (n: number) => Number(n.toFixed(3))
  const build = (wall: WallNode, node: FormworkAssemblyNode) =>
    buildFormworkGeometry(node, makeLevelCtx(wall))
  const rowsOf = (group: Group, prefix: string) => {
    const members = group.children.filter((c) => c.name.startsWith(prefix))
    const ys = [...new Set(members.map((m) => at(m.position.y)))].sort((a, b) => a - b)
    return ys.map((y) => ({
      y,
      xs: members
        .filter((m) => at(m.position.y) === y)
        .map((m) => at(m.position.x))
        .sort((a, b) => a - b),
    }))
  }
  const pitch = (row: { xs: number[] }) => at((row.xs[1] as number) - (row.xs[0] as number))

  test('grades the rows: tightest at the base, opening out as the head falls', () => {
    const rows = rowsOf(build(unstated(), conventional()), 'tie-')
    expect(rows.length).toBeGreaterThan(1)
    // The bottom row stands on the kicker, and is tied at what the hardware and the
    // waler's bending take under the full head.
    expect(rows[0]?.y).toBeCloseTo(0.1, 6)
    expect(pitch(rows[0] as { xs: number[] })).toBeCloseTo(0.3, 6)
    expect(pitch(rows.at(-1) as { xs: number[] })).toBeGreaterThan(
      pitch(rows[0] as { xs: number[] }),
    )
  })

  test('the grid tightens with the lift height on its own', () => {
    // The whole reason for running the chain rather than assuming a spacing. A 4 m
    // lift carries more head than a 2.4 m one at every elevation, and no constant
    // pair of spacings can answer both.
    const short = rowsOf(build(unstated(), conventional()), 'tie-')
    const tall = rowsOf(build(unstated({ height: 4 }), conventional()), 'tie-')
    expect(tall.length).toBeGreaterThan(short.length)
    expect(pitch(tall[0] as { xs: number[] })).toBeLessThan(pitch(short[0] as { xs: number[] }))
  })

  test('divides each row into whole bays, so no bay exceeds what it allowed', () => {
    // Rounded up rather than to nearest: a 3 m run at 0.9 m centres rounded to
    // nearest is three bays of 1 m, over capacity on every one of them.
    for (const row of rowsOf(build(unstated({ height: 4 }), conventional()), 'tie-')) {
      expect(row.xs[0]).toBeCloseTo(0, 6)
      expect(row.xs.at(-1)).toBeCloseTo(3, 6)
      for (let i = 1; i < row.xs.length; i++) {
        expect((row.xs[i] as number) - (row.xs[i - 1] as number)).toBeCloseTo(pitch(row), 6)
      }
    }
  })

  test('a stated spacing is used as given rather than quietly retightened', () => {
    // 0.6 m is looser than the 0.3 m the base row solves to, but a crew that has set
    // out to a stated module has to find the drawing agreeing with it. The overload
    // is the design's warning to report, not the builder's to fix behind the drawing.
    const rows = rowsOf(build(makeWall({ parentId: 'level_test' }), conventional()), 'tie-')
    expect(rows.map((row) => row.y)).toEqual([0.1, 1, 1.9])
    for (const row of rows) expect(pitch(row)).toBeCloseTo(0.6, 6)
  })

  test('a drilled panel system ties where holes meet, not on the solved pitch', () => {
    // Framax leaves the factory drilled, so a rod passes only where a hole on one
    // skin lines up with a hole on the other. Asking for a tie at the calculated
    // elevation would draw steel through a steel frame.
    const drilled = rowsOf(build(unstated(), makeNode()), 'tie-')
    const solved = rowsOf(build(unstated(), conventional()), 'tie-')
    expect(drilled.map((row) => row.y)).toEqual([0.775, 2.125])
    expect(drilled.map((row) => row.y)).not.toEqual(solved.map((row) => row.y))
  })

  test('walers land on the tie rows, because a tie has to bear on one', () => {
    // On the drilled system that means the factory's grid rather than the solved
    // spacing — a beam set out on the solved spacing beside it would leave every rod
    // bearing on the panel skin.
    const group = build(unstated(), makeNode())
    const ties = rowsOf(group, 'tie-').map((row) => row.y)
    expect(rowsOf(group, 'waler-front-').map((row) => row.y)).toEqual(ties)
    expect(rowsOf(group, 'waler-back-').map((row) => row.y)).toEqual(ties)
  })

  test('a single-sided pour has no ties, so its walers take the solved rows', () => {
    const wall = unstated({ formworkMode: 'single-sided-a' } as Partial<WallNode>)
    const group = build(wall, makeNode())
    expect(group.children.some((c) => c.name.startsWith('tie-'))).toBe(false)
    expect(rowsOf(group, 'waler-front-').map((row) => row.y)).toEqual(
      rowsOf(build(unstated(), conventional()), 'tie-').map((row) => row.y),
    )
  })

  test('architectural concrete is designed to a stiffer deflection limit', () => {
    // Visible concrete is read for its finish, so the sheathing takes l/360 and an
    // absolute cap rather than structural l/270 — which moves the rows above it.
    const plain = rowsOf(build(unstated(), conventional()), 'tie-').map((row) => row.y)
    const seen = rowsOf(
      build(unstated({ exposureClass: 'architectural' } as Partial<WallNode>), conventional()),
      'tie-',
    ).map((row) => row.y)
    expect(seen).not.toEqual(plain)
  })
})
