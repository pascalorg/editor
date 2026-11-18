import { afterEach, beforeEach, expect, test } from 'bun:test'
import { clearSceneHistory, createSceneApi, SiteNode, useScene } from '@pascal-app/core'
import { sceneLayout, useEditor, useInteractionScope } from '@pascal-app/editor'
import { act, create } from '@react-three/test-renderer'
import { createElement } from 'react'
import { useLawnDraft, useLawnDraftController } from './draft'

const site = SiteNode.parse({ id: 'site_lawn_draft' })
const savedWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
const raf = globalThis.requestAnimationFrame
const cancelRaf = globalThis.cancelAnimationFrame
const savedAct = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
let savedScene: ReturnType<typeof useScene.getState>
let savedEditor: ReturnType<typeof useEditor.getState>
let savedScope: ReturnType<typeof useInteractionScope.getState>
const controllers = new Map<'2d' | '3d', ReturnType<typeof useLawnDraftController>>()
function Controller({ view }: { view: '2d' | '3d' }) {
  controllers.set(
    view,
    useLawnDraftController({
      sceneApi: createSceneApi(useScene),
      siteId: site.id,
      view,
      selectNode: () => {},
      finishTool: () => {},
    }),
  )
  return null
}
const point = async (view: '2d' | '3d', value: [number, number]) =>
  act(async () => {
    const controller = controllers.get(view)
    if (!controller) throw new Error('Expected a mounted controller')
    controller.addPoint(value)
  })
const key = async (value: string) =>
  act(async () => {
    const event = new Event('keydown', { cancelable: true })
    Object.defineProperty(event, 'key', { value })
    window.dispatchEvent(event)
  })
beforeEach(() => {
  savedScene = useScene.getState()
  savedEditor = useEditor.getState()
  savedScope = useInteractionScope.getState()
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: new EventTarget(),
  })
  globalThis.requestAnimationFrame = (cb) => {
    cb(0)
    return 0
  }
  globalThis.cancelAnimationFrame = () => {}
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  useScene.setState({ nodes: { [site.id]: site }, rootNodeIds: [site.id] })
  useEditor.setState({
    mode: 'build',
    tool: 'lawn',
    workspaceMode: 'edit',
    viewLayouts: { edit: sceneLayout('2d') },
  })
  clearSceneHistory()
})
afterEach(() => {
  useScene.setState(savedScene)
  useEditor.setState(savedEditor)
  useInteractionScope.setState(savedScope)
  useLawnDraft.setState({ points: [], hover: null, error: null })
  controllers.clear()
  clearSceneHistory()
  globalThis.requestAnimationFrame = raf
  globalThis.cancelAnimationFrame = cancelRaf
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = savedAct
  if (savedWindow) Object.defineProperty(globalThis, 'window', savedWindow)
  else Reflect.deleteProperty(globalThis, 'window')
})

test('both mounted views share an area: Enter adds one Site lawn in one undo and Escape adds none', async () => {
  const plan = await create(createElement(Controller, { view: '2d' }))
  const scene = await create(createElement(Controller, { view: '3d' }))
  try {
    await point('2d', [0, 0])
    await point('2d', [4, 0])
    await point('2d', [4, 4])
    await key('Enter')
    expect(
      Object.values(useScene.getState().nodes).filter((node) => node.type === 'lawn'),
    ).toHaveLength(1)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    useScene.temporal.getState().undo()
    expect(Object.keys(useScene.getState().nodes)).toEqual([site.id])
    const before = useScene.getState().nodes
    await point('2d', [0, 0])
    await key('Escape')
    expect(useScene.getState().nodes).toBe(before)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  } finally {
    await act(async () => {
      await plan.unmount()
      await scene.unmount()
    })
  }
})

test('closing the first point commits once and an invalid outline stays editable', async () => {
  const renderer = await create(createElement(Controller, { view: '2d' }))
  try {
    await point('2d', [0, 0])
    await point('2d', [4, 0])
    await key('Enter')
    expect(useLawnDraft.getState().error).toBeTruthy()
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    await point('2d', [4, 4])
    await point('2d', [0.01, 0.01])
    expect(useLawnDraft.getState().points).toEqual([])
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  } finally {
    await act(async () => renderer.unmount())
  }
})
