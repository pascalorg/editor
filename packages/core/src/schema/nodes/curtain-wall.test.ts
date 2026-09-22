import { describe, expect, test } from 'bun:test'
import {
  buildCurtainWallLayout,
  CurtainGrid,
  CurtainWallConfig,
  curtainGridPositions,
  curtainPanelType,
} from './curtain-wall'
import { WallNode } from './wall'

describe('curtain walls', () => {
  test('old walls remain standard and switching preserves both configurations', () => {
    const wall = WallNode.parse({ start: [0, 0], end: [6, 0], skirting: { enabled: true } })
    expect(wall.wallType ?? 'standard').toBe('standard')
    const curtain = WallNode.parse({
      ...wall,
      wallType: 'curtain',
      curtainWall: { construction: 'unitized' },
    })
    const restored = WallNode.parse({ ...curtain, wallType: 'standard' })
    expect(restored.skirting).toEqual(wall.skirting)
    expect(restored.curtainWall?.construction).toBe('unitized')
    expect(restored.id).toBe(wall.id)
    expect(restored.type).toBe('wall')
  })

  test('grid rules preserve requested spacing and alignment', () => {
    expect(curtainGridPositions(6, CurtainGrid.parse({ layout: 'count', count: 3 }))).toEqual([
      0, 2, 4, 6,
    ])
    expect(
      curtainGridPositions(5, CurtainGrid.parse({ layout: 'maximum-spacing', spacing: 2 })),
    ).toEqual([0, 5 / 3, 10 / 3, 5])
    expect(
      curtainGridPositions(
        5,
        CurtainGrid.parse({ layout: 'fixed-spacing', spacing: 2, alignment: 'start' }),
      ),
    ).toEqual([0, 2, 4, 5])
    expect(
      curtainGridPositions(
        5,
        CurtainGrid.parse({ layout: 'fixed-spacing', spacing: 2, alignment: 'center' }),
      ),
    ).toEqual([0, 0.5, 2.5, 4.5, 5])
    expect(
      curtainGridPositions(
        5,
        CurtainGrid.parse({ layout: 'fixed-spacing', spacing: 2, alignment: 'end' }),
      ),
    ).toEqual([0, 1, 3, 5])
    expect(curtainGridPositions(0, CurtainGrid.parse({}))).toEqual([0])
    expect(curtainGridPositions(1000, CurtainGrid.parse({ spacing: 0.2 })).length).toBe(33)
  })

  test('panel overrides take precedence over spandrels and defaults', () => {
    const config = CurtainWallConfig.parse({
      spandrel: 'bottom',
      panels: [{ column: 0, row: 0, type: 'empty' }],
    })
    expect(curtainPanelType(config, 0, 0, 2)).toBe('empty')
    expect(curtainPanelType(config, 1, 0, 2)).toBe('solid')
    expect(curtainPanelType(config, 1, 1, 2)).toBe('glass')
  })

  test('structural glazing exposes glass in front of recessed framing', () => {
    const pieces = buildCurtainWallLayout(
      6,
      3,
      0.15,
      CurtainWallConfig.parse({ framing: 'structural-glazing' }),
    )
    const frames = pieces.filter((piece) => piece.role === 'frame')
    const panes = pieces.filter((piece) => piece.role === 'glass')
    expect(frames.length).toBeGreaterThan(0)
    expect(panes.length).toBe(8)
    expect(Math.max(...frames.map((piece) => piece.front))).toBeLessThanOrEqual(
      Math.min(...panes.map((piece) => piece.back)),
    )
  })

  test('tiny cells remain positive and invalid dimensions are rejected', () => {
    const config = CurtainWallConfig.parse({
      columns: { layout: 'count', count: 32 },
      rows: { layout: 'count', count: 32 },
      mullionWidth: 0.3,
    })
    for (const piece of buildCurtainWallLayout(0.1, 0.1, 0.05, config)) {
      expect(piece.right).toBeGreaterThan(piece.left)
      expect(piece.top).toBeGreaterThan(piece.bottom)
      expect(piece.front).toBeGreaterThan(piece.back)
    }
    for (const input of [
      { mullionWidth: -1 },
      { glassOpacity: 2 },
      { columns: { count: 33 } },
      { glassThickness: Infinity },
    ])
      expect(CurtainWallConfig.safeParse(input).success).toBe(false)
  })

  test('dense stick grids use continuous members instead of one frame per panel edge', () => {
    const columns = 32
    const rows = 32
    const pieces = buildCurtainWallLayout(
      10,
      3,
      0.15,
      CurtainWallConfig.parse({
        construction: 'stick',
        columns: { layout: 'count', count: columns },
        rows: { layout: 'count', count: rows },
      }),
    )
    const frames = pieces.filter((piece) => piece.role === 'frame')
    expect(frames).toHaveLength(columns + 1 + columns * (rows + 1))
    expect(frames.length).toBeLessThan(columns * rows * 2)
  })
})

test('entrance frames adapt to door size, position, support elevation, and removal', () => {
  const config = CurtainWallConfig.parse({})
  const base = buildCurtainWallLayout(6, 3, 0.15, config)
  const door = {
    type: 'door' as const,
    position: [1.5, 1.05, 0] as [number, number, number],
    width: 0.9,
    height: 2.1,
    openingShape: 'rectangle' as const,
  }
  const at = (pieces: typeof base, x: number, y: number) =>
    pieces.filter((piece) => x > piece.left && x < piece.right && y > piece.bottom && y < piece.top)
  const first = buildCurtainWallLayout(6, 3, 0.15, config, [door])
  expect(at(first, 1.5, 0.02)).toHaveLength(0)
  expect(at(first, 1.025, 1).map((piece) => piece.role)).toEqual(['frame'])
  expect(at(first, 1.25, 2.125).map((piece) => piece.role)).toEqual(['frame'])
  const moved = buildCurtainWallLayout(6, 3, 0.15, config, [
    { ...door, position: [4, 1.2, 0], width: 1.8, height: 2.4 },
  ])
  expect(at(moved, 1.25, 1).map((piece) => piece.role)).toEqual(['glass'])
  expect(at(moved, 4, 1)).toHaveLength(0)
  expect(at(moved, 3.075, 1).map((piece) => piece.role)).toEqual(['frame'])
  expect(buildCurtainWallLayout(6, 3, 0.15, config, [])).toEqual(base)
  const supported = buildCurtainWallLayout(6, 3.5, 0.15, config, [door], -0.5)
  expect(at(supported, 1.25, 2.625).map((piece) => piece.role)).toEqual(['frame'])
})
