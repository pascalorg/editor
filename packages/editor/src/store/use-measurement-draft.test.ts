import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  AnyNode,
  BuildingNode,
  LevelNode,
  MeasurementNode,
  SiteNode,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import {
  commitMeasurementDraft,
  finishMeasurementDraft,
  useMeasurementDraft,
} from './use-measurement-draft'

const point = (x: number, y: number, z: number): [number, number, number] => [x, y, z]

let site: ReturnType<typeof SiteNode.parse>
let building: ReturnType<typeof BuildingNode.parse>
let level: ReturnType<typeof LevelNode.parse>

beforeEach(() => {
  level = LevelNode.parse({ level: 0, children: [] })
  building = BuildingNode.parse({ children: [level.id] })
  site = SiteNode.parse({ children: [building.id] })
  level = LevelNode.parse({ ...level, parentId: building.id })
  building = BuildingNode.parse({ ...building, parentId: site.id })

  useScene.setState({
    nodes: {
      [site.id]: site,
      [building.id]: building,
      [level.id]: level,
    },
    rootNodeIds: [site.id],
    collections: {},
    dirtyNodes: new Set(),
  } as never)
  useScene.temporal.getState().clear()
  useScene.temporal.getState().resume()
  useViewer.setState({
    selection: {
      buildingId: building.id,
      levelId: level.id,
      zoneId: null,
      selectedIds: [],
    },
  })
})

afterEach(() => {
  const draft = useMeasurementDraft.getState()
  draft.reset()
  draft.setKind('distance')
})

describe('measurement draft ownership', () => {
  test('locks to the view that places the first point', () => {
    const draft = useMeasurementDraft.getState()
    expect(draft.addPoint('2d', point(0, 0, 0))).toBe(true)
    expect(useMeasurementDraft.getState().owner).toBe('2d')
    expect(draft.addPoint('3d', point(1, 0, 0))).toBe(false)
    expect(useMeasurementDraft.getState().points).toEqual([point(0, 0, 0)])
  })

  test('does not claim an owner for pointer previews', () => {
    useMeasurementDraft.getState().setHover('3d', {
      point: point(1, 2, 3),
      normal: point(0, 1, 0),
      targetNodeId: 'wall_1',
    })
    expect(useMeasurementDraft.getState().owner).toBeNull()
    expect(useMeasurementDraft.getState().hoverOwner).toBe('3d')
  })

  test('does not reinterpret an active draft after the selected level changes', () => {
    const draft = useMeasurementDraft.getState()
    expect(draft.addPoint('3d', point(0, 0, 0))).toBe(true)
    expect(useMeasurementDraft.getState().levelId).toBe(level.id)

    const otherLevel = LevelNode.parse({ level: 1, parentId: building.id, children: [] })
    useScene.setState((state) => ({
      nodes: {
        ...state.nodes,
        [otherLevel.id]: otherLevel,
        [building.id]: { ...building, children: [level.id, otherLevel.id] },
      },
    }))
    useViewer.getState().setSelection({ levelId: otherLevel.id })

    expect(draft.addPoint('3d', point(1, 0, 0))).toBe(false)
    expect(useMeasurementDraft.getState().error).toBe(
      'The active level changed. Start a new measurement.',
    )
    expect(commitMeasurementDraft('3d')).toBeNull()
    expect(
      Object.values(useScene.getState().nodes).some((node) => node.type === 'measurement'),
    ).toBe(false)
  })
})

describe('measurement draft transitions', () => {
  test('makes distance ready on its second point', () => {
    const draft = useMeasurementDraft.getState()
    draft.addPoint('3d', point(0, 0, 0))
    draft.addPoint('3d', point(3, 4, 0))

    expect(useMeasurementDraft.getState().stage).toBe('ready')
    expect(useMeasurementDraft.getState().getCommitPayload('3d')).toEqual({
      kind: 'distance',
      points: [point(0, 0, 0), point(3, 4, 0)],
    })
  })

  test('makes angle ready on its third point and closes a perimeter', () => {
    const draft = useMeasurementDraft.getState()
    draft.setKind('angle')
    draft.addPoint('3d', point(1, 0, 0))
    draft.addPoint('3d', point(0, 0, 0))
    draft.addPoint('3d', point(0, 0, 1))
    expect(useMeasurementDraft.getState().getCommitPayload('3d')).toEqual({
      kind: 'angle',
      points: [point(1, 0, 0), point(0, 0, 0), point(0, 0, 1)],
    })

    draft.setKind('perimeter')
    draft.addPoint('2d', point(0, 0, 0))
    draft.addPoint('2d', point(2, 0, 0))
    draft.addPoint('2d', point(2, 0, 2))
    expect(draft.closeBase('2d')).toBe(true)
    expect(useMeasurementDraft.getState().getCommitPayload('2d')).toEqual({
      kind: 'perimeter',
      base: [point(0, 0, 0), point(2, 0, 0), point(2, 0, 2)],
    })
  })

  test('persists a semantic feature anchor alongside its fallback point', () => {
    const draft = useMeasurementDraft.getState()
    const anchor = {
      kind: 'feature' as const,
      reference: {
        nodeId: 'wall_host',
        featureId: 'wall:centerline',
        parameters: { t: 0.25, height: 1 },
      },
      fallback: point(1, 1, 0),
    }
    draft.addPoint('3d', anchor.fallback, anchor)
    draft.addPoint('3d', point(2, 1, 0))

    expect(useMeasurementDraft.getState().getCommitPayload('3d')).toEqual({
      kind: 'distance',
      points: [anchor, point(2, 1, 0)],
    })
  })

  test('closes a planar area and rejects a non-planar base', () => {
    const draft = useMeasurementDraft.getState()
    draft.setKind('area')
    draft.addPoint('3d', point(0, 0, 0))
    draft.addPoint('3d', point(2, 0, 0))
    draft.addPoint('3d', point(2, 0, 2))
    draft.addPoint('3d', point(0, 1, 2))

    expect(draft.closeBase('3d')).toBe(false)
    expect(useMeasurementDraft.getState().error).toBe('Measurement points must be on one plane.')

    draft.removeLast('3d')
    draft.addPoint('3d', point(0, 0, 2))
    expect(draft.closeBase('3d')).toBe(true)
    expect(useMeasurementDraft.getState().getCommitPayload('3d')).toEqual({
      kind: 'area',
      base: [point(0, 0, 0), point(2, 0, 0), point(2, 0, 2), point(0, 0, 2)],
    })
  })

  test('closes a volume base before accepting explicit extrusion', () => {
    const draft = useMeasurementDraft.getState()
    draft.setKind('volume')
    draft.addPoint('2d', point(0, 0, 0))
    draft.addPoint('2d', point(2, 0, 0))
    draft.addPoint('2d', point(2, 0, 2))

    expect(draft.closeBase('2d', point(0, 1, 0))).toBe(true)
    expect(useMeasurementDraft.getState().stage).toBe('extruding')
    expect(useMeasurementDraft.getState().getCommitPayload('2d')).toBeNull()

    expect(draft.setExtrusionHeight('2d', 3)).toBe(true)
    expect(draft.finishExtrusion('2d')).toBe(true)
    expect(useMeasurementDraft.getState().getCommitPayload('2d')).toEqual({
      kind: 'volume',
      base: [point(0, 0, 0), point(2, 0, 0), point(2, 0, 2)],
      extrusion: [0, 3, 0],
    })
  })

  test('Backspace removes the final base point and reopens extrusion', () => {
    const draft = useMeasurementDraft.getState()
    draft.setKind('volume')
    draft.addPoint('3d', point(0, 0, 0))
    draft.addPoint('3d', point(1, 0, 0))
    draft.addPoint('3d', point(1, 0, 1))
    draft.closeBase('3d')
    draft.setExtrusionHeight('3d', 2)

    expect(draft.removeLast('3d')).toBe(true)
    expect(useMeasurementDraft.getState()).toMatchObject({
      owner: '3d',
      stage: 'collecting',
      points: [point(0, 0, 0), point(1, 0, 0)],
      baseNormal: null,
      extrusionHeight: 0,
    })
  })

  test('reset clears the interaction but preserves the selected kind', () => {
    const draft = useMeasurementDraft.getState()
    draft.setKind('area')
    draft.addPoint('2d', point(0, 0, 0))
    draft.reset()

    expect(useMeasurementDraft.getState()).toMatchObject({
      kind: 'area',
      owner: null,
      stage: 'collecting',
      points: [],
    })
  })

  test('finishes a valid polygon and stays ready for another measurement of the same kind', () => {
    const draft = useMeasurementDraft.getState()
    draft.setKind('area')
    draft.addPoint('2d', point(0, 0, 0))
    draft.addPoint('2d', point(2, 0, 0))
    draft.addPoint('2d', point(2, 0, 2))

    expect(finishMeasurementDraft('2d', point(0, 1, 0))).toBe(true)
    expect(
      Object.values(useScene.getState().nodes).filter((node) => node.type === 'measurement'),
    ).toHaveLength(1)
    expect(useMeasurementDraft.getState()).toMatchObject({
      kind: 'area',
      owner: null,
      stage: 'collecting',
      points: [],
    })
    expect(useMeasurementDraft.getState().addPoint('2d', point(4, 0, 4))).toBe(true)
  })

  test('commits one parseable level child in one undoable scene write', () => {
    const draft = useMeasurementDraft.getState()
    draft.addPoint('3d', point(0, 0, 0))
    draft.addPoint('3d', point(3, 4, 0))

    const pastCount = useScene.temporal.getState().pastStates.length
    const measurementId = commitMeasurementDraft('3d')
    expect(measurementId).toBeTruthy()
    expect(useScene.temporal.getState().pastStates.length).toBe(pastCount + 1)

    const committedLevel = useScene.getState().nodes[level.id]
    expect(committedLevel?.type).toBe('level')
    if (committedLevel?.type !== 'level' || !measurementId) return
    expect(committedLevel.children).toEqual([measurementId])

    const serialized = JSON.parse(JSON.stringify(useScene.getState().nodes[measurementId]))
    expect(MeasurementNode.parse(serialized).id).toBe(measurementId)
    expect(AnyNode.parse(serialized).type).toBe('measurement')

    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes[measurementId]).toBeUndefined()
    const undoneLevel = useScene.getState().nodes[level.id]
    expect(undoneLevel?.type === 'level' ? undoneLevel.children : null).toEqual([])

    useScene.temporal.getState().redo()
    expect(useScene.getState().nodes[measurementId]?.type).toBe('measurement')
    const redoneLevel = useScene.getState().nodes[level.id]
    expect(redoneLevel?.type === 'level' ? redoneLevel.children : null).toEqual([measurementId])
  })
})

describe('measurement draft vertex editing', () => {
  test('enforces owner, index, and transition guards during a drag', () => {
    const draft = useMeasurementDraft.getState()
    draft.setKind('area')
    draft.addPoint('3d', point(0, 0, 0))
    draft.addPoint('3d', point(2, 0, 0))
    draft.addPoint('3d', point(2, 0, 2))

    expect(draft.beginVertexDrag('2d', 1)).toBe(false)
    expect(draft.beginVertexDrag('3d', 8)).toBe(false)
    expect(draft.beginVertexDrag('3d', 1)).toBe(true)
    expect(useMeasurementDraft.getState().vertexDrag).toEqual({
      owner: '3d',
      index: 1,
      originalPoint: point(2, 0, 0),
      originalAnchor: null,
      inserted: false,
    })
    expect(draft.addPoint('3d', point(3, 0, 3))).toBe(false)
    expect(draft.closeBase('3d')).toBe(false)
    expect(draft.removeLast('3d')).toBe(false)
  })

  test('previews an indexed move without scene history and restores it on cancel', () => {
    const draft = useMeasurementDraft.getState()
    draft.setKind('area')
    draft.addPoint('3d', point(0, 0, 0))
    draft.addPoint('3d', point(2, 0, 0))
    draft.addPoint('3d', point(2, 0, 2))
    const pastCount = useScene.temporal.getState().pastStates.length

    expect(draft.beginVertexDrag('3d', 1)).toBe(true)
    expect(
      draft.updateDraggedVertex(
        '3d',
        {
          point: point(3, 0, 0),
          normal: point(0, 1, 0),
          targetNodeId: 'slab_1',
        },
        {
          axis: 'x',
          from: point(0, 0, 0),
          to: point(3, 0, 0),
          snapped: true,
        },
      ),
    ).toBe(true)
    expect(useMeasurementDraft.getState()).toMatchObject({
      points: [point(0, 0, 0), point(3, 0, 0), point(2, 0, 2)],
      hoverOwner: '3d',
      axisGuide: { axis: 'x', snapped: true },
    })
    expect(useScene.temporal.getState().pastStates.length).toBe(pastCount)

    expect(draft.cancelVertexDrag('3d')).toBe(true)
    expect(useMeasurementDraft.getState()).toMatchObject({
      points: [point(0, 0, 0), point(2, 0, 0), point(2, 0, 2)],
      vertexDrag: null,
      hover: null,
      axisGuide: null,
    })
    expect(useScene.temporal.getState().pastStates.length).toBe(pastCount)
  })

  test('retains a finished move and still commits the polygon in one undo step', () => {
    const draft = useMeasurementDraft.getState()
    draft.setKind('area')
    draft.addPoint('2d', point(0, 0, 0))
    draft.addPoint('2d', point(2, 0, 0))
    draft.addPoint('2d', point(2, 0, 2))
    const pastCount = useScene.temporal.getState().pastStates.length

    expect(draft.beginVertexDrag('2d', 1)).toBe(true)
    expect(
      draft.updateDraggedVertex('2d', {
        point: point(3, 0, 0),
        normal: point(0, 1, 0),
        targetNodeId: 'wall_1',
      }),
    ).toBe(true)
    expect(draft.finishVertexDrag('2d')).toBe(true)
    expect(useMeasurementDraft.getState()).toMatchObject({
      points: [point(0, 0, 0), point(3, 0, 0), point(2, 0, 2)],
      vertexDrag: null,
      hover: null,
    })

    expect(draft.closeBase('2d', point(0, 1, 0))).toBe(true)
    expect(commitMeasurementDraft('2d')).toBeTruthy()
    expect(useScene.temporal.getState().pastStates.length).toBe(pastCount + 1)
  })

  test('inserts a midpoint transiently and removes it again on cancel', () => {
    const draft = useMeasurementDraft.getState()
    draft.setKind('area')
    draft.addPoint('3d', point(0, 0, 0))
    draft.addPoint('3d', point(4, 0, 0))
    draft.addPoint('3d', point(4, 0, 4))
    const pastCount = useScene.temporal.getState().pastStates.length

    expect(draft.beginMidpointVertexDrag('3d', 0)).toBe(true)
    expect(useMeasurementDraft.getState()).toMatchObject({
      points: [point(0, 0, 0), point(2, 0, 0), point(4, 0, 0), point(4, 0, 4)],
      vertexDrag: {
        owner: '3d',
        index: 1,
        originalPoint: point(2, 0, 0),
        inserted: true,
      },
    })
    expect(useScene.temporal.getState().pastStates.length).toBe(pastCount)

    expect(draft.cancelVertexDrag('3d')).toBe(true)
    expect(useMeasurementDraft.getState()).toMatchObject({
      points: [point(0, 0, 0), point(4, 0, 0), point(4, 0, 4)],
      vertexDrag: null,
    })
    expect(useScene.temporal.getState().pastStates.length).toBe(pastCount)
  })

  test('keeps a dragged midpoint insertion and commits it with the polygon', () => {
    const draft = useMeasurementDraft.getState()
    draft.setKind('area')
    draft.addPoint('2d', point(0, 0, 0))
    draft.addPoint('2d', point(4, 0, 0))
    draft.addPoint('2d', point(4, 0, 4))

    expect(draft.beginMidpointVertexDrag('2d', 2)).toBe(true)
    expect(
      draft.updateDraggedVertex('2d', {
        point: point(1, 0, 2),
        normal: point(0, 1, 0),
        targetNodeId: 'slab_1',
      }),
    ).toBe(true)
    expect(draft.finishVertexDrag('2d')).toBe(true)
    expect(useMeasurementDraft.getState().points).toEqual([
      point(0, 0, 0),
      point(4, 0, 0),
      point(4, 0, 4),
      point(1, 0, 2),
    ])

    expect(draft.closeBase('2d', point(0, 1, 0))).toBe(true)
    const measurementId = commitMeasurementDraft('2d')
    const measurement = measurementId ? useScene.getState().nodes[measurementId] : null
    expect(measurement?.type).toBe('measurement')
    if (measurement?.type !== 'measurement' || measurement.measurement.kind !== 'area') return
    expect(measurement.measurement.base).toHaveLength(4)
  })

  test('rejects midpoint insertion for distances and incomplete polygons', () => {
    const draft = useMeasurementDraft.getState()
    draft.addPoint('3d', point(0, 0, 0))
    expect(draft.beginMidpointVertexDrag('3d', 0)).toBe(false)

    draft.setKind('area')
    draft.addPoint('3d', point(0, 0, 0))
    draft.addPoint('3d', point(2, 0, 0))
    expect(draft.beginMidpointVertexDrag('3d', 0)).toBe(false)
  })
})
