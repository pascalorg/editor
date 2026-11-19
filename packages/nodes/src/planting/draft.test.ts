import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  type AnyNodeId,
  clearSceneHistory,
  createSceneApi,
  SiteNode,
  useScene,
} from '@pascal-app/core'
import { sceneLayout, useEditor, useInteractionScope } from '@pascal-app/editor'
import { act, create } from '@react-three/test-renderer'
import { createElement } from 'react'
import { snapPlantingDraftPoint, usePlantingDraft, usePlantingDraftController } from './draft'

// Exercise the real shared drawing controller and scene operation, without a browser or GPU.
// DOM pointer-to-Site conversion is not claimed by this headless keyboard/draft test.
let originalScene: ReturnType<typeof useScene.getState>
let originalEditor: ReturnType<typeof useEditor.getState>
let originalScope: ReturnType<typeof useInteractionScope.getState>
const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
const frame = globalThis.requestAnimationFrame,
  cancel = globalThis.cancelAnimationFrame
const actEnvironment = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT
const site = SiteNode.parse({ id: 'site_draft' })
const controllers: Partial<Record<'2d' | '3d', ReturnType<typeof usePlantingDraftController>>> = {}
let selected: AnyNodeId[] = [],
  finished: string[] = []
let sceneApi: ReturnType<typeof createSceneApi>
function Controller({ view }: { view: '2d' | '3d' }) {
  controllers[view] = usePlantingDraftController({
    sceneApi,
    siteId: site.id,
    view,
    selectNode: (id) => selected.push(id),
    finishTool: () => finished.push(view),
  })
  return null
}
const points = () => usePlantingDraft.getState().points
const beds = () =>
  Object.values(useScene.getState().nodes).filter((node) => node.type === 'planting')
const point = (view: '2d' | '3d', x: number, z: number) =>
  act(async () => {
    controllers[view]!.addPoint([x, z])
  })
const key = (key: string) =>
  act(async () => {
    const event = new Event('keydown', { cancelable: true })
    Object.defineProperty(event, 'key', { value: key })
    window.dispatchEvent(event)
  })
beforeEach(() => {
  originalScene = useScene.getState()
  originalEditor = useEditor.getState()
  originalScope = useInteractionScope.getState()
  globalThis.window = new EventTarget() as Window & typeof globalThis
  globalThis.requestAnimationFrame = (cb) => {
    cb(0)
    return 0
  }
  globalThis.cancelAnimationFrame = () => {}
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  useScene.setState({ nodes: { [site.id]: site }, rootNodeIds: [site.id] } as never)
  useEditor.setState({
    mode: 'build',
    tool: 'planting',
    workspaceMode: 'edit',
    viewLayouts: { edit: sceneLayout('2d') },
  })
  usePlantingDraft.setState({ points: [], hover: null, error: null })
  selected = []
  finished = []
  sceneApi = createSceneApi(useScene)
  clearSceneHistory()
})
afterEach(() => {
  useScene.setState(originalScene)
  useEditor.setState(originalEditor)
  useInteractionScope.setState(originalScope)
  usePlantingDraft.setState({ points: [], hover: null, error: null })
  globalThis.requestAnimationFrame = frame
  globalThis.cancelAnimationFrame = cancel
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = actEnvironment
  if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor)
  else Reflect.deleteProperty(globalThis, 'window')
  delete controllers['2d']
  delete controllers['3d']
  clearSceneHistory()
})

test('plan Enter commits once even with both view controllers mounted; duplicate clicks do not add corners', async () => {
  const plan = await create(createElement(Controller, { view: '2d' }))
  const scene = await create(createElement(Controller, { view: '3d' }))
  try {
    await point('2d', -3, -2)
    await point('2d', -3, -2)
    expect(points()).toHaveLength(1)
    await point('2d', 3, -2)
    await point('2d', 3, 2)
    await point('2d', -3, 2)
    await key('Enter')
    expect(beds()).toHaveLength(1)
    expect(selected).toEqual([beds()[0]!.id])
    expect(finished).toEqual(['2d'])
    expect(points()).toEqual([])
    expect(usePlantingDraft.getState().error).toBeNull()
  } finally {
    await act(async () => {
      await plan.unmount()
      await scene.unmount()
    })
  }
})

test('an invalid outline remains editable, Backspace repairs it, and closing its first point plants it', async () => {
  const renderer = await create(createElement(Controller, { view: '2d' }))
  try {
    await point('2d', 0, 0)
    await point('2d', 4, 0)
    await key('Enter')
    expect(beds()).toEqual([])
    expect(points()).toHaveLength(2)
    expect(usePlantingDraft.getState().error).toBeTruthy()
    await point('2d', 0, 4)
    await point('2d', 4, 4)
    await key('Enter')
    expect(beds()).toEqual([])
    expect(points()).toHaveLength(4)
    expect(usePlantingDraft.getState().error).toBeTruthy()
    await key('Backspace')
    expect(points()).toHaveLength(3)
    expect(usePlantingDraft.getState().error).toBeNull()
    await point('2d', 0.01, 0.01)
    expect(beds()).toHaveLength(1)
    expect(points()).toEqual([])
  } finally {
    await act(async () => renderer.unmount())
  }
})

test('3D owns Enter in split view, Escape clears without a write, and Alt preserves the raw point', async () => {
  useEditor.setState({ viewLayouts: { edit: sceneLayout('split') } })
  const plan = await create(createElement(Controller, { view: '2d' }))
  const scene = await create(createElement(Controller, { view: '3d' }))
  try {
    expect(snapPlantingDraftPoint([0.123, 0.456], true)).toEqual([0.123, 0.456])
    await point('3d', -3, -2)
    await point('3d', 3, -2)
    await point('3d', 0, 2)
    await key('Enter')
    expect(beds()).toHaveLength(1)
    expect(finished).toEqual(['3d'])
    const before = useScene.getState().nodes
    await point('3d', 10, 10)
    await key('Escape')
    expect(points()).toEqual([])
    expect(useScene.getState().nodes).toBe(before)
    expect(finished).toEqual(['3d', '3d'])
  } finally {
    await act(async () => {
      await plan.unmount()
      await scene.unmount()
    })
  }
})
