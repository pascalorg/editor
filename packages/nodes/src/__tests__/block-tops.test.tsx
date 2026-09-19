import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import {
  type AnyNode,
  BlockNode,
  type BlockTopology,
  BuildingNode,
  createBoxBlockTopology,
  createSceneApi,
  emitter,
  getBlockFaceFrame,
  ItemNode,
  LevelNode,
  nodeRegistry,
  registerNode,
  resolveSurfacePlacement,
  runAsSingleSceneHistoryStep,
  SiteNode,
  SlabNode,
  sceneRegistry,
  spatialGridManager,
  useLiveNodeOverrides,
  useLiveTransforms,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import { ProceduralItemNode, type Recipe } from '@pascal-app/core/procedural-items'
import { NodeRenderer, useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { events, type RootStore, useThree } from '@react-three/fiber'
import { act, create } from '@react-three/test-renderer'
import React, {
  Children,
  cloneElement,
  isValidElement,
  type ReactNode,
  useMemo,
  useRef,
} from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, type Object3D, Vector2, Vector3 } from 'three'
import { FloorplanRegistryLayer } from '../../../editor/src/components/editor-2d/renderers/floorplan-registry-layer'
import { MoveRegistryNodeTool } from '../../../editor/src/components/tools/registry/move-registry-node-tool'
import { useKeyboard } from '../../../editor/src/hooks/use-keyboard'
import useEditor from '../../../editor/src/store/use-editor'
import useInteractionScope from '../../../editor/src/store/use-interaction-scope'
import { FloorElevationSystem } from '../../../viewer/src/systems/floor-elevation/floor-elevation-system'
import { GeometrySystem } from '../../../viewer/src/systems/geometry/geometry-system'
import { ItemSystem } from '../../../viewer/src/systems/item/item-system'
import { applyBlockCommand, type BlockCommand } from '../block/commands'
import { commitBlockOperation } from '../block/last-operation'
import { useBlockFaceOperation } from '../block/use-block-face-operation'
import { builtinPlugin } from '../index'
import { ItemGLTFLoader } from '../item/model-loader'
import { MoveItemTool } from '../item/move-tool'
import ItemTool from '../item/tool'
import { getDefaultPanelMaterial } from '../solar-panel/geometry'

// Other node tests install process-global renderer mocks; this audit must observe production modules.
if (process.env.PASCAL_BLOCK_TOPS_ISOLATED !== '1') {
  test('block tops with production registrations', async () => {
    const child = Bun.spawn(
      [process.execPath, 'run', 'test', 'src/__tests__/block-tops.test.tsx'],
      {
        cwd: new URL('../..', import.meta.url).pathname,
        env: { ...process.env, PASCAL_BLOCK_TOPS_ISOLATED: '1' },
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
  type Mover = 'registry' | 'catalog'
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
      () => null,
    )
    savedScene = useScene.getState()
    savedEditor = useEditor.getState()
    savedViewer = useViewer.getState()
    savedScope = useInteractionScope.getState()
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

  function withoutLabels(element: ReactNode): ReactNode {
    if (!isValidElement<{ children?: ReactNode }>(element)) return element
    if (element.type === Html) return null
    return cloneElement(element, {}, Children.map(element.props.children, withoutLabels))
  }
  function RegistryMover({ node }: { node: AnyNode }) {
    return withoutLabels(MoveRegistryNodeTool({ node }))
  }
  function CatalogMover({ source }: { source: ItemNode }) {
    const node = useMemo(() => structuredClone(source), [source])
    return withoutLabels(MoveItemTool({ node }))
  }
  function Keyboard() {
    useKeyboard()
    return null
  }
  function Scene({
    mover,
    child,
    fresh = false,
    keyboard = false,
  }: {
    mover?: Mover
    child?: AnyNode
    fresh?: boolean
    keyboard?: boolean
  }) {
    const armed = useEditor((s) => s.mode === 'build' && s.tool === 'item')
    const buildingNode = useScene((s) => s.nodes[building.id] as BuildingNode)
    const children = useScene((s) => (s.nodes[level.id] as LevelNode).children)
    const buildingChildren = useScene((s) => (s.nodes[building.id] as BuildingNode).children)
    const moving = useInteractionScope(
      (s) => s.scope.kind === 'moving' || s.scope.kind === 'placing',
    )
    const ref = useRef<Group>(null!)
    const buildingRef = useRef<Group>(null!)
    useRegistry(level.id, 'level', ref)
    useRegistry(building.id, 'building', buildingRef)
    return (
      <>
        <group ref={buildingRef} position={buildingNode.position} rotation={buildingNode.rotation}>
          <group ref={ref}>
            {children.map((id) => (
              <NodeRenderer key={id} nodeId={id} />
            ))}
          </group>
          {buildingChildren
            .filter((id) => id !== level.id)
            .map((id) => (
              <NodeRenderer key={id} nodeId={id} />
            ))}
        </group>
        {keyboard && <Keyboard />}
        {fresh && armed && <ItemTool />}
        {mover &&
          child &&
          moving &&
          (mover === 'catalog' ? (
            <CatalogMover source={child as ItemNode} />
          ) : (
            <RegistryMover node={child} />
          ))}
        <FloorElevationSystem />
        <ItemSystem />
        <GeometrySystem />
      </>
    )
  }
  async function settle(renderer: Awaited<ReturnType<typeof create>>) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
    await act(async () => {
      await renderer.advanceFrames(3, 1 / 60)
    })
  }
  function visible(object?: Object3D): boolean {
    if (!object) return false
    for (let current: Object3D | null = object; current; current = current.parent)
      if (!current.visible) return false
    let mesh = false
    object.traverse((entry) => {
      if ((entry as Mesh).isMesh) mesh = true
    })
    return mesh
  }
  function under(object: Object3D | undefined, ancestor: Object3D | undefined) {
    if (!object || !ancestor) return false
    for (let current: Object3D | null = object.parent; current; current = current.parent)
      if (current === ancestor) return true
    return false
  }
  function matrix(object?: Object3D) {
    if (!object) return undefined
    object.updateWorldMatrix(true, true)
    return [...object.matrixWorld.elements]
  }
  function snapshot() {
    const { nodes, rootNodeIds, collections, materials, installedPlugins } = useScene.getState()
    return JSON.parse(
      JSON.stringify({ nodes, rootNodeIds, collections, materials, installedPlugins }),
    )
  }
  function plan(childId: string) {
    // SSR normally reads Zustand's empty startup state; render the current committed scene instead.
    const useSyncExternalStore = React.useSyncExternalStore
    const serverSnapshot = spyOn(React, 'useSyncExternalStore').mockImplementation(
      (subscribe, getSnapshot) => useSyncExternalStore(subscribe, getSnapshot, getSnapshot),
    )
    try {
      const markup = renderToStaticMarkup(
        <svg>
          <FloorplanRegistryLayer />
        </svg>,
      )
      return {
        plan: markup.includes(childId),
        planError: markup.includes(childId) ? '' : 'child absent from SVG',
      }
    } catch (error) {
      return { plan: false, planError: String(error) }
    } finally {
      serverSnapshot.mockRestore()
    }
  }

  function prism(points: [number, number][], height = 1.5): BlockTopology {
    const vertices = points.flatMap(([x, z], i) => [
      { id: `b${i}`, position: [x, 0, z] },
      { id: `t${i}`, position: [x, height, z] },
    ])
    const faces = [
      { id: 'bottom', vertexIds: points.map((_, i) => `b${i}`), materialSlot: 'body' },
      { id: 'top', vertexIds: points.map((_, i) => `t${i}`).reverse(), materialSlot: 'body' },
      ...points.map((_, i) => ({
        id: `side${i}`,
        vertexIds: [`b${i}`, `t${i}`, `t${(i + 1) % points.length}`, `b${(i + 1) % points.length}`],
        materialSlot: 'body',
      })),
    ]
    const edges = new Map<string, { id: string; vertexIds: [string, string] }>()
    for (const face of faces)
      for (let i = 0; i < face.vertexIds.length; i++) {
        const pair = [face.vertexIds[i]!, face.vertexIds[(i + 1) % face.vertexIds.length]!] as [
          string,
          string,
        ]
        const key = [...pair].sort().join(':')
        if (!edges.has(key)) edges.set(key, { id: `e${edges.size}`, vertexIds: pair })
      }
    return { vertices, faces, edges: [...edges.values()] } as BlockTopology
  }
  function topology(shape: string): BlockTopology {
    if (shape === 'L')
      return prism([
        [-1, -1],
        [1, -1],
        [1, 0],
        [0, 0],
        [0, 1],
        [-1, 1],
      ])
    if (shape === 'two-height') {
      const low = prism(
        [
          [-1, -1],
          [0, -1],
          [0, 1],
          [-1, 1],
        ],
        1,
      )
      const high = prism(
        [
          [0, -1],
          [1, -1],
          [1, 1],
          [0, 1],
        ],
        2,
      )
      return {
        vertices: [...low.vertices, ...high.vertices.map((v) => ({ ...v, id: `high-${v.id}` }))],
        edges: [
          ...low.edges,
          ...high.edges.map((e) => ({
            ...e,
            id: `high-${e.id}`,
            vertexIds: e.vertexIds.map((id) => `high-${id}`) as [string, string],
          })),
        ],
        faces: [
          ...low.faces,
          ...high.faces.map((f) => ({
            ...f,
            id: `high-${f.id}`,
            vertexIds: f.vertexIds.map((id) => `high-${id}`),
          })),
        ],
      }
    }
    return createBoxBlockTopology(2, 1.5, 2)
  }
  function seed(shape = 'box', mover: Mover = 'registry', hosted = true) {
    const host = BlockNode.parse({
      parentId: level.id,
      position: [1, 0, -1],
      rotation: shape === 'rotated' ? Math.PI / 6 : 0,
      topology: topology(shape),
    })
    const slab = SlabNode.parse({
      parentId: level.id,
      elevation: 0.4,
      polygon: [
        [-5, -5],
        [5, -5],
        [5, 5],
        [-5, 5],
      ],
    })
    const values = {
      parentId: hosted ? host.id : level.id,
      position: hosted ? [-0.5, shape === 'two-height' ? 1 : 1.5, -0.5] : [-4, 0, -4],
    }
    const child =
      mover === 'registry'
        ? ProceduralItemNode.parse({ ...values, recipe })
        : ItemNode.parse({ ...values, asset })
    if (mover === 'catalog' && hosted) {
      const faceId = host.topology.faces.find(
        (f) => getBlockFaceFrame(host.topology, f.id)!.normal[1] > 0.99,
      )!.id
      const f = getBlockFaceFrame(host.topology, faceId)!
      const d = new Vector3(...child.position).sub(new Vector3(...f.origin))
      Object.assign(child, {
        blockFaceId: faceId,
        position: [d.dot(new Vector3(...f.xAxis)), d.dot(new Vector3(...f.yAxis)), 0],
        rotation: [Math.PI / 2, 0, 0],
      })
    }
    useScene.setState({
      nodes: {
        [site.id]: { ...site, children: [building.id] },
        [building.id]: { ...building, children: [level.id] },
        [level.id]: { ...level, children: [host.id, slab.id, ...(hosted ? [] : [child.id])] },
        [host.id]: { ...host, children: hosted ? [child.id] : [] },
        [slab.id]: slab,
        [child.id]: child,
      },
      rootNodeIds: [site.id],
      dirtyNodes: new Set([host.id, slab.id, child.id]),
      readOnly: false,
      materials: {},
      collections: {},
      installedPlugins: [],
    })
    spatialGridManager.handleNodeCreated(slab, level.id)
    useScene.temporal.getState().clear()
    useScene.temporal.getState().pause()
    useInteractionScope.getState().end()
    useEditor.setState({
      mode: 'build',
      tool: 'item',
      movingNodeOrigin: '3d',
      placementDragMode: false,
      viewMode: '3d',
    })
    useEditor.getState().setSnappingMode('item', 'off')
    useViewer.setState({
      textures: false,
      showZones: false,
      showMeasurements: false,
      selection: { buildingId: building.id, levelId: level.id, zoneId: null, selectedIds: [] },
    })
    return { host: useScene.getState().nodes[host.id] as BlockNode, child }
  }
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
  for (const shape of ['box', 'rotated', 'L', 'two-height'])
    test(`generated ${shape}: mounted plan keeps original top and releases to slab floor`, async () => {
      const { host, child } = seed(shape)
      const renderer = await create(<Scene />)
      try {
        await settle(renderer)
        const scene = createSceneApi(useScene)
        const session = nodeRegistry.get(child.type)!.floorplanMoveTarget!({
          node: child,
          nodes: scene.nodes(),
          sceneApi: scene,
        } as never)
        const planPoint = (x: number, z: number): [number, number] => [
          host.position[0] + x * Math.cos(host.rotation) + z * Math.sin(host.rotation),
          host.position[2] - x * Math.sin(host.rotation) + z * Math.cos(host.rotation),
        ]
        const modifiers = { altKey: false, shiftKey: false, metaKey: false, ctrlKey: false }
        await act(async () => {
          session.apply({ planPoint: planPoint(-0.5, -0.5), modifiers })
          session.apply({ planPoint: planPoint(-0.3, -0.4), modifiers })
        })
        await settle(renderer)
        expect(useLiveNodeOverrides.getState().get(child.id)?.parentId).toBe(host.id)
        expect(visible(sceneRegistry.nodes.get(child.id))).toBe(true)
        await act(async () => session.commit!())
        await settle(renderer)
        expect(useScene.getState().nodes[child.id]!.parentId).toBe(host.id)
        expect(plan(child.id).plan).toBe(true)
        const moved = useScene.getState().nodes[child.id]!
        const exit = nodeRegistry.get(child.type)!.floorplanMoveTarget!({
          node: moved,
          nodes: scene.nodes(),
          sceneApi: scene,
        } as never)
        await act(async () => {
          exit.apply({ planPoint: planPoint(-0.3, -0.4), modifiers })
          exit.apply({ planPoint: planPoint(shape === 'L' ? 0.5 : 3, 0.5), modifiers })
          exit.commit!()
        })
        await settle(renderer)
        expect(useScene.getState().nodes[child.id]!.parentId).toBe(level.id)
        expect((useScene.getState().nodes[child.id] as ItemNode).position[1]).toBe(0)
        expect(sceneRegistry.nodes.get(child.id)!.getWorldPosition(new Vector3()).y).toBeCloseTo(
          0.4,
          6,
        )
      } finally {
        await renderer.unmount()
      }
    })
  test('L top: post-snap centre over a notch is refused for generated and catalog floor assets', async () => {
    const { host, child } = seed('L')
    const renderer = await create(<Scene />)
    try {
      await settle(renderer)
      const resolve = (x: number, z: number) =>
        resolveSurfacePlacement({
          host,
          childKind: child.type,
          childId: child.id,
          childFootprint: { size: [0.1, 0.2, 0.1], rotationY: 0 },
          hit: { point: [-0.1, 1.5, 0.5], normalWorldY: 1 },
          snapScalar: (v) => (v === -0.1 ? x : z),
          scene: createSceneApi(useScene),
        })
      expect(resolve(0.5, 0.5)).toBeNull()
      expect(resolve(0, 0.5)).not.toBeNull()
      const object = sceneRegistry.nodes.get(host.id)!
      let geometryMesh: Mesh
      object.traverse((o) => {
        if ((o as Mesh).geometry?.userData.blockFaces) geometryMesh = o as Mesh
      })
      const range = (
        geometryMesh.geometry.userData.blockFaces as { faceId: string; start: number }[]
      ).find((f) => f.faceId === 'top')!
      const result = nodeRegistry.get('block')!.capabilities.faceHost!.resolvePlacement({
        host,
        asset: ItemNode.parse({ asset }).asset,
        dimensions: [0.1, 0.2, 0.1],
        rawDimensions: [0.1, 0.2, 0.1],
        object,
        localPosition: [0.5, 1.5, 0.5],
        faceIndex: range.start / 3,
        currentFaceId: 'top',
        snapScalar: (v: number) => v,
      } as never)
      expect(result).toBeNull()
    } finally {
      await renderer.unmount()
    }
  })
  for (const mover of ['registry', 'catalog'] as const)
    for (const shape of ['box', 'rotated', 'L', 'two-height'])
      for (const operation of ['raise', 'lower', 'extrude', 'delete-face', 'shrink'])
        test(`${mover} ${shape}: ${operation} carries or refuses atomically`, async () => {
          const { host, child } = seed(shape, mover)
          const renderer = await create(<Scene />)
          try {
            await settle(renderer)
            const top = host.topology.faces.find(
              (f) => getBlockFaceFrame(host.topology, f.id)!.normal[1] > 0.99,
            )!.id
            const command: BlockCommand =
              operation === 'extrude'
                ? { type: 'extrude-faces', faceIds: [top], distance: 0.5 }
                : operation === 'delete-face'
                  ? { type: 'delete-components', selection: { mode: 'face', ids: [top] } }
                  : operation === 'shrink'
                    ? {
                        type: 'scale-components',
                        selection: { mode: 'face', ids: [top] },
                        pivot: [0, shape === 'two-height' ? 1 : 1.5, 0],
                        factors: [0.1, 1, 0.1],
                      }
                    : {
                        type: 'translate-components',
                        selection: { mode: 'face', ids: [top] },
                        delta: [0, operation === 'raise' ? 0.5 : -0.25, 0],
                      }
            const original = snapshot().nodes
            const world = sceneRegistry.nodes.get(child.id)!.getWorldPosition(new Vector3())
            useScene.temporal.getState().resume()
            useScene.temporal.getState().clear()
            let result: ReturnType<typeof commitBlockOperation>
            await act(async () => {
              result = commitBlockOperation(services(), host.id, operation, host.topology, command)
            })
            await settle(renderer)
            if (operation === 'delete-face' || operation === 'shrink') {
              expect(result!.ok).toBe(false)
              expect(snapshot().nodes).toEqual(original)
              expect(useScene.temporal.getState().pastStates).toHaveLength(0)
            } else {
              expect(result!.ok).toBe(true)
              expect(
                sceneRegistry.nodes.get(child.id)!.getWorldPosition(new Vector3()).y,
              ).toBeCloseTo(world.y + (operation === 'lower' ? -0.25 : 0.5), 6)
              expect(useScene.temporal.getState().pastStates).toHaveLength(1)
              await act(async () => useScene.temporal.getState().undo())
              await settle(renderer)
              expect(snapshot().nodes).toEqual(original)
              expect(visible(sceneRegistry.nodes.get(child.id))).toBe(true)
            }
          } finally {
            await renderer.unmount()
          }
        })
  let beginFaceOperation: ReturnType<typeof useBlockFaceOperation>
  function FaceOperationDriver({ host }: { host: BlockNode }) {
    const { camera } = useThree()
    const cancelRef = useRef<(() => void) | null>(null)
    const pointer = useRef<Vector2 | null>(new Vector2(500, 500))
    const top = host.topology.faces.find(
      (f) => getBlockFaceFrame(host.topology, f.id)!.normal[1] > 0.99,
    )!.id
    beginFaceOperation = useBlockFaceOperation({
      beginInputDrag: () => () => {},
      camera,
      cancelRef,
      canvas: {
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 1000 }),
      } as HTMLCanvasElement,
      closeToolbar() {},
      commit: (base, cmd, label) => commitBlockOperation(services(), host.id, label, base, cmd).ok,
      displayTopology: host.topology,
      extent: 2,
      lastPointerClientRef: pointer,
      mode: 'face',
      nodeId: host.id,
      ownsEditSession: () => true,
      playSfx() {},
      sceneApi: services().sceneApi,
      selectedIds: [top],
      selection: { mode: 'face', ids: [top] },
      setActiveFaceOperation() {},
      setError() {},
      setFaceOperationAxis() {},
      setFaceOperationValue() {},
      setModalFeedbackMode() {},
      setPreviewTopology() {},
      setTransformNumericInput() {},
      target: sceneRegistry.nodes.get(host.id)!,
    })
    return null
  }
  for (const finish of ['Escape', 'Enter'])
    test(`production face operation preview carries both children without rebuilds: ${finish}`, async () => {
      const { host, child } = seed('box')
      const face = getBlockFaceFrame(host.topology, 'f-top')!
      const catalog = ItemNode.parse({
        parentId: host.id,
        asset,
        blockFaceId: 'f-top',
        position: [0, 0, 0],
        rotation: [Math.PI / 2, 0, 0],
      })
      useScene.getState().createNode(catalog, host.id)
      const renderer = await create(<Scene />)
      try {
        await settle(renderer)
        await renderer.update(
          <>
            <Scene />
            <FaceOperationDriver host={host} />
          </>,
        )
        await settle(renderer)
        const ids = [child.id, catalog.id]
        const before = ids.map((id) => matrix(sceneRegistry.nodes.get(id))!)
        const geometryIds = () =>
          ids.map((id) => {
            const result: string[] = []
            sceneRegistry.nodes.get(id)!.traverse((o) => {
              if ((o as Mesh).geometry) result.push((o as Mesh).geometry.uuid)
            })
            return result
          })
        const initial = geometryIds()
        useScene.temporal.getState().resume()
        useScene.temporal.getState().clear()
        const rebuild = spyOn(nodeRegistry.get('block')!, 'geometry')
        await act(async () => {
          expect(beginFaceOperation('extrude')).toBe(true)
        })
        for (const key of ['0', '.', '5'])
          await act(async () =>
            window.dispatchEvent(
              Object.assign(new Event('keydown', { cancelable: true }), { key }),
            ),
          )
        await settle(renderer)
        ids.forEach((id, i) => {
          expect(matrix(sceneRegistry.nodes.get(id))![13]).toBeCloseTo(before[i]![13]! + 0.5, 6)
        })
        expect(geometryIds()).toEqual(initial)
        expect(rebuild).toHaveBeenCalledTimes(1)
        await act(async () => renderer.advanceFrames(10, 1 / 60))
        expect(rebuild).toHaveBeenCalledTimes(1)
        rebuild.mockRestore()
        expect(useScene.getState().nodes[host.id]).toMatchObject({ topology: host.topology })
        await act(async () =>
          window.dispatchEvent(
            Object.assign(new Event('keydown', { cancelable: true }), { key: finish }),
          ),
        )
        await settle(renderer)
        if (finish === 'Enter') {
          ids.forEach((id, i) => {
            expect(matrix(sceneRegistry.nodes.get(id))![13]).toBeCloseTo(before[i]![13]! + 0.5, 6)
          })
          expect(useScene.temporal.getState().pastStates).toHaveLength(1)
          await act(async () => useScene.temporal.getState().undo())
          await settle(renderer)
        } else expect(useScene.temporal.getState().pastStates).toHaveLength(0)
        ids.forEach((id, i) => {
          expect(matrix(sceneRegistry.nodes.get(id))![13]).toBeCloseTo(before[i]![13]!, 6)
        })
        expect(useLiveNodeOverrides.getState().overrides.size).toBe(0)
        expect(face.normal[1]).toBe(1)
      } finally {
        await renderer.unmount()
      }
    })

  function pointerDispatcher(point: Vector3, direction = new Vector3(0, 1, 0)) {
    const object = sceneRegistry.nodes.get(level.id)! as Object3D & { __r3f: { root: RootStore } }
    const store = object.__r3f.root
    const manager = events(store)
    store.setState({ events: manager })
    const state = store.getState()
    state.setSize(1000, 1000)
    state.camera.position.copy(point).addScaledVector(direction, 10)
    state.camera.up.set(
      0,
      Math.abs(direction.y) > 0.9 ? 0 : 1,
      Math.abs(direction.y) > 0.9 ? -1 : 0,
    )
    state.camera.lookAt(point)
    state.camera.updateMatrixWorld()
    state.raycaster.layers.enableAll()
    return (world: Vector3, phase: 'onPointerMove' | 'onPointerUp' = 'onPointerMove') => {
      state.scene.updateMatrixWorld(true)
      const ndc = world.clone().project(state.camera)
      const native = {
        offsetX: (ndc.x + 1) * 500,
        offsetY: (1 - ndc.y) * 500,
        pointerId: 1,
        button: 0,
        target: { setPointerCapture() {}, releasePointerCapture() {} },
      }
      return { native, dispatch: () => manager.handlers![phase](native as never) }
    }
  }
  async function dispatchMove(
    pointer: ReturnType<typeof pointerDispatcher>,
    point: Vector3,
    order: string,
  ) {
    const move = pointer(point)
    const grid = {
      position: [8, 0, 8],
      localPosition: [8, 0, 8],
      nativeEvent: { nativeEvent: move.native },
      stopPropagation() {},
    }
    await act(async () => {
      if (order === 'grid first') emitter.emit('grid:move', grid as never)
      move.dispatch()
      if (order === 'host first') emitter.emit('grid:move', grid as never)
    })
  }
  function blockMeshes(id: AnyNode['id']) {
    const result: string[] = []
    sceneRegistry.nodes.get(id)!.traverse((o) => {
      if ((o as Mesh).geometry?.userData.blockFaces)
        result.push(`${o.uuid}:${(o as Mesh).geometry.uuid}`)
    })
    return result
  }
  for (const shape of ['box', 'rotated', 'L', 'two-height'])
    for (const order of ['grid first', 'host first'])
      for (const mode of ['fresh', 'move', 'regrab'])
        test(`generated ${mode} ${shape}, ${order}: R3F placement, no blink, preview equals commit`, async () => {
          const { host, child } = seed(shape, 'registry', mode === 'regrab')
          if (mode === 'fresh') {
            ;(child.metadata as Record<string, unknown>).isNew = true
            useScene.getState().updateNode(child.id, { metadata: child.metadata })
          }
          useEditor.getState().setMovingNode(child)
          const renderer = await create(<Scene mover="registry" child={child} />)
          try {
            await settle(renderer)
            const mesh = sceneRegistry.nodes.get(host.id)!
            const y = shape === 'two-height' ? 1 : 1.5
            const pointer = pointerDispatcher(mesh.localToWorld(new Vector3(-0.5, y, -0.5)))
            const initial = blockMeshes(host.id)
            for (let i = 0; i < 12; i++) {
              const point = mesh.localToWorld(new Vector3(-0.5 + i * 0.02, y, -0.5))
              await dispatchMove(pointer, point, order)
              await settle(renderer)
              expect(useScene.getState().nodes[child.id]!.parentId).toBe(host.id)
              expect(visible(sceneRegistry.nodes.get(child.id))).toBe(true)
              expect(blockMeshes(host.id)).toEqual(initial)
            }
            const preview = matrix(sceneRegistry.nodes.get(child.id))!
            await act(async () =>
              pointer(mesh.localToWorld(new Vector3(-0.28, y, -0.5)), 'onPointerUp').dispatch(),
            )
            await settle(renderer)
            expect(useInteractionScope.getState().scope.kind).toBe('idle')
            const committed = Object.values(useScene.getState().nodes).find(
              (n) => n.type === 'procedural-item',
            )!
            expect(committed.parentId).toBe(host.id)
            matrix(sceneRegistry.nodes.get(committed.id))!.forEach((v, i) => {
              expect(v).toBeCloseTo(preview[i]!, 6)
            })
          } finally {
            await renderer.unmount()
          }
        })

  for (const shape of ['box', 'rotated'])
    for (const faceId of ['f-top', 'f-front', 'f-bottom'])
      for (const order of ['grid first', 'host first'])
        for (const mode of ['fresh', 'move'])
          test(`catalog ${mode} ${shape} ${faceId}, ${order}: stored face pose and preview equal commit`, async () => {
            const { host, child } = seed(shape, 'catalog', false)
            const face = getBlockFaceFrame(host.topology, faceId)!
            const attachTo =
              faceId === 'f-top' ? undefined : faceId === 'f-bottom' ? 'ceiling' : 'wall-side'
            const selectedAsset = { ...asset, attachTo }
            const rotation: [number, number, number] =
              attachTo === 'ceiling'
                ? [-Math.PI / 2, 0, 0]
                : attachTo
                  ? [0, 0, 0]
                  : [Math.PI / 2, 0, 0]
            const start: [number, number, number] = [0, 0, attachTo === 'ceiling' ? 0.2 : 0]
            Object.assign(child, {
              asset: { ...(child as ItemNode).asset, attachTo },
              parentId: host.id,
              blockFaceId: faceId,
              position: start,
              rotation,
            })
            if (mode === 'fresh') {
              useScene.getState().deleteNode(child.id)
              useEditor.setState({ selectedItem: selectedAsset })
              useEditor.getState().setContinuation('point', 'single')
            } else {
              useScene.getState().updateNode(child.id, child)
              useEditor.getState().setMovingNode(child)
            }
            const renderer = await create(
              <Scene
                fresh={mode === 'fresh'}
                mover={mode === 'move' ? 'catalog' : undefined}
                child={child}
              />,
            )
            try {
              await settle(renderer)
              const mesh = sceneRegistry.nodes.get(host.id)!
              const normal = new Vector3(...face.normal).transformDirection(mesh.matrixWorld)
              const origin = mesh.localToWorld(new Vector3(...face.origin))
              const pointer = pointerDispatcher(origin, normal)
              let draft = Object.values(useScene.getState().nodes).find((n) => n.type === 'item')!
              const initial = blockMeshes(host.id)
              for (let i = 0; i < 3; i++) {
                const point = mesh.localToWorld(
                  new Vector3(...face.origin).addScaledVector(new Vector3(...face.xAxis), i * 0.04),
                )
                await dispatchMove(pointer, point, order)
                await settle(renderer)
                draft = Object.values(useScene.getState().nodes).find((n) => n.type === 'item')!
                const node = useScene.getState().nodes[draft.id] as ItemNode
                expect(node.parentId).toBe(host.id)
                expect(node.blockFaceId).toBe(faceId)
                expect(visible(sceneRegistry.nodes.get(node.id))).toBe(true)
                expect(blockMeshes(host.id)).toEqual(initial)
              }
              const preview = matrix(sceneRegistry.nodes.get(draft.id))!
              const point = mesh.localToWorld(
                new Vector3(...face.origin).addScaledVector(new Vector3(...face.xAxis), 0.08),
              )
              await act(async () => pointer(point, 'onPointerUp').dispatch())
              await settle(renderer)
              const node = Object.values(useScene.getState().nodes).find(
                (n) => n.type === 'item',
              ) as ItemNode
              expect(node.blockFaceId).toBe(faceId)
              expect(node.position[0]).toBeCloseTo(0.08, 6)
              expect(node.position[1]).toBeCloseTo(0, 6)
              expect(node.position[2]).toBeCloseTo(start[2], 6)
              expect(node.rotation).toEqual(rotation)
              matrix(sceneRegistry.nodes.get(node.id))!.forEach((v, i) => {
                expect(v).toBeCloseTo(preview[i]!, 6)
              })
            } finally {
              await renderer.unmount()
            }
          })

  for (const mover of ['catalog', 'registry'] as const)
    test(`${mover}: split carries the retained half; deleting block removes subtree and undo restores it`, async () => {
      const { host, child } = seed('box', mover)
      const renderer = await create(<Scene />)
      try {
        await settle(renderer)
        const original = snapshot().nodes
        useScene.temporal.getState().resume()
        useScene.temporal.getState().clear()
        const edge = host.topology.edges.find(
          (e) => e.vertexIds.includes('v4') && e.vertexIds.includes('v5'),
        )!
        const command: BlockCommand = { type: 'loop-cut', edgeId: edge.id, factor: 0.5 }
        const proposed = applyBlockCommand(host.topology, command)
        expect(proposed.ok).toBe(true)
        if (!proposed.ok) throw Error(proposed.error)
        const result = commitBlockOperation(services(), host.id, 'Split', host.topology, command)
        expect(result.ok).toBe(true)
        await settle(renderer)
        expect(visible(sceneRegistry.nodes.get(child.id))).toBe(true)
        expect(sceneRegistry.nodes.get(child.id)!.getWorldPosition(new Vector3()).y).toBeCloseTo(
          1.9,
          6,
        )
        expect(useScene.temporal.getState().pastStates).toHaveLength(1)
        await act(async () => useScene.temporal.getState().undo())
        await settle(renderer)
        expect(snapshot().nodes).toEqual(original)
        useScene.temporal.getState().clear()
        await act(async () => useScene.getState().deleteNode(host.id))
        await settle(renderer)
        expect(useScene.getState().nodes[child.id]).toBeUndefined()
        expect(sceneRegistry.nodes.get(child.id)).toBeUndefined()
        expect(useScene.temporal.getState().pastStates).toHaveLength(1)
        await act(async () => useScene.temporal.getState().undo())
        await settle(renderer)
        expect(snapshot().nodes).toEqual(original)
        expect(visible(sceneRegistry.nodes.get(child.id))).toBe(true)
      } finally {
        await renderer.unmount()
      }
    })
  for (const mover of ['catalog', 'registry'] as const)
    test(`${mover}: splitting support into a new face carries the child`, async () => {
      const { host, child } = seed('box', mover)
      if (mover === 'registry') child.position[0] = 0.5
      else {
        const f = getBlockFaceFrame(host.topology, 'f-top')!
        const d = new Vector3(0.5, 1.5, -0.5).sub(new Vector3(...f.origin))
        child.position = [d.dot(new Vector3(...f.xAxis)), d.dot(new Vector3(...f.yAxis)), 0]
      }
      const renderer = await create(<Scene />)
      try {
        await settle(renderer)
        const original = snapshot().nodes
        useScene.temporal.getState().resume()
        useScene.temporal.getState().clear()
        const result = commitBlockOperation(services(), host.id, 'Split', host.topology, {
          type: 'loop-cut',
          edgeId: 'e4',
          factor: 0.5,
        })
        expect(result.ok).toBe(true)
        expect(useScene.temporal.getState().pastStates).toHaveLength(1)
        await act(async () => useScene.temporal.getState().undo())
        await settle(renderer)
        expect(snapshot().nodes).toEqual(original)
        expect(visible(sceneRegistry.nodes.get(child.id))).toBe(true)
      } finally {
        await renderer.unmount()
      }
    })
  for (const order of ['grid first', 'host first'])
    test(`catalog side switch keeps legacy face-local pose, ${order}`, async () => {
      const { host, child } = seed('rotated', 'catalog', false)
      Object.assign(child, {
        asset: { ...(child as ItemNode).asset, attachTo: 'wall-side' },
        parentId: host.id,
        blockFaceId: 'f-front',
        position: [0, 0, 0],
        rotation: [0, 0, 0],
      })
      useScene.getState().updateNode(child.id, child)
      useEditor.getState().setMovingNode(child)
      const renderer = await create(<Scene mover="catalog" child={child} />)
      try {
        await settle(renderer)
        const mesh = sceneRegistry.nodes.get(host.id)!
        mesh.updateWorldMatrix(true, true)
        const look = mesh.localToWorld(new Vector3(0, 0.75, 0))
        const direction = new Vector3(-1, 0, -1).normalize().transformDirection(mesh.matrixWorld)
        const pointer = pointerDispatcher(look, direction)
        for (const faceId of ['f-front', 'f-left', 'f-front', 'f-left']) {
          const face = getBlockFaceFrame(host.topology, faceId)!
          const mesh = sceneRegistry.nodes.get(host.id)!
          mesh.updateWorldMatrix(true, true)
          const point = mesh.localToWorld(new Vector3(...face.origin))
          await dispatchMove(pointer, point, order)
          await settle(renderer)
          await dispatchMove(pointer, point.clone().add(new Vector3(0, 0.01, 0)), order)
          await settle(renderer)
          expect(
            (
              {
                ...useScene.getState().nodes[child.id],
                ...useLiveNodeOverrides.getState().overrides.get(child.id),
              } as ItemNode
            ).blockFaceId,
          ).toBe(faceId)
          expect(visible(sceneRegistry.nodes.get(child.id))).toBe(true)
        }
        const preview = matrix(sceneRegistry.nodes.get(child.id))!
        const face = getBlockFaceFrame(host.topology, 'f-left')!
        const point = mesh.localToWorld(new Vector3(...face.origin)).add(new Vector3(0, 0.01, 0))
        await act(async () => pointer(point, 'onPointerUp').dispatch())
        await settle(renderer)
        expect((useScene.getState().nodes[child.id] as ItemNode).blockFaceId).toBe('f-left')
        matrix(sceneRegistry.nodes.get(child.id))!.forEach((v, i) => {
          expect(v).toBeCloseTo(preview[i]!, 6)
        })
      } finally {
        await renderer.unmount()
      }
    })
  test('two-height top: the hit chooses height and plan retention never acquires the adjacent face', async () => {
    const { host, child } = seed('two-height')
    const renderer = await create(<Scene />)
    try {
      await settle(renderer)
      for (const [x, y] of [
        [-0.5, 1],
        [0.5, 2],
      ]) {
        const result = resolveSurfacePlacement({
          host,
          childKind: child.type,
          childId: child.id,
          childFootprint: { size: [2, 0.2, 2], rotationY: 0 },
          hit: { point: [x!, y!, 0], normalWorldY: 1 },
          scene: createSceneApi(useScene),
        })!
        expect(result.position[1]).toBe(y!)
      }
      const scene = createSceneApi(useScene)
      const session = nodeRegistry.get(child.type)!.floorplanMoveTarget!({
        node: child,
        nodes: scene.nodes(),
        sceneApi: scene,
      } as never)
      const modifiers = { altKey: false, shiftKey: false, metaKey: false, ctrlKey: false }
      await act(async () => {
        session.apply({ planPoint: [0.5, -1.5], modifiers })
        session.apply({ planPoint: [1.5, -1.5], modifiers })
        session.commit!()
      })
      expect(useScene.getState().nodes[child.id]!.parentId).toBe(level.id)
    } finally {
      await renderer.unmount()
    }
  })
}
