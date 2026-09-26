import { afterEach, expect, test } from 'bun:test'
import {
  BuildingNode,
  ColumnNode,
  clearSceneHistory,
  LevelNode,
  SiteNode,
  useScene,
} from '@pascal-app/core'
import { create } from '@react-three/test-renderer'
import { type SaveStatus, useAutoSave } from './use-auto-save'

const originalWindow = globalThis.window
const originalRequestAnimationFrame = globalThis.requestAnimationFrame
const previousScene = useScene.getState()
let renderer: Awaited<ReturnType<typeof create>> | undefined

afterEach(async () => {
  await renderer?.unmount()
  renderer = undefined
  globalThis.window = originalWindow
  globalThis.requestAnimationFrame = originalRequestAnimationFrame
  useScene.setState(previousScene, true)
  clearSceneHistory()
})

function graph(count: number) {
  if (count === 0) return { nodes: {}, rootNodeIds: [] }
  const columns = Array.from({ length: count - 3 }, (_, index) =>
    ColumnNode.parse({ id: `column_autosave_${index}`, parentId: 'level_autosave' }),
  )
  const level = LevelNode.parse({
    id: 'level_autosave',
    parentId: 'building_autosave',
    children: columns.map((node) => node.id),
  })
  const building = BuildingNode.parse({
    id: 'building_autosave',
    parentId: 'site_autosave',
    children: [level.id],
  })
  const site = SiteNode.parse({ id: 'site_autosave', children: [building.id] })
  const nodes = [site, building, level, ...columns]
  return { nodes: Object.fromEntries(nodes.map((node) => [node.id, node])), rootNodeIds: [site.id] }
}

/** Mounts the hook in its initial state: a scene load not yet completed. */
async function mountBeforeLoad(guardAgainstSceneWipe?: boolean, save?: () => Promise<void>) {
  globalThis.window = new EventTarget() as unknown as Window & typeof globalThis
  useScene.setState({ ...graph(0), readOnly: false })
  clearSceneHistory()
  const writes: number[] = []
  const statuses: SaveStatus[] = []
  let controls: ReturnType<typeof useAutoSave> | undefined
  function Host(props: { guardAgainstSceneWipe?: boolean; isVersionPreviewMode?: boolean }) {
    controls = useAutoSave({
      ...props,
      onSave: async (scene) => {
        writes.push(Object.keys(scene.nodes).length)
        await save?.()
      },
      onSaveStatusChange: (status) => statuses.push(status),
    })
    return null
  }
  renderer = await create(<Host guardAgainstSceneWipe={guardAgainstSceneWipe} />)
  return {
    writes,
    statuses,
    controls: controls!,
    update: (props: { guardAgainstSceneWipe?: boolean; isVersionPreviewMode?: boolean }) =>
      renderer!.update(<Host {...props} />),
  }
}

async function mount(
  loadedCount: number,
  guardAgainstSceneWipe?: boolean,
  save?: () => Promise<void>,
) {
  const mounted = await mountBeforeLoad(guardAgainstSceneWipe, save)
  useScene.setState(graph(loadedCount))
  clearSceneHistory()
  mounted.controls.completeSceneLoad()
  mounted.statuses.length = 0
  return mounted
}

/** The Editor's load sequence: begin, unload, hydrate the store, complete. */
function loadScene(controls: ReturnType<typeof useAutoSave>, count: number) {
  controls.beginSceneLoad()
  useScene.getState().unloadScene()
  hydrate(count)
  controls.completeSceneLoad()
}

function hydrate(count: number) {
  const { nodes, rootNodeIds } = graph(count)
  useScene.getState().setScene(nodes as never, rootNodeIds as never)
  clearSceneHistory()
}

function agentAddsColumn() {
  useScene
    .getState()
    .createNode(
      ColumnNode.parse({ id: 'column_agent', parentId: 'level_autosave' }),
      'level_autosave' as never,
    )
}

/** A hidden tab: requestAnimationFrame callbacks never run. */
function hideDocument() {
  const frames: FrameRequestCallback[] = []
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    frames.push(callback)
    return frames.length
  }) as typeof requestAnimationFrame
  return frames
}

test('a scene loaded in a hidden tab autosaves agent edits without waiting for a frame', async () => {
  hideDocument()
  const { writes, statuses, controls } = await mountBeforeLoad()
  statuses.length = 0
  // Pre-hydration document writes (the host-panel installedPlugins sync on
  // mount) still must not arm a save of the empty store.
  useScene.getState().setInstalledPlugins(['pre-hydration-default'], { explicit: false })
  loadScene(controls, 12)
  expect(statuses).toEqual([])

  agentAddsColumn()
  await Bun.sleep(1100)
  expect(writes).toEqual([13])
  expect(statuses.at(-1)).toBe('saved')
})

test('the exit flush writes an agent edit made right after a hidden load', async () => {
  hideDocument()
  const { writes, statuses, controls } = await mountBeforeLoad()
  loadScene(controls, 12)
  agentAddsColumn()
  window.dispatchEvent(new Event('pagehide'))
  expect(writes).toEqual([13])
  expect(statuses).not.toContain('error')
})

test('the exit flush still skips while a load is in flight', async () => {
  const { writes, controls } = await mount(12)
  agentAddsColumn()
  controls.beginSceneLoad()
  useScene.getState().unloadScene()
  window.dispatchEvent(new Event('pagehide'))
  expect(writes).toEqual([])
})

test('a save that came due mid-load is written once the load completes', async () => {
  const { writes, statuses, controls } = await mount(12)
  agentAddsColumn()
  controls.beginSceneLoad()
  useScene.getState().unloadScene()
  await Bun.sleep(1100)
  expect(writes).toEqual([])
  expect(statuses.at(-1)).toBe('paused')

  hydrate(12)
  controls.completeSceneLoad()
  await Bun.sleep(0)
  expect(writes).toEqual([12])
  expect(statuses.at(-1)).toBe('saved')
})

test.each([
  'undo',
  'redo',
  'delete',
] as const)('autosave permits a 5 to 4 single-node %s', async (action) => {
  const { writes, statuses } = await mount(5)
  if (action === 'undo') {
    useScene.setState(graph(4))
    clearSceneHistory()
    useScene.setState(graph(5))
    useScene.temporal.getState().undo()
  } else if (action === 'redo') {
    useScene.getState().deleteNode('column_autosave_1')
    useScene.temporal.getState().undo()
    useScene.temporal.getState().redo()
  } else {
    useScene.getState().deleteNode('column_autosave_1')
  }
  expect(Object.keys(useScene.getState().nodes)).toHaveLength(4)
  await Bun.sleep(1100)
  expect(statuses).not.toContain('error')
  expect(writes).toEqual([4])
  expect(statuses.at(-1)).toBe('saved')
})

test('autosave permits a single-node deletion on exit', async () => {
  const { writes, statuses } = await mount(5)
  useScene.getState().deleteNode('column_autosave_1')
  window.dispatchEvent(new Event('pagehide'))
  expect(statuses).not.toContain('error')
  expect(writes).toEqual([4])
})

test('autosave blocks a full wipe and resumes after an allowed edit', async () => {
  const { writes, statuses, controls } = await mount(78)
  useScene.setState(graph(4))
  controls.saveNow()
  window.dispatchEvent(new Event('pagehide'))
  expect(statuses).toContain('error')
  expect(writes).toEqual([])
  useScene.setState(graph(5))
  controls.saveNow()
  await Bun.sleep(0)
  expect(writes).toEqual([5])
  expect(statuses.at(-1)).toBe('saved')
})

test('collaboration scaffold deletion waits for persistence and reports saved', async () => {
  const idle = Promise.withResolvers<void>()
  const { writes, statuses } = await mount(78, false, () => idle.promise)
  useScene.setState(graph(4))
  await Bun.sleep(1100)
  expect(statuses).not.toContain('error')
  expect(writes).toEqual([4])
  expect(statuses).toEqual(['pending', 'saving'])
  idle.resolve()
  await Bun.sleep(0)
  expect(statuses).toEqual(['pending', 'saving', 'saved'])
})

test.each([
  'pagehide',
  'unmount',
])('collaboration scaffold deletion still flushes on %s', async (event) => {
  const { writes, statuses } = await mount(78, false)
  useScene.setState(graph(4))
  if (event === 'pagehide') window.dispatchEvent(new Event(event))
  else {
    await renderer!.unmount()
    renderer = undefined
  }
  expect(statuses).not.toContain('error')
  expect(writes).toEqual([4])
})

test('collaboration guard exemption preserves preview pause and resume', async () => {
  const { writes, statuses, update } = await mount(78, false)
  useScene.setState(graph(4))
  await update({ guardAgainstSceneWipe: false, isVersionPreviewMode: true })
  expect(statuses.at(-1)).toBe('paused')
  await Bun.sleep(1100)
  expect(writes).toEqual([])
  await update({ guardAgainstSceneWipe: false, isVersionPreviewMode: false })
  await Bun.sleep(1100)
  expect(writes).toEqual([4])
  expect(statuses.at(-1)).toBe('saved')
  expect(statuses).not.toContain('error')
})

test('changing guard ownership recovers an error and keeps the new stored baseline', async () => {
  const { writes, statuses, controls, update } = await mount(78)
  useScene.setState(graph(4))
  controls.saveNow()
  expect(statuses.at(-1)).toBe('error')
  await update({ guardAgainstSceneWipe: false })
  controls.saveNow()
  await Bun.sleep(0)
  expect(writes).toEqual([4])
  expect(statuses.at(-1)).toBe('saved')
  await update({ guardAgainstSceneWipe: true })
  useScene.setState(graph(3))
  controls.saveNow()
  await Bun.sleep(0)
  expect(writes).toEqual([4, 3])
  expect(statuses.at(-1)).toBe('saved')
})

test('collaboration callback failures still report error', async () => {
  const { writes, statuses, controls } = await mount(78, false, async () => {
    throw new Error('Collaboration failed')
  })
  useScene.setState(graph(4))
  controls.saveNow()
  await Bun.sleep(0)
  expect(writes).toEqual([4])
  expect(statuses).toEqual(['pending', 'saving', 'error'])
})
