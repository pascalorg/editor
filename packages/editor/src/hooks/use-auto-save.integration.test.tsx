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
const previousScene = useScene.getState()
let renderer: Awaited<ReturnType<typeof create>> | undefined

afterEach(async () => {
  await renderer?.unmount()
  renderer = undefined
  globalThis.window = originalWindow
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

async function mount(
  loadedCount: number,
  guardAgainstSceneWipe?: boolean,
  save?: () => Promise<void>,
) {
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
  useScene.setState(graph(loadedCount))
  clearSceneHistory()
  controls!.isLoadingSceneRef.current = false
  statuses.length = 0
  return {
    writes,
    statuses,
    controls: controls!,
    update: (props: { guardAgainstSceneWipe?: boolean; isVersionPreviewMode?: boolean }) =>
      renderer!.update(<Host {...props} />),
  }
}

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
