import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import {
  type AnyNode,
  BuildingNode,
  CabinetNode,
  ColumnNode,
  createSceneApi,
  emitter,
  getSurfaceProvider,
  ItemNode,
  LevelNode,
  nodeRegistry,
  nodeType,
  objectId,
  registerNode,
  resolveSurfacePlacement,
  ShelfNode,
  SiteNode,
  SlabNode,
  sceneRegistry,
  spatialGridManager,
  useLiveNodeOverrides,
  useLiveTransforms,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import { nodeLevelFrame, ProceduralItemNode, type Recipe } from '@pascal-app/core/procedural-items'
import { NodeRenderer, useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { events, type RootStore } from '@react-three/fiber'
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
import {
  BoxGeometry,
  Euler,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  Quaternion,
  Raycaster,
  Vector3,
} from 'three'
import {
  FloorplanRegistryLayer,
  splitFloorplanOverlay,
} from '../../../editor/src/components/editor-2d/renderers/floorplan-registry-layer'
import { MoveRegistryNodeTool } from '../../../editor/src/components/tools/registry/move-registry-node-tool'
import { useKeyboard } from '../../../editor/src/hooks/use-keyboard'
import useEditor from '../../../editor/src/store/use-editor'
import useInteractionScope from '../../../editor/src/store/use-interaction-scope'
import { FloorElevationSystem } from '../../../viewer/src/systems/floor-elevation/floor-elevation-system'
import { GeometrySystem } from '../../../viewer/src/systems/geometry/geometry-system'
import { ItemSystem } from '../../../viewer/src/systems/item/item-system'
import childlessPlan from '../column/__fixtures__/childless-plan.json'
import { planColumnEdit } from '../column/hosted-resize'
import { builtinPlugin } from '../index'
import { resolveItemTransform } from '../item/floorplan'
import { ItemGLTFLoader } from '../item/model-loader'
import { MoveItemTool } from '../item/move-tool'
import ItemTool from '../item/tool'
import { getDefaultPanelMaterial } from '../solar-panel/geometry'

// Other node tests install process-global renderer mocks; this audit must observe production modules.
if (process.env.PASCAL_COLUMN_TOPS_ISOLATED !== '1') {
  test('column tops with production registrations', async () => {
    const child = Bun.spawn(
      [process.execPath, 'run', 'test', 'src/__tests__/column-tops.test.tsx'],
      {
        cwd: new URL('../..', import.meta.url).pathname,
        env: { ...process.env, PASCAL_COLUMN_TOPS_ISOLATED: '1' },
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
  type Row = {
    kind: string
    mover: Mover
    order: string
    accepted: boolean
    parent: string
    mounted: boolean
    rendered: boolean
    survives: boolean
    samePose: boolean
    reloadRendered: boolean
    parsedSamePose: boolean | null
    parsedRendered: boolean | null
    parsedSurvives: boolean | null
    retainsChildren: boolean
    plan: boolean
    planError: string
    moveError: string
    parseError: string
  }
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
  // Invisible children have no mesh matrix; preserve their stored pose composed with the real host frame.
  function storedWorldMatrix(child: AnyNode) {
    const object = sceneRegistry.nodes.get(child.id)
    if (object) return matrix(object)
    const parent = sceneRegistry.nodes.get(child.parentId!)
    if (!parent) return undefined
    parent.updateWorldMatrix(true, false)
    const posed = child as unknown as {
      position: [number, number, number]
      rotation: [number, number, number]
    }
    const local = new Matrix4().compose(
      new Vector3(...posed.position),
      new Quaternion().setFromEuler(new Euler(...posed.rotation)),
      new Vector3(1, 1, 1),
    )
    return [...parent.matrixWorld.clone().multiply(local).elements]
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

  function seedColumn(mover: Mover, shape: string, mode: string) {
    const host = ColumnNode.parse({
      parentId: level.id,
      position: [1, 0, -1],
      rotation: Math.PI / 6,
      height: shape === 'round' ? 0.8 : 2.5,
      crossSection: shape,
      radius: 0.35,
      width: 0.5,
      depth: 0.35,
      capitalStyle: shape === 'round' ? 'none' : 'simple-slab',
      capitalWidthScale: 2,
      capitalDepthScale: 2,
      baseStyle: 'none',
      shaftProfile: 'straight',
      taper: 0,
      shaftStartScale: 1,
      shaftEndScale: 1,
    })
    const slab = SlabNode.parse({
      parentId: level.id,
      polygon: [
        [-5, -5],
        [5, -5],
        [5, 5],
        [-5, 5],
      ],
      elevation: 0.4,
    })
    const topY =
      getSurfaceProvider(host).surfaces?.(host, { scene: createSceneApi(useScene) })?.[0]
        ?.position[1] ?? host.height
    const values = {
      parentId: mode === 'regrab' ? host.id : level.id,
      position: mode === 'regrab' ? [0, topY, 0] : [-4, 0, -4],
      ...(mode === 'fresh' ? { metadata: { isNew: true } } : {}),
    }
    const child =
      mover === 'registry'
        ? ProceduralItemNode.parse({ recipe, ...values })
        : ItemNode.parse({ asset, ...values })
    useScene.setState({
      nodes: {
        [site.id]: { ...site, children: [building.id] },
        [building.id]: { ...building, children: [level.id] },
        [level.id]: {
          ...level,
          children: [slab.id, host.id, ...(mode === 'regrab' ? [] : [child.id])],
        },
        [host.id]: { ...host, children: mode === 'regrab' ? [child.id] : [] },
        ...(mode === 'fresh' && mover === 'catalog' ? {} : { [child.id]: child }),
        [slab.id]: slab,
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
    return { host, child }
  }
  for (const mover of ['catalog', 'registry'] as const)
    for (const order of ['grid first', 'host first'])
      for (const shape of ['round', 'rectangular'])
        for (const mode of ['fresh', 'move', 'regrab'])
          test(`${mover} ${mode} on ${shape}, ${order}: preview, commit and reload`, async () => {
            const { host, child } = seedColumn(mover, shape, mode)
            useEditor.getState().setMovingNode(child)
            let renderer = await create(<Scene mover={mover} child={child} />)
            try {
              await settle(renderer)
              const object = sceneRegistry.nodes.get(host.id)!
              const meshes = () => {
                const result: string[] = []
                object.traverse((o) => {
                  if (
                    (o as Mesh).isMesh &&
                    !Object.values(useScene.getState().nodes).some(
                      (n) => n.type === child.type && under(o, sceneRegistry.nodes.get(n.id)),
                    )
                  )
                    result.push(`${o.uuid}:${(o as Mesh).geometry.uuid}`)
                })
                return result
              }
              const initialMeshes = meshes()
              let event: any
              for (let i = 0; i < 6; i++) {
                const point: [number, number, number] = [
                  i * 0.01,
                  getSurfaceProvider(host).surfaces?.(host, {
                    scene: createSceneApi(useScene),
                  })?.[0]?.position[1] ?? host.height,
                  0,
                ]
                const nativeEvent = {}
                event = {
                  node: useScene.getState().nodes[host.id],
                  object,
                  normal: [0, 1, 0],
                  position: object.localToWorld(new Vector3(...point)).toArray(),
                  localPosition: point,
                  nativeEvent: { nativeEvent },
                  stopPropagation() {},
                }
                const grid = { ...event, position: [20, 0, 20], localPosition: [20, 0, 20] }
                await act(async () => {
                  if (order === 'grid first') emitter.emit('grid:move', grid)
                  emitter.emit('column:move', event)
                  emitter.emit('node:move', event)
                  if (order === 'host first') emitter.emit('grid:move', grid)
                })
                await settle(renderer)
                const current = Object.values(useScene.getState().nodes).find(
                  (n) =>
                    n.type === child.type &&
                    (mode !== 'fresh' || mover !== 'catalog' || n.id !== child.id),
                )!
                expect(current.parentId).toBe(host.id)
                expect(visible(sceneRegistry.nodes.get(current.id))).toBe(true)
                expect(under(sceneRegistry.nodes.get(current.id), object)).toBe(true)
                expect(meshes()).toEqual(initialMeshes)
                expect(object.position.y).toBeCloseTo(0.4, 5)
              }
              const current = Object.values(useScene.getState().nodes).find(
                (n) =>
                  n.type === child.type &&
                  (mode !== 'fresh' || mover !== 'catalog' || n.id !== child.id),
              )!
              const preview = matrix(sceneRegistry.nodes.get(current.id))!
              await act(async () => {
                emitter.emit('column:click', event)
                emitter.emit('node:click', event)
              })
              await settle(renderer)
              expect(useInteractionScope.getState().scope.kind).toBe('idle')
              const committedId = Object.values(useScene.getState().nodes).find(
                (n) => n.type === child.type,
              )!.id
              expect(useScene.getState().nodes[committedId]!.parentId).toBe(host.id)
              const committed = matrix(sceneRegistry.nodes.get(committedId))!
              preview.forEach((v, i) => {
                expect(committed[i]).toBeCloseTo(v, 5)
              })
              expect(plan(committedId)).toEqual({ plan: true, planError: '' })
              const saved = snapshot()
              await renderer.unmount()
              useScene.getState().setScene(saved.nodes, saved.rootNodeIds, saved)
              renderer = await create(<Scene />)
              await settle(renderer)
              expect(visible(sceneRegistry.nodes.get(committedId))).toBe(true)
              const reloaded = matrix(sceneRegistry.nodes.get(committedId))!
              committed.forEach((v, i) => {
                expect(reloaded[i]).toBeCloseTo(v, 5)
              })
            } finally {
              await renderer.unmount()
            }
          })

  for (const mover of ['catalog', 'registry'] as const)
    test(`${mover}: occupied top resize carries children or refuses loss of support`, async () => {
      const { host, child } = seedColumn(mover, 'rectangular', 'regrab')
      const renderer = await create(<Scene />)
      try {
        await settle(renderer)
        const definition = nodeRegistry.get('column')!
        const scene = createSceneApi(useScene)
        const handles =
          typeof definition.handles === 'function'
            ? definition.handles(host, scene)
            : definition.handles!
        const handle = handles.find((h) => h.kind === 'linear-resize' && h.axis === 'y')!
        const patch = handle.apply(host, 3, scene, { altKey: false })
        expect(
          handle
            .previewOverrides?.(host, 3, scene, { altKey: false })
            ?.some(([id]) => id === child.id),
        ).toBe(true)
        await act(async () => {
          if (handle.commit) handle.commit(host, patch, scene, { altKey: false })
          else scene.update(host.id, patch)
        })
        await settle(renderer)
        expect((useScene.getState().nodes[child.id] as ItemNode).position[1]).toBe(3)
        const width = handles.find((h) => h.kind === 'linear-resize' && h.axis === 'x')!
        await act(async () => scene.update(child.id, { position: [0.4, 3, 0] } as never))
        const narrow = width.apply(scene.get(host.id)!, 0.1, scene, { altKey: false })
        expect(narrow.width).toBe(host.width)
        expect(planColumnEdit(host.id, { capitalStyle: 'none' } as never)).toBeNull()
        const cap = planColumnEdit(host.id, { capitalStyle: 'stepped' } as never)!
        expect(cap.some(([id]) => id === child.id)).toBe(true)
        await act(async () =>
          useScene.getState().updateNodes(cap.map(([id, data]) => ({ id, data }))),
        )
        await settle(renderer)
        const resized = scene.get(host.id)!
        const top = getSurfaceProvider(resized).surfaces!(resized, { scene })[0]!
        expect((scene.get(child.id) as ItemNode).position[1]).toBeCloseTo(top.position[1], 6)
        expect(sceneRegistry.nodes.get(child.id)!.getWorldPosition(new Vector3()).y).toBeCloseTo(
          top.position[1] + 0.4,
          6,
        )
      } finally {
        await renderer.unmount()
      }
    })
  for (const mover of ['catalog', 'registry'] as const)
    test(`${mover}: column transforms, undo, subtree and 2D keep/release`, async () => {
      const { host, child } = seedColumn(mover, 'rectangular', 'regrab')
      const renderer = await create(<Scene />)
      try {
        await settle(renderer)
        const object = sceneRegistry.nodes.get(child.id)!
        expect(object.getWorldPosition(new Vector3()).y).toBeCloseTo(2.9, 5)
        await act(async () =>
          useScene.setState({ nodes: structuredClone(useScene.getState().nodes) }),
        )
        await settle(renderer)
        expect(sceneRegistry.nodes.get(host.id)!.position.y).toBeCloseTo(0.4, 5)
        const scene = createSceneApi(useScene)
        const before = matrix(object)!
        useScene.temporal.getState().resume()
        await act(async () =>
          scene.update(host.id, { position: [2, 0, -2], rotation: 1.1 } as never),
        )
        await settle(renderer)
        const moved = matrix(object)!
        expect(moved[12]).toBeCloseTo(2, 5)
        expect(Math.atan2(moved[8]!, moved[10]!)).toBeCloseTo(1.1, 5)
        await act(async () => useScene.temporal.getState().undo())
        await settle(renderer)
        matrix(object)!.forEach((v, i) => {
          expect(v).toBeCloseTo(before[i]!, 5)
        })
        useScene.temporal.getState().pause()
        const dirty = spyOn(useScene.getState(), 'markDirty')
        await act(async () =>
          useLiveTransforms.getState().set(host.id, { position: [2, 0, -2], rotation: 0.8 }),
        )
        await settle(renderer)
        expect(dirty.mock.calls.some(([id]) => id === child.id)).toBe(true)
        dirty.mockRestore()
        await act(async () => useLiveTransforms.getState().clear(host.id))
        await settle(renderer)
        expect(sceneRegistry.nodes.get(host.id)!.position.y).toBeCloseTo(0.4, 5)
        const subtree = scene.getSubtree(host.id)!
        let cloneId: AnyNode['id']
        await act(async () => {
          cloneId = scene.cloneNodesInto([subtree.root, ...subtree.descendants], {
            rootId: host.id,
            parentId: level.id,
            position: [3, 0, 0],
          })!
        })
        await settle(renderer)
        const cloned = scene.getSubtree(cloneId!)!
        expect(cloned.descendants.length).toBe(1)
        expect(visible(sceneRegistry.nodes.get(cloned.descendants[0]!.id))).toBe(true)
        await act(async () => useScene.getState().deleteNode(cloneId!))
        expect(useScene.getState().nodes[cloned.descendants[0]!.id]).toBeUndefined()
        const source = useScene.getState().nodes[child.id]!
        const session = nodeRegistry.get(source.type)!.floorplanMoveTarget!({
          node: source,
          nodes: scene.nodes(),
          sceneApi: scene,
        } as never)
        const modifiers = { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false }
        await act(async () => {
          session.apply({ planPoint: [1, -1], modifiers })
          session.apply({ planPoint: [1.1, -1], modifiers })
        })
        expect(
          useLiveNodeOverrides.getState().get(child.id)?.parentId ?? scene.get(child.id)!.parentId,
        ).toBe(host.id)
        await act(async () => session.apply({ planPoint: [4, 4], modifiers }))
        expect(session.canCommit()).toBe(true)
        await act(async () => session.commit!())
        await settle(renderer)
        const released = scene.get(child.id) as ItemNode
        expect(released.parentId).toBe(level.id)
        expect(released.position[1]).toBe(0)
        expect(visible(sceneRegistry.nodes.get(child.id))).toBe(true)
        expect(plan(child.id).plan).toBe(true)
      } finally {
        await renderer.unmount()
      }
    })

  test('column body paints below its selectable hosted children in plan', async () => {
    const { host, child } = seedColumn('catalog', 'round', 'regrab')
    const renderer = await create(<Scene />)
    try {
      await settle(renderer)
      expect(plan(child.id).plan).toBe(true)
      const geometry = nodeRegistry.get('column')!.floorplan!(
        useScene.getState().nodes[host.id]!,
        {} as never,
      )!
      const { base, overlay } = splitFloorplanOverlay(geometry)
      expect(base).not.toBeNull()
      const opaquePolygons = (node: any): any[] =>
        node?.kind === 'group'
          ? node.children.flatMap(opaquePolygons)
          : node?.kind === 'polygon' && node.fill && node.fill !== 'none'
            ? [node]
            : []
      expect(opaquePolygons(base)).toHaveLength(1)
      expect(opaquePolygons(overlay)).toHaveLength(0)
    } finally {
      await renderer.unmount()
    }
  })

  for (const order of ['grid first', 'host first'])
    test(`catalog reaches undeclared geometry plugin, ${order}`, async () => {
      const { host: oldHost, child } = seedColumn('catalog', 'round', 'move')
      const kind = 'plugin:column-audit'
      const schema = nodeRegistry
        .get('shelf')!
        .schema.extend({ id: objectId(kind), type: nodeType(kind) })
      registerNode({
        kind,
        schema,
        schemaVersion: 1,
        category: 'furnish',
        defaults: () => ({}),
        capabilities: {},
        geometry: () => {
          const group = new Group()
          group.add(
            new Mesh(new BoxGeometry(2, 1, 2).translate(0, 0.5, 0), new MeshBasicMaterial()),
          )
          return group
        },
      } as never)
      const host = schema.parse({ parentId: level.id, position: [0, 0, 0] }) as AnyNode
      useScene.getState().deleteNode(oldHost.id)
      useScene.getState().createNode(host, level.id)
      useEditor.getState().setMovingNode(child)
      const renderer = await create(<Scene mover="catalog" child={child} />)
      try {
        await settle(renderer)
        const object = sceneRegistry.nodes.get(host.id)!
        const nativeEvent = {}
        const event = {
          node: host,
          object,
          position: [0, 1, 0],
          localPosition: [0, 1, 0],
          normal: [0, 1, 0],
          nativeEvent: { nativeEvent },
          stopPropagation() {},
        }
        const grid = { ...event, position: [10, 0, 10], localPosition: [10, 0, 10] }
        await act(async () => {
          if (order === 'grid first') emitter.emit('grid:move', grid as never)
          emitter.emit('node:move', event as never)
          if (order === 'host first') emitter.emit('grid:move', grid as never)
        })
        await settle(renderer)
        expect(useScene.getState().nodes[child.id]!.parentId).toBe(host.id)
        expect(visible(sceneRegistry.nodes.get(child.id))).toBe(true)
        // Exercise self-click forwarding, including the paired generic event.
        await act(async () => {
          const self = { ...event, node: useScene.getState().nodes[child.id]! }
          emitter.emit('item:click', self as never)
          emitter.emit('node:click', self as never)
        })
        await settle(renderer)
        expect(useInteractionScope.getState().scope.kind).toBe('idle')
        expect(useScene.getState().nodes[child.id]!.parentId).toBe(host.id)
      } finally {
        await renderer.unmount()
      }
    })

  for (const shape of ['round', 'square', 'rectangular', 'octagonal', 'sixteen-sided'])
    for (const capital of ['none', 'simple-slab', 'stepped'])
      test(`${shape}/${capital}: surface height agrees with rendered geometry and cap centre rule`, async () => {
        const { host: seeded } = seedColumn('catalog', 'round', 'move')
        const host = ColumnNode.parse({
          ...seeded,
          crossSection: shape,
          capitalStyle: capital,
          capitalHeight: 0.2,
          shaftTaper: 0,
          shaftStartScale: 1,
          shaftEndScale: 1,
          ringCount: 0,
        })
        useScene.getState().updateNode(host.id, host)
        const renderer = await create(<Scene />)
        try {
          await settle(renderer)
          const object = sceneRegistry.nodes.get(host.id)!
          object.updateWorldMatrix(true, true)
          const origin = object.localToWorld(new Vector3(0, 10, 0))
          const ray = new Raycaster(origin, new Vector3(0, -1, 0))
          ray.layers.enableAll()
          const hit = ray.intersectObject(object, true)[0]!
          const point = object.worldToLocal(hit.point.clone()).toArray()
          const resolve = (x: number) =>
            resolveSurfacePlacement({
              host,
              childKind: 'item',
              childFootprint: { size: [0.1, 0.2, 0.1], rotationY: 0 },
              hit: { point: [x, point[1], 0], normalWorldY: 1 },
              scene: createSceneApi(useScene),
            })
          expect(resolve(0)!.position[1]).toBeCloseTo(point[1], 5)
          if (capital !== 'none') {
            expect(resolve(0.3)).not.toBeNull()
            expect(resolve(1)).toBeNull()
          }
        } finally {
          await renderer.unmount()
        }
      })
  function genericHost(parentId = level.id) {
    const kind = 'plugin:column-audit'
    const schema = nodeRegistry
      .get('shelf')!
      .schema.extend({ id: objectId(kind), type: nodeType(kind) })
    registerNode({
      kind,
      schema,
      schemaVersion: 1,
      category: 'furnish',
      defaults: () => ({}),
      capabilities: {
        floorPlaced: { footprint: () => ({ dimensions: [2, 1, 2], rotation: [0, 0.6, 0] }) },
      },
      geometry: () => {
        const group = new Group()
        group.add(new Mesh(new BoxGeometry(2, 1, 2).translate(0, 0.5, 0), new MeshBasicMaterial()))
        return group
      },
    } as never)
    return schema.parse({ parentId, position: [1, 0, -1], rotation: [0, 0.6, 0] }) as AnyNode
  }
  function hostEvent(host: AnyNode, point: [number, number, number], normal = [0, 1, 0]) {
    const object = sceneRegistry.nodes.get(host.id)!
    return {
      node: host,
      object,
      position: object.localToWorld(new Vector3(...point)).toArray(),
      localPosition: point,
      normal,
      nativeEvent: { nativeEvent: {} },
      stopPropagation() {},
    }
  }
  async function pairedMove(event: any, order: string) {
    const grid = { ...event, position: [8, 0, 8], localPosition: [8, 0, 8] }
    await act(async () => {
      if (order === 'grid first') emitter.emit('grid:move', grid)
      emitter.emit(`${event.node.type}:move` as never, event)
      emitter.emit('node:move', event)
      if (order === 'host first') emitter.emit('grid:move', grid)
    })
    return grid
  }
  for (const order of ['grid first', 'host first'])
    for (const rejection of ['vertical side', 'outside region'])
      test(`audit: rejected generic ${rejection} yields to floor, ${order}`, async () => {
        const { host, child } = seedColumn('catalog', 'rectangular', 'move')
        useEditor.getState().setMovingNode(child)
        const renderer = await create(<Scene mover="catalog" child={child} />)
        try {
          await settle(renderer)
          await act(async () =>
            emitter.emit('grid:move', {
              position: [-4, 0, -4],
              localPosition: [-4, 0, -4],
              normal: [0, 1, 0],
              nativeEvent: {},
              stopPropagation() {},
            } as never),
          )
          await settle(renderer)
          const event = hostEvent(
            host,
            rejection === 'vertical side' ? [0.25, 1, 0] : [3, 2.5, 0],
            rejection === 'vertical side' ? [1, 0, 0] : [0, 1, 0],
          )
          const grid = await pairedMove(event, order)
          await settle(renderer)
          expect(useScene.getState().nodes[child.id]!.parentId).toBe(level.id)
          expect(
            sceneRegistry.nodes.get(child.id)!.getWorldPosition(new Vector3()).toArray(),
          ).toEqual([8, 0, 8])
          await act(async () => emitter.emit('grid:click', grid))
          await settle(renderer)
          expect(useInteractionScope.getState().scope.kind).toBe('idle')
          expect((useScene.getState().nodes[child.id] as ItemNode).position).toEqual([8, 0, 8])
        } finally {
          await renderer.unmount()
        }
      })

  for (const mover of ['catalog', 'registry'] as const)
    for (const kind of ['column', 'plugin', 'shelf', 'cabinet', 'item'])
      test(`audit: shared frame equals mounted ${mover} under ${kind}, slab and rotated building`, async () => {
        const { host: column, child } = seedColumn(mover, 'rectangular', 'regrab')
        const host =
          kind === 'column'
            ? useScene.getState().nodes[column.id]!
            : kind === 'plugin'
              ? genericHost()
              : kind === 'shelf'
                ? ShelfNode.parse({
                    parentId: level.id,
                    position: [1, 0, -1],
                    rotation: [0, 0.6, 0],
                  })
                : kind === 'cabinet'
                  ? CabinetNode.parse({ parentId: level.id, position: [1, 0, -1], rotation: 0.6 })
                  : ItemNode.parse({
                      parentId: level.id,
                      position: [1, 0, -1],
                      rotation: [0, 0.6, 0],
                      asset,
                    })
        const nodes = { ...useScene.getState().nodes }
        delete nodes[column.id]
        nodes[host.id] = { ...host, children: [child.id] } as AnyNode
        nodes[child.id] = { ...child, parentId: host.id, position: [0.2, 2.5, 0.1] } as AnyNode
        nodes[level.id] = {
          ...nodes[level.id],
          children: [
            ...(nodes[level.id] as LevelNode).children.filter((id) => id !== column.id),
            host.id,
          ],
        } as AnyNode
        nodes[building.id] = {
          ...nodes[building.id],
          position: [3, 1, -2],
          rotation: [0, 0.7, 0],
        } as AnyNode
        useScene.setState({ nodes, dirtyNodes: new Set(Object.keys(nodes) as AnyNode['id'][]) })
        const renderer = await create(<Scene />)
        try {
          await settle(renderer)
          const shared = nodeLevelFrame(child.id, nodes)
          expect(shared.position[1]).toBeCloseTo(2.9, 6)
          const actual = sceneRegistry.nodes.get(child.id)!
          actual.updateWorldMatrix(true, false)
          const levelObject = sceneRegistry.nodes.get(level.id)!
          levelObject.updateWorldMatrix(true, false)
          const local = levelObject.matrixWorld.clone().invert().multiply(actual.matrixWorld)
          expect(local.elements[13]).toBeCloseTo(shared.position[1], 6)
          shared.position.forEach((v, i) => {
            expect(local.elements[12 + i]).toBeCloseTo(v, 6)
          })
          shared.axes.forEach((axis, i) => {
            axis.forEach((v, j) => {
              expect(local.elements[i * 4 + j]).toBeCloseTo(v, 6)
            })
          })
          if (mover === 'catalog') {
            const planPose = resolveItemTransform(
              nodes[child.id] as ItemNode,
              { resolve: (id: string) => nodes[id] } as never,
            )!
            expect(planPose.x).toBeCloseTo(local.elements[12]!, 6)
            expect(planPose.y).toBeCloseTo(local.elements[14]!, 6)
            expect(planPose.rotation).toBeCloseTo(
              Math.atan2(local.elements[8]!, local.elements[10]!),
              6,
            )
          }
        } finally {
          await renderer.unmount()
        }
      })

  for (const shape of ['round', 'rectangular'])
    for (const selected of [false, true])
      test(`audit: childless column plan remains identical to main, ${shape}/${selected}`, async () => {
        const { host } = seedColumn('catalog', shape, 'move')
        const renderer = await create(<Scene />)
        try {
          await settle(renderer)
          const geometry = nodeRegistry.get('column')!.floorplan!(host, {
            viewState: { selected },
          } as never)!
          expect(JSON.parse(JSON.stringify(geometry))).toEqual(
            childlessPlan[`${shape}:${selected}` as keyof typeof childlessPlan],
          )
          expect(splitFloorplanOverlay(geometry).base).toBeNull()
        } finally {
          await renderer.unmount()
        }
      })
  function pointerDispatcher() {
    const object = sceneRegistry.nodes.get(level.id)! as Object3D & { __r3f: { root: RootStore } }
    const store = object.__r3f.root
    const manager = events(store)
    store.setState({ events: manager })
    const state = store.getState()
    state.setSize(1000, 1000)
    state.camera.position.set(1, 12, -1)
    state.camera.up.set(0, 0, -1)
    state.camera.lookAt(1, 0, -1)
    state.camera.updateMatrixWorld()
    state.raycaster.layers.enableAll()
    return (point: Vector3, phase: 'onPointerMove' | 'onPointerUp' = 'onPointerMove') => {
      state.scene.updateMatrixWorld(true)
      const ndc = point.clone().project(state.camera)
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
  for (const order of ['grid first', 'host first'])
    for (const shape of ['round', 'rectangular'])
      test(`audit: real ItemTool fresh creation on ${shape}, R3F ${order}`, async () => {
        const { host } = seedColumn('catalog', shape, 'fresh')
        useEditor.setState({ selectedItem: asset })
        useEditor.getState().setContinuation('point', 'single')
        const renderer = await create(<Scene fresh />)
        try {
          await settle(renderer)
          const draft = Object.values(useScene.getState().nodes).find((n) => n.type === 'item')!
          expect(draft).toBeDefined()
          const pointer = pointerDispatcher()
          const point = sceneRegistry.nodes
            .get(host.id)!
            .localToWorld(new Vector3(0.05, host.height, 0))
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
          await settle(renderer)
          expect(useScene.getState().nodes[draft.id]!.parentId).toBe(host.id)
          const preview = matrix(sceneRegistry.nodes.get(draft.id))!
          await act(async () => pointer(point, 'onPointerUp').dispatch())
          await settle(renderer)
          const committed = Object.values(useScene.getState().nodes).find((n) => n.type === 'item')!
          expect(committed.parentId).toBe(host.id)
          expect(committed.metadata?.isNew).not.toBe(true)
          expect(useEditor.getState().mode).toBe('select')
          matrix(sceneRegistry.nodes.get(committed.id))!.forEach((v, i) => {
            expect(v).toBeCloseTo(preview[i]!, 6)
          })
        } finally {
          await renderer.unmount()
        }
      })

  for (const arrangement of ['column child', 'countertop under generic ancestor'])
    for (const order of ['grid first', 'host first'])
      test(`audit: R3F bubbling gives specialized item top exclusive ownership, ${arrangement}, ${order}`, async () => {
        const { host: column, child } = seedColumn('catalog', 'rectangular', 'move')
        let parent: AnyNode = useScene.getState().nodes[column.id]!
        if (arrangement !== 'column child') {
          const ancestor = genericHost()
          useScene.getState().deleteNode(column.id)
          useScene.getState().createNode(ancestor, level.id)
          parent = CabinetNode.parse({ parentId: ancestor.id, position: [0, 1, 0], rotation: 0 })
          useScene.getState().createNode(parent, ancestor.id)
        }
        const top = ItemNode.parse({
          parentId: parent.id,
          asset: { ...asset, dimensions: [0.4, 0.2, 0.4] },
          position: [0, arrangement === 'column child' ? 2.5 : 1, 0],
        })
        useScene.getState().createNode(top, parent.id)
        useEditor.getState().setMovingNode(child)
        const renderer = await create(<Scene mover="catalog" child={child} />)
        const seen: string[] = []
        const observe = (event: any) => seen.push(event.node.id)
        emitter.on('node:move', observe)
        try {
          await settle(renderer)
          const pointer = pointerDispatcher()
          const point = sceneRegistry.nodes.get(top.id)!.localToWorld(new Vector3(0, 0.2, 0))
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
          await settle(renderer)
          expect(seen).toEqual([top.id])
          expect(useScene.getState().nodes[child.id]!.parentId).toBe(top.id)
          expect(visible(sceneRegistry.nodes.get(child.id))).toBe(true)
          await act(async () => pointer(point, 'onPointerUp').dispatch())
          await settle(renderer)
          expect(useInteractionScope.getState().scope.kind).toBe('idle')
          expect(useScene.getState().nodes[child.id]!.parentId).toBe(top.id)
        } finally {
          emitter.off('node:move', observe)
          await renderer.unmount()
        }
      })

  for (const strict of [false, true])
    test(`audit: generic route R/T, Escape and queued grid cleanup, Strict Mode ${strict}`, async () => {
      const { host, child } = seedColumn('catalog', 'rectangular', 'move')
      useEditor.getState().setMovingNode(child)
      const content = <Scene mover="catalog" child={child} keyboard />
      const renderer = await create(
        strict ? <React.StrictMode>{content}</React.StrictMode> : content,
      )
      const key = async (key: string) =>
        act(async () => {
          window.dispatchEvent(
            Object.assign(new Event('keydown', { cancelable: true }), {
              key,
              code: key === 'Escape' ? 'Escape' : `Key${key.toUpperCase()}`,
            }),
          )
        })
      try {
        await settle(renderer)
        const point = sceneRegistry.nodes.get(host.id)!.localToWorld(new Vector3(0, 2.5, 0))
        await act(async () => pointerDispatcher()(point).dispatch())
        await settle(renderer)
        expect(useScene.getState().nodes[child.id]!.parentId).toBe(host.id)
        const rotation = () =>
          (
            (useLiveNodeOverrides.getState().get(child.id)?.rotation ??
              (useScene.getState().nodes[child.id] as ItemNode).rotation) as number[]
          )[1]!
        const initial = rotation()
        await key('r')
        await settle(renderer)
        const rotated = rotation()
        expect(rotated).not.toBe(initial)
        await key('t')
        await settle(renderer)
        expect(rotation()).toBeCloseTo(rotated - Math.PI / 4, 6)
        await act(async () => {
          emitter.emit('grid:move', {
            position: [8, 0, 8],
            localPosition: [8, 0, 8],
            nativeEvent: {},
            stopPropagation() {},
          } as never)
          window.dispatchEvent(
            Object.assign(new Event('keydown', { cancelable: true }), {
              key: 'Escape',
              code: 'Escape',
            }),
          )
        })
        await settle(renderer)
        expect(useInteractionScope.getState().scope.kind).toBe('idle')
        expect(useScene.getState().nodes[child.id]).toEqual(child)
        expect(visible(sceneRegistry.nodes.get(child.id))).toBe(true)
      } finally {
        await renderer.unmount()
      }
    })

  for (const mover of ['catalog', 'registry'] as const)
    for (const operation of ['height', 'clone', 'delete'])
      test(`audit: ${mover} column subtree ${operation} undo/redo`, async () => {
        const { host, child } = seedColumn(mover, 'rectangular', 'regrab')
        const renderer = await create(<Scene />)
        try {
          await settle(renderer)
          const before = snapshot().nodes
          const beforePose = matrix(sceneRegistry.nodes.get(child.id))!
          useScene.temporal.getState().resume()
          useScene.temporal.getState().clear()
          let target = child.id
          await act(async () => {
            if (operation === 'height')
              useScene.getState().updateNodes(
                planColumnEdit(host.id, { height: 3 } as never)!.map(([id, data]) => ({
                  id,
                  data,
                })),
              )
            else if (operation === 'delete') useScene.getState().deleteNode(host.id)
            else {
              const scene = createSceneApi(useScene)
              const subtree = scene.getSubtree(host.id)!
              const cloneId = scene.cloneNodesInto([subtree.root, ...subtree.descendants], {
                rootId: host.id,
                parentId: level.id,
                position: [3, 0, 0],
              })!
              target = scene.getSubtree(cloneId)!.descendants[0]!.id
            }
          })
          await settle(renderer)
          const after = snapshot().nodes
          const afterPose = matrix(sceneRegistry.nodes.get(target))
          if (operation === 'height') expect(afterPose![13]).toBeCloseTo(3.4, 6)
          else if (operation === 'clone')
            expect(visible(sceneRegistry.nodes.get(target))).toBe(true)
          else expect(useScene.getState().nodes[child.id]).toBeUndefined()
          await act(async () => useScene.temporal.getState().undo())
          await settle(renderer)
          expect(snapshot().nodes).toEqual(before)
          matrix(sceneRegistry.nodes.get(child.id))!.forEach((v, i) => {
            expect(v).toBeCloseTo(beforePose[i]!, 6)
          })
          await act(async () => useScene.temporal.getState().redo())
          await settle(renderer)
          expect(snapshot().nodes).toEqual(after)
          if (operation === 'delete') expect(sceneRegistry.nodes.get(child.id)).toBeUndefined()
          else
            matrix(sceneRegistry.nodes.get(target))!.forEach((v, i) => {
              expect(v).toBeCloseTo(afterPose![i]!, 6)
            })
        } finally {
          await renderer.unmount()
        }
      })
}
