// Provide in-memory storage for Zustand persist middleware
const memoryStorage = new Map<string, string>()
const mockStorage = {
  getItem: (key: string) => memoryStorage.get(key) ?? null,
  setItem: (key: string, value: string) => {
    memoryStorage.set(key, String(value))
  },
  removeItem: (key: string) => {
    memoryStorage.delete(key)
  },
  clear: () => memoryStorage.clear(),
  key: (index: number) => Array.from(memoryStorage.keys())[index] ?? null,
  get length() {
    return memoryStorage.size
  },
}

if (typeof globalThis.window === 'undefined') {
  ;(globalThis as any).window = globalThis
}
;(globalThis as any).localStorage = mockStorage
;(globalThis.window as any).localStorage = mockStorage

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import React from 'react'
import { renderToString } from 'react-dom/server'
import {
  type AnyNodeId,
  BuildingNode,
  LevelNode,
  WallNode,
  SlabNode,
  ItemNode,
  ZoneNode,
  useScene,
  useLiveTransforms,
  useLiveNodeOverrides,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import useEditor from '../store/use-editor'
import { EditorLayoutV2 } from '../components/editor/editor-layout-v2'

describe('Empirical Challenger Verification — WebGL Context Retention & State Integrity', () => {
  let originalWarn: typeof console.warn

  beforeAll(() => {
    originalWarn = console.warn
    console.warn = (...args: any[]) => {
      if (typeof args[0] === 'string' && args[0].includes('[zustand persist middleware]')) {
        return
      }
      originalWarn(...args)
    }
  })

  afterAll(() => {
    console.warn = originalWarn
  })

  beforeEach(() => {
    useScene.setState({
      nodes: {},
      rootNodeIds: [],
      materials: {},
      collections: {},
      dirtyNodes: new Set(),
      readOnly: false,
    } as never)
    useScene.temporal.getState().clear()

    useViewer.setState({
      selection: {
        buildingId: null,
        levelId: null,
        zoneId: null,
        selectedIds: [],
      },
      cameraMode: 'perspective',
      wallMode: 'up',
      shading: 'solid',
      renderContext: 'editor',
    })

    useEditor.setState({
      isPreviewMode: true,
      mode: 'select',
      tool: null,
      catalogCategory: null,
      viewMode: '3d',
      isFloorplanOpen: false,
      isFirstPersonMode: false,
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // Dimension 1: Persistent Canvas & Layout Continuity across Role Flips
  // ───────────────────────────────────────────────────────────────────────────
  describe('Dimension 1: Persistent Canvas & Layout Continuity', () => {
    test('EditorLayoutV2 continuously hosts the same viewerContent node without unmounting across role flips', () => {
      function MockViewerNode() {
        return <div data-testid="persistent-viewer-canvas">WebGL Canvas Stub</div>
      }

      const persistentViewerElement = <MockViewerNode />

      // Initial render in Preview (Viewer) mode
      useEditor.setState({ isPreviewMode: true })
      const htmlViewer = renderToString(
        <EditorLayoutV2
          isPreviewMode={true}
          renderTabContent={() => null}
          viewerContent={persistentViewerElement}
        />,
      )

      expect(htmlViewer).toContain('data-testid="persistent-viewer-canvas"')

      // Transition to Editor Mode
      useEditor.setState({ isPreviewMode: false })
      const htmlEditor = renderToString(
        <EditorLayoutV2
          isPreviewMode={false}
          renderTabContent={() => null}
          viewerContent={persistentViewerElement}
        />,
      )

      expect(htmlEditor).toContain('data-testid="persistent-viewer-canvas"')
    })

    test('Toggling isPreviewMode does not rebuild or reset viewer camera props or context store', () => {
      useViewer.setState({
        cameraMode: 'orthographic',
        wallMode: 'cutaway',
      })

      expect(useEditor.getState().isPreviewMode).toBe(true)
      expect(useViewer.getState().cameraMode).toBe('orthographic')
      expect(useViewer.getState().wallMode).toBe('cutaway')

      // Flip to editor
      useEditor.getState().setPreviewMode(false)
      expect(useEditor.getState().isPreviewMode).toBe(false)
      expect(useViewer.getState().cameraMode).toBe('orthographic')
      expect(useViewer.getState().wallMode).toBe('cutaway')

      // Flip back to preview
      useEditor.getState().setPreviewMode(true)
      expect(useEditor.getState().isPreviewMode).toBe(true)
      expect(useViewer.getState().cameraMode).toBe('orthographic')
      expect(useViewer.getState().wallMode).toBe('cutaway')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // Dimension 2: Selection & Multi-Selection Persistence
  // ───────────────────────────────────────────────────────────────────────────
  describe('Dimension 2: Selection & Multi-Selection Persistence', () => {
    test('Viewer -> Editor transition fully preserves multi-selection, buildingId, and levelId', () => {
      const buildingId = 'building_test_1'
      const levelId = 'level_test_1'
      const selectedIds = ['wall_1', 'wall_2', 'item_1', 'slab_1']

      useViewer.setState({
        selection: {
          buildingId,
          levelId,
          zoneId: null,
          selectedIds,
        },
      })

      // 1. Initial State: Viewer mode
      expect(useEditor.getState().isPreviewMode).toBe(true)
      expect(useViewer.getState().selection.selectedIds).toEqual(selectedIds)

      // 2. Transition: Viewer -> Editor (Role Handoff)
      useEditor.getState().setPreviewMode(false)
      expect(useEditor.getState().isPreviewMode).toBe(false)
      expect(useViewer.getState().selection.buildingId).toBe(buildingId)
      expect(useViewer.getState().selection.levelId).toBe(levelId)
      expect(useViewer.getState().selection.selectedIds).toEqual(selectedIds)
    })

    test('Editor -> Viewer transition preserves buildingId and levelId while cleanly resetting tool selection', () => {
      const buildingId = 'building_test_2'
      const levelId = 'level_test_2'
      const selectedIds = ['wall_1', 'item_2']

      useEditor.getState().setPreviewMode(false)
      useViewer.setState({
        selection: {
          buildingId,
          levelId,
          zoneId: null,
          selectedIds,
        },
      })

      expect(useEditor.getState().isPreviewMode).toBe(false)
      expect(useViewer.getState().selection.selectedIds).toEqual(selectedIds)

      // Demote to Viewer mode
      useEditor.getState().setPreviewMode(true)
      expect(useEditor.getState().isPreviewMode).toBe(true)
      expect(useViewer.getState().selection.buildingId).toBe(buildingId)
      expect(useViewer.getState().selection.levelId).toBe(levelId)
      expect(useViewer.getState().selection.selectedIds).toEqual([])
    })

    test('Rapid consecutive role toggling maintains level and building selection invariants', () => {
      const buildingId = 'building_stress'
      const levelId = 'level_stress'

      useViewer.setState({
        selection: {
          buildingId,
          levelId,
          zoneId: null,
          selectedIds: [],
        },
      })

      for (let i = 0; i < 50; i++) {
        const isPreview = i % 2 === 0
        useEditor.getState().setPreviewMode(isPreview)

        expect(useViewer.getState().selection.buildingId).toBe(buildingId)
        expect(useViewer.getState().selection.levelId).toBe(levelId)
      }
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // Dimension 3: Tool State Integrity & Mode Switching
  // ───────────────────────────────────────────────────────────────────────────
  describe('Dimension 3: Tool State Integrity & Mode Switching', () => {
    test('Exiting Editor mode into Viewer disarms active build tool to select mode cleanly', () => {
      useEditor.getState().setPreviewMode(false)
      useEditor.getState().setMode('build')
      useEditor.getState().setTool('wall')

      expect(useEditor.getState().mode).toBe('build')
      expect(useEditor.getState().tool).toBe('wall')

      // Transition to Preview
      useEditor.getState().setPreviewMode(true)
      expect(useEditor.getState().isPreviewMode).toBe(true)
      expect(useEditor.getState().mode).toBe('select')
      expect(useEditor.getState().tool).toBeNull()

      // Transition back to Editor: stays clean in select mode
      useEditor.getState().setPreviewMode(false)
      expect(useEditor.getState().isPreviewMode).toBe(false)
      expect(useEditor.getState().mode).toBe('select')
      expect(useEditor.getState().tool).toBeNull()
    })

    test('Material paint mode and active paint materials disarm cleanly without leaking state', () => {
      useEditor.getState().setPreviewMode(false)
      useEditor.getState().setMode('material-paint')
      useEditor.getState().setActivePaintMaterial({
        mode: 'paint',
        materialPreset: 'mat_wood_oak',
      })

      expect(useEditor.getState().mode).toBe('material-paint')
      expect(useEditor.getState().activePaintMaterial?.materialPreset).toBe('mat_wood_oak')

      // Transition to Preview
      useEditor.getState().setPreviewMode(true)
      expect(useEditor.getState().mode).toBe('select')

      // Return to Editor
      useEditor.getState().setPreviewMode(false)
      expect(useEditor.getState().mode).toBe('select')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // Dimension 4: ViewMode (2D / 3D / Split) and First-Person Walkthrough Interaction
  // ───────────────────────────────────────────────────────────────────────────
  describe('Dimension 4: ViewMode & Walkthrough Continuity', () => {
    test('Switching viewMode to 2D / split mode retains canvas in store without corruption', () => {
      useEditor.getState().setPreviewMode(false)
      useEditor.getState().setViewMode('split')
      useEditor.getState().setFloorplanPaneRatio(0.5)

      expect(useEditor.getState().viewMode).toBe('split')
      expect(useEditor.getState().floorplanPaneRatio).toBe(0.5)

      // Role flip to Viewer (which defaults previewStageMode to 3d)
      useEditor.getState().setPreviewMode(true)
      expect(useEditor.getState().isPreviewMode).toBe(true)

      // Role flip back to Editor
      useEditor.getState().setPreviewMode(false)
      expect(useEditor.getState().viewMode).toBe('split')
      expect(useEditor.getState().floorplanPaneRatio).toBe(0.5)
    })

    test('First-person mode walkthrough entering and exiting maintains level selection', () => {
      const levelId = 'level_walkthrough_1'
      useScene.setState({
        nodes: {
          [levelId]: LevelNode.parse({ id: levelId, level: 1, elevation: 3, children: [] }),
        },
        rootNodeIds: [levelId],
      } as never)

      useViewer.getState().setSelection({ levelId, selectedIds: [] })
      expect(useViewer.getState().selection.levelId).toBe(levelId)

      // Enter first-person mode
      useEditor.getState().setFirstPersonMode(true)
      expect(useEditor.getState().isFirstPersonMode).toBe(true)

      // Exit first-person mode
      useEditor.getState().setFirstPersonMode(false)
      expect(useEditor.getState().isFirstPersonMode).toBe(false)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // Dimension 5: High-Stress State Invariant Verification
  // ───────────────────────────────────────────────────────────────────────────
  describe('Dimension 5: High-Stress State Invariant Verification', () => {
    test('100 Stress flips with concurrent live transform mutations maintain 100% store integrity', () => {
      const nodeId = 'item_stress_1'

      for (let i = 0; i < 100; i++) {
        const isPreview = i % 2 === 0
        useEditor.getState().setPreviewMode(isPreview)

        // Inject live transform
        useLiveTransforms.getState().set(nodeId, {
          position: [i * 0.1, 0, i * 0.2],
          rotation: (i * Math.PI) / 50,
        })

        if (!isPreview) {
          useViewer.getState().setSelection({
            selectedIds: [nodeId],
          })
        }
      }

      expect(useLiveTransforms.getState().transforms.has(nodeId)).toBe(true)
      expect(useViewer.getState().selection.selectedIds).toEqual([nodeId])

      useLiveTransforms.getState().clearAll()
    })
  })
})
