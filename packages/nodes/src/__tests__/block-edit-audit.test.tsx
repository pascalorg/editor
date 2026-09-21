import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import * as core from '@pascal-app/core'
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
  resolveSurfacePlacement,
  runAsSingleSceneHistoryStep,
  SiteNode,
  sceneRegistry,
  spatialGridManager,
  useLiveNodeOverrides,
  useLiveTransforms,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import { nodeLevelFrame, ProceduralItemNode, type Recipe } from '@pascal-app/core/procedural-items'
import { meshEditScope } from '@pascal-app/editor'
import { NodeRenderer, useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { act, create } from '@react-three/test-renderer'
import React, { type ReactNode, useMemo, useRef } from 'react'
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Ray, Vector3 } from 'three'
import useEditor from '../../../editor/src/store/use-editor'
import useInteractionScope from '../../../editor/src/store/use-interaction-scope'
import { GeometrySystem } from '../../../viewer/src/systems/geometry/geometry-system'
import { ItemSystem } from '../../../viewer/src/systems/item/item-system'
import { applyBlockCommand } from '../block/commands'
import useBlockEditSession from '../block/edit-session'
import { BLOCK_SUPPORT_REFUSAL, planBlockTopologyEdit } from '../block/hosted-edit'
import BlockSelectionAffordance from '../block/selection'
import { builtinPlugin } from '../index'
import { ItemGLTFLoader } from '../item/model-loader'
import { getDefaultPanelMaterial } from '../solar-panel/geometry'

function htmlText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(htmlText).join(' ')
  if (React.isValidElement<{ children?: ReactNode }>(node)) return htmlText(node.props.children)
  return ''
}
// Other node tests install process-global renderer mocks; this audit must observe production modules.
if (process.env.PASCAL_BLOCK_EDIT_AUDIT_ISOLATED !== '1') {
  test('block edit audit with production registrations', async () => {
    const child = Bun.spawn(
      [process.execPath, 'run', 'test', 'src/__tests__/block-edit-audit.test.tsx'],
      {
        cwd: new URL('../..', import.meta.url).pathname,
        env: { ...process.env, PASCAL_BLOCK_EDIT_AUDIT_ISOLATED: '1' },
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
      (props: { children: ReactNode }) => <group userData={{ ui: htmlText(props.children) }} />,
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
  const mounts = new Set<Promise<Awaited<ReturnType<typeof create>>>>()
  const workSpies: Array<{ mockRestore(): void }> = []
  function ownSpy<T extends { mockRestore(): void }>(spy: T): T {
    workSpies.push(spy)
    return spy
  }
  async function mount(element: React.ReactElement) {
    const pending = create(element)
    mounts.add(pending)
    const renderer = await pending
    const unmount = renderer.unmount.bind(renderer)
    renderer.unmount = async () => {
      if (mounts.delete(pending)) await unmount()
    }
    return renderer
  }
  afterEach(async () => {
    for (const pending of mounts) await (await pending).unmount()
    for (const spy of workSpies.splice(0).reverse()) spy.mockRestore()
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
  function Scene({ id, editing = true }: { id: AnyNodeId; editing?: boolean }) {
    const children = useScene((s) => (s.nodes[level.id] as LevelNode).children)
    const host = useScene((s) => s.nodes[id])!
    const ref = useRef<Group>(null!)
    useRegistry(level.id, 'level', ref)
    const { camera, gl } = useThree()
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
  function pose(id: AnyNodeId) {
    const object = sceneRegistry.nodes.get(id)!
    object.updateWorldMatrix(true, true)
    return object.getWorldPosition(new Vector3()).toArray()
  }
  function valid(hostId: AnyNodeId, childId: AnyNodeId) {
    const host = useScene.getState().nodes[hostId] as BlockNode
    const child = useScene.getState().nodes[childId]
    if (child?.type === 'item')
      return nodeRegistry.get('block')!.capabilities.faceHost!.isStoredPlacementValid!({
        host,
        item: child,
        asset: child.asset,
        dimensions: child.asset.dimensions,
      } as never)
    if (child?.type !== 'procedural-item') throw Error('missing child')
    const placement = resolveSurfacePlacement({
      host,
      childKind: child.type,
      childId,
      childFootprint: { size: [0.1, 0.2, 0.1], rotationY: child.rotation[1] },
      hit: { point: child.position, normalWorldY: 1 },
      scene: api.sceneApi,
    })
    return !!placement && Math.abs(placement.position[1] - child.position[1]) < 1e-5
  }
  async function reload(
    renderer: Awaited<ReturnType<typeof create>>,
    hostId: AnyNodeId,
    childId?: AnyNodeId,
  ) {
    const saved = nodes()
    const before = childId ? pose(childId) : null
    await renderer.unmount()
    useScene.setState({ nodes: saved, dirtyNodes: new Set(Object.keys(saved) as AnyNodeId[]) })
    const next = await mount(<Scene id={hostId} editing={false} />)
    await settle(next)
    expect(nodes()).toEqual(saved)
    if (childId) {
      expect(pose(childId)).toEqual(before)
      expect(valid(hostId, childId)).toBe(true)
    }
    return next
  }

  for (const kind of ['catalog', 'generated'] as const)
    test(`BlockEditor: ${kind} top tilt respects stored support and reload`, async () => {
      const { host, child } = seed(kind)
      let renderer = await mount(<Scene id={host.id} />)
      try {
        await settle(renderer)
        const before = nodes()
        await keys(['r', 'z', '1', '0'])
        await settle(renderer)
        await key('Enter')
        await settle(renderer)
        if (kind === 'catalog') {
          expect(useScene.getState().nodes[child.id]).toEqual(before[child.id])
          expect(useScene.temporal.getState().pastStates).toHaveLength(1)
          expect(valid(host.id, child.id)).toBe(true)
          const frame = nodeLevelFrame(child.id, useScene.getState().nodes)
          pose(child.id).forEach((v, i) => {
            expect(v).toBeCloseTo(frame.position[i]!, 8)
          })
        } else {
          expect(nodes()).toEqual(before)
          expect(ui(renderer)).toContain(BLOCK_SUPPORT_REFUSAL)
          expect(useScene.temporal.getState().pastStates).toHaveLength(0)
          await key('Escape')
        }
        renderer = await reload(renderer, host.id, child.id)
      } finally {
        await renderer.unmount()
      }
    })
  for (const finish of ['Escape', 'correct'])
    test(`BlockEditor: refused inset .19 stays open; ${finish}`, async () => {
      const { host, child } = seed('catalog', -0.85)
      let renderer = await mount(<Scene id={host.id} />)
      try {
        await settle(renderer)
        const before = nodes()
        await keys(['i', '0', '.', '1'])
        await settle(renderer)
        expect(ui(renderer)).toContain('0.1')
        await key('9')
        await settle(renderer)
        expect(ui(renderer)).toContain(BLOCK_SUPPORT_REFUSAL)
        await key('Enter')
        await settle(renderer)
        expect(nodes()).toEqual(before)
        expect(useInteractionScope.getState().scope).toMatchObject({ phase: 'operating' })
        expect(ui(renderer)).toContain(BLOCK_SUPPORT_REFUSAL)
        if (finish === 'correct') {
          await key('Backspace')
          await settle(renderer)
          expect(ui(renderer)).not.toContain(BLOCK_SUPPORT_REFUSAL)
          await key('Enter')
          await settle(renderer)
          expect(useBlockEditSession.getState().lastOperation?.command).toMatchObject({
            type: 'inset-faces',
            amount: 0.1,
          })
          expect(useScene.temporal.getState().pastStates).toHaveLength(1)
        } else {
          await key('Escape')
          await settle(renderer)
          expect(nodes()).toEqual(before)
          expect(useLiveNodeOverrides.getState().overrides.size).toBe(0)
        }
        renderer = await reload(renderer, host.id, child.id)
      } finally {
        await renderer.unmount()
      }
    })
  test('BlockEditor: childless preview and cancel match main dirty/write/history counts', async () => {
    const { host } = seed('none')
    const renderer = await mount(<Scene id={host.id} />)
    const dirty = spyOn(api.sceneApi, 'markDirty'),
      write = spyOn(api.sceneApi, 'update'),
      batch = spyOn(api.sceneApi, 'applyChanges')
    try {
      await settle(renderer)
      dirty.mockClear()
      write.mockClear()
      batch.mockClear()
      await keys(['e', '1'])
      await settle(renderer)
      expect(dirty).toHaveBeenCalledTimes(1)
      await key('Escape')
      await settle(renderer)
      expect(dirty).toHaveBeenCalledTimes(2)
      expect(write).toHaveBeenCalledTimes(0)
      expect(batch).toHaveBeenCalledTimes(0)
      expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    } finally {
      dirty.mockRestore()
      write.mockRestore()
      batch.mockRestore()
      await renderer.unmount()
    }
  })
  for (const kind of ['catalog', 'generated'] as const)
    test(`BlockEditor loop-cut: ${kind} moves to new half, undo/redo and reload`, async () => {
      const { host, child } = seed(kind, 0.5)
      let renderer = await mount(<Scene id={host.id} />)
      try {
        await settle(renderer)
        const before = nodes()
        const position = pose(child.id)
        await key('r', { ctrlKey: true })
        await settle(renderer)
        const point = new Vector3(0, 1.5, -1)
        const target = renderer.scene
          .findAll((n) => n.props.renderOrder === 1221)
          .find((n) => (n.instance.parent?.position.distanceTo(point) ?? Infinity) < 1e-6)!
        expect(target).toBeDefined()
        await renderer.fireEvent(target, 'pointerDown', {
          ray: new Ray(
            new Vector3(0, 3, -5),
            point
              .clone()
              .sub(new Vector3(0, 3, -5))
              .normalize(),
          ),
          nativeEvent: { button: 0, stopImmediatePropagation() {}, clientX: 500, clientY: 500 },
        })
        await settle(renderer)
        expect(ui(renderer)).not.toContain(BLOCK_SUPPORT_REFUSAL)
        expect(useInteractionScope.getState().scope).toMatchObject({ phase: 'operating' })
        await act(async () =>
          window.dispatchEvent(
            Object.assign(new Event('pointerdown', { cancelable: true }), { button: 0 }),
          ),
        )
        await settle(renderer)
        expect(useScene.temporal.getState().pastStates).toHaveLength(1)
        if (kind === 'catalog')
          expect((useScene.getState().nodes[child.id] as ItemNode).blockFaceId).not.toBe('f-top')
        else expect(useScene.getState().nodes[child.id]).toEqual(before[child.id])
        pose(child.id).forEach((v, i) => {
          expect(v).toBeCloseTo(position[i]!, 8)
        })
        expect(valid(host.id, child.id)).toBe(true)
        const after = nodes()
        await act(async () => useScene.temporal.getState().undo())
        await settle(renderer)
        expect(nodes()).toEqual(before)
        await act(async () => useScene.temporal.getState().redo())
        await settle(renderer)
        expect(nodes()).toEqual(after)
        renderer = await reload(renderer, host.id, child.id)
      } finally {
        await renderer.unmount()
      }
    })
  for (const kind of ['none', 'catalog', 'generated'] as const)
    test(`BlockEditor ${kind}: commit, undo, redo and repeat are single writes/history steps`, async () => {
      const { host, child } = seed(kind)
      let renderer = await mount(<Scene id={host.id} />)
      const dirty = spyOn(api.sceneApi, 'markDirty'),
        write = spyOn(api.sceneApi, 'update'),
        batch = spyOn(api.sceneApi, 'applyChanges')
      let storeWrites = 0
      const unsub = useScene.subscribe((next, prev) => {
        if (next.nodes !== prev.nodes) storeWrites++
      })
      try {
        await settle(renderer)
        dirty.mockClear()
        write.mockClear()
        batch.mockClear()
        storeWrites = 0
        const before = nodes()
        await keys(['e', '1', 'Enter'])
        await settle(renderer)
        expect(storeWrites).toBe(1)
        expect(useScene.temporal.getState().pastStates).toHaveLength(1)
        if (kind === 'none') {
          expect(dirty).toHaveBeenCalledTimes(2)
          expect(write).toHaveBeenCalledTimes(1)
          expect(batch).toHaveBeenCalledTimes(0)
        }
        const after = nodes()
        await act(async () => useScene.temporal.getState().undo())
        await settle(renderer)
        expect(storeWrites).toBe(2)
        expect(nodes()).toEqual(before)
        expect(useScene.temporal.getState().pastStates).toHaveLength(0)
        await act(async () => useScene.temporal.getState().redo())
        await settle(renderer)
        expect(storeWrites).toBe(3)
        expect(nodes()).toEqual(after)
        expect(useScene.temporal.getState().pastStates).toHaveLength(1)
        await key('r', { shiftKey: true })
        await settle(renderer)
        expect(storeWrites).toBe(4)
        expect(useScene.temporal.getState().pastStates).toHaveLength(2)
        if (kind === 'none') {
          expect(dirty).toHaveBeenCalledTimes(2)
          expect(write).toHaveBeenCalledTimes(2)
          expect(batch).toHaveBeenCalledTimes(0)
        } else {
          expect(pose(child.id)[1]).toBeCloseTo(3.5, 8)
          expect(valid(host.id, child.id)).toBe(true)
        }
        const repeated = nodes()
        await act(async () => useScene.temporal.getState().undo())
        await settle(renderer)
        expect(nodes()).toEqual(after)
        await act(async () => useScene.temporal.getState().redo())
        await settle(renderer)
        expect(nodes()).toEqual(repeated)
        renderer = await reload(renderer, host.id, kind === 'none' ? undefined : child.id)
      } finally {
        unsub()
        dirty.mockRestore()
        write.mockRestore()
        batch.mockRestore()
        await renderer.unmount()
      }
    })
  test('BlockEditor axis changes commit the complete accepted extrusion command', async () => {
    const { host } = seed('catalog')
    const renderer = await mount(<Scene id={host.id} />)
    try {
      await settle(renderer)
      await keys(['e', '0', '.', '2', 'x'])
      await settle(renderer)
      expect(ui(renderer)).toContain('X axis')
      const preview = getEffectiveNode(useScene.getState().nodes[host.id] as BlockNode).topology
      await key('Enter')
      await settle(renderer)
      expect(useBlockEditSession.getState().lastOperation?.command).toMatchObject({
        type: 'extrude-faces',
        axis: 'x',
        distance: 0.2,
      })
      expect((useScene.getState().nodes[host.id] as BlockNode).topology).toEqual(preview)
    } finally {
      await renderer.unmount()
    }
  })
  test('BlockEditor: a translated horizontal top carries a generated child in every axis', async () => {
    const { host, child } = seed('generated', 0.9)
    let renderer = await mount(<Scene id={host.id} />)
    try {
      await settle(renderer)
      for (const [axis, index] of [
        ['x', 0],
        ['z', 2],
        ['y', 1],
      ] as const) {
        const before = pose(child.id)
        await keys(['g', axis, '0', '.', '5', 'Enter'])
        await settle(renderer)
        expect(pose(child.id)[index]).toBeCloseTo(before[index]! + 0.5, 8)
        expect(valid(host.id, child.id)).toBe(true)
      }
      renderer = await reload(renderer, host.id, child.id)
    } finally {
      await renderer.unmount()
    }
  })
  function manyBoxes(count: number): BlockTopology {
    const topology = createBoxBlockTopology(2, 1.5, 2)
    for (let i = 1; i < count; i++) {
      const box = createBoxBlockTopology(2, 1.5, 2),
        prefix = `box${i}-`
      topology.vertices.push(
        ...box.vertices.map((v) => ({
          ...v,
          id: prefix + v.id,
          position: [v.position[0] + i * 3, v.position[1], v.position[2]] as [
            number,
            number,
            number,
          ],
        })),
      )
      topology.edges.push(
        ...box.edges.map((e) => ({
          ...e,
          id: prefix + e.id,
          vertexIds: e.vertexIds.map((id) => prefix + id) as [string, string],
        })),
      )
      topology.faces.push(
        ...box.faces.map((f) => ({
          ...f,
          id: prefix + f.id,
          vertexIds: f.vertexIds.map((id) => prefix + id),
        })),
      )
    }
    return topology
  }
  test('BlockEditor: translating a surviving catalog face does not rehome onto its neighbour', async () => {
    const topology = manyBoxes(2)
    for (const vertex of topology.vertices)
      if (vertex.id.startsWith('box1-')) vertex.position[0] -= 1
    const { host, child } = seed('catalog', 1, topology)
    let renderer = await mount(<Scene id={host.id} />)
    try {
      await settle(renderer)
      const before = nodes()[child.id]
      await keys(['g', 'x', '-', '0', '.', '5', 'Enter'])
      await settle(renderer)
      expect(useScene.getState().nodes[child.id]).toEqual(before)
      expect(pose(child.id)[0]).toBeCloseTo(0.5, 8)
      expect(valid(host.id, child.id)).toBe(true)
      renderer = await reload(renderer, host.id, child.id)
    } finally {
      await renderer.unmount()
    }
  })
  function workCounters(topologies: BlockTopology[]) {
    const frames = ownSpy(spyOn(core, 'getBlockFaceNormal'))
    const centroids = ownSpy(spyOn(core, 'getBlockFaceCentroid'))
    const polygons = ownSpy(spyOn(core, 'pointInPolygon2D'))
    const extractions = [...new Set(topologies.map((topology) => topology.faces))].map((faces) =>
      ownSpy(spyOn(faces, 'flatMap')),
    )
    const indices = [...new Set(topologies.map((topology) => topology.vertices))].map((vertices) =>
      ownSpy(spyOn(vertices, 'map')),
    )
    const spies = [frames, centroids, polygons, ...extractions, ...indices]
    const reset = () => {
      for (const spy of spies) spy.mockClear()
    }
    reset()
    return {
      reset,
      read: () => ({
        frames: frames.mock.calls.length,
        centroids: centroids.mock.calls.length,
        polygons: polygons.mock.calls.length,
        extractions: extractions.reduce((n, spy) => n + spy.mock.calls.length, 0),
        indices: indices.reduce((n, spy) => n + spy.mock.calls.length, 0),
      }),
    }
  }
  for (const kind of ['catalog', 'generated'] as const)
    for (const childCount of [1, 8])
      test(`1200-face reconciliation work is cached: ${kind}, ${childCount} children`, () => {
        const { host, child } = seed(kind, 0.5, manyBoxes(200))
        const children = Array.from({ length: childCount }, (_, index) =>
          index === 0
            ? child
            : kind === 'catalog'
              ? ItemNode.parse({ ...child, id: undefined })
              : ProceduralItemNode.parse({ ...child, id: undefined }),
        )
        const live = { ...host, children: children.map((n) => n.id) }
        useScene.setState({
          nodes: {
            ...useScene.getState().nodes,
            [host.id]: live,
            ...Object.fromEntries(children.map((n) => [n.id, n])),
          },
        })
        for (const distance of [0.2, 0.3]) {
          const proposed = applyBlockCommand(live.topology, {
            type: 'translate-components',
            selection: { mode: 'face', ids: ['f-top'] },
            delta: [0, distance, 0],
          })
          if (!proposed.ok) throw Error(proposed.error)
          const counts = workCounters([live.topology, proposed.topology])
          expect(planBlockTopologyEdit(api.sceneApi, host.id, proposed.topology)).not.toBeNull()
          const cold = counts.read()
          expect(cold.frames).toBeLessThanOrEqual(2400)
          expect(cold.centroids).toBe(cold.frames)
          expect(cold.extractions).toBeLessThanOrEqual(2)
          expect(cold.indices).toBeLessThanOrEqual(6)
          expect(cold.polygons).toBeGreaterThan(0)
          expect(cold.polygons).toBeLessThanOrEqual(childCount * (kind === 'catalog' ? 2 : 404))
          counts.reset()
          expect(planBlockTopologyEdit(api.sceneApi, host.id, proposed.topology)).not.toBeNull()
          const warm = counts.read()
          expect(warm.frames).toBe(0)
          expect(warm.centroids).toBe(0)
          expect(warm.extractions).toBe(0)
          expect(warm.indices).toBeLessThanOrEqual(2)
          expect(warm.polygons).toBe(cold.polygons)
          console.log('reconciliation work', { kind, childCount, distance, cold, warm })
        }
      })
  test('small occupied BlockEditor preview and commit still reconcile children', async () => {
    const { host, child } = seed('generated', 0.5, manyBoxes(2))
    const renderer = await mount(<Scene id={host.id} />)
    await settle(renderer)
    await keys(['e', '0', '.', '2', 'Enter'])
    await settle(renderer)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    expect(ui(renderer)).not.toContain(BLOCK_SUPPORT_REFUSAL)
    expect(pose(child.id)[1]).toBeCloseTo(1.7)
    expect(valid(host.id, child.id)).toBe(true)
  })
  test('childless reconciliation does zero polygon work', () => {
    const { host } = seed('none')
    const proposed = structuredClone(host.topology)
    const counts = workCounters([host.topology, proposed])
    let reads = 0
    const topology = new Proxy(proposed, {
      get(target, key, receiver) {
        if (key === 'vertices' || key === 'faces') reads++
        return Reflect.get(target, key, receiver)
      },
    })
    expect(planBlockTopologyEdit(api.sceneApi, host.id, topology)).toEqual([
      [host.id, { topology }],
    ])
    expect(reads).toBe(0)
    expect(counts.read()).toEqual({
      frames: 0,
      centroids: 0,
      polygons: 0,
      extractions: 0,
      indices: 0,
    })
  })
}
