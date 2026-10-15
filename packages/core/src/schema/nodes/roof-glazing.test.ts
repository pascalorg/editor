import { afterEach, expect, test } from 'bun:test'
import {
  clampRectToRoofWallFace,
  type GlazedRoofPiece,
  getBarrelRoofSolidPieces,
  getGlazedRoofFaces,
  getGlazedRoofLayout,
  getGlazedRoofPieceFaces,
  getGlazedRoofPieces,
  getGlazedRoofPlanLines,
  getRoofGlazing,
  getRoofSegmentSurfaceY,
  getRoofSegmentWallFace,
  glazedRoofFacePoint,
  glazedRoofSupportsPoint,
  isGlazedRoofSegment,
  RoofSegmentNode,
  useScene,
} from '@pascal-app/core'

test('old roof segments stay standard and glazing survives a JSON round trip', () => {
  expect(isGlazedRoofSegment(RoofSegmentNode.parse({ roofType: 'gable' }))).toBe(false)
  const node = RoofSegmentNode.parse({
    roofType: 'gable',
    roofSystem: 'glazed',
    glazing: {
      across: { count: 4, layout: 'count' },
      glassColor: '#123456',
      panels: [{ face: 'front', column: 1, row: 0, type: 'empty' }],
    },
  })
  expect(RoofSegmentNode.parse(JSON.parse(JSON.stringify(node)))).toEqual(node)
  expect(isGlazedRoofSegment({ ...node, roofSystem: 'standard' })).toBe(false)
  expect(isGlazedRoofSegment({ ...node, roofType: 'hip' })).toBe(false)
})

for (const roofType of ['gable', 'shed'] as const) {
  test(`${roofType} pane layout measures slope distance and shares the covering datum`, () => {
    const node = RoofSegmentNode.parse({
      roofType,
      roofSystem: 'glazed',
      width: 8,
      depth: 6,
      pitch: 45,
      overhang: 0,
      wallThickness: 0,
      glazing: { along: { layout: 'maximum-spacing', spacing: 1 } },
    })
    const layout = getGlazedRoofLayout(node).find(({ face }) => face.normal[1] > 0)!
    expect(layout.face.length).toBeCloseTo((roofType === 'gable' ? 3 : 6) * Math.SQRT2)
    for (let i = 1; i < layout.along.length; i++)
      expect(layout.along[i]! - layout.along[i - 1]!).toBeLessThanOrEqual(1)
    const point = glazedRoofFacePoint(layout.face, 2, layout.face.length * 0.6)
    expect(point[1]).toBeCloseTo(getRoofSegmentSurfaceY(node, point[0], point[2]))
    expect(getGlazedRoofFaces(node).filter((face) => face.normal[1] === 0)).toHaveLength(2)
  })
}

test('empty pane interiors and trimmed corners do not support accessories', () => {
  const node = RoofSegmentNode.parse({
    roofType: 'gable',
    roofSystem: 'glazed',
    width: 4,
    depth: 4,
    wallThickness: 0,
    overhang: 0,
    glazing: {
      across: { layout: 'count', count: 2 },
      along: { layout: 'count', count: 1 },
      panels: [{ face: 'front', column: 0, row: 0, type: 'empty' }],
    },
  })
  expect(glazedRoofSupportsPoint(node, -1, 1)).toBe(false)
  expect(glazedRoofSupportsPoint(node, 1, 1)).toBe(true)
  expect(glazedRoofSupportsPoint(node, -1, -1)).toBe(true)
  const trimmed = RoofSegmentNode.parse({ ...node, trim: { frontRightX: 1, frontRightZ: 1 } })
  expect(glazedRoofSupportsPoint(trimmed, 1.8, 1.8)).toBe(false)
  expect(glazedRoofSupportsPoint(trimmed, 0.8, 0.8)).toBe(true)
  expect(
    getGlazedRoofPlanLines(trimmed).every(
      ([a, b]) => a[0] + a[1] <= 3.000001 && b[0] + b[1] <= 3.000001,
    ),
  ).toBe(true)
})

const originalScene = useScene.getState()
afterEach(() => useScene.setState(originalScene))
test('scene loading fills glazing defaults in sparse saved configurations', () => {
  const node = RoofSegmentNode.parse({ roofType: 'gable', roofSystem: 'glazed' })
  const sparse = { ...node, glazing: { glassOpacity: 0.45 } } as RoofSegmentNode
  useScene.getState().setScene({ [node.id]: sparse }, [node.id])
  const loaded = useScene.getState().nodes[node.id] as RoofSegmentNode
  expect(loaded.glazing?.across.spacing).toBe(1.5)
  expect(loaded.glazing?.glassOpacity).toBe(0.45)
})

test('barrel span and rise define symmetric arch bays and arched end infill', () => {
  const node = RoofSegmentNode.parse({
    roofType: 'barrel',
    roofSystem: 'glazed',
    depth: 4,
    width: 6,
    barrelRise: 2,
    barrelSegments: 12,
    glazing: {},
    overhang: 0,
    wallThickness: 0,
  })
  const faces = getGlazedRoofFaces(node)
  expect(faces.filter((face) => face.id.startsWith('barrel-'))).toHaveLength(12)
  expect(faces.filter((face) => face.id.startsWith('end-'))).toHaveLength(2)
  expect(getRoofSegmentSurfaceY(node, 0, 0)).toBeCloseTo(node.wallHeight + 2)
  expect(getRoofSegmentSurfaceY(node, 0, 2)).toBeCloseTo(node.wallHeight)
  expect(getRoofSegmentSurfaceY({ ...node, barrelRise: 20 }, 0, 0)).toBeCloseTo(node.wallHeight + 2)
  expect(getRoofSegmentSurfaceY({ ...node, barrelRise: undefined, pitch: 0 }, 0, 0)).toBeCloseTo(
    node.wallHeight + 1,
  )
  const layout = getGlazedRoofLayout(node)[3]!
  const u = (layout.across[0]! + layout.across[1]!) / 2
  const v = layout.face.length / 2
  const [x, , z] = glazedRoofFacePoint(layout.face, u, v)
  const empty = {
    ...node,
    glazing: {
      ...RoofSegmentNode.parse({ ...node }).glazing!,
      panels: [{ face: 'barrel-3', column: 0, row: 0, type: 'empty' as const }],
    },
  }
  expect(glazedRoofSupportsPoint(node, x, z)).toBe(true)
  expect(glazedRoofSupportsPoint(empty, x, z)).toBe(false)
  expect(RoofSegmentNode.parse(JSON.parse(JSON.stringify(empty)))).toEqual(empty)
  expect(getGlazedRoofPlanLines(node).length).toBeGreaterThan(12)
})

const vertices = (pieces: GlazedRoofPiece[]) =>
  pieces.flatMap((piece) => getGlazedRoofPieceFaces(piece).flat())
const extent = (points: { x: number; y: number; z: number }[], axis: 'x' | 'y' | 'z') => [
  Math.min(...points.map((point) => point[axis])),
  Math.max(...points.map((point) => point[axis])),
]

for (const roofType of ['gable', 'shed'] as const)
  test(`a glazed ${roofType} stands on walls centred on its footprint, and nothing rises through its covering`, () => {
    const node = RoofSegmentNode.parse({
      roofType,
      roofSystem: 'glazed',
      width: 8,
      depth: 6,
      pitch: 30,
      overhang: 0.3,
      wallThickness: 0.2,
      wallHeight: 0.5,
    })
    const pieces = getGlazedRoofPieces(node)
    const walls = vertices(pieces.filter((piece) => piece.face.normal[1] === 0 && piece.slot === 2))
    expect(extent(walls, 'x')).toEqual([-4.1, 4.1].map((x) => expect.closeTo(x)))
    expect(extent(walls, 'z')).toEqual([-3.1, 3.1].map((z) => expect.closeTo(z)))
    expect(extent(walls, 'y')[0]).toBeCloseTo(0)
    // Everything under the covering's top stays below its frame depth: no face shares its plane.
    const depth = getRoofGlazing(node).frameDepth
    const under = vertices(pieces.filter((piece) => piece.face.normal[1] === 0))
    for (const { x, y, z } of under)
      expect(y).toBeLessThanOrEqual(getRoofSegmentSurfaceY(node, x, z) - depth + 1e-6)

    expect(
      extent(vertices(getGlazedRoofPieces({ ...node, wallShell: 'omit' })), 'y')[0],
    ).toBeGreaterThan(0)
  })

test('a barrel stands on walls centred on its footprint, as doors and windows place on them', () => {
  const node = RoofSegmentNode.parse({
    roofType: 'barrel',
    width: 6,
    depth: 4,
    barrelRise: 1,
    wallThickness: 0.2,
    wallHeight: 0.5,
  })
  const walls = vertices(
    getBarrelRoofSolidPieces(node).filter((piece) => piece.face.normal[1] === 0),
  )
  expect(extent(walls, 'x')).toEqual([-3.1, 3.1].map((x) => expect.closeTo(x)))
  expect(extent(walls, 'z')).toEqual([-2.1, 2.1].map((z) => expect.closeTo(z)))
  expect(getRoofSegmentWallFace(node, 'right').length).toBeCloseTo(4.2)
  expect(getRoofSegmentWallFace(node, 'front').length).toBeCloseTo(6.2)
  // A window fits on the arched end above the wall top.
  expect(clampRectToRoofWallFace(getRoofSegmentWallFace(node, 'right'), 2.1, 0.9, 1, 0.6)).toEqual({
    u: 2.1,
    v: 0.9,
  })
})
