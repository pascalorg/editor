import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import {
  type AnyNodeId,
  BlockNode,
  type BlockTopology,
  BuildingNode,
  createBoxBlockTopology,
  createSceneApi,
  getEffectiveNode,
  ItemNode,
  LevelNode,
  nodeRegistry,
  registerNode,
  runAsSingleSceneHistoryStep,
  SiteNode,
  sceneRegistry,
  spatialGridManager,
  useLiveNodeOverrides,
  useLiveTransforms,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import { ProceduralItemNode, type Recipe } from '@pascal-app/core/procedural-items'
import { meshEditScope } from '@pascal-app/editor'
import { NodeRenderer, useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { act, create } from '@react-three/test-renderer'
import { type ReactNode, useMemo, useRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { BoxGeometry, type Camera, Group, Mesh, MeshBasicMaterial, Ray, Vector3 } from 'three'
import useEditor from '../../../editor/src/store/use-editor'
import useInteractionScope from '../../../editor/src/store/use-interaction-scope'
import { GeometrySystem } from '../../../viewer/src/systems/geometry/geometry-system'
import { ItemSystem } from '../../../viewer/src/systems/item/item-system'
import useBlockEditSession from '../block/edit-session'
import { BLOCK_SUPPORT_REFUSAL } from '../block/hosted-edit'
import BlockSelectionAffordance from '../block/selection'
import { blockGizmoDimensions } from '../block/toolbar-state'
import { builtinPlugin } from '../index'
import { ItemGLTFLoader } from '../item/model-loader'
import { getDefaultPanelMaterial } from '../solar-panel/geometry'

// Other node tests install process-global renderer mocks; this audit must observe production modules.
if (process.env.PASCAL_BLOCK_EDIT_AUDIT2_ISOLATED !== '1') {
  test('second block edit audit with production registrations', async () => {
    const child = Bun.spawn(
      [process.execPath, 'run', 'test', 'src/__tests__/block-edit-audit2.test.tsx'],
      {
        cwd: new URL('../..', import.meta.url).pathname,
        env: { ...process.env, PASCAL_BLOCK_EDIT_AUDIT2_ISOLATED: '1' },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    console.log(stdout)
    console.log(
      stderr
        .split('\n')
        .filter(
          (line) =>
            !line.startsWith('The current testing environment') &&
            !line.startsWith('[zustand persist') &&
            !line.startsWith('THREE.Clock'),
        )
        .join('\n'),
    )
    expect(code).toBe(0)
  }, 120_000)
} else {
  const recipe: Recipe = {
    version: 1,
    name: 'Audit box',
    description: '',
    constraints: [],
    parameters: [
      { id: 'width', label: 'Width', default: 0.1, min: 0.05, max: 1, step: 0.05, unit: 'm' },
    ],
    slots: [{ id: 'body', label: 'Body', color: '#ffffff' }],
    parts: [
      {
        id: 'body',
        label: 'Body',
        count: 1,
        shapes: [
          {
            id: 'box',
            primitive: 'box',
            size: [0.1, 0.2, 0.1],
            position: [0, 0.1, 0],
            slot: 'body',
          },
        ],
      },
    ],
    surfaces: [],
  }
  const asset = {
    id: 'audit-box',
    name: 'Audit box',
    category: 'decor',
    thumbnail: '',
    src: '/unrenderable-host-audit.glb',
    dimensions: [0.1, 0.2, 0.1] as [number, number, number],
  }
  const site = SiteNode.parse({})
  const building = BuildingNode.parse({ parentId: site.id })
  const level = LevelNode.parse({ parentId: building.id })
  let savedScene: ReturnType<typeof useScene.getState>
  let savedEditor: ReturnType<typeof useEditor.getState>
  let savedViewer: ReturnType<typeof useViewer.getState>
  let savedScope: ReturnType<typeof useInteractionScope.getState>
  let restoreRegistry: () => void
  let restoreGlobals: () => void
  let loadModel: ReturnType<typeof spyOn>
  let htmlLabels: ReturnType<typeof spyOn>

  beforeEach(() => {
    htmlLabels = spyOn(Html as unknown as { render: () => ReactNode }, 'render').mockImplementation(
      (props: { children: ReactNode }) => (
        <group userData={{ ui: renderToStaticMarkup(props.children) }} />
      ),
    )
    savedScene = useScene.getState()
    savedEditor = useEditor.getState()
    savedViewer = useViewer.getState()
    savedScope = useInteractionScope.getState()
    useBlockEditSession.setState({
      nodeId: null,
      lastOperation: null,
      selection: { mode: 'face', ids: [], activeId: null },
    })
    const names = [
      'window',
      'document',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'HTMLElement',
      'HTMLInputElement',
      'HTMLTextAreaElement',
    ] as const
    const descriptors = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name))
    restoreGlobals = () =>
      names.forEach((name, i) => {
        const descriptor = descriptors[i]
        if (descriptor) Object.defineProperty(globalThis, name, descriptor)
        else Reflect.deleteProperty(globalThis, name)
      })
    for (const name of ['HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement'])
      Object.defineProperty(globalThis, name, { configurable: true, value: class {} })
    globalThis.window = new EventTarget() as Window & typeof globalThis
    globalThis.document = {
      body: { style: { cursor: '' } },
      createElement: (tag: string) => {
        if (tag !== 'canvas') throw new Error(`Unexpected DOM element: ${tag}`)
        const context = new Proxy(
          {},
          {
            get: (_target, key) =>
              key === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {},
          },
        )
        return { width: 0, height: 0, getContext: () => context }
      },
    } as unknown as Document
    getDefaultPanelMaterial()
    Reflect.deleteProperty(globalThis.document, 'createElement')
    globalThis.requestAnimationFrame = () => 0
    globalThis.cancelAnimationFrame = () => {}
    loadModel = spyOn(ItemGLTFLoader.prototype, 'load').mockImplementation((_url, onLoad) => {
      const scene = new Group()
      scene.add(
        new Mesh(new BoxGeometry(0.1, 0.2, 0.1).translate(0, 0.1, 0), new MeshBasicMaterial()),
      )
      onLoad({
        scene,
        scenes: [scene],
        animations: [],
        cameras: [],
        asset: { version: '2.0' },
        parser: {},
      } as never)
    })
    restoreRegistry = nodeRegistry._snapshot()
    nodeRegistry._reset()
    for (const def of builtinPlugin.nodes!) registerNode(def)
  })
  afterEach(() => {
    htmlLabels.mockRestore()
    loadModel.mockRestore()
    sceneRegistry.nodes.clear()
    spatialGridManager.clear()
    useLiveNodeOverrides.getState().clearAll()
    useLiveTransforms.getState().clearAll()
    useScene.temporal.getState().resume()
    useScene.temporal.getState().clear()
    useScene.setState(savedScene)
    useEditor.setState(savedEditor)
    useViewer.setState(savedViewer)
    useInteractionScope.setState(savedScope)
    restoreRegistry()
    restoreGlobals()
  })

  const services = () => ({
    sceneApi: createSceneApi(useScene),
    readOnly: false,
    historyApi: {
      depth: () => useScene.temporal.getState().pastStates.length,
      replaceLatest: (depth: number, replace: () => boolean) => {
        if (depth !== useScene.temporal.getState().pastStates.length) return false
        let ok = false
        runAsSingleSceneHistoryStep(useScene, () => {
          useScene.temporal.getState().undo()
          ok = replace()
          if (!ok) useScene.temporal.getState().redo()
        })
        return ok
      },
    },
  })
  let api: ReturnType<typeof services>
  const interactionApi = { beginInputDrag: () => () => {}, clearSelection() {} }
  let viewCamera: Camera
  function Scene({ id, editing = true }: { id: AnyNodeId; editing?: boolean }) {
    const children = useScene((s) => (s.nodes[level.id] as LevelNode).children)
    const host = useScene((s) => s.nodes[id])!
    const ref = useRef<Group>(null!)
    useRegistry(level.id, 'level', ref)
    const { camera, gl } = useThree()
    viewCamera = camera
    useMemo(() => {
      camera.position.set(4, 5, 6)
      camera.lookAt(0, 1, 0)
      camera.updateMatrixWorld()
      gl.domElement.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 1000, height: 1000 }) as DOMRect
    }, [camera, gl])
    return (
      <>
        <group ref={ref}>
          {children.map((id) => (
            <NodeRenderer key={id} nodeId={id} />
          ))}
        </group>
        {editing && (
          <BlockSelectionAffordance {...api} node={host} interactionApi={interactionApi} />
        )}
        <GeometrySystem />
        <ItemSystem />
      </>
    )
  }
  function seed(
    kind: 'catalog' | 'generated' | 'none' = 'catalog',
    x = 0.5,
    topology = createBoxBlockTopology(2, 1.5, 2),
  ) {
    const host = BlockNode.parse({ parentId: level.id, topology })
    const child =
      kind === 'generated'
        ? ProceduralItemNode.parse({ parentId: host.id, recipe, position: [x, 1.5, 0] })
        : ItemNode.parse({
            parentId: host.id,
            asset,
            blockFaceId: 'f-top',
            position: [x, 0, 0],
            rotation: [Math.PI / 2, 0, 0],
          })
    const entries = [
      { ...site, children: [building.id] },
      { ...building, children: [level.id] },
      { ...level, children: [host.id] },
      { ...host, children: kind === 'none' ? [] : [child.id] },
      ...(kind === 'none' ? [] : [child]),
    ]
    useScene.setState({
      nodes: Object.fromEntries(entries.map((n) => [n.id, n])),
      rootNodeIds: [site.id],
      dirtyNodes: new Set(entries.map((n) => n.id)),
      readOnly: false,
      materials: {},
      collections: {},
      installedPlugins: [],
    })
    useScene.temporal.getState().resume()
    useScene.temporal.getState().clear()
    useEditor.setState({ mode: 'select', tool: null, viewMode: '3d' })
    useViewer.setState({
      textures: false,
      showZones: false,
      showMeasurements: false,
      selection: {
        buildingId: building.id,
        levelId: level.id,
        zoneId: null,
        selectedIds: [host.id],
      },
    })
    useBlockEditSession
      .getState()
      .begin(host.id, { mode: 'face', ids: ['f-top'], activeId: 'f-top' })
    useInteractionScope.getState().begin(meshEditScope(host.id))
    api = services()
    return { host: useScene.getState().nodes[host.id] as BlockNode, child }
  }
  async function settle(renderer: Awaited<ReturnType<typeof create>>) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5))
    })
    await act(async () => renderer.advanceFrames(3, 1 / 60))
  }
  async function key(key: string, extra = {}) {
    await act(async () =>
      window.dispatchEvent(
        Object.assign(new Event('keydown', { cancelable: true }), { key, ...extra }),
      ),
    )
  }
  async function keys(input: string[]) {
    for (const k of input) await key(k)
  }
  const nodes = () => JSON.parse(JSON.stringify(useScene.getState().nodes))
  function ui(renderer: Awaited<ReturnType<typeof create>>) {
    const text: string[] = []
    renderer.scene.instance.traverse((o) => {
      if (o.userData.ui) text.push(o.userData.ui)
    })
    return text.join(' ')
  }

  function client(point: Vector3) {
    const projected = point.clone().project(viewCamera)
    return { clientX: (projected.x + 1) * 500, clientY: (1 - projected.y) * 500 }
  }
  async function pointer(type: string, point?: Vector3) {
    await act(async () =>
      window.dispatchEvent(
        Object.assign(new Event(type, { cancelable: true }), {
          button: 0,
          altKey: true,
          ...(point ? client(point) : {}),
        }),
      ),
    )
  }
  async function beginDrag(
    renderer: Awaited<ReturnType<typeof create>>,
    operation: string,
    origin: Vector3,
  ) {
    const shape =
      operation === 'rotate'
        ? 'TorusGeometry'
        : operation === 'scale'
          ? 'SphereGeometry'
          : 'CylinderGeometry'
    const color = operation === 'rotate' ? '#2080ff' : '#ff2060'
    const handle = renderer.scene
      .findAll((n) => n.props.renderOrder === 1301)
      .find(
        (n) =>
          (n.instance as Mesh).geometry?.type === shape &&
          ((n.instance as Mesh).material as MeshBasicMaterial).color?.getHexString() ===
            color.slice(1),
      )!
    expect(handle).toBeDefined()
    const point = origin.clone().add(new Vector3(1, 0, 0))
    await renderer.fireEvent(handle, 'pointerDown', {
      point,
      ray: new Ray(viewCamera.position.clone(), point.clone().sub(viewCamera.position).normalize()),
      nativeEvent: { button: 0, altKey: true, ...client(point), stopImmediatePropagation() {} },
    })
  }
  function dragPoint(operation: string, value: number, origin: Vector3) {
    if (operation === 'rotate') {
      const radians = (value * Math.PI) / 180
      return origin.clone().add(new Vector3(Math.cos(radians), Math.sin(radians), 0))
    }
    const offset = operation === 'scale' ? (value - 1) * blockGizmoDimensions(2).length : value
    return origin.clone().add(new Vector3(1 + offset, 0, 0))
  }
  for (const operation of ['rotate', 'translate', 'scale'])
    for (const sequence of ['accepted then refused', 'refused first', 'refused then corrected'])
      test(`BlockEditor drag ${operation}: ${sequence}`, async () => {
        const { host } = seed('catalog')
        if (operation === 'translate')
          useBlockEditSession.getState().setSelection(host.id, {
            mode: 'face',
            ids: ['f-right'],
            activeId: 'f-right',
          })
        const renderer = await create(<Scene id={host.id} />)
        let writes = 0
        const unsubscribe = useScene.subscribe((next, prev) => {
          if (next.nodes !== prev.nodes) writes++
        })
        try {
          await settle(renderer)
          const before = nodes()
          writes = 0
          const origin =
            operation === 'translate' ? new Vector3(1, 0.75, 0) : new Vector3(0, 1.5, 0)
          await beginDrag(renderer, operation, origin)
          const acceptedValue = operation === 'rotate' ? 10 : operation === 'translate' ? -0.2 : 0.8
          const refusedValue = operation === 'rotate' ? 50 : operation === 'translate' ? -1.5 : 0.2
          let accepted: BlockTopology | null = null
          if (sequence !== 'refused first') {
            await pointer('pointermove', dragPoint(operation, acceptedValue, origin))
            await settle(renderer)
            expect(ui(renderer).includes(BLOCK_SUPPORT_REFUSAL)).toBe(false)
            accepted = getEffectiveNode(useScene.getState().nodes[host.id] as BlockNode).topology
            expect(accepted).not.toEqual(host.topology)
          }
          await pointer('pointermove', dragPoint(operation, refusedValue, origin))
          await settle(renderer)
          expect(ui(renderer).includes(BLOCK_SUPPORT_REFUSAL)).toBe(true)
          expect(writes).toBe(0)
          expect(nodes()).toEqual(before)
          expect(
            getEffectiveNode(useScene.getState().nodes[host.id] as BlockNode).topology,
          ).toEqual(accepted ?? host.topology)
          if (sequence === 'refused then corrected') {
            await pointer('pointermove', dragPoint(operation, acceptedValue, origin))
            await settle(renderer)
            expect(ui(renderer).includes(BLOCK_SUPPORT_REFUSAL)).toBe(false)
          }
          await pointer('pointerup')
          await settle(renderer)
          expect(writes).toBe(accepted ? 1 : 0)
          expect((useScene.getState().nodes[host.id] as BlockNode).topology).toEqual(
            accepted ?? host.topology,
          )
          expect(useScene.temporal.getState().pastStates).toHaveLength(accepted ? 1 : 0)
          expect(useInteractionScope.getState().scope).toMatchObject({ phase: 'selecting' })
          expect(useLiveNodeOverrides.getState().overrides.size).toBe(0)
          expect(ui(renderer).includes(BLOCK_SUPPORT_REFUSAL)).toBe(false)
          if (accepted) {
            const label =
              operation === 'rotate'
                ? 'Angle'
                : operation === 'translate'
                  ? 'X distance'
                  : 'X scale'
            expect(ui(renderer)).toContain(`aria-label="${label}"`)
            expect(ui(renderer)).toContain(`value="${acceptedValue}"`)
          }
        } finally {
          unsubscribe()
          await renderer.unmount()
        }
      })

  for (const entry of [
    { name: 'sign after .1', input: ['0', '.', '1', '-'], amount: 0.1, dirty: 4 },
    { name: 'sign after .25', input: ['0', '.', '2', '5', '-'], amount: 0.25, dirty: 5 },
    { name: 'negative without accepted value', input: ['-', '.', '1'], amount: null, dirty: 3 },
  ])
    test(`childless malformed inset: ${entry.name} matches main counts`, async () => {
      const { host } = seed('none')
      const renderer = await create(<Scene id={host.id} />)
      const dirty = spyOn(api.sceneApi, 'markDirty'),
        write = spyOn(api.sceneApi, 'update'),
        batch = spyOn(api.sceneApi, 'applyChanges')
      try {
        await settle(renderer)
        dirty.mockClear()
        write.mockClear()
        batch.mockClear()
        await keys(['i', ...entry.input])
        await settle(renderer)
        const preview = getEffectiveNode(useScene.getState().nodes[host.id] as BlockNode).topology
        if (entry.amount !== null) expect(preview).not.toEqual(host.topology)
        else expect(preview).toEqual(host.topology)
        expect(ui(renderer).includes(BLOCK_SUPPORT_REFUSAL)).toBe(false)
        await key('Enter')
        await settle(renderer)
        expect(useInteractionScope.getState().scope).toMatchObject({ phase: 'selecting' })
        expect((useScene.getState().nodes[host.id] as BlockNode).topology).toEqual(preview)
        if (entry.amount !== null)
          expect(useBlockEditSession.getState().lastOperation?.command).toMatchObject({
            type: 'inset-faces',
            amount: entry.amount,
          })
        else expect(useBlockEditSession.getState().lastOperation).toBeNull()
        expect(dirty).toHaveBeenCalledTimes(entry.dirty)
        expect(write).toHaveBeenCalledTimes(entry.amount === null ? 0 : 1)
        expect(batch).toHaveBeenCalledTimes(0)
        expect(useScene.temporal.getState().pastStates).toHaveLength(entry.amount === null ? 0 : 1)
        expect(useLiveNodeOverrides.getState().overrides.size).toBe(0)
      } finally {
        dirty.mockRestore()
        write.mockRestore()
        batch.mockRestore()
        await renderer.unmount()
      }
    })

  for (const operation of ['rotate', 'translate', 'scale'])
    for (const finish of ['pointerup', 'pointercancel'])
      test(`childless drag ${operation} ${finish}: main write and dirty counts`, async () => {
        const { host } = seed('none')
        if (operation === 'translate')
          useBlockEditSession.getState().setSelection(host.id, {
            mode: 'face',
            ids: ['f-right'],
            activeId: 'f-right',
          })
        const renderer = await create(<Scene id={host.id} />)
        const dirty = spyOn(api.sceneApi, 'markDirty'),
          write = spyOn(api.sceneApi, 'update'),
          batch = spyOn(api.sceneApi, 'applyChanges')
        try {
          await settle(renderer)
          dirty.mockClear()
          write.mockClear()
          batch.mockClear()
          const origin =
            operation === 'translate' ? new Vector3(1, 0.75, 0) : new Vector3(0, 1.5, 0)
          await beginDrag(renderer, operation, origin)
          for (const value of operation === 'rotate'
            ? [10, 50]
            : operation === 'translate'
              ? [-0.2, -1.5]
              : [0.8, 0.2]) {
            await pointer('pointermove', dragPoint(operation, value, origin))
            await settle(renderer)
          }
          const preview = getEffectiveNode(useScene.getState().nodes[host.id] as BlockNode).topology
          expect(write).toHaveBeenCalledTimes(0)
          expect(dirty).toHaveBeenCalledTimes(2)
          await pointer(finish)
          await settle(renderer)
          expect(dirty).toHaveBeenCalledTimes(3)
          expect(write).toHaveBeenCalledTimes(finish === 'pointerup' ? 1 : 0)
          expect(batch).toHaveBeenCalledTimes(0)
          expect(useScene.temporal.getState().pastStates).toHaveLength(
            finish === 'pointerup' ? 1 : 0,
          )
          expect((useScene.getState().nodes[host.id] as BlockNode).topology).toEqual(
            finish === 'pointerup' ? preview : host.topology,
          )
          expect(useLiveNodeOverrides.getState().overrides.size).toBe(0)
          expect(useInteractionScope.getState().scope).toMatchObject({ phase: 'selecting' })
        } finally {
          dirty.mockRestore()
          write.mockRestore()
          batch.mockRestore()
          await renderer.unmount()
        }
      })

  test('generated child: a refused first rotation tick releases without writes or stale feedback', async () => {
    const { host } = seed('generated')
    const renderer = await create(<Scene id={host.id} />)
    let writes = 0
    const unsubscribe = useScene.subscribe((next, prev) => {
      if (next.nodes !== prev.nodes) writes++
    })
    try {
      await settle(renderer)
      const before = nodes()
      writes = 0
      const origin = new Vector3(0, 1.5, 0)
      await beginDrag(renderer, 'rotate', origin)
      await pointer('pointermove', dragPoint('rotate', 10, origin))
      await settle(renderer)
      expect(ui(renderer).includes(BLOCK_SUPPORT_REFUSAL)).toBe(true)
      await pointer('pointerup')
      await settle(renderer)
      expect(nodes()).toEqual(before)
      expect(writes).toBe(0)
      expect(useScene.temporal.getState().pastStates).toHaveLength(0)
      expect(useInteractionScope.getState().scope).toMatchObject({ phase: 'selecting' })
      expect(useLiveNodeOverrides.getState().overrides.size).toBe(0)
      expect(ui(renderer).includes(BLOCK_SUPPORT_REFUSAL)).toBe(false)
    } finally {
      unsubscribe()
      await renderer.unmount()
    }
  })
}
