import { afterEach, describe, expect, test } from 'bun:test'
import { availableViews, editorHostViewRegistry, registerEditorHostView } from '../lib/editor-views'
import useEditor, { normalizePersistedEditorUiState } from './use-editor'
import {
  activeViewLayout,
  DEFAULT_VIEW_LAYOUT,
  isViewVisible,
  sceneLayout,
  VIEW_2D,
  VIEW_3D,
  visibleScene,
} from './view-layout'

function layout() {
  return activeViewLayout(useEditor.getState())
}

afterEach(() => {
  useEditor.getState().setCaptureMode(false)
  useEditor.getState().setFirstPersonMode(false)
  useEditor.getState().setWorkspaceMode('edit')
  useEditor.setState({ viewLayouts: {} })
  editorHostViewRegistry.reset()
})

describe('the stage layout', () => {
  test('a view sits in one pane: picking the other pane’s view swaps them', () => {
    useEditor.getState().setViewLayout(sceneLayout('split'))
    useEditor.getState().setPaneView(0, VIEW_3D)
    expect(layout().panes).toEqual([VIEW_3D, VIEW_2D])
    expect(layout().split).toBe(true)
  })

  test('a view opened beside the scene splits next to the focused pane', () => {
    useEditor.getState().showView('gallery', { beside: true })
    expect(layout()).toMatchObject({ split: true, panes: [VIEW_3D, 'gallery'], focus: 1 })
    expect(visibleScene(useEditor.getState())).toBe('3d')
  })

  test('opening a view already on screen only focuses it', () => {
    useEditor.getState().setViewLayout(sceneLayout('split'))
    useEditor.getState().showView(VIEW_3D)
    expect(layout()).toMatchObject({ panes: [VIEW_2D, VIEW_3D], focus: 1, split: true })
  })

  test('splitting from 3D brings the plan in on the left, as the split always did', () => {
    useEditor.getState().toggleSplit()
    expect(layout()).toMatchObject({ split: true, panes: [VIEW_2D, VIEW_3D], focus: 1 })
  })

  test('closing the split keeps the focused pane', () => {
    useEditor.getState().setViewLayout(sceneLayout('split'))
    useEditor.getState().focusViewPane(1)
    useEditor.getState().toggleSplit()
    expect(layout()).toMatchObject({ split: false, panes: [VIEW_3D, VIEW_2D] })
  })

  test('closing a view collapses its split, or brings a lone pane back to 3D', () => {
    useEditor.getState().showView('gallery', { beside: true })
    useEditor.getState().closeView('gallery')
    expect(layout()).toMatchObject({ split: false, panes: [VIEW_3D, VIEW_2D] })
    useEditor.getState().setViewLayout(sceneLayout('2d'))
    useEditor.getState().showView('gallery')
    useEditor.getState().closeView('gallery')
    expect(visibleScene(useEditor.getState())).toBe('3d')
  })

  test('a plan beside another view owns the scene like a plan alone', () => {
    useEditor.getState().setViewLayout(sceneLayout('2d'))
    useEditor.getState().showView('gallery', { beside: true })
    expect(visibleScene(useEditor.getState())).toBe('2d')
  })

  test('each workspace keeps its own layout', () => {
    useEditor.getState().setViewLayout(sceneLayout('split'))
    useEditor.getState().setWorkspaceMode('studio')
    expect(layout()).toEqual(DEFAULT_VIEW_LAYOUT)
    useEditor.getState().showView('gallery')
    useEditor.getState().setWorkspaceMode('edit')
    expect(visibleScene(useEditor.getState())).toBe('split')
  })

  test('capture frames in 3D alone and gives the layout back untouched', () => {
    useEditor.getState().setViewLayout(sceneLayout('2d'))
    useEditor.getState().setCaptureMode(true)
    expect(visibleScene(useEditor.getState())).toBe('3d')
    useEditor.getState().setCaptureMode(false)
    expect(visibleScene(useEditor.getState())).toBe('2d')
  })
})

describe('the deprecated viewMode for plugins written before views', () => {
  test('mirrors the scene on screen and sets it', () => {
    useEditor.getState().setViewMode('split')
    expect(visibleScene(useEditor.getState())).toBe('split')
    expect(useEditor.getState().viewMode).toBe('split')
    useEditor.getState().showView('gallery')
    expect(useEditor.getState().viewMode).toBe('3d')
    useEditor.getState().setCaptureMode(true)
    expect(useEditor.getState().viewMode).toBe('3d')
  })
})

describe('layouts saved before views', () => {
  test.each([
    ['3d', '3d'],
    ['2d', '2d'],
    ['split', 'split'],
  ] as const)('a stored %s view opens as %s, the plan on the left', (viewMode, scene) => {
    const state = normalizePersistedEditorUiState({ viewMode, floorplanPaneRatio: 0.4 } as never)
    const restored = state.viewLayouts.edit
    expect(restored).toBeDefined()
    if (!restored) return
    expect(
      visibleScene({
        viewLayouts: state.viewLayouts,
        workspaceMode: 'edit',
        isCaptureMode: false,
        isFirstPersonMode: false,
      }),
    ).toBe(scene)
    if (scene !== '3d') expect(restored).toMatchObject({ panes: [VIEW_2D, VIEW_3D], ratio: 0.4 })
  })

  test('an open floorplan from before view modes opens split', () => {
    const state = normalizePersistedEditorUiState({ isFloorplanOpen: true } as never)
    expect(state.viewLayouts.edit).toMatchObject({ split: true })
  })
})

describe('registered views', () => {
  test('a plugin view is offered only where its plugin is installed and its workspace matches', () => {
    registerEditorHostView({
      id: 'acme:pets',
      label: 'Pets',
      icon: { kind: 'iconify', name: 'lucide:cat' },
      component: async () => ({ default: () => null }),
      pluginId: 'acme',
    })
    registerEditorHostView({
      id: 'acme:habitat',
      label: 'Habitat',
      icon: { kind: 'iconify', name: 'lucide:house' },
      component: async () => ({ default: () => null }),
      pluginId: 'acme',
      workspaces: ['studio'],
    })
    const ids = (workspaceMode: string, installedPlugins: string[]) =>
      availableViews({
        registered: editorHostViewRegistry.getSnapshot(),
        workspaceMode,
        installedPlugins,
      }).map((view) => view.id)
    expect(ids('edit', [])).toEqual([VIEW_3D, VIEW_2D])
    expect(ids('edit', ['acme'])).toEqual([VIEW_3D, VIEW_2D, 'acme:pets'])
    expect(ids('studio', ['acme'])).toEqual([VIEW_3D, VIEW_2D, 'acme:habitat'])
  })

  test('the scene views cannot be replaced', () => {
    expect(() =>
      registerEditorHostView({
        id: VIEW_3D,
        label: '3D',
        icon: { kind: 'iconify', name: 'lucide:box' },
        component: async () => ({ default: () => null }),
      }),
    ).toThrow()
  })

  test('a layout naming a view that is gone keeps it, so the choice returns with the view', () => {
    useEditor.getState().showView('acme:pets')
    expect(isViewVisible(useEditor.getState(), 'acme:pets')).toBe(true)
    expect(isViewVisible(useEditor.getState(), VIEW_3D)).toBe(false)
  })
})
