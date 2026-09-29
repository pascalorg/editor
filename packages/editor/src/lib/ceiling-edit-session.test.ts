import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  CeilingNode,
  emitter,
  LevelNode,
  SiteNode,
  useScene,
  ZoneNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { create } from '@react-three/test-renderer'
import { createElement } from 'react'
import { cancelActiveTool } from '../hooks/use-keyboard'
import useEditor from '../store/use-editor'
import useInteractionScope from '../store/use-interaction-scope'
import {
  endCeilingEdit,
  getCeilingEditSession,
  setCeilingHoles,
  startCeilingEdit,
  startCeilingEditFromTreeSelection,
  useCeilingEditSessionOwner,
} from './ceiling-edit-session'
import { boundaryReshapeScope, holeEditScope } from './interaction/scope'

const square: [number, number][] = [
  [0, 0],
  [4, 0],
  [4, 4],
  [0, 4],
]
const site = SiteNode.parse({ id: 'site_ceiling_edit', children: ['building_ceiling_edit'] })
const building = BuildingNode.parse({
  id: 'building_ceiling_edit',
  parentId: site.id,
  children: ['level_ceiling_edit_0', 'level_ceiling_edit_1'],
})
const level = LevelNode.parse({ id: 'level_ceiling_edit_0', parentId: building.id, level: 0 })
const upper = LevelNode.parse({ id: 'level_ceiling_edit_1', parentId: building.id, level: 1 })
const zone = ZoneNode.parse({
  id: 'zone_ceiling_edit',
  parentId: level.id,
  name: 'Kitchen',
  polygon: square,
  spaceRole: 'room',
})
const ceiling = CeilingNode.parse({
  id: 'ceiling_linked',
  parentId: level.id,
  polygon: square,
  boundary: 'auto',
  zoneId: zone.id,
})
const manual = CeilingNode.parse({
  id: 'ceiling_manual',
  parentId: level.id,
  polygon: square.map(([x, z]) => [x + 10, z] as [number, number]),
})
const roomHole: [number, number][] = [
  [1, 1],
  [2, 1],
  [2, 2],
  [1, 2],
]
const cutHole: [number, number][] = [
  [2.5, 2.5],
  [3, 2.5],
  [3, 3],
  [2.5, 3],
]
const holed = CeilingNode.parse({
  id: 'ceiling_holed',
  parentId: upper.id,
  polygon: square,
  boundary: 'auto',
  zoneId: 'zone_ceiling_edit_upper',
  holes: [roomHole],
  holeMetadata: [{ source: 'room' }],
})

const snapshots = {
  scene: useScene.getState(),
  viewer: useViewer.getState(),
  editor: useEditor.getState(),
  scope: useInteractionScope.getState(),
  raf: globalThis.requestAnimationFrame,
  cancelRaf: globalThis.cancelAnimationFrame,
}

beforeEach(() => {
  // Scene updates schedule a dirty-flush frame.
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
  const nodes = Object.fromEntries(
    [site, building, level, upper, zone, ceiling, manual, holed].map((node) => [node.id, node]),
  ) as Record<AnyNodeId, AnyNode>
  useScene.setState({ nodes, rootNodeIds: [site.id] })
  useViewer.setState({
    hoveredId: null,
    selection: { buildingId: building.id, levelId: level.id, zoneId: null, selectedIds: [] },
  })
  useEditor.setState({ phase: 'structure', mode: 'select', room: null, hoveredRoom: null })
  useInteractionScope.setState({ scope: { kind: 'idle' } })
})

afterEach(() => {
  endCeilingEdit()
  useScene.setState(snapshots.scene)
  useViewer.setState(snapshots.viewer)
  useEditor.setState(snapshots.editor)
  useInteractionScope.setState(snapshots.scope)
  globalThis.requestAnimationFrame = snapshots.raf
  globalThis.cancelAnimationFrame = snapshots.cancelRaf
})

const selectedIds = () => useViewer.getState().selection.selectedIds

describe('starting a session', () => {
  test('the pill API opens the room ceiling from its zone id and selects it', () => {
    expect(startCeilingEdit(zone.id)).toBe(true)
    expect(getCeilingEditSession()).toEqual({
      ceilingId: ceiling.id,
      zoneId: zone.id,
      levelId: level.id,
    })
    expect(selectedIds()).toEqual([ceiling.id])
  })

  test('a ceiling id opens that ceiling; an unknown target or a room without one does nothing', () => {
    expect(startCeilingEdit(manual.id)).toBe(true)
    expect(getCeilingEditSession()).toEqual({
      ceilingId: manual.id,
      zoneId: null,
      levelId: level.id,
    })
    expect(startCeilingEdit('ceiling_missing')).toBe(false)
    useScene.getState().deleteNode(ceiling.id as AnyNodeId)
    endCeilingEdit()
    expect(startCeilingEdit(zone.id)).toBe(false)
    expect(getCeilingEditSession()).toBeNull()
  })

  test('the pill switches to the ceiling level and the structure phase', () => {
    useViewer.setState({
      selection: { buildingId: building.id, levelId: upper.id, zoneId: null, selectedIds: [] },
    })
    useEditor.setState({ phase: 'furnish' })
    expect(startCeilingEdit(zone.id)).toBe(true)
    expect(useEditor.getState().phase).toBe('structure')
    expect(useViewer.getState().selection.levelId).toBe(level.id)
    expect(getCeilingEditSession()?.ceilingId).toBe(ceiling.id)
  })

  test('a scene-graph selection of exactly the ceiling opens it; a multi-selection does not', () => {
    useViewer.getState().setSelection({ selectedIds: [ceiling.id, manual.id] })
    expect(startCeilingEditFromTreeSelection(ceiling.id)).toBe(false)
    expect(getCeilingEditSession()).toBeNull()
    useViewer.getState().setSelection({ selectedIds: [ceiling.id] })
    expect(startCeilingEditFromTreeSelection(ceiling.id)).toBe(true)
    expect(getCeilingEditSession()?.ceilingId).toBe(ceiling.id)
  })

  test('a canvas selection (drill-down or Alt-click) selects the ceiling without a session', () => {
    useViewer.getState().setSelection({ selectedIds: [ceiling.id] })
    expect(getCeilingEditSession()).toBeNull()
  })
})

describe('ending a session', () => {
  test('Escape returns to the ceiling room', () => {
    startCeilingEdit(ceiling.id)
    expect(cancelActiveTool()).toBe(true)
    expect(getCeilingEditSession()).toBeNull()
    expect(useEditor.getState().room).toEqual({ levelId: level.id, zoneId: zone.id })
    expect(selectedIds()).toEqual([])
    expect(useEditor.getState().mode).toBe('select')
  })

  test('Escape returns to the room even after a polygon edit detached the link', () => {
    startCeilingEdit(ceiling.id)
    useScene.getState().detachDerivedNode(ceiling.id as AnyNodeId, {
      polygon: square.map(([x, z]) => [x, z + 0.5] as [number, number]),
    })
    const detached = useScene.getState().nodes[ceiling.id as AnyNodeId] as CeilingNode
    expect(detached.boundary).toBeUndefined()
    expect(detached.zoneId).toBeUndefined()
    expect(getCeilingEditSession()?.ceilingId).toBe(ceiling.id)
    cancelActiveTool()
    expect(useEditor.getState().room).toEqual({ levelId: level.id, zoneId: zone.id })
  })

  test('Escape on a ceiling with no room clears the selection', () => {
    startCeilingEdit(manual.id)
    expect(cancelActiveTool()).toBe(true)
    expect(getCeilingEditSession()).toBeNull()
    expect(useEditor.getState().room).toBeNull()
    expect(selectedIds()).toEqual([])
  })

  test('Escape during an in-flight reshape is left to the reshape', () => {
    startCeilingEdit(ceiling.id)
    useInteractionScope.getState().begin(boundaryReshapeScope(ceiling.id))
    emitter.emit('tool:cancel')
    expect(getCeilingEditSession()?.ceilingId).toBe(ceiling.id)
  })

  test('deselection, another selection, a level change, a phase change and deletion end it', () => {
    const ends: Array<() => void> = [
      () => useViewer.getState().setSelection({ selectedIds: [] }),
      () => useViewer.getState().setSelection({ selectedIds: [manual.id] }),
      () => useViewer.getState().setSelection({ selectedIds: [ceiling.id, manual.id] }),
      () => useViewer.getState().setSelection({ levelId: upper.id }),
      () => useEditor.getState().setPhase('furnish'),
      () => useScene.getState().deleteNode(ceiling.id as AnyNodeId),
    ]
    for (const end of ends) {
      useEditor.setState({ phase: 'structure' })
      useViewer.setState({
        selection: { buildingId: building.id, levelId: level.id, zoneId: null, selectedIds: [] },
      })
      if (!useScene.getState().nodes[ceiling.id as AnyNodeId])
        useScene.setState({ nodes: { ...useScene.getState().nodes, [ceiling.id]: ceiling } })
      expect(startCeilingEdit(ceiling.id)).toBe(true)
      end()
      expect(getCeilingEditSession()).toBeNull()
    }
  })

  test('height and material edits keep the session and the auto boundary', () => {
    startCeilingEdit(ceiling.id)
    useScene.getState().updateNode(ceiling.id as AnyNodeId, { height: 2.4, materialPreset: 'x' })
    const edited = useScene.getState().nodes[ceiling.id as AnyNodeId] as CeilingNode
    expect(edited.boundary).toBe('auto')
    expect(edited.zoneId).toBe(zone.id)
    expect(getCeilingEditSession()?.ceilingId).toBe(ceiling.id)
  })

  test('an ended session stops listening', () => {
    startCeilingEdit(ceiling.id)
    endCeilingEdit()
    useViewer.getState().setSelection({ selectedIds: [ceiling.id] })
    expect(cancelActiveTool()).toBe(false)
    expect(useEditor.getState().room).toBeNull()
  })
})

describe('session ownership', () => {
  test('unmounting the editor that owns the session ends it', async () => {
    const renderer = await create(
      createElement(function Owner() {
        useCeilingEditSessionOwner()
        return null
      }),
    )
    startCeilingEdit(ceiling.id)
    expect(getCeilingEditSession()?.ceilingId).toBe(ceiling.id)
    await renderer.unmount()
    expect(getCeilingEditSession()).toBeNull()
    useViewer.getState().setSelection({ selectedIds: [ceiling.id] })
    expect(cancelActiveTool()).toBe(false)
  })

  test("ending the session ends its hole edit, not another node's", () => {
    startCeilingEdit(ceiling.id)
    useInteractionScope.getState().begin(holeEditScope({ nodeId: ceiling.id, holeIndex: 0 }))
    endCeilingEdit()
    expect(useInteractionScope.getState().scope.kind).toBe('idle')

    startCeilingEdit(ceiling.id)
    useInteractionScope.getState().begin(holeEditScope({ nodeId: 'slab_other', holeIndex: 0 }))
    endCeilingEdit()
    expect(useInteractionScope.getState().scope).toMatchObject({
      reshape: 'hole',
      nodeId: 'slab_other',
    })
  })
})

describe('hole edits', () => {
  const node = (id: string) => useScene.getState().nodes[id as AnyNodeId] as CeilingNode

  test('a manual hole on an auto ceiling keeps the room link (only polygon edits detach)', () => {
    startCeilingEdit(ceiling.id)
    const before = node(ceiling.id)
    expect(
      setCeilingHoles(ceiling.id, { holes: [cutHole], holeMetadata: [{ source: 'manual' }] }),
    ).toBe(true)
    expect(node(ceiling.id).holes).toEqual([cutHole])
    expect(node(ceiling.id).boundary).toBe(before.boundary)
    expect(node(ceiling.id).zoneId).toBe(before.zoneId)
    expect(getCeilingEditSession()?.ceilingId).toBe(ceiling.id)
    // Deleting it again is a plain update too.
    expect(setCeilingHoles(ceiling.id, { holes: [], holeMetadata: [] })).toBe(true)
    expect(node(ceiling.id).zoneId).toBe(before.zoneId)
  })

  test('room-cut holes stay protected: a write that changes one is refused', () => {
    const moved = roomHole.map(([x, z]) => [x + 0.5, z] as [number, number])
    expect(setCeilingHoles(holed.id, { holes: [moved] })).toBe(false)
    expect(setCeilingHoles(holed.id, { holes: [], holeMetadata: [] })).toBe(false)
    expect(node(holed.id)).toEqual(holed)

    expect(
      setCeilingHoles(holed.id, {
        holes: [roomHole, cutHole],
        holeMetadata: [{ source: 'room' }, { source: 'manual' }],
      }),
    ).toBe(true)
    expect(node(holed.id).holes).toEqual([roomHole, cutHole])
    expect(node(holed.id).boundary).toBe(holed.boundary)
  })

  test('a manual ceiling takes a plain update; a non-ceiling is refused', () => {
    expect(setCeilingHoles(manual.id, { holes: [cutHole] })).toBe(true)
    expect(node(manual.id).holes).toEqual([cutHole])
    expect(setCeilingHoles(zone.id, { holes: [cutHole] })).toBe(false)
  })
})
