import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { type AnyNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { beginGesture } from '../lib/gesture-lifecycle'
import useEditor, { normalizePersistedEditorUiState } from './use-editor'
import useInteractionScope from './use-interaction-scope'

function resetToolMode() {
  useEditor.getState().clearRoom()
  useViewer.getState().setSelection({ selectedIds: [], zoneId: null })
  useEditor.getState().setPhase('structure')
  useEditor.getState().setStructureLayer('elements')
  useEditor.getState().armToolMode({ mode: 'select' })
  useEditor.getState().setActivePaintMaterial(null)
}

beforeEach(resetToolMode)
afterEach(resetToolMode)

describe('ToolMode transition', () => {
  test('choosing a paint swatch while selected arms material paint', () => {
    useEditor.getState().armToolMode({ mode: 'select' })
    useEditor.getState().armMaterialPaint({
      materialPreset: 'library:test-paint',
      sourceTarget: 'wall',
    })

    expect(useEditor.getState().toolMode).toEqual({ mode: 'material-paint' })
    expect(useEditor.getState().mode).toBe('material-paint')
    expect(useEditor.getState().tool).toBeNull()
    expect(useEditor.getState().activePaintMaterial?.materialPreset).toBe('library:test-paint')
  })

  test('leaving build clears the materialized tool', () => {
    useEditor.getState().armToolMode({ mode: 'build', tool: 'wall' })
    useEditor.getState().armToolMode({ mode: 'select' })

    expect(useEditor.getState().toolMode).toEqual({ mode: 'select' })
    expect(useEditor.getState().mode).toBe('select')
    expect(useEditor.getState().tool).toBeNull()
  })

  test('the setMode compatibility wrapper elects a default build tool', () => {
    useEditor.getState().setMode('build')

    expect(useEditor.getState().toolMode).toEqual({ mode: 'build', tool: 'wall' })
    expect(useEditor.getState().mode).toBe('build')
    expect(useEditor.getState().tool).toBe('wall')
  })

  test('setTool enters build and null exits it', () => {
    useEditor.getState().armToolMode({ mode: 'select' })
    useEditor.getState().setTool('slab')

    expect(useEditor.getState().toolMode).toEqual({ mode: 'build', tool: 'slab' })
    expect(useEditor.getState().mode).toBe('build')
    expect(useEditor.getState().tool).toBe('slab')

    useEditor.getState().setTool(null)
    expect(useEditor.getState().toolMode).toEqual({ mode: 'select' })
    expect(useEditor.getState().tool).toBeNull()
  })
})

describe('leaving Select ends the selection', () => {
  const ROOM = { levelId: 'level_1', zoneId: 'zone_1' }

  function selectRoomAndNode() {
    useEditor.getState().armToolMode({ mode: 'select' })
    useViewer
      .getState()
      .setSelection({ selectedIds: ['wall_1' as never], zoneId: 'zone_1' as never })
    useEditor.getState().selectRoom(ROOM)
    useEditor.getState().setSelectedReferenceId(null)
  }

  function expectNothingSelected() {
    expect(useViewer.getState().selection.selectedIds).toEqual([])
    expect(useViewer.getState().selection.zoneId).toBeNull()
    expect(useEditor.getState().room).toBeNull()
  }

  test('picking a catalog item (the item tool) clears the room and node selection', () => {
    selectRoomAndNode()
    useEditor.getState().setSelectedItem({ id: 'chair' } as never)
    useEditor.getState().setTool('item')
    expectNothingSelected()
  })

  test('the door and window tools clear it', () => {
    for (const tool of ['door', 'window'] as const) {
      selectRoomAndNode()
      useEditor.getState().armToolMode({ mode: 'build', tool })
      expectNothingSelected()
    }
  })

  test('draw tools clear it, and so does switching from one tool to another', () => {
    selectRoomAndNode()
    useEditor.getState().setMode('build')
    expect(useEditor.getState().tool).toBe('wall')
    expectNothingSelected()

    // A tool that selects what it just drew (the roof, to draw into it next)
    // loses that selection when another tool is picked.
    useViewer.getState().setSelection({ selectedIds: ['roof_1' as never] })
    useEditor.getState().armToolMode({ mode: 'build', tool: 'slab' })
    expectNothingSelected()
  })

  test('re-arming the tool already in hand is not a transition', () => {
    useEditor.getState().armToolMode({ mode: 'build', tool: 'roof' })
    useViewer.getState().setSelection({ selectedIds: ['roof_1' as never] })
    useEditor.getState().setTool('roof')
    expect(useViewer.getState().selection.selectedIds).toEqual(['roof_1'])
  })

  test('paint clears it, after taking its target from the selection', () => {
    const previousNodes = useScene.getState().nodes
    useScene.setState({
      nodes: { roof_1: { id: 'roof_1', type: 'roof' } as unknown as AnyNode } as never,
    })
    try {
      useEditor.getState().setActivePaintTarget('wall')
      selectRoomAndNode()
      useViewer.getState().setSelection({ selectedIds: ['roof_1' as never] })
      useEditor.getState().armMaterialPaint()
      expect(useEditor.getState().mode).toBe('material-paint')
      expect(useEditor.getState().activePaintTarget).toBe('roof')
      expectNothingSelected()
    } finally {
      useScene.setState({ nodes: previousNodes })
    }
  })

  test('terrain sculpt and delete clear it', () => {
    for (const mode of ['terrain-sculpt', 'delete'] as const) {
      selectRoomAndNode()
      useEditor.getState().armToolMode({ mode })
      expectNothingSelected()
    }
  })

  test('the level and building context survive', () => {
    useViewer
      .getState()
      .setSelection({ buildingId: 'building_1' as never, levelId: 'level_1' as never })
    selectRoomAndNode()
    useEditor.getState().armToolMode({ mode: 'build', tool: 'door' })
    expect(useViewer.getState().selection.levelId).toBe('level_1')
    expect(useViewer.getState().selection.buildingId).toBe('building_1')
  })

  test('Select, and a move or handle drag inside it, keep the selection', () => {
    selectRoomAndNode()
    useEditor.getState().armToolMode({ mode: 'select' })
    expect(useViewer.getState().selection.selectedIds).toEqual(['wall_1'])
    expect(useEditor.getState().room).toEqual(ROOM)

    let cancelled = false
    const handle = beginGesture({
      kind: 'test-handle',
      onCancel: () => {
        cancelled = true
      },
    })
    useEditor.getState().armToolMode({ mode: 'select' })
    expect(handle.active).toBe(true)
    handle.end()
    expect(cancelled).toBe(false)

    useEditor.getState().setMovingNode({ id: 'wall_1', type: 'wall' } as unknown as AnyNode)
    expect(useInteractionScope.getState().scope.kind).toBe('moving')
    expect(useEditor.getState().mode).toBe('select')
    expect(useViewer.getState().selection.selectedIds).toEqual(['wall_1'])
    useEditor.getState().setMovingNode(null)
    expect(useViewer.getState().selection.selectedIds).toEqual(['wall_1'])
  })
})

describe('persisted ToolMode normalization', () => {
  test('elects a default for build with a null tool', () => {
    const state = normalizePersistedEditorUiState({
      phase: 'structure',
      toolMode: { mode: 'build', tool: null as never },
      mode: 'select',
      tool: 'slab',
      structureLayer: 'elements',
    })

    expect(state.toolMode).toEqual({ mode: 'build', tool: 'wall' })
    expect(state.mode).toBe('build')
    expect(state.tool).toBe('wall')
  })

  test('clears a persisted tool from a non-build mode', () => {
    const state = normalizePersistedEditorUiState({
      phase: 'structure',
      toolMode: { mode: 'select' },
      mode: 'build',
      tool: 'wall',
      structureLayer: 'elements',
    })

    expect(state.toolMode).toEqual({ mode: 'select' })
    expect(state.mode).toBe('select')
    expect(state.tool).toBeNull()
  })
})
