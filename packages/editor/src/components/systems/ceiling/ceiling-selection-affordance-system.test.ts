import { expect, test } from 'bun:test'
import {
  BuildingNode,
  CeilingNode,
  emitter,
  LevelNode,
  sceneRegistry,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { _roots, act, createRoot, events, extend, type RootState } from '@react-three/fiber'
import { createElement } from 'react'
import { Group, InstancedMesh, OrthographicCamera, Vector3, type WebGLRenderer } from 'three'
import { sfxEmitter } from '../../../lib/sfx-bus'
import useEditor from '../../../store/use-editor'
import useInteractionScope from '../../../store/use-interaction-scope'
import { clearBoxSelectHandled } from '../../tools/select/box-select-state'
import { CeilingSelectionAffordanceSystem } from './ceiling-selection-affordance-system'

extend({ Group })

type PointerHandler = 'onPointerMove' | 'onPointerDown' | 'onClick' | 'onPointerLeave'
type BracketHarness = {
  ceiling: CeilingNode
  level: LevelNode
  levelObject: Group
  state: () => RootState
  dispatch: (name: PointerHandler, x: number, z: number) => Promise<void>
  dispatchWindow: (type: string, x: number, z: number) => Promise<void>
  meshes: () => InstancedMesh[]
  clicks: any[]
  sounds: string[]
}

async function withMountedBrackets(run: (harness: BracketHarness) => Promise<void>) {
  const previousScene = useScene.getState()
  const previousViewer = useViewer.getState()
  const previousEditor = useEditor.getState()
  const previousScope = useInteractionScope.getState()
  const previousOverrides = useLiveNodeOverrides.getState()
  const previousWindow = globalThis.window
  const previousRaf = globalThis.requestAnimationFrame
  const frames: FrameRequestCallback[] = []
  globalThis.requestAnimationFrame = (callback) => frames.push(callback)
  const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true
  globalThis.window = new EventTarget() as Window & typeof globalThis
  const canvas = Object.assign(new EventTarget(), {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 1000 }),
  }) as unknown as HTMLCanvasElement
  const root = createRoot(canvas)
  const building = BuildingNode.parse({})
  const level = LevelNode.parse({ parentId: building.id, height: 3 })
  const ceiling = CeilingNode.parse({
    parentId: level.id,
    height: 3,
    polygon: [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ],
  })
  const levelObject = new Group()
  sceneRegistry.nodes.set(level.id, levelObject)
  const clicks: any[] = []
  const onClick = (event: unknown) => clicks.push(event)
  emitter.on('ceiling:click', onClick)
  const sounds: string[] = []
  const onSound = (type: string) => {
    sounds.push(type)
  }
  sfxEmitter.on('*', onSound)
  try {
    useScene.setState({
      nodes: { [building.id]: building, [level.id]: level, [ceiling.id]: ceiling },
    })
    useViewer.setState({
      hoveredId: null,
      selection: { buildingId: building.id, levelId: level.id, zoneId: null, selectedIds: [] },
    })
    useEditor.setState({ phase: 'structure', mode: 'select', structureLayer: 'elements' })
    useInteractionScope.setState({ scope: { kind: 'idle' } })
    const camera = Object.assign(new OrthographicCamera(-1, 5, 5, -1, 0.1, 100), { manual: true })
    camera.position.set(0, 10, 0)
    camera.up.set(0, 0, -1)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld(true)
    await root.configure({
      gl: {
        domElement: canvas,
        render() {},
        setSize() {},
        setPixelRatio() {},
      } as unknown as WebGLRenderer,
      camera,
      events,
      frameloop: 'never',
      dpr: 1,
      size: { width: 1000, height: 1000, top: 0, left: 0 },
    })
    await act(async () => root.render(createElement(CeilingSelectionAffordanceSystem)))
    const state = () => _roots.get(canvas)!.store.getState()
    const eventAt = (x: number, z: number) => {
      const point = new Vector3(x, 3, z).project(camera)
      return {
        target: canvas,
        pointerId: 1,
        button: 0,
        offsetX: (point.x + 1) * 500,
        offsetY: (1 - point.y) * 500,
        clientX: (point.x + 1) * 500,
        clientY: (1 - point.y) * 500,
        stopPropagation() {},
        preventDefault() {},
      } as unknown as PointerEvent
    }
    const dispatch = async (name: PointerHandler, x: number, z: number) => {
      sceneRegistry.nodes.get(level.id)?.updateMatrixWorld(true)
      await act(async () => state().events.handlers![name](eventAt(x, z)))
    }
    const dispatchWindow = async (type: string, x: number, z: number) => {
      const point = eventAt(x, z)
      const event = Object.assign(new Event(type, { cancelable: true }), {
        pointerId: 1,
        clientX: point.clientX,
        clientY: point.clientY,
      })
      await act(async () => {
        window.dispatchEvent(event)
      })
    }
    const meshes = () => state().internal.interaction as InstancedMesh[]
    await run({
      ceiling,
      level,
      levelObject,
      state,
      dispatch,
      dispatchWindow,
      meshes,
      clicks,
      sounds,
    })
  } finally {
    await act(async () => root.render(null))
    clearBoxSelectHandled()
    emitter.off('ceiling:click', onClick)
    sfxEmitter.off('*', onSound)
    for (const frame of frames) frame(0)
    globalThis.requestAnimationFrame = previousRaf
    sceneRegistry.nodes.delete(level.id)
    _roots.delete(canvas)
    useScene.setState(previousScene)
    useViewer.setState(previousViewer)
    useEditor.setState(previousEditor)
    useInteractionScope.setState(previousScope)
    useLiveNodeOverrides.setState(previousOverrides)
    globalThis.window = previousWindow
    actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct
  }
}

test('mounted brackets preserve hover, clicks, drags, capture visibility, overrides, and unmounting', async () => {
  await withMountedBrackets(
    async ({ ceiling, levelObject, state, dispatch, dispatchWindow, meshes, clicks, sounds }) => {
      expect(meshes()).toHaveLength(2)
      expect(meshes().every((mesh) => mesh instanceof InstancedMesh)).toBe(true)
      expect(meshes().reduce((sum, mesh) => sum + mesh.count, 0)).toBe(12)
      expect(meshes()[0]!.parent!.parent).toBe(levelObject)
      await dispatch('onPointerDown', 0, 0)
      await dispatch('onPointerMove', 0, 0)
      expect(useViewer.getState().hoveredId).toBe(ceiling.id)
      expect(meshes().find((mesh) => mesh.renderOrder === 1001)!.count).toBe(7)
      await dispatch('onPointerMove', 0, 0)
      expect(useViewer.getState().hoveredId).toBe(ceiling.id)
      await dispatch('onClick', 0, 0)
      expect(clicks).toHaveLength(1)
      expect(clicks[0]).toMatchObject({ viaHandle: true, node: ceiling, position: [0, 3, 0] })
      await dispatch('onClick', 4, 0)
      expect(clicks).toHaveLength(1)
      await dispatch('onPointerMove', 4, 0)
      expect(useViewer.getState().hoveredId).toBe(ceiling.id)
      await dispatch('onPointerDown', 4, 0)

      const oldNormal = meshes().find((mesh) => mesh.renderOrder === 1000)
      await act(async () => {
        const additions = Array.from({ length: 8 }, (_, index) =>
          CeilingNode.parse({
            ...ceiling,
            id: undefined,
            polygon: [
              [10 + index * 5, 0],
              [14 + index * 5, 0],
              [14 + index * 5, 4],
              [10 + index * 5, 4],
            ],
          }),
        )
        useScene.setState({
          nodes: {
            ...useScene.getState().nodes,
            ...Object.fromEntries(additions.map((node) => [node.id, node])),
          },
        })
      })
      expect(meshes()).toHaveLength(2)
      expect(meshes().find((mesh) => mesh.renderOrder === 1000)).not.toBe(oldNormal)
      expect(useViewer.getState().hoveredId).toBe(ceiling.id)
      await dispatch('onClick', 4, 0)
      expect(clicks).toHaveLength(2)
      expect(clicks[1].position).toEqual([4, 3, 0])
      await dispatch('onPointerLeave', 4, 0)
      expect(useViewer.getState().hoveredId).toBeNull()

      const bracketRoot = meshes()[0]!.parent!
      emitter.emit('thumbnail:before-capture')
      expect(bracketRoot.visible).toBe(false)
      emitter.emit('thumbnail:after-capture')
      expect(bracketRoot.visible).toBe(true)
      await act(async () =>
        useLiveNodeOverrides.getState().set(ceiling.id, {
          height: 5,
          polygon: [
            [1, 1],
            [4, 0],
            [4, 4],
            [0, 4],
          ],
        }),
      )
      await dispatch('onPointerMove', 1, 1)
      expect(useViewer.getState().hoveredId).toBe(ceiling.id)
      await dispatch('onPointerDown', 1, 1)
      await dispatch('onClick', 1, 1)
      expect(clicks[2].position).toEqual([1, 5, 1])
      await dispatchWindow('pointerup', 1, 1)
      await act(async () => useLiveNodeOverrides.getState().clear(ceiling.id))
      await dispatch('onPointerDown', 0, 0)
      const initialInputDragging = useViewer.getState().inputDragging
      await dispatchWindow('pointermove', 3 / (1000 / 6), 0)
      expect(sounds).not.toContain('sfx:item-pick')
      await dispatchWindow('pointermove', 0.5, 0.5)
      expect(useViewer.getState().inputDragging).toBe(true)
      expect(sounds).toContain('sfx:item-pick')
      expect(useLiveNodeOverrides.getState().overrides.get(ceiling.id)?.polygon).not.toEqual(
        ceiling.polygon,
      )
      expect(useScene.getState().nodes[ceiling.id]).toEqual(ceiling)
      await dispatchWindow('pointercancel', 0.5, 0.5)
      expect(useLiveNodeOverrides.getState().overrides.has(ceiling.id)).toBe(false)
      expect(useViewer.getState().inputDragging).toBe(initialInputDragging)
      expect(useScene.getState().nodes[ceiling.id]).toEqual(ceiling)
      await dispatch('onPointerDown', 0, 0)
      await dispatchWindow('pointermove', 0.5, 0.5)
      const preview = useLiveNodeOverrides.getState().overrides.get(ceiling.id)
        ?.polygon as CeilingNode['polygon']
      expect(preview).toBeDefined()
      await dispatchWindow('pointerup', 0.5, 0.5)
      expect((useScene.getState().nodes[ceiling.id] as CeilingNode).polygon).toEqual(preview)
      expect(useLiveNodeOverrides.getState().overrides.has(ceiling.id)).toBe(false)
      expect(useViewer.getState().inputDragging).toBe(initialInputDragging)
      expect(sounds).toContain('sfx:item-place')
      const corner = preview[0]!
      await dispatch('onPointerDown', corner[0], corner[1])
      await dispatchWindow('pointermove', corner[0] + 0.5, corner[1] + 0.5)
      expect(useViewer.getState().inputDragging).toBe(true)
      await act(async () => useEditor.setState({ mode: 'build' }))
      expect(useLiveNodeOverrides.getState().overrides.has(ceiling.id)).toBe(false)
      expect(useViewer.getState().inputDragging).toBe(initialInputDragging)
      expect(state().internal.interaction).toHaveLength(0)
      expect(levelObject.children).toHaveLength(0)
      expect(useViewer.getState().hoveredId).toBeNull()
    },
  )
})

test('coincident ceiling corners keep the same hover, click, and drag owner across batch transfers', async () => {
  await withMountedBrackets(async ({ ceiling, dispatch, dispatchWindow, meshes, clicks }) => {
    const adjacent = CeilingNode.parse({
      ...ceiling,
      id: undefined,
      polygon: [
        [0, 0],
        [-4, 0],
        [-4, -4],
        [0, -4],
      ],
    })
    await act(async () =>
      useScene.setState({
        nodes: { ...useScene.getState().nodes, [adjacent.id]: adjacent },
      }),
    )
    const owner = ceiling.id < adjacent.id ? ceiling : adjacent
    const other = owner === ceiling ? adjacent : ceiling
    for (let move = 0; move < 20; move++) {
      await dispatch('onPointerMove', 0, 0)
      expect(useViewer.getState().hoveredId).toBe(owner.id)
      expect(meshes().find((mesh) => mesh.renderOrder === 1001)!.count).toBe(7)
    }
    await dispatch('onPointerDown', 0, 0)
    await dispatch('onClick', 0, 0)
    expect(clicks[0].node.id).toBe(owner.id)
    await dispatchWindow('pointermove', 0.5, 0.5)
    expect(useLiveNodeOverrides.getState().overrides.has(owner.id)).toBe(true)
    expect(useLiveNodeOverrides.getState().overrides.has(other.id)).toBe(false)
    await dispatchWindow('pointercancel', 0.5, 0.5)
    await dispatch('onPointerLeave', 0, 0)
    expect(useViewer.getState().hoveredId).toBeNull()
  })
})

test('same-id registry replacement rebinds the portal and drag plane without rewriting instance data', async () => {
  await withMountedBrackets(
    async ({ ceiling, level, levelObject, state, dispatch, dispatchWindow, meshes, clicks }) => {
      const initialMeshes = [...meshes()]
      const geometries = initialMeshes.map((mesh) => mesh.geometry)
      const versions = initialMeshes.map((mesh) => mesh.instanceMatrix.version)
      const replacement = new Group()
      replacement.position.set(10, 0, 20)
      replacement.rotation.y = Math.PI / 2
      sceneRegistry.nodes.set(level.id, replacement)
      await act(async () => state().advance(1))
      expect(levelObject.children).toHaveLength(0)
      expect(replacement.children).toHaveLength(1)
      expect(meshes()).toEqual(initialMeshes)
      expect(meshes().map((mesh) => mesh.geometry)).toEqual(geometries)
      expect(meshes().map((mesh) => mesh.instanceMatrix.version)).toEqual(versions)
      for (let frame = 2; frame < 6; frame++) {
        await act(async () => state().advance(frame))
      }
      expect(meshes().map((mesh) => mesh.instanceMatrix.version)).toEqual(versions)
      await dispatch('onPointerDown', 10, 20)
      await dispatch('onClick', 10, 20)
      expect(clicks[0].position).toEqual([0, 3, 0])
      await dispatchWindow('pointermove', 10.5, 20)
      const preview = useLiveNodeOverrides.getState().overrides.get(ceiling.id)
        ?.polygon as CeilingNode['polygon']
      expect(preview[0]![0]).toBeCloseTo(0, 6)
      expect(preview[0]![1]).toBeCloseTo(0.5, 6)
      await dispatchWindow('pointercancel', 10.5, 20)
    },
  )
})
