import { expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  FoundationNode,
  LevelNode,
  useScene,
  WallNode,
} from '@pascal-app/core'
import { foundationEditorPlanPoint } from './boundary-editor'
import { foundationMoveEdgeAffordance } from './floorplan-affordances'
import { snapEdgeToWallFaces, snapPointToWallFaces, wallFacesOf } from './wall-face-snap'

globalThis.requestAnimationFrame ??= () => 1
globalThis.cancelAnimationFrame ??= () => {}

/** The outside faces of a 10 × 8 m box of 0.1 m walls, a millimetre out, as the foundation traces them. */
const FACES: Array<Array<[number, number]>> = [
  [
    [-0.051, -0.051],
    [10.051, -0.051],
    [10.051, 8.051],
    [-0.051, 8.051],
  ],
]

test('a side pushed back within a foot of a wall lands on its outside face; further off it stays', () => {
  const near = snapEdgeToWallFaces(FACES, [
    [10.25, -0.051],
    [10.25, 8.051],
  ])
  expect(near?.[0][0]).toBeCloseTo(10.051, 9)
  expect(near?.[1][0]).toBeCloseTo(10.051, 9)
  expect(
    snapEdgeToWallFaces(FACES, [
      [10.5, -0.051],
      [10.5, 8.051],
    ]),
  ).toBeNull()
  // A side running across the faces, not with them, stays.
  expect(
    snapEdgeToWallFaces(FACES, [
      [10.2, 0],
      [12, 1],
    ]),
  ).toBeNull()
})

test('a corner near a corner of the faces lands on it; near a face, on the face', () => {
  expect(snapPointToWallFaces(FACES, [10.2, 8.2])).toEqual([10.051, 8.051])
  const onFace = snapPointToWallFaces(FACES, [10.12, 4])
  expect(onFace?.[0]).toBeCloseTo(10.051, 9)
  expect(onFace?.[1]).toBeCloseTo(4, 9)
  expect(snapPointToWallFaces(FACES, [11, 4])).toBeNull()
})

test('in the plan a side of an outline pushed out and back snaps onto the wall over it', () => {
  const corners: Array<[number, number]> = [
    [0, 0],
    [10, 0],
    [10, 8],
    [0, 8],
  ]
  const walls = corners.map((start, index) =>
    WallNode.parse({
      id: `wall_${index}`,
      parentId: 'level_g',
      start,
      end: corners[(index + 1) % 4],
      thickness: 0.1,
    }),
  )
  const outline = FoundationNode.parse({
    id: 'foundation_patio',
    parentId: 'level_g',
    polygon: [
      [-0.051, -0.051],
      [12, -0.051],
      [12, 8.051],
      [-0.051, 8.051],
    ],
  })
  const nodes = Object.fromEntries(
    [
      BuildingNode.parse({ id: 'building_a', children: ['level_g'] }),
      LevelNode.parse({
        id: 'level_g',
        parentId: 'building_a',
        level: 0,
        children: [...walls.map((wall) => wall.id), outline.id],
      }),
      ...walls,
      outline,
    ].map((node) => [node.id, node]),
  ) as Record<AnyNodeId, AnyNode>
  const previous = useScene.getState()
  try {
    useScene.setState({ nodes, rootNodeIds: [] } as never)
    expect(wallFacesOf(nodes as Record<string, AnyNode>, 'level_g')).toHaveLength(1)
    const session = foundationMoveEdgeAffordance.start({
      node: outline,
      payload: { edgeIndex: 1 },
      nodes,
      initialPlanPoint: [12, 4],
      gridSnapStep: 0,
    })
    const modifiers = { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false }
    session.apply({ planPoint: [10.2, 4], modifiers } as never)
    const polygon = () =>
      (useScene.getState().nodes['foundation_patio' as AnyNodeId] as FoundationNode).polygon
    expect(polygon()[1]?.[0]).toBeCloseTo(10.051, 6)
    expect(polygon()[2]?.[0]).toBeCloseTo(10.051, 6)
    // Alt keeps it where the pointer is.
    session.apply({ planPoint: [10.2, 4], modifiers: { ...modifiers, altKey: true } } as never)
    expect(polygon()[1]?.[0]).toBeCloseTo(10.2, 6)
  } finally {
    useScene.setState(previous, true)
  }
})

test('in 3D a side pushed back near a wall lands on its outside face too, a corner on its corner', () => {
  const outline: Array<[number, number]> = [
    [-0.051, -0.051],
    [12, -0.051],
    [12, 8.051],
    [-0.051, 8.051],
  ]
  const base = {
    initialPolygon: outline,
    vertexIndex: null,
    nativeEvent: undefined,
  }
  // The east side (edge 1) grabbed at x 12 and let go at x 10.2.
  const side = foundationEditorPlanPoint(
    {
      ...base,
      mode: 'edge',
      edgeIndex: 1,
      initialPosition: [12, 4],
      rawPoint: [10.2, 4],
      gridPoint: [10.2, 4],
    },
    FACES,
  )
  expect(side[0]).toBeCloseTo(10.051, 9)
  // Alt (no faces): where the pointer is.
  expect(
    foundationEditorPlanPoint(
      {
        ...base,
        mode: 'edge',
        edgeIndex: 1,
        initialPosition: [12, 4],
        rawPoint: [10.2, 4],
        gridPoint: [10.2, 4],
      },
      null,
    )[0],
  ).toBeCloseTo(10.2, 9)
  // A corner let go near a corner of the faces lands on it.
  expect(
    foundationEditorPlanPoint(
      {
        ...base,
        mode: 'vertex',
        vertexIndex: 1,
        initialPosition: [12, -0.051],
        rawPoint: [10.2, 0.1],
        gridPoint: [10.2, 0.1],
      },
      FACES,
    ),
  ).toEqual([10.051, -0.051])
})
