import { beforeEach, expect, test } from 'bun:test'
import {
  clearSceneHistory,
  createSceneApi,
  emitter,
  type GridEvent,
  RockNode,
  SiteNode,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import {
  boundaryReshapeScope,
  cancelActiveTool,
  RegistryToolProvider,
  sceneLayout,
  useEditor,
  useInteractionScope,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { act } from '@react-three/test-renderer'
import { Vector3 } from 'three'
import { installMountedScene, mount, settle } from '../__tests__/harness'
import RockSelectionAffordance from './boundary-editor'
import { rockDefinition } from './definition'
import { createRockMoveSession } from './floorplan-move'
import RockTool from './tool'

// Real rock adapters and the shared PolygonEditor, with the repository's mounted
// R3F harness. This proves scene writes/ownership, not browser picking or GPU output.
installMountedScene({ nodes: [rockDefinition] })
const polygon: [number, number][] = [
  [-2, -2],
  [2, -2],
  [2, 2],
  [-2, 2],
]
let site: SiteNode
let rock: RockNode
beforeEach(() => {
  site = SiteNode.parse({})
  rock = RockNode.parse({ parentId: site.id, polygon, gen: 2 })
  useScene.setState({
    nodes: { [site.id]: { ...site, children: [rock.id] }, [rock.id]: rock },
    rootNodeIds: [site.id],
    dirtyNodes: new Set(),
    readOnly: false,
  })
  useScene.temporal.getState().resume()
  clearSceneHistory()
  useInteractionScope.getState().end()
  useEditor.setState({
    mode: 'select',
    tool: null,
    workspaceMode: 'edit',
    viewLayouts: { edit: sceneLayout('3d') },
    gridSnapStep: 0.5,
  })
  useEditor.getState().setSnappingMode('polygon', 'off')
  useViewer.getState().setSelection({ selectedIds: [rock.id] })
  window.requestAnimationFrame = globalThis.requestAnimationFrame
  window.cancelAnimationFrame = globalThis.cancelAnimationFrame
})

const preview = () => useLiveNodeOverrides.getState().get(rock.id)?.polygon
const handles = (renderer: Awaited<ReturnType<typeof mount>>) =>
  renderer.scene.findAll((entry) => typeof entry.props.onPointerDown === 'function')

for (const ending of ['pointerup', 'pointercancel', 'escape'] as const) {
  test(`3D corner ${ending}: transient preview, one commit or no write, and undo`, async () => {
    const renderer = await mount(<RockSelectionAffordance node={rock} readOnly={false} />)
    await settle(renderer)
    const vertex = handles(renderer).find((entry) => {
      const point = entry.instance.getWorldPosition(new Vector3())
      return Math.abs(point.x + 2) < 1e-6 && Math.abs(point.z + 2) < 1e-6
    })
    expect(vertex).toBeDefined()
    await renderer.fireEvent(vertex!, 'pointerDown', {
      button: 0,
      pointerId: 1,
      point: new Vector3(-2, 0, -2),
      nativeEvent: { button: 0, stopPropagation() {}, stopImmediatePropagation() {} },
      stopPropagation() {},
    })
    await act(async () => {
      emitter.emit('grid:move', {
        position: [-3, 0, -2],
        localPosition: [-3, 0, -2],
        nativeEvent: { altKey: true },
      } as GridEvent)
    })
    expect(preview()).toEqual([[-3, -2], ...polygon.slice(1)])
    expect(useScene.getState().nodes[rock.id]).toBe(rock)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    await act(async () => {
      if (ending === 'escape') cancelActiveTool()
      else
        window.dispatchEvent(
          Object.assign(new Event(ending, { cancelable: true }), { pointerId: 1 }),
        )
    })
    await settle(renderer)
    expect(preview()).toBeUndefined()
    expect(useInteractionScope.getState().scope.kind).toBe('idle')
    expect(useViewer.getState().inputDragging).toBe(false)
    if (ending === 'pointerup') {
      expect((useScene.getState().nodes[rock.id] as RockNode).polygon).toEqual([
        [-3, -2],
        ...polygon.slice(1),
      ])
      expect(useScene.temporal.getState().pastStates).toHaveLength(1)
      await act(async () => useScene.temporal.getState().undo())
      expect(useScene.getState().nodes[rock.id]).toEqual(rock)
    } else {
      expect(useScene.getState().nodes[rock.id]).toBe(rock)
      expect(useScene.temporal.getState().pastStates).toHaveLength(0)
      // A late pointerup cannot commit the cancelled internal PolygonEditor draft.
      await act(async () => window.dispatchEvent(new Event('pointerup', { cancelable: true })))
      expect(useScene.getState().nodes[rock.id]).toBe(rock)
    }
  })
}

test('2D-only, read-only and plan-owned reshapes do not mount a second 3D driver', async () => {
  for (const mode of ['2d', 'read-only', 'plan-owned'] as const) {
    useInteractionScope.getState().end()
    useEditor.setState({ viewLayouts: { edit: sceneLayout(mode === '2d' ? '2d' : 'split') } })
    if (mode === 'plan-owned')
      useInteractionScope.getState().begin(boundaryReshapeScope(rock.id, 'floorplan'))
    const renderer = await mount(
      <RockSelectionAffordance node={rock} readOnly={mode === 'read-only'} />,
    )
    await settle(renderer)
    expect(handles(renderer)).toEqual([])
    expect(useScene.getState().nodes[rock.id]).toBe(rock)
    await renderer.unmount()
  }
})

test('whole-rock moves preview only, respect Grid/Alt rather than held Shift, and undo once', () => {
  useInteractionScope.getState().begin(boundaryReshapeScope(rock.id))
  useEditor.getState().setSnappingMode('polygon', 'grid')
  const session = createRockMoveSession({ node: rock, nodes: useScene.getState().nodes } as never)
  const modifiers = { shiftKey: true, altKey: false, ctrlKey: false, metaKey: false }
  session.apply({ planPoint: [0, 0], modifiers } as never)
  session.apply({ planPoint: [0.73, 0.73], modifiers } as never)
  expect(preview()).toEqual(polygon.map(([x, z]) => [x + 0.5, z + 0.5]))
  session.apply({ planPoint: [0.73, 0.73], modifiers: { ...modifiers, altKey: true } } as never)
  expect(preview()).toEqual(polygon.map(([x, z]) => [x + 0.73, z + 0.73]))
  expect(useScene.getState().nodes[rock.id]).toBe(rock)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  expect(session.canCommit?.()).toBe(true)
  session.commit?.()
  expect(preview()).toBeUndefined()
  expect((useScene.getState().nodes[rock.id] as RockNode).polygon).toEqual(
    polygon.map(([x, z]) => [x + 0.73, z + 0.73]),
  )
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(useScene.getState().nodes[rock.id]).toEqual(rock)
})

test('the mounted 3D point-placement tool ignores 2D-only and forwarded SVG clicks', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'HTMLCanvasElement')
  class Canvas extends EventTarget {}
  Object.defineProperty(globalThis, 'HTMLCanvasElement', { configurable: true, value: Canvas })
  const selected: string[] = []
  useEditor.setState({ mode: 'build', tool: 'rock', viewLayouts: { edit: sceneLayout('2d') } })
  const renderer = await mount(
    <RegistryToolProvider
      value={{
        activeLevelId: null,
        sceneApi: createSceneApi(useScene),
        isCameraDragging: () => false,
        selectNode: (id) => selected.push(id),
        unit: 'metric',
      }}
    >
      <RockTool />
    </RegistryToolProvider>,
  )
  const click = (target: EventTarget) =>
    act(async () => {
      emitter.emit('grid:click', {
        position: [5, 0, 3],
        localPosition: [5, 0, 3],
        nativeEvent: { target, altKey: true, stopPropagation() {} },
        stopPropagation() {},
      } as unknown as GridEvent)
    })
  try {
    const before = useScene.getState().nodes
    await click(new Canvas())
    expect(useScene.getState().nodes).toBe(before)
    await act(async () => useEditor.setState({ viewLayouts: { edit: sceneLayout('split') } }))
    await click(new EventTarget())
    expect(useScene.getState().nodes).toBe(before)
    await click(new Canvas())
    const rocks = Object.values(useScene.getState().nodes).filter((node) => node.type === 'rock')
    expect(rocks).toHaveLength(2)
    expect(selected).toHaveLength(1)
    expect(rocks.find((node) => node.id === selected[0])).toMatchObject({
      parentId: site.id,
      gen: 2,
    })
    expect(useEditor.getState().tool).toBeNull()
  } finally {
    await renderer.unmount()
    if (descriptor) Object.defineProperty(globalThis, 'HTMLCanvasElement', descriptor)
    else Reflect.deleteProperty(globalThis, 'HTMLCanvasElement')
  }
})
