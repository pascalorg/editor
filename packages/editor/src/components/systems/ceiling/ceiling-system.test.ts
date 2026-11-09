import { expect, test } from 'bun:test'
import { BuildingNode, CeilingNode, LevelNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { act, createRoot } from '@react-three/fiber'
import { createElement, Fragment } from 'react'
import { OrthographicCamera, type WebGLRenderer } from 'three'
import useEditor, { normalizePersistedEditorLayoutState } from '../../../store/use-editor'
import useInteractionScope from '../../../store/use-interaction-scope'
import { CeilingSystem, CeilingTopsSync } from './ceiling-system'

test('ceilings start on for the roof level and off for the floor plans, each kept as set', () => {
  const fresh = normalizePersistedEditorLayoutState(undefined)
  expect(fresh.showRoofCeilings).toBe(true)
  expect(fresh.showCeilings).toBe(false)
  const turned = normalizePersistedEditorLayoutState({
    showRoofCeilings: false,
    showCeilings: true,
  })
  expect(turned.showRoofCeilings).toBe(false)
  expect(turned.showCeilings).toBe(true)
})

test('the level’s ceilings setting draws the ceiling tops, stepping aside to place on a ceiling', async () => {
  const previous = {
    scene: useScene.getState(),
    viewer: useViewer.getState(),
    editor: useEditor.getState(),
    scope: useInteractionScope.getState(),
  }
  const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true
  const makeCanvas = () =>
    Object.assign(new EventTarget(), {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    }) as unknown as HTMLCanvasElement
  const canvas = makeCanvas()
  const previewCanvas = makeCanvas()
  const root = createRoot(canvas)
  const previewRoot = createRoot(previewCanvas)
  const building = BuildingNode.parse({})
  const storey = LevelNode.parse({ parentId: building.id, level: 0, height: 3 })
  const roof = LevelNode.parse({
    parentId: building.id,
    level: 1,
    height: 3,
    metadata: { role: 'roof' },
  })
  building.children = [storey.id, roof.id]
  const ceiling = CeilingNode.parse({
    parentId: storey.id,
    height: 2.7,
    polygon: [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ],
  })
  const select = (levelId: typeof storey.id) =>
    act(async () =>
      useViewer.setState({
        selection: { buildingId: building.id, levelId, zoneId: null, selectedIds: [] },
      }),
    )
  const tops = () => useViewer.getState().showCeilingTops
  try {
    useScene.setState({
      nodes: {
        [building.id]: building,
        [storey.id]: storey,
        [roof.id]: roof,
        [ceiling.id]: ceiling,
      },
    })
    useEditor.setState({
      ...normalizePersistedEditorLayoutState(undefined),
      tool: null,
      selectedItem: null,
      isPreviewMode: false,
      isCaptureMode: false,
    })
    useInteractionScope.setState({ scope: { kind: 'idle' } })
    useViewer.setState({ showCeilingTops: false, hoveredId: null })
    await select(roof.id)
    const configure = (target: typeof root, domElement: HTMLCanvasElement) =>
      target.configure({
        gl: {
          domElement,
          render() {},
          setSize() {},
          setPixelRatio() {},
        } as unknown as WebGLRenderer,
        camera: Object.assign(new OrthographicCamera(), { manual: true }),
        frameloop: 'never',
        dpr: 1,
        size: { width: 100, height: 100, top: 0, left: 0 },
      })
    await configure(root, canvas)
    await act(async () =>
      root.render(
        createElement(Fragment, null, createElement(CeilingTopsSync), createElement(CeilingSystem)),
      ),
    )
    expect(tops()).toBe(true)

    // A second viewer's ceiling system (the preview's) going away leaves the tops as set.
    await configure(previewRoot, previewCanvas)
    await act(async () => previewRoot.render(createElement(CeilingSystem)))
    await act(async () => previewRoot.unmount())
    expect(tops()).toBe(true)

    await select(storey.id)
    expect(tops()).toBe(false)
    await act(async () => useEditor.getState().setShowCeilings(true))
    expect(tops()).toBe(true)
    await act(async () => useEditor.setState({ tool: 'ceiling' }))
    expect(tops()).toBe(false)
    await act(async () => useEditor.setState({ tool: null, isPreviewMode: true }))
    expect(tops()).toBe(false)
    await act(async () => useEditor.setState({ isPreviewMode: false }))
    expect(tops()).toBe(true)

    // The roof level keeps its own setting.
    await select(roof.id)
    await act(async () => useEditor.getState().setShowRoofCeilings(false))
    expect(tops()).toBe(false)
    expect(useEditor.getState().showCeilings).toBe(true)

    await act(async () => useEditor.getState().setShowRoofCeilings(true))
    expect(tops()).toBe(true)
    await act(async () => root.unmount())
    expect(tops()).toBe(false)
  } finally {
    useScene.setState(previous.scene, true)
    useViewer.setState(previous.viewer, true)
    useEditor.setState(previous.editor, true)
    useInteractionScope.setState(previous.scope, true)
    actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct
  }
})
