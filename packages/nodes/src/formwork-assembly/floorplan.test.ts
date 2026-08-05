import { describe, expect, test } from 'bun:test'
import type { AnyNode, AnyNodeId, GeometryContext, SlabNode, WallNode } from '@pascal-app/core'
import { buildFormworkAssemblyFloorplan } from './floorplan'
import { buildFormworkFloorplanSchedule } from './schedule'
import type { FormworkAssemblyNode } from './schema'

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

function makeSlab(overrides: Record<string, unknown> = {}): SlabNode {
  return {
    object: 'node',
    id: 'slab_test',
    type: 'slab',
    parentId: 'level_test',
    visible: true,
    metadata: {},
    children: [],
    polygon: [
      [0, 0],
      [6, 0],
      [6, 4],
      [0, 4],
    ],
    holes: [],
    holeMetadata: [],
    elevation: 3,
    thickness: 0.2,
    recessed: false,
    autoFromWalls: false,
    formworkType: 'plywood',
    soffitHeightAboveSupport: 3,
    ...overrides,
  } as unknown as SlabNode
}

function makeAssembly(
  hostId: string,
  scope: { segmentIndex?: number; liftIndex?: number } = {},
): FormworkAssemblyNode {
  return {
    object: 'node',
    id: `formwork-assembly_${hostId}_${scope.segmentIndex ?? 0}_${scope.liftIndex ?? 0}`,
    type: 'formwork-assembly',
    parentId: hostId,
    visible: true,
    metadata: {},
    children: [],
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    panelWidth: 0.6,
    segmentIndex: scope.segmentIndex ?? 0,
    liftIndex: scope.liftIndex ?? 0,
  } as FormworkAssemblyNode
}

/** A level holding `host` plus any neighbours, as the builders' `ctx` sees it. */
function makeCtx(host: AnyNode, neighbours: AnyNode[] = []): GeometryContext {
  const level = {
    object: 'node',
    id: 'level_test',
    type: 'level',
    children: [host.id, ...neighbours.map((n) => n.id)],
  }
  const byId = new Map<string, unknown>([
    [level.id, level],
    [host.id as string, host],
    ...neighbours.map((n) => [n.id as string, n] as [string, unknown]),
  ])
  return {
    parent: host,
    resolve: (id: string) => byId.get(id),
  } as unknown as GeometryContext
}

type Line = { kind: string; x1: number; y1: number; x2: number; y2: number }

function lines(geometry: ReturnType<typeof buildFormworkAssemblyFloorplan>): Line[] {
  if (geometry?.kind !== 'group') return []
  return geometry.children.filter((child): child is Line & typeof child => child.kind === 'line')
}

describe('formwork floorplan', () => {
  test('no host draws nothing', () => {
    const ctx = { parent: null } as GeometryContext
    expect(buildFormworkAssemblyFloorplan(makeAssembly('wall_test'), ctx)).toBeNull()
  })

  test('shuttering switched off draws nothing rather than an outline', () => {
    const wall = makeWall({ formworkType: 'none' })
    const geometry = buildFormworkAssemblyFloorplan(makeAssembly(wall.id), makeCtx(wall))
    expect(geometry).toBeNull()
  })

  test('a freestanding wall draws all four faces', () => {
    const wall = makeWall()
    const drawn = lines(buildFormworkAssemblyFloorplan(makeAssembly(wall.id), makeCtx(wall)))
    expect(drawn.length).toBe(4)
  })

  /**
   * The reason this layer exists. A wall butting a column that was cast first is
   * not formed at that end, and the gap in the plan line is the only place that
   * decision is visible — the 3D shutter just has no panel there.
   */
  test('a face the coverage engine suppresses leaves no line', () => {
    const wall = makeWall({ castOrder: 2 })
    const column = {
      object: 'node',
      id: 'column_first',
      type: 'column',
      parentId: 'level_test',
      visible: true,
      metadata: {},
      children: [],
      position: [3, 0, 0],
      rotation: 0,
      crossSection: 'square',
      width: 0.4,
      depth: 0.4,
      radius: 0.2,
      height: 2.4,
      castOrder: 1,
    } as unknown as AnyNode
    const free = lines(buildFormworkAssemblyFloorplan(makeAssembly(wall.id), makeCtx(makeWall())))
    const abutted = lines(
      buildFormworkAssemblyFloorplan(makeAssembly(wall.id), makeCtx(wall, [column])),
    )
    expect(abutted.length).toBeLessThan(free.length)
  })

  /**
   * A shutter drawn on the wrong side of its own edge stands inside the pour it is
   * holding back. The wall runs along y = 0 with a 0.2 m core, so its faces are at
   * y = ±0.1 and every shutter line must lie beyond them, never between.
   */
  test('shutter lines stand outside the concrete, not inside it', () => {
    const wall = makeWall()
    const drawn = lines(buildFormworkAssemblyFloorplan(makeAssembly(wall.id), makeCtx(wall)))
    const sideLines = drawn.filter((line) => Math.abs(line.y1 - line.y2) < 1e-9)
    expect(sideLines.length).toBe(2)
    for (const line of sideLines) {
      expect(Math.abs(line.y1)).toBeGreaterThan(0.1)
    }
    // One each side, rather than both pushed the same way.
    expect(Math.min(...sideLines.map((l) => l.y1))).toBeLessThan(0)
    expect(Math.max(...sideLines.map((l) => l.y1))).toBeGreaterThan(0)
  })

  test('a decked slab draws its rim plus a soffit wash', () => {
    const slab = makeSlab()
    const geometry = buildFormworkAssemblyFloorplan(makeAssembly(slab.id), makeCtx(slab))
    expect(geometry?.kind).toBe('group')
    expect(lines(geometry).length).toBe(4)
    if (geometry?.kind !== 'group') throw new Error('expected a group')
    expect(geometry.children.some((child) => child.kind === 'path')).toBe(true)
  })

  test('a hole in a slab takes its own edge forms', () => {
    const plain = buildFormworkAssemblyFloorplan(makeAssembly('slab_test'), makeCtx(makeSlab()))
    const holed = makeSlab({
      holes: [
        [
          [2, 1],
          [3, 1],
          [3, 2],
          [2, 2],
        ],
      ],
      holeMetadata: [{}],
    })
    const withHole = buildFormworkAssemblyFloorplan(makeAssembly('slab_test'), makeCtx(holed))
    expect(lines(withHole).length).toBe(lines(plain).length + 4)
  })
})

describe('formwork schedule', () => {
  const scheduleFor = (host: AnyNode, assemblies: FormworkAssemblyNode[]) =>
    buildFormworkFloorplanSchedule({
      siblings: assemblies,
      nodes: Object.fromEntries([
        [
          'level_test',
          {
            object: 'node',
            id: 'level_test',
            type: 'level',
            children: [host.id, ...assemblies.map((a) => a.id)],
          },
        ],
        [host.id as string, host],
        ...assemblies.map((a) => [a.id as string, a] as [string, AnyNode]),
      ]) as Record<string, AnyNode>,
      levelId: 'level_test' as AnyNodeId,
      unit: 'metric',
    })

  test('no assemblies produces no schedule at all', () => {
    expect(
      buildFormworkFloorplanSchedule({
        siblings: [],
        nodes: {},
        levelId: 'level_test' as AnyNodeId,
        unit: 'metric',
      }),
    ).toBeNull()
  })

  test('a wall contributes one row plus a total', () => {
    const wall = makeWall()
    const schedule = scheduleFor(wall, [makeAssembly(wall.id)])
    expect(schedule?.rows.length).toBe(2)
    expect(schedule?.rows.at(-1)?.cells.mark).toBe('TOTAL')
    expect(schedule?.title).toBe('FORMWORK SCHEDULE')
  })

  /**
   * The shuttered area is the number the schedule exists for, so it has to be a
   * real measurement rather than a placeholder. A 3 m × 2.4 m wall formed both
   * sides is 14.4 m² of contact area before the ends.
   */
  test('the area is the measured contact area, both faces counted', () => {
    const wall = makeWall()
    const schedule = scheduleFor(wall, [makeAssembly(wall.id)])
    const area = Number.parseFloat(schedule?.rows[0]?.cells.area ?? '0')
    expect(area).toBeGreaterThan(14)
    expect(area).toBeLessThan(16)
  })

  test('faces that are not formed are reported with the reason, not dropped', () => {
    const wall = makeWall({ formworkMode: 'single-sided-b' })
    const schedule = scheduleFor(wall, [makeAssembly(wall.id)])
    const notes = schedule?.rows[0]?.cells.notes ?? ''
    expect(notes).not.toBe('—')
    expect(notes.toLowerCase()).toContain('braced')
  })

  test('the total is the sum of the rows above it', () => {
    const wall = makeWall()
    const schedule = scheduleFor(wall, [makeAssembly(wall.id)])
    const rows = schedule?.rows ?? []
    const sum = rows
      .slice(0, -1)
      .reduce((acc, row) => acc + Number.parseFloat(row.cells.area ?? '0'), 0)
    expect(Number.parseFloat(rows.at(-1)?.cells.area ?? '0')).toBeCloseTo(sum, 1)
  })
})
