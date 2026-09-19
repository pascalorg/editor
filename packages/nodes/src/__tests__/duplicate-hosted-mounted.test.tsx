import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import * as Core from '@pascal-app/core'
import {
  type AnyNode,
  type AnyNodeId,
  BlockNode,
  BuildingNode,
  CabinetModuleNode,
  CabinetNode,
  ColumnNode,
  createBoxBlockTopology,
  emitter,
  getEffectiveNode,
  ItemNode,
  LevelNode,
  MeasurementNode,
  nodeRegistry,
  nodeType,
  objectId,
  registerNode,
  ShelfNode,
  SiteNode,
  SlabNode,
  sceneRegistry,
  spatialGridManager,
  subscribeSceneCommits,
  useLiveNodeOverrides,
  useLiveTransforms,
  useRegistry,
  useScene,
  WallNode,
  ZoneNode,
} from '@pascal-app/core'
import { nodeLevelFrame, ProceduralItemNode, type Recipe } from '@pascal-app/core/procedural-items'
import { NodeRenderer, useViewer, WallSystem } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { events, type RootStore, useThree } from '@react-three/fiber'
import { act, create } from '@react-three/test-renderer'
import {
  Children,
  Component,
  isValidElement,
  type ReactNode,
  StrictMode,
  useMemo,
  useRef,
} from 'react'
import * as ReactDOM from 'react-dom'
import {
  BoxGeometry,
  Euler,
  Group,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  Raycaster,
  Vector2,
  Vector3,
} from 'three'
import gridTableRecipe from '../../../core/src/procedural-items/__fixtures__/grid-table.json'
import { counterRecipe } from '../../../core/src/procedural-items/fixtures'
import { FloatingActionMenu } from '../../../editor/src/components/editor/floating-action-menu'
import { NodeActionMenu } from '../../../editor/src/components/editor/node-action-menu'
import { FloorplanRegistryActionMenu } from '../../../editor/src/components/editor-2d/floorplan-registry-action-menu'
import { FloorplanRegistryMoveOverlay } from '../../../editor/src/components/editor-2d/floorplan-registry-move-overlay'
import { MoveRegistryNodeTool } from '../../../editor/src/components/tools/registry/move-registry-node-tool'
import { CATALOG_ITEMS } from '../../../editor/src/components/ui/item-catalog/catalog-items'
import { useGridEvents } from '../../../editor/src/hooks/use-grid-events'
import { useKeyboard } from '../../../editor/src/hooks/use-keyboard'
import {
  createFreshPlacementSubtree,
  duplicatesAsFreshSubtree,
} from '../../../editor/src/lib/fresh-planar-placement'
import { applySceneGraphToEditor } from '../../../editor/src/lib/scene'
import { surfaceAttachmentId } from '../../../editor/src/lib/surface-attachment'
import useEditor from '../../../editor/src/store/use-editor'
import useInteractionScope, {
  getMovingNode,
  useMovingNode,
} from '../../../editor/src/store/use-interaction-scope'
import usePlacementPreview from '../../../editor/src/store/use-placement-preview'
import { FloorElevationSystem } from '../../../viewer/src/systems/floor-elevation/floor-elevation-system'
import { GeometrySystem } from '../../../viewer/src/systems/geometry/geometry-system'
import { ItemSystem } from '../../../viewer/src/systems/item/item-system'
import { builtinPlugin } from '../index'
import { ItemGLTFLoader } from '../item/model-loader'
import { MoveItemTool } from '../item/move-tool'
import ItemTool from '../item/tool'
import { getDefaultPanelMaterial } from '../solar-panel/geometry'

// Other node tests install process-global renderer mocks; this audit must observe production modules.
if (process.env.PASCAL_DUPLICATE_AUDIT_ISOLATED !== '1') {
  test('duplicate audit with production movers, menus and pointer events', async () => {
    const child = Bun.spawn(
      [process.execPath, 'run', 'test', 'src/__tests__/duplicate-hosted-mounted.test.tsx'],
      {
        cwd: new URL('../..', import.meta.url).pathname,
        env: { ...process.env, PASCAL_DUPLICATE_AUDIT_ISOLATED: '1' },
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
  let htmlChildren: ReactNode[] = []
  let portal: ReturnType<typeof spyOn>
  let frames: FrameRequestCallback[] = []
  let htmlLabels: ReturnType<typeof spyOn>

  beforeEach(() => {
    htmlLabels = spyOn(Html as unknown as { render: () => ReactNode }, 'render').mockImplementation(
      (props: { children?: ReactNode }) => {
        htmlChildren.push(props.children)
        return null
      },
    )
    htmlChildren = []
    portal = spyOn(ReactDOM, 'createPortal').mockImplementation((children) => {
      htmlChildren.push(children)
      return null as never
    })
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
      'DOMRect',
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
    globalThis.window = Object.assign(new EventTarget(), {
      matchMedia: () => Object.assign(new EventTarget(), { matches: false }),
    }) as Window & typeof globalThis
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
    const svg = {
      getBoundingClientRect: () => ({ left: -100, top: -100, right: 100, bottom: 100 }),
      createSVGPoint: () => ({
        x: 0,
        y: 0,
        matrixTransform() {
          return { x: this.x, y: this.y }
        },
      }),
    }
    Object.assign(document, {
      createElementNS: () => ({ setAttribute() {}, remove() {} }),
      querySelector: () => ({
        appendChild() {},
        ownerSVGElement: svg,
        getScreenCTM: () => ({ inverse: () => ({}) }),
        querySelector: () => ({ getBoundingClientRect: () => ({ left: 0, top: 0, width: 10 }) }),
      }),
    })
    frames = []
    globalThis.requestAnimationFrame = (callback) => {
      frames.push(callback)
      return frames.length
    }
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
    portal.mockRestore()
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

  function CatalogMover({ source }: { source: ItemNode }) {
    const node = useMemo(() => structuredClone(source), [source])
    return <MoveItemTool node={node} />
  }
  function Grid() {
    const canvas = useThree((s) => s.gl.domElement)
    if (!(canvas as any).__native) {
      const target = Object.assign(new EventTarget(), {
        setPointerCapture() {},
        releasePointerCapture() {},
      })
      Object.assign(canvas, {
        __native: target,
        addEventListener: target.addEventListener.bind(target),
        removeEventListener: target.removeEventListener.bind(target),
        dispatchEvent: target.dispatchEvent.bind(target),
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 1000 }),
      })
    }
    useGridEvents(0)
    return null
  }
  function Scene({
    mover,
    child,
    fresh = false,
    menu = false,
    panes,
  }: {
    mover?: Mover
    child?: AnyNode
    fresh?: boolean
    menu?: boolean
    panes?: { plan: boolean; spatial: boolean }
  }) {
    useKeyboard({})
    const plan = useEditor((s) => s.viewMode === '2d')
    const children = useScene((s) => (s.nodes[level.id] as LevelNode).children)
    const activeNode = useMovingNode()
    const source = child ?? activeNode
    const moving = useInteractionScope(
      (s) => s.scope.kind === 'moving' || s.scope.kind === 'placing',
    )
    const armed = useEditor((s) => s.mode === 'build' && s.tool === 'item')
    const ref = useRef<Group>(null!)
    useRegistry(level.id, 'level', ref)
    return (
      <>
        <group ref={ref}>
          {children.map((id) => (
            <NodeRenderer key={id} nodeId={id} />
          ))}
        </group>
        <Grid />
        {menu && (plan ? <FloorplanRegistryActionMenu /> : <FloatingActionMenu />)}
        {(panes?.plan ?? plan) && moving && <FloorplanRegistryMoveOverlay />}
        {fresh && armed && <ItemTool />}
        {moving &&
          (panes?.spatial ?? !plan) &&
          source &&
          (source.type === 'item' ? (
            <CatalogMover source={source as ItemNode} />
          ) : (
            <MoveRegistryNodeTool node={source} />
          ))}
        <FloorElevationSystem />
        <ItemSystem />
        <GeometrySystem />
        <WallSystem />
      </>
    )
  }
  async function settle(renderer: Awaited<ReturnType<typeof create>>) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 15))
    })
    await act(async () => renderer.advanceFrames(3, 1 / 60))
    await act(async () => {
      for (const callback of frames.splice(0)) callback(0)
    })
  }
  function seed(entries: AnyNode[], slab = false) {
    const support = SlabNode.parse({
      parentId: level.id,
      elevation: 0.4,
      polygon: [
        [-10, -10],
        [10, -10],
        [10, 10],
        [-10, 10],
      ],
    })
    const nodes = Object.fromEntries(
      [site, building, level, ...entries, ...(slab ? [support] : [])].map((n) => [
        n.id,
        { ...n, children: [] },
      ]),
    ) as Record<AnyNodeId, AnyNode>
    for (const n of Object.values(nodes))
      if (n.parentId) (nodes[n.parentId] as AnyNode & { children: string[] })?.children?.push(n.id)
    useScene.setState({
      nodes,
      rootNodeIds: [site.id],
      dirtyNodes: new Set(entries.map((n) => n.id)),
      readOnly: false,
      materials: {},
      collections: {},
      installedPlugins: [],
    })
    if (slab) spatialGridManager.handleNodeCreated(support, level.id)
    useScene.temporal.getState().clear()
    useScene.temporal.getState().pause()
    useInteractionScope.getState().end()
    useEditor.setState({
      mode: 'build',
      tool: 'item',
      movingNodeOrigin: '3d',
      placementDragMode: false,
      isFloorplanHovered: false,
      viewMode: '3d',
    })
    useEditor.getState().setSnappingMode('item', 'off')
    useEditor.getState().setContinuation('point', 'single')
    useViewer.setState({
      textures: false,
      cameraDragging: false,
      inputDragging: false,
      showZones: false,
      showMeasurements: false,
      selection: { buildingId: building.id, levelId: level.id, zoneId: null, selectedIds: [] },
    })
  }
  function world(id: AnyNodeId) {
    const o = sceneRegistry.nodes.get(id)!
    o.updateWorldMatrix(true, true)
    return o.getWorldPosition(new Vector3())
  }
  function pointerDispatcher(side = false) {
    const object = sceneRegistry.nodes.get(level.id)! as Object3D & { __r3f: { root: RootStore } }
    const store = object.__r3f.root
    const manager = events(store)
    store.setState({ events: manager })
    const state = store.getState()
    state.setSize(1000, 1000)
    state.camera.position.set(...((side ? [0, 1.2, 5] : [0, 10, 0]) as [number, number, number]))
    state.camera.up.set(0, 0, -1)
    state.camera.lookAt(0, side ? 0.4 : 0, 0)
    state.camera.updateMatrixWorld()
    state.raycaster.layers.enableAll()
    const ray = (point: Vector3) => {
      state.scene.updateMatrixWorld(true)
      const ndc = point.clone().project(state.camera)
      const cast = new Raycaster()
      cast.layers.enableAll()
      cast.setFromCamera(new Vector2(ndc.x, ndc.y), state.camera)
      return { ndc, cast }
    }
    const dispatch = (point: Vector3, order: string, click = false) => {
      const { ndc } = ray(point)
      const type = click ? 'pointerup' : 'pointermove'
      const native = Object.assign(new Event(type), {
        offsetX: (ndc.x + 1) * 500,
        offsetY: (1 - ndc.y) * 500,
        clientX: (ndc.x + 1) * 500,
        clientY: (1 - ndc.y) * 500,
        pointerId: 1,
        button: 0,
      })
      const grid = () => state.gl.domElement.dispatchEvent(native)
      const host = () => manager.handlers![click ? 'onPointerUp' : 'onPointerMove'](native as never)
      if (order === 'grid first') {
        grid()
        host()
      } else {
        host()
        grid()
      }
      if (click)
        state.gl.domElement.dispatchEvent(
          Object.assign(new Event('click'), {
            clientX: native.clientX,
            clientY: native.clientY,
            button: 0,
          }),
        )
    }
    return {
      ray,
      send: (point: Vector3, order: string, click = false) =>
        act(async () => dispatch(point, order, click)),
      // One input frame coalesces grid dispatch before its zero-delay task runs.
      sendFrame: (points: Vector3[], order: string) =>
        act(async () => {
          for (const point of points) dispatch(point, order)
        }),
    }
  }
  function menuAction(
    action: 'onDuplicate' | 'onMove' = 'onDuplicate',
  ): ((event: { stopPropagation(): void }) => void) | undefined {
    const search = (value: ReactNode): any => {
      for (const element of Children.toArray(value)) {
        if (!isValidElement(element)) continue
        if (element.type === NodeActionMenu) return (element.props as any)[action]
        const child = search((element.props as any).children)
        if (child) return child
      }
    }
    return htmlChildren.map(search).filter(Boolean).at(-1)
  }
  function genericHost(declared = false) {
    const kind = 'plugin:browser-host'
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
        ...(declared
          ? {
              surfaces: {
                hosting: {
                  childFrame: 'host-local',
                  resolveHit: (_host: AnyNode, hit: { normalWorldY: number }) =>
                    hit.normalWorldY >= 0.75
                      ? {
                          id: 'declared-top',
                          position: [0, 1, 0],
                          normal: [0, 1, 0],
                          region: { kind: 'rect', size: [0.5, 0.5] },
                        }
                      : null,
                },
              },
            }
          : {}),
        selectable: { hitVolume: 'bbox' },
        movable: { axes: ['x', 'z'] },
        duplicable: true,
        deletable: true,
        floorPlaced: { footprint: () => ({ dimensions: [1, 1, 1], rotation: [0, 0, 0] }) },
      },
      geometry: () => {
        const group = new Group()
        group.add(new Mesh(new BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new MeshBasicMaterial()))
        return group
      },
    } as never)
    return schema.parse({ parentId: level.id }) as AnyNode
  }

  function snapshot() {
    const { nodes, rootNodeIds, collections, materials, installedPlugins } = useScene.getState()
    return JSON.stringify({ nodes, rootNodeIds, collections, materials, installedPlugins })
  }
  async function duplicate(renderer: Awaited<ReturnType<typeof create>>, firstFrame?: () => void) {
    await settle(renderer)
    const callback = menuAction()
    expect(callback).toBeDefined()
    await act(async () => callback!({ stopPropagation() {} }))
    if (firstFrame) {
      await act(async () => renderer.advanceFrames(1, 1 / 60))
      firstFrame()
    }
    await settle(renderer)
    return getMovingNode()!
  }
  async function key(key: string) {
    await act(async () =>
      window.dispatchEvent(
        Object.assign(new Event('keydown', { cancelable: true }), { key, code: key }),
      ),
    )
  }
  async function planPointer(x: number, z: number, click = false) {
    await act(async () =>
      window.dispatchEvent(
        Object.assign(new Event(click ? 'pointerup' : 'pointermove'), {
          clientX: x,
          clientY: z,
          button: 0,
        }),
      ),
    )
  }
  function select(root: AnyNode, view = '3d') {
    useEditor.setState({
      mode: 'select',
      tool: null,
      viewMode: view as never,
      isFloorplanHovered: view === '2d',
    })
    useViewer.getState().setSelection({ selectedIds: [root.id] })
    useScene.temporal.getState().resume()
  }
  function namedFixture(childless: boolean) {
    const host = ProceduralItemNode.parse({
      parentId: level.id,
      recipe: {
        ...recipe,
        parts: [
          {
            ...recipe.parts[0]!,
            shapes: [{ ...recipe.parts[0]!.shapes[0]!, size: [4, 0.2, 4], position: [0, 1.9, 0] }],
          },
        ],
        surfaces: [{ id: 'top', label: 'Top', position: [0, 2, 0], size: [4, 4] }],
      },
    })
    const root = ItemNode.parse({ parentId: host.id, asset, position: [-1, 0, 0] })
    host.attachments[root.id] = 'top'
    const leaf = ItemNode.parse({ parentId: root.id, asset, position: [0, 0.2, 0] })
    const other = ProceduralItemNode.parse({
      ...host,
      id: 'procedural-item_other',
      position: [6, 0, 0],
      attachments: {},
    })
    seed([host, root, ...(childless ? [] : [leaf]), other])
    return { host, root, leaf, other }
  }
  for (const view of ['3d', '2d'])
    for (const childless of [false, true])
      for (const outcome of [
        'commit',
        'Escape',
        'unmount',
        'floor',
        ...(view === '3d' ? ['other host'] : []),
      ])
        test(`named external surface ${view} ${childless ? 'childless' : 'subtree'} ${outcome}`, async () => {
          const { host, root, other } = namedFixture(childless)
          select(root, view)
          const before = snapshot()
          const commits: unknown[] = []
          const unsubscribe = subscribeSceneCommits((commit) => commits.push(commit))
          const renderer = await create(<Scene menu />)
          let unmounted = false
          try {
            await duplicate(renderer, () => {
              const draft = useScene.getState().nodes[getMovingNode()!.id]!
              expect(surfaceAttachmentId(draft)).toBe('top')
              expect(world(draft.id).y).toBeCloseTo(2)
            })
            const copy = Object.values(useScene.getState().nodes).find(
              (n) => n.id !== root.id && n.parentId === host.id,
            )!
            expect(copy).toBeDefined()
            expect(surfaceAttachmentId(copy)).toBe('top')
            expect(nodeLevelFrame(copy.id, useScene.getState().nodes).position[1]).toBeCloseTo(2)
            expect(world(copy.id).y).toBeCloseTo(2)
            expect(commits).toHaveLength(0)
            const pointer = view === '3d' ? pointerDispatcher() : null
            const point =
              outcome === 'floor'
                ? new Vector3(10, 0, 4)
                : outcome === 'other host'
                  ? new Vector3(7, 2, 0)
                  : new Vector3(1, 2, 0)
            if (pointer && (outcome === 'floor' || outcome === 'other host')) {
              await pointer.send(new Vector3(1, 2, 0), 'grid first')
              await settle(renderer)
            }
            if (pointer) await pointer.send(point, 'grid first')
            else await planPointer(point.x, point.z)
            await settle(renderer)
            if (outcome === 'Escape') {
              await key('Escape')
              await settle(renderer)
              expect(snapshot()).toBe(before)
            } else if (outcome === 'unmount') {
              await renderer.unmount()
              unmounted = true
              expect(useScene.getState().nodes[copy.id]).toBeDefined()
              await act(async () => useEditor.getState().setMovingNode(null))
              expect(snapshot()).toBe(before)
            } else {
              const live = getEffectiveNode(useScene.getState().nodes[copy.id]!)
              expect(
                nodeLevelFrame(copy.id, { ...useScene.getState().nodes, [copy.id]: live })
                  .position[1],
              ).toBeCloseTo(outcome === 'floor' ? 0 : 2)
              if (pointer) await pointer.send(point, 'grid first', true)
              else await planPointer(point.x, point.z, true)
              await settle(renderer)
              expect(getMovingNode()).toBeNull()
              const placed = Object.values(useScene.getState().nodes).find(
                (n) =>
                  n.type === 'item' &&
                  n.id !== root.id &&
                  n.parentId ===
                    (outcome === 'floor'
                      ? level.id
                      : outcome === 'other host'
                        ? other.id
                        : host.id),
              )!
              expect(placed).toBeDefined()
              expect(surfaceAttachmentId(placed)).toBe(outcome === 'floor' ? null : 'top')
              expect(nodeLevelFrame(placed.id, useScene.getState().nodes).position[1]).toBeCloseTo(
                outcome === 'floor' ? 0 : 2,
              )
              expect(
                (useScene.getState().nodes[host.id] as ProceduralItemNode).attachments[copy.id],
              ).toBeUndefined()
              expect(commits).toHaveLength(1)
              const after = snapshot()
              await act(async () => useScene.temporal.getState().undo())
              await settle(renderer)
              expect(snapshot()).toBe(before)
              await act(async () => useScene.temporal.getState().redo())
              await settle(renderer)
              expect(snapshot()).toBe(after)
            }
          } finally {
            unsubscribe()
            if (!unmounted) await renderer.unmount()
          }
        })
  for (const mover of ['catalog', 'registry'] as const)
    for (const route of [
      'shelf',
      'cabinet',
      'item',
      'generated',
      'generic',
      ...(mover === 'catalog' ? ['face'] : []),
    ])
      for (const targetRelation of [
        'descendant',
        ...((mover === 'catalog' && route === 'item') || (mover === 'registry' && route === 'shelf')
          ? ['self']
          : []),
      ])
        test(`cycle rejection ${mover} ${route} via mounted Duplicate and ${targetRelation} pointer hit`, async () => {
          const root =
            mover === 'catalog'
              ? ItemNode.parse({
                  parentId: level.id,
                  asset: { ...asset, ...(route === 'face' ? { attachTo: 'wall-side' } : {}) },
                })
              : ShelfNode.parse({ parentId: level.id, style: 'bookshelf' })
          const descendant =
            route === 'shelf'
              ? ShelfNode.parse({ parentId: root.id, style: 'bookshelf', width: 2, depth: 1 })
              : route === 'cabinet'
                ? CabinetNode.parse({ parentId: root.id, withCountertop: true })
                : route === 'item'
                  ? ItemNode.parse({ parentId: root.id, asset })
                  : route === 'generated'
                    ? ProceduralItemNode.parse({
                        parentId: root.id,
                        recipe: {
                          ...recipe,
                          surfaces: [
                            { id: 'top', label: 'Top', position: [0, 0.2, 0], size: [1, 1] },
                          ],
                        },
                      })
                    : route === 'face'
                      ? BlockNode.parse({
                          parentId: root.id,
                          topology: createBoxBlockTopology(2, 2, 2),
                        })
                      : { ...genericHost(true), parentId: root.id }
          const module =
            route === 'cabinet'
              ? CabinetModuleNode.parse({
                  ...nodeRegistry.get('cabinet-module')!.defaults(),
                  parentId: descendant.id,
                  width: 1,
                  depth: 0.65,
                  stack: [{ id: 'door', type: 'door', height: 0.8 }],
                })
              : null
          descendant.position = [3, 0, 0]
          seed([root, descendant, ...(module ? [module] : [])])
          select(root)
          const renderer = await create(<Scene menu />)
          let writes: ReturnType<typeof spyOn> | undefined
          const invalid: string[] = []
          const eventIds: string[] = []
          const observe = (event: { node: AnyNode }) => eventIds.push(event.node.id)
          const channel =
            route === 'generic' || route === 'generated' || route === 'face'
              ? 'node:enter'
              : `${route}:enter`
          emitter.on(channel as never, observe as never)
          try {
            const copy = await duplicate(renderer)
            const target =
              targetRelation === 'self'
                ? useScene.getState().nodes[copy.id]!
                : useScene.getState().nodes[copy.children[0]!]!
            const targets = new Set([copy.id, target.id, ...target.children])
            const update = useScene.getState().updateNodes
            // Capture an attempted cycle before it can hang renderer/store ancestor walks.
            writes = spyOn(useScene.getState(), 'updateNodes').mockImplementation((updates) => {
              if (
                updates.some(
                  (u) => u.id === copy.id && u.data.parentId && targets.has(u.data.parentId),
                )
              ) {
                invalid.push(
                  ...updates.filter((u) => u.id === copy.id).map((u) => u.data.parentId!),
                )
                return
              }
              update(updates)
            })
            sceneRegistry.nodes.get(root.id)?.traverse((o) => {
              o.raycast = () => {}
            })
            const targetMesh = sceneRegistry.nodes.get(target.id)!
            // A queued hit can precede per-frame draft raycast suppression.
            targetMesh.traverse((o) => {
              if ((o as Mesh).isMesh) o.raycast = Mesh.prototype.raycast
            })
            const local =
              route === 'shelf'
                ? new Vector3(0.1, 1.85, 0.1)
                : route === 'cabinet'
                  ? new Vector3(0.2, 0.92, 0.1)
                  : route === 'generic'
                    ? new Vector3(0.1, 1, 0.1)
                    : route === 'face'
                      ? new Vector3(0.2, 1, 1)
                      : new Vector3(0, 0.2, 0)
            const point = targetMesh.localToWorld(local)
            const pointer = pointerDispatcher(route === 'face')
            await pointer.send(point, 'host first')
            expect(eventIds).toContain(target.id)
            expect(invalid).toEqual([])
            expect(useScene.getState().nodes[copy.id]!.parentId).toBe(root.parentId)
          } finally {
            writes?.mockRestore()
            emitter.off(channel as never, observe as never)
            await renderer.unmount()
          }
        })
  test('registry owns conditional subtree policy, including plugin kinds', () => {
    for (const kind of ['item', 'shelf', 'procedural-item'])
      expect(nodeRegistry.get(kind)!.capabilities.duplicable).toEqual({ subtree: 'with-children' })
    const host = genericHost()
    const def = nodeRegistry.get(host.type)!
    def.capabilities.duplicable = { subtree: 'with-children' }
    expect(duplicatesAsFreshSubtree(host)).toBe(false)
    expect(duplicatesAsFreshSubtree({ ...host, children: ['item_child'] } as AnyNode)).toBe(true)
    for (const kind of ['cabinet', 'column', 'block']) {
      const definition = nodeRegistry.get(kind)!
      expect(duplicatesAsFreshSubtree(definition.schema.parse(definition.defaults()))).toBe(true)
    }
  })
  test('ordinary shelf move with 40 items caches descendant traversal between pointer ticks', async () => {
    const root = ShelfNode.parse({ parentId: level.id, width: 3, style: 'bookshelf' })
    const items = Array.from({ length: 40 }, (_, i) =>
      ItemNode.parse({
        parentId: root.id,
        asset,
        position: [(i % 10) / 4 - 1, 0.05 + Math.floor(i / 10) * 0.6, 0],
      }),
    )
    seed([root, ...items])
    select(root, '2d')
    const renderer = await create(<Scene menu />)
    const counts: number[] = []
    try {
      await act(async () => useEditor.getState().setMovingNode(useScene.getState().nodes[root.id]!))
      await settle(renderer)
      const committed = useScene.getState().nodes
      let reads = 0
      const nodes = new Proxy(committed, {
        get(target, key, receiver) {
          if (typeof key === 'string' && key in target) reads++
          return Reflect.get(target, key, receiver)
        },
      })
      const def = nodeRegistry.get('shelf')!
      for (let tick = 0; tick < 6; tick++) {
        await planPointer(5 + tick / 10, 3)
        await settle(renderer)
        expect(useScene.getState().nodes).toBe(committed)
        reads = 0
        const ids =
          def.floorplanAffectedIds?.({
            nodeId: root.id,
            node: root,
            nodes,
            liveTransforms: useLiveTransforms.getState().transforms,
            liveOverrides: useLiveNodeOverrides.getState().overrides,
          }) ?? []
        counts.push(reads)
        expect(ids.length).toBe(def.floorplanAffectedIds ? 40 : 0)
      }
      console.log(`ordinary shelf 40: descendant reads per pointer tick ${counts.join(', ')}`)
      expect(counts.slice(1)).toEqual([0, 0, 0, 0, 0])
      const extra = ItemNode.parse({ parentId: root.id, asset })
      const changed = {
        ...committed,
        [extra.id]: extra,
        [root.id]: { ...committed[root.id], children: [...items.map((n) => n.id), extra.id] },
      } as typeof committed
      if (def.floorplanAffectedIds)
        expect(
          def.floorplanAffectedIds({
            nodeId: root.id,
            node: changed[root.id]!,
            nodes: changed,
            liveTransforms: new Map(),
            liveOverrides: new Map(),
          }),
        ).toContain(extra.id)
    } finally {
      await renderer.unmount()
    }
  })
  for (const view of ['3d', '2d'])
    test(`Strict Mode ${view} keeps one subtree through view unmount until interaction end`, async () => {
      const { root, host } = namedFixture(false)
      select(root, view)
      const before = snapshot()
      const commits: unknown[] = []
      const unsubscribe = subscribeSceneCommits((c) => commits.push(c))
      const changes = spyOn(useScene.getState(), 'applyNodeChanges')
      const renderer = await create(
        <StrictMode>
          <Scene menu />
        </StrictMode>,
      )
      try {
        const copy = await duplicate(renderer)
        expect(useScene.getState().nodes[copy.id]).toBeDefined()
        expect(copy.children).toHaveLength(1)
        expect(
          changes.mock.calls.filter(([batch]) =>
            batch.create?.some((entry) => entry.node.id === copy.id),
          ).length,
        ).toBe(1)
        expect(useScene.getState().nodes[copy.children[0]!]?.parentId).toBe(copy.id)
        expect(
          (useScene.getState().nodes[host.id] as ProceduralItemNode).attachments[copy.id],
        ).toBe('top')
        expect(world(copy.id).y).toBeCloseTo(2)
        if (view === '3d') await pointerDispatcher().send(new Vector3(1, 2, 0), 'grid first')
        else await planPointer(1, 0)
        await settle(renderer)
      } finally {
        await renderer.unmount()
        expect(getMovingNode()).not.toBeNull()
        await act(async () => useEditor.getState().setMovingNode(null))
        unsubscribe()
        changes.mockRestore()
      }
      expect(snapshot()).toBe(before)
      expect(commits).toHaveLength(0)
      expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    })
  for (const view of ['3d', '2d'])
    for (const kind of ['item', 'shelf', 'procedural-item'])
      for (const outcome of ['commit', 'Escape'])
        test(`childless lifecycle ${view} ${kind} ${outcome}`, async () => {
          const root =
            kind === 'item'
              ? ItemNode.parse({ parentId: level.id, asset, position: [-2, 0, 0] })
              : kind === 'shelf'
                ? ShelfNode.parse({ parentId: level.id, position: [-2, 0, 0] })
                : ProceduralItemNode.parse({ parentId: level.id, recipe, position: [-2, 0, 0] })
          seed([root])
          select(root, view)
          const before = snapshot()
          const minted = new Set<string>()
          const idDef = nodeRegistry.get(kind)!.schema.shape.id._zod.def
          const descriptor = Object.getOwnPropertyDescriptor(idDef, 'defaultValue')!
          const getter = descriptor.get!
          Object.defineProperty(idDef, 'defaultValue', {
            ...descriptor,
            get() {
              const id = getter.call(idDef)
              minted.add(id)
              return id
            },
          })
          const generate = Core.generateId
          const mintSpy = spyOn(Core, 'generateId').mockImplementation((prefix) => {
            const id = generate(prefix)
            minted.add(id)
            return id
          })
          let writes = 0
          const unsubscribe = useScene.subscribe((s, p) => {
            if (s.nodes !== p.nodes) {
              writes++
              for (const id of Object.keys(s.nodes)) if (!savedIds.has(id)) minted.add(id)
            }
          })
          const savedIds = new Set(Object.keys(useScene.getState().nodes))
          const commits: unknown[] = []
          const uncommits = subscribeSceneCommits((c) => commits.push(c))
          const renderer = await create(<Scene menu />)
          const trace: unknown[] = []
          const labels = new Map([...savedIds].map((id, i) => [id, `original-${i}`]))
          const normalise = (value: unknown) =>
            JSON.parse(
              JSON.stringify(value, (_key, v) => {
                if (typeof v !== 'string') return v
                if (labels.has(v)) return labels.get(v)
                if (minted.has(v)) {
                  const label = `fresh-${[...minted].indexOf(v)}`
                  labels.set(v, label)
                  return label
                }
                return v
              }),
            )
          const record = (stage: string) => {
            const moving = getMovingNode()
            if (moving) minted.add(moving.id)
            const nodes = Object.values(useScene.getState().nodes).filter(
              (n) => !savedIds.has(n.id),
            )
            trace.push(
              normalise({
                stage,
                minted: minted.size,
                writes,
                history: useScene.temporal.getState().pastStates.length,
                commits: commits.length,
                moving: moving?.id ?? null,
                nodes,
                preview: nodes.map((n) => ({ id: n.id, position: world(n.id).toArray() })),
              }),
            )
          }
          try {
            await duplicate(renderer)
            record('preview')
            const pointer = view === '3d' ? pointerDispatcher() : null
            const point = new Vector3(6, 0, 5)
            if (pointer) await pointer.send(new Vector3(3, 0, 3), 'grid first')
            else await planPointer(3, 3)
            await settle(renderer)
            if (pointer) await pointer.send(point, 'grid first')
            else await planPointer(6, 5)
            await settle(renderer)
            record('pointer')
            if (outcome === 'Escape') {
              await key('Escape')
              await settle(renderer)
              record('Escape')
              expect(snapshot()).toBe(before)
            } else {
              if (pointer) await pointer.send(point, 'grid first', true)
              else await planPointer(6, 5, true)
              await settle(renderer)
              record('commit')
              expect(getMovingNode()).toBeNull()
              const after = snapshot()
              await act(async () => useScene.temporal.getState().undo())
              await settle(renderer)
              record('undo')
              expect(snapshot()).toBe(before)
              await act(async () => useScene.temporal.getState().redo())
              await settle(renderer)
              record('redo')
              expect(snapshot()).toBe(after)
            }
            const name = `${view}-${kind}-${outcome}`
            if (process.env.DUPLICATE_CAPTURE_LIFECYCLE)
              await Bun.write(
                `${process.env.DUPLICATE_CAPTURE_LIFECYCLE}/${name}.json`,
                `${JSON.stringify(trace, null, 2)}\n`,
              )
            else
              expect(trace).toEqual(
                await Bun.file(
                  new URL(`./fixtures/duplicate-lifecycle/${name}.json`, import.meta.url),
                ).json(),
              )
          } finally {
            await renderer.unmount()
            unsubscribe()
            uncommits()
            Object.defineProperty(idDef, 'defaultValue', descriptor)
            mintSpy.mockRestore()
          }
        })
  for (const view of ['3d', '2d'])
    for (const hostKind of ['wall', 'block', ...(view === '3d' ? ['block-side'] : [])])
      test(`external ${hostKind} bookkeeping and original references ${view} through Duplicate and pointer commit`, async () => {
        const host =
          hostKind === 'wall'
            ? WallNode.parse({ parentId: level.id, start: [-2, 0], end: [2, 0], height: 3 })
            : BlockNode.parse({ parentId: level.id, topology: createBoxBlockTopology(4, 3, 2) })
        const root = ItemNode.parse({
          parentId: host.id,
          position: hostKind === 'wall' ? [1, 0.8, 0] : [-1, 0.8, 0],
          asset: { ...asset, ...(hostKind !== 'block' ? { attachTo: 'wall-side' } : {}) },
          side: 'front',
          ...(hostKind === 'wall'
            ? { wallId: host.id }
            : { blockFaceId: hostKind === 'block-side' ? 'f-front' : 'f-top' }),
        })
        const leaf = ItemNode.parse({ parentId: root.id, asset, position: [0, 0.2, 0] })
        const measurement = MeasurementNode.parse({
          parentId: level.id,
          measurement: {
            kind: 'distance',
            points: [
              {
                kind: 'feature',
                reference: { nodeId: root.id, featureId: 'center' },
                fallback: [0, 0, 0],
              },
              [2, 0, 0],
            ],
          },
        })
        const zone = ZoneNode.parse({
          parentId: level.id,
          name: 'Original grouping',
          polygon: [
            [0, 0],
            [2, 0],
            [2, 2],
            [0, 2],
          ],
          metadata: { nodeIds: [root.id, leaf.id] },
        })
        seed([host, root, leaf, measurement, zone])
        if (host.type === 'wall') spatialGridManager.handleNodeCreated(host, level.id)
        useScene.setState({
          collections: {
            collection_original: {
              id: 'collection_original',
              name: 'Original',
              nodeIds: [root.id, leaf.id],
              controlNodeId: root.id,
            },
          },
        })
        select(root, view)
        const before = snapshot()
        const references = () =>
          JSON.stringify({
            measurement: useScene.getState().nodes[measurement.id],
            zone: useScene.getState().nodes[zone.id],
            collections: useScene.getState().collections,
          })
        const originals = references()
        const renderer = await create(<Scene menu />)
        try {
          const copy = await duplicate(renderer)
          expect(useScene.getState().nodes[copy.id]?.children).toHaveLength(1)
          expect(useScene.getState().nodes[host.id]?.children).toEqual([root.id, copy.id])
          expect(references()).toBe(originals)
          const childId = (useScene.getState().nodes[copy.id] as ItemNode).children[0]!
          const pointer = view === '3d' ? pointerDispatcher(hostKind !== 'block') : null
          const point =
            hostKind === 'wall'
              ? new Vector3(1, 1, 0.1)
              : hostKind === 'block-side'
                ? new Vector3(0.7, 1, 1)
                : new Vector3(0.7, 3, 0)
          if (pointer) await pointer.send(point, 'host first')
          else await planPointer(1, hostKind === 'wall' ? 0 : 1)
          await settle(renderer)
          expect(
            world(childId).distanceTo(
              sceneRegistry.nodes.get(copy.id)!.localToWorld(new Vector3(...leaf.position)),
            ),
          ).toBeLessThan(1e-6)
          if (pointer) await pointer.send(point, 'host first', true)
          else await planPointer(1, hostKind === 'wall' ? 0 : 1, true)
          await settle(renderer)
          expect(getMovingNode()).toBeNull()
          const placed = Object.values(useScene.getState().nodes).find(
            (n) => n.type === 'item' && n.id !== root.id && n.parentId === host.id,
          ) as ItemNode
          expect(placed.children).toHaveLength(1)
          expect(useScene.getState().nodes[host.id]?.children).toEqual([root.id, placed.id])
          expect(references()).toBe(originals)
          const after = snapshot()
          await act(async () => useScene.temporal.getState().undo())
          await settle(renderer)
          expect(snapshot()).toBe(before)
          expect(references()).toBe(originals)
          await act(async () => useScene.temporal.getState().redo())
          await settle(renderer)
          expect(snapshot()).toBe(after)
          expect(references()).toBe(originals)
        } finally {
          await renderer.unmount()
        }
      })
  for (const kind of ['item', 'cabinet'])
    test(`abandonment probe ${kind}`, async () => {
      const root =
        kind === 'item'
          ? ItemNode.parse({ parentId: level.id, asset })
          : CabinetNode.parse({ ...nodeRegistry.get('cabinet')!.defaults(), parentId: level.id })
      const child = CabinetModuleNode.parse({
        ...nodeRegistry.get('cabinet-module')!.defaults(),
        parentId: root.id,
      })
      seed([root, ...(kind === 'cabinet' ? [child] : [])])
      select(root)
      const originalIds = new Set(Object.keys(useScene.getState().nodes))
      const renderer = await create(<Scene menu />)
      await duplicate(renderer)
      await pointerDispatcher().send(new Vector3(6, 0, 5), 'grid first')
      await settle(renderer)
      const report = (stage: string) =>
        console.log(
          `abandonment ${kind} ${stage}: ${
            Object.values(useScene.getState().nodes)
              .filter((n) => !originalIds.has(n.id))
              .map((n) => `${n.type}:${JSON.stringify(n.metadata)}`)
              .join(', ') || 'none'
          }`,
        )
      report('preview')
      await renderer.update(<Scene menu panes={{ plan: false, spatial: false }} />)
      await settle(renderer)
      report('unmount')
      expect(
        Object.values(useScene.getState().nodes).filter((n) => !originalIds.has(n.id)),
      ).toHaveLength(kind === 'cabinet' ? 2 : 0)
      await act(async () => useEditor.getState().armToolMode({ mode: 'build', tool: 'wall' }))
      await act(async () => useViewer.getState().setSelection({ selectedIds: [root.id] }))
      report('switch and selection')
      await key('Escape')
      report('Escape after unmount')
      const raw = structuredClone(useScene.getState().nodes)
      await act(async () => useScene.getState().setScene(raw, [site.id]))
      report('raw reload')
      expect(
        Object.values(useScene.getState().nodes).filter((n) => !originalIds.has(n.id)),
      ).toHaveLength(0)
      await renderer.unmount()
    })

  function lifecycleFixture(kind: string, childless: boolean, named = true) {
    const fixture = namedFixture(true)
    const root =
      kind === 'item'
        ? fixture.root
        : kind === 'shelf'
          ? ShelfNode.parse({ parentId: level.id, position: [-1, 0, 0], width: 0.5, depth: 0.3 })
          : ProceduralItemNode.parse({ parentId: fixture.host.id, position: [-1, 0, 0], recipe })
    if (!named) root.parentId = level.id
    fixture.host.attachments = kind === 'shelf' || !named ? {} : { [root.id]: 'top' }
    if (kind === 'shelf' || !named) fixture.host.position = [20, 0, 0]
    const leaf = ItemNode.parse({ parentId: root.id, asset, position: [0, 0.2, 0] })
    seed([fixture.host, root, ...(childless ? [] : [leaf])])
    return { root, host: fixture.host }
  }
  for (const kind of ['item', 'shelf', 'procedural-item'])
    for (const childless of [false, true]) {
      for (const named of kind === 'shelf' ? [false] : [false, true])
        for (const owner of ['3d', '2d'])
          test(`pane teardown ${owner} owns ${kind} ${childless ? 'childless' : 'subtree'} named=${named}`, async () => {
            const { root, host } = lifecycleFixture(kind, childless, named)
            select(root, owner)
            const before = snapshot()
            const renderer = await create(<Scene menu panes={{ plan: true, spatial: true }} />)
            try {
              const moving = await duplicate(renderer)
              const copy =
                useScene.getState().nodes[moving.id] ??
                Object.values(useScene.getState().nodes).find(
                  (n) => n.type === root.type && n.id !== root.id && n.metadata?.isTransient,
                )!
              const pointer = owner === '3d' ? pointerDispatcher() : null
              if (pointer) await pointer.send(new Vector3(0.5, 2, 0), 'grid first')
              else await planPointer(0.5, 0)
              await settle(renderer)
              const pose = world(copy.id).clone()
              await act(async () => {
                for (const type of ['pointermove', 'pointerup']) {
                  const event = Object.assign(new Event(type), {
                    clientX: 50,
                    clientY: 50,
                    button: 0,
                  })
                  Object.defineProperty(event, 'target', {
                    value: { closest: () => ({ tagName: 'BUTTON' }) },
                  })
                  window.dispatchEvent(event)
                }
              })
              expect(getMovingNode()?.id).toBe(moving.id)
              await renderer.update(
                <Scene menu panes={{ plan: owner === '2d', spatial: owner === '3d' }} />,
              )
              await settle(renderer)
              expect(getMovingNode()?.id).toBe(moving.id)
              expect(useScene.getState().nodes[copy.id]).toBeDefined()
              expect(surfaceAttachmentId(useScene.getState().nodes[copy.id]!)).toBe(
                kind === 'shelf' || !named ? null : 'top',
              )
              if (childless && !named) {
                const mainPose =
                  kind === 'item' ? [-1, 0, 0] : owner === '3d' ? [0, 0, 1] : [0.5, 0, 0]
                expect(world(copy.id).toArray()).toEqual(mainPose)
              } else expect(world(copy.id).distanceTo(pose)).toBeLessThan(1e-6)
              if (pointer) await pointer.send(new Vector3(1, 2, 0), 'grid first')
              else await planPointer(1, 0)
              await settle(renderer)
              expect(world(copy.id).x).not.toBeCloseTo(pose.x)
              if (pointer) await pointer.send(new Vector3(1, 2, 0), 'grid first', true)
              else await planPointer(1, 0, true)
              await settle(renderer)
              expect(getMovingNode()).toBeNull()
              const placed = Object.values(useScene.getState().nodes).find(
                (n) =>
                  n.id !== root.id &&
                  n.id !== host.id &&
                  n.type === root.type &&
                  n.parentId === root.parentId,
              )!
              expect(placed.children).toHaveLength(childless ? 0 : 1)
              expect(surfaceAttachmentId(placed)).toBe(kind === 'shelf' || !named ? null : 'top')
              const after = snapshot()
              await act(async () => useScene.temporal.getState().undo())
              expect(snapshot()).toBe(before)
              await act(async () => useScene.temporal.getState().redo())
              expect(snapshot()).toBe(after)
            } finally {
              await renderer.unmount()
            }
          })
      for (const strict of [false, true])
        test(`abandoned named draft ${kind} ${childless ? 'childless' : 'subtree'} strict=${strict}`, async () => {
          const { root, host } = lifecycleFixture(kind, childless)
          select(root)
          const renderer = await create(
            strict ? (
              <StrictMode>
                <Scene menu />
              </StrictMode>
            ) : (
              <Scene menu />
            ),
          )
          let copy: AnyNode
          try {
            copy = await duplicate(renderer)
            expect(surfaceAttachmentId(useScene.getState().nodes[copy.id]!)).toBe(
              kind === 'shelf' ? null : 'top',
            )
            expect(world(copy.id).y).toBeCloseTo(kind === 'shelf' ? 0 : 2)
            await pointerDispatcher().send(new Vector3(1, 2, 0), 'grid first')
            await settle(renderer)
          } finally {
            await renderer.unmount()
          }
          await new Promise((resolve) => setTimeout(resolve, 0))
          if (!childless || kind !== 'item')
            expect(useScene.getState().nodes[copy!.id]).toBeDefined()
          await act(async () => useEditor.getState().setMovingNode(null))
          expect((useScene.getState().nodes[host.id] as ProceduralItemNode).attachments).toEqual(
            kind === 'shelf' ? {} : { [root.id]: 'top' },
          )
          expect(useScene.temporal.getState().pastStates).toHaveLength(0)
          if (childless && kind === 'shelf')
            expect(useScene.getState().nodes[copy!.id]?.metadata?.isNew).toBe(true)
          else expect(useScene.getState().nodes[copy!.id]).toBeUndefined()
          for (const id of copy!.children) expect(useScene.getState().nodes[id]).toBeUndefined()
        })
      for (const view of ['3d', '2d'])
        test(`explicit cancellation ${view} ${kind} childless=${childless}`, async () => {
          const { root, host } = lifecycleFixture(kind, childless)
          select(root, view)
          const before = snapshot()
          const renderer = await create(<Scene menu />)
          try {
            await duplicate(renderer)
            if (view === '3d') await pointerDispatcher().send(new Vector3(1, 2, 0), 'grid first')
            else await planPointer(1, 0)
            await settle(renderer)
            await key('Escape')
            await settle(renderer)
            expect(getMovingNode()).toBeNull()
            expect(snapshot()).toBe(before)
            expect((useScene.getState().nodes[host.id] as ProceduralItemNode).attachments).toEqual(
              kind === 'shelf' ? {} : { [root.id]: 'top' },
            )
          } finally {
            await renderer.unmount()
          }
        })
    }

  for (const kind of ['item', 'shelf', 'procedural-item'])
    for (const producer of ['3d', '2d'])
      for (const outcome of ['Escape', 'commit', 'unmount'])
        test(`ordinary differential ${kind} ${producer} ${outcome}`, async () => {
          const { root } = lifecycleFixture(kind, true, false)
          usePlacementPreview.getState().clear()
          select(root, producer)
          const originalIds = Object.keys(useScene.getState().nodes)
          const normalize = (data: unknown) =>
            JSON.parse(
              originalIds.reduce(
                (text, id, i) => text.replaceAll(id, `original-${i}`),
                JSON.stringify(data),
              ),
            )
          const trace: unknown[] = []
          const record = (stage: string) =>
            trace.push(
              normalize({
                stage,
                scene: JSON.parse(snapshot()),
                mesh: world(root.id).toArray(),
                placement: usePlacementPreview.getState().node,
                transforms: [...useLiveTransforms.getState().transforms],
                overrides: [...useLiveNodeOverrides.getState().overrides],
                history: useScene.temporal.getState().pastStates.length,
              }),
            )
          const renderer = await create(<Scene menu panes={{ plan: true, spatial: true }} />)
          try {
            await settle(renderer)
            await act(async () => menuAction('onMove')!({ stopPropagation() {} }))
            await settle(renderer)
            record('start')
            const pointer = pointerDispatcher()
            if (producer === '3d') {
              await pointer.sendFrame([new Vector3(1, 0, 0), new Vector3(4, 0, 4)], 'grid first')
            } else {
              await planPointer(1, 0)
              await planPointer(4, 4)
            }
            await settle(renderer)
            record('pointer')
            await renderer.update(
              <Scene menu panes={{ plan: producer === '3d', spatial: producer === '2d' }} />,
            )
            await settle(renderer)
            record('teardown')
            if (outcome === 'Escape') await key('Escape')
            else if (outcome === 'commit') {
              if (producer === '3d') {
                await planPointer(6, 5)
                await planPointer(6, 5, true)
              } else {
                await pointer.send(new Vector3(6, 0, 5), 'grid first')
                await pointer.send(new Vector3(6, 0, 5), 'grid first', true)
              }
            } else await renderer.update(<Scene menu panes={{ plan: false, spatial: false }} />)
            await settle(renderer)
            record(outcome)
            const name = `${kind}-${producer}-${outcome}`
            if (process.env.DUPLICATE_CAPTURE_ORDINARY)
              await Bun.write(
                `${process.env.DUPLICATE_CAPTURE_ORDINARY}/${name}.json`,
                `${JSON.stringify(trace, null, 2)}\n`,
              )
            else
              expect(trace).toEqual(
                await Bun.file(
                  new URL(`./fixtures/ordinary-move-lifecycle/${name}.json`, import.meta.url),
                ).json(),
              )
          } finally {
            await renderer.unmount()
          }
        })

  for (const kind of ['procedural-item', 'shelf', 'cabinet', 'column', 'block'])
    for (const strict of [false, true])
      test(`registry abandonment deletes ${kind} strict=${strict} before real reload`, async () => {
        const root =
          kind === 'procedural-item'
            ? lifecycleFixture(kind, false).root
            : kind === 'shelf'
              ? ShelfNode.parse({ parentId: level.id })
              : kind === 'cabinet'
                ? CabinetNode.parse({ ...nodeRegistry.get(kind)!.defaults(), parentId: level.id })
                : kind === 'column'
                  ? ColumnNode.parse({ parentId: level.id })
                  : BlockNode.parse({
                      parentId: level.id,
                      topology: createBoxBlockTopology(1, 1, 1),
                    })
        if (kind !== 'procedural-item') {
          const child =
            kind === 'cabinet'
              ? CabinetModuleNode.parse({
                  ...nodeRegistry.get('cabinet-module')!.defaults(),
                  parentId: root.id,
                })
              : ItemNode.parse({ parentId: root.id, asset, position: [0, 0.2, 0] })
          seed([root, child])
        }
        select(root)
        const before = JSON.parse(snapshot())
        const renderer = await create(
          strict ? (
            <StrictMode>
              <Scene menu />
            </StrictMode>
          ) : (
            <Scene menu />
          ),
        )
        let ids: AnyNodeId[] = []
        try {
          // Blocks are duplicated through preset placement; their production menu has no Duplicate action.
          let copy: AnyNode
          if (kind === 'block') {
            await act(async () => {
              useScene.temporal.getState().pause()
              const id = createFreshPlacementSubtree(root.id)!
              copy = useScene.getState().nodes[id]!
              useEditor.getState().setMovingNode(copy)
            })
            await settle(renderer)
          } else copy = await duplicate(renderer)
          ids = [copy!.id, ...copy!.children] as AnyNodeId[]
          expect(ids).toHaveLength(2)
          for (const id of ids) expect(useScene.getState().nodes[id]).toBeDefined()
          await pointerDispatcher().send(new Vector3(6, 0, 5), 'grid first')
          await settle(renderer)
        } finally {
          await renderer.unmount()
        }
        for (const id of ids) expect(useScene.getState().nodes[id]).toBeDefined()
        await act(async () => useEditor.getState().setMovingNode(null))
        for (const id of ids) expect(useScene.getState().nodes[id]).toBeUndefined()
        expect(JSON.parse(snapshot())).toEqual(before)
        await act(async () => applySceneGraphToEditor(JSON.parse(snapshot())))
        const reloaded = await create(<Scene />)
        try {
          await settle(reloaded)
          for (const id of ids) {
            expect(useScene.getState().nodes[id]).toBeUndefined()
            expect(sceneRegistry.nodes.has(id)).toBe(false)
          }
        } finally {
          await reloaded.unmount()
        }
      })

  class SetupBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
    state = { failed: false }
    static getDerivedStateFromError() {
      return { failed: true }
    }
    componentDidCatch() {}
    render() {
      return this.state.failed ? null : this.props.children
    }
  }
  for (const route of ['item', 'item-events', 'registry', '2d'])
    test(`failed ${route} setup cannot strand the interaction draft`, async () => {
      const { root } = lifecycleFixture(
        route.startsWith('item') ? 'item' : 'procedural-item',
        false,
      )
      select(root, route === '2d' ? '2d' : '3d')
      const reported: unknown[] = []
      const report = spyOn(globalThis, 'reportError').mockImplementation((error) =>
        reported.push(error),
      )
      const renderer = await create(
        <SetupBoundary>
          <Scene menu panes={{ plan: false, spatial: false }} />
        </SetupBoundary>,
      )
      const copy = await duplicate(renderer)
      const target = route === 'item' ? usePlacementPreview.getState() : window
      const method = route === 'item' ? 'set' : 'addEventListener'
      const original = (target as any)[method].bind(target)
      const setup = spyOn(target as any, method).mockImplementation((...args: any[]) => {
        if (route === 'item' || args[0] === 'pointerup')
          throw new Error('injected mover setup failure')
        return original(...args)
      })
      const errors = spyOn(console, 'error').mockImplementation(() => {})
      const listeners = spyOn(emitter, 'on')
      try {
        await renderer.update(
          <SetupBoundary>
            <Scene menu panes={{ plan: route === '2d', spatial: route !== '2d' }} />
          </SetupBoundary>,
        )
        await renderer.unmount()
        expect(reported).toHaveLength(1)
        expect(useScene.getState().nodes[copy.id]).toBeDefined()
        await act(async () => useEditor.getState().setMovingNode(null))
        expect(useScene.getState().nodes[copy.id]).toBeUndefined()
      } finally {
        for (const [event, handler] of listeners.mock.calls) emitter.off(event, handler)
        listeners.mockRestore()
        report.mockRestore()
        setup.mockRestore()
        errors.mockRestore()
      }
    })

  function genericPlanDOM() {
    const scene = document.querySelector('[data-floorplan-scene]')!
    const element = () => ({
      style: {},
      setAttribute() {},
      removeAttribute() {},
      remove() {},
      getBBox: () => ({ x: -0.5, y: -0.3, width: 1, height: 0.6 }),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 10 }),
    })
    Object.assign(scene, {
      querySelector: () => element(),
      querySelectorAll: () => [],
      appendChild() {},
    })
    Object.assign(document, { querySelector: () => scene, createElementNS: element })
    Object.defineProperty(globalThis, 'DOMRect', {
      configurable: true,
      value: class {
        constructor(
          public x: number,
          public y: number,
          public width: number,
          public height: number,
        ) {}
      },
    })
  }
  function interactionFixture(kind: string) {
    if (kind !== 'cabinet') return lifecycleFixture(kind, false)
    genericPlanDOM()
    const root = CabinetNode.parse({
      ...nodeRegistry.get('cabinet')!.defaults(),
      parentId: level.id,
    })
    const child = CabinetModuleNode.parse({
      ...nodeRegistry.get('cabinet-module')!.defaults(),
      parentId: root.id,
    })
    seed([root, child])
    return { root }
  }
  const panesFor = (view: string) => ({ plan: view !== '3d', spatial: view !== '2d' })
  for (const strict of [false, true]) {
    for (const scenario of ['cabinet-handoff', 'named-replacement'])
      test(`interaction lifetime audit ${scenario} strict=${strict}`, async () => {
        const { root } = interactionFixture(
          scenario === 'cabinet-handoff' ? 'cabinet' : 'procedural-item',
        )
        select(root)
        const before = snapshot()
        const tree = (view: string) =>
          strict ? (
            <StrictMode>
              <Scene menu panes={panesFor(view)} />
            </StrictMode>
          ) : (
            <Scene menu panes={panesFor(view)} />
          )
        const renderer = await create(tree(scenario === 'cabinet-handoff' ? 'split' : '3d'))
        try {
          const copy = await duplicate(renderer)
          await pointerDispatcher().send(new Vector3(1, 2, 0), 'grid first')
          await settle(renderer)
          const live = structuredClone(useScene.getState().nodes[copy.id])
          await renderer.update(tree('2d'))
          await settle(renderer)
          expect(getMovingNode()?.id).toBe(copy.id)
          expect(useScene.getState().nodes[copy.id]).toEqual(live)
          for (const id of copy.children) expect(useScene.getState().nodes[id]).toBeDefined()
          if (scenario === 'named-replacement')
            expect(surfaceAttachmentId(useScene.getState().nodes[copy.id]!)).toBe('top')
          await planPointer(6, 5)
          await planPointer(6, 5, true)
          await settle(renderer)
          expect(getMovingNode()).toBeNull()
          const after = snapshot()
          const originalIds = new Set(Object.keys(JSON.parse(before).nodes))
          const created = Object.values(useScene.getState().nodes).filter(
            (n) => !originalIds.has(n.id),
          )
          expect(created).toHaveLength(2)
          expect(useScene.temporal.getState().pastStates).toHaveLength(1)
          await act(async () => useScene.temporal.getState().undo())
          expect(snapshot()).toBe(before)
          await act(async () => useScene.temporal.getState().redo())
          expect(snapshot()).toBe(after)
        } finally {
          await renderer.unmount()
        }
      })
    for (const kind of ['item', 'shelf', 'procedural-item', 'cabinet'])
      for (const terminalView of ['3d', '2d'])
        for (const outcome of ['commit', 'Escape', 'tool', 'end'])
          test(`interaction lifetime cycling ${kind} ${terminalView} ${outcome} strict=${strict}`, async () => {
            const { root } = interactionFixture(kind)
            select(root)
            const before = snapshot()
            const tree = (view: string, key = 'editor') =>
              strict ? (
                <StrictMode>
                  <Scene key={key} menu panes={panesFor(view)} />
                </StrictMode>
              ) : (
                <Scene key={key} menu panes={panesFor(view)} />
              )
            const renderer = await create(tree('3d'))
            try {
              const copy = await duplicate(renderer)
              for (const view of [
                '2d',
                'split',
                '3d',
                'split',
                '2d',
                '3d',
                '2d',
                'split',
                terminalView,
              ]) {
                await renderer.update(tree(view))
                await settle(renderer)
                expect(getMovingNode()?.id).toBe(copy.id)
                expect(useScene.getState().nodes[copy.id]).toBeDefined()
                expect(useScene.getState().nodes[copy.children[0]!]?.parentId).toBe(copy.id)
              }
              // A whole editor remount leaves the interaction owner and scene intact.
              await renderer.update(tree(terminalView, 'replacement-editor'))
              await settle(renderer)
              expect(useScene.getState().nodes[copy.id]).toBeDefined()
              const pointer = pointerDispatcher()
              if (terminalView === '3d') {
                await pointer.send(new Vector3(1, 2, 0), 'grid first')
                await settle(renderer)
                await pointer.send(new Vector3(6, 0, 5), 'grid first')
              } else await planPointer(6, 5)
              await settle(renderer)
              if (outcome === 'commit') {
                if (terminalView === '3d')
                  await pointer.send(new Vector3(6, 0, 5), 'grid first', true)
                else await planPointer(6, 5, true)
              } else if (outcome === 'Escape') await key('Escape')
              else if (outcome === 'tool') await key('p')
              else await act(async () => useEditor.getState().setMovingNode(null))
              await settle(renderer)
              await act(async () => {
                await new Promise((resolve) => setTimeout(resolve, 20))
                await Promise.resolve()
              })
              expect(getMovingNode()).toBeNull()
              if (outcome === 'commit') {
                expect(usePlacementPreview.getState().node?.id).not.toBe(copy.id)
                for (const id of [copy.id, ...copy.children] as AnyNodeId[]) {
                  expect(useLiveTransforms.getState().transforms.has(id)).toBe(false)
                  expect(useLiveNodeOverrides.getState().overrides.has(id)).toBe(false)
                }
                const ids = new Set(Object.keys(JSON.parse(before).nodes))
                const copies = Object.values(useScene.getState().nodes).filter(
                  (n) => !ids.has(n.id),
                )
                expect(copies).toHaveLength(2)
                for (const n of copies) expect(n.metadata?.isNew).not.toBe(true)
                const committed = snapshot()
                await renderer.update(tree(terminalView, 'after-commit'))
                await settle(renderer)
                expect(snapshot()).toBe(committed)
                expect(useScene.temporal.getState().pastStates).toHaveLength(1)
                await act(async () => useScene.temporal.getState().undo())
                expect(snapshot()).toBe(before)
                await act(async () => useScene.temporal.getState().redo())
                expect(snapshot()).toBe(committed)
              } else {
                expect(snapshot()).toBe(before)
                expect(useScene.temporal.getState().pastStates).toHaveLength(0)
              }
            } finally {
              await renderer.unmount()
            }
          })
  }

  for (const strict of [false, true])
    for (const kind of ['shelf', 'cabinet', 'procedural-item'])
      for (const outcome of ['commit', 'Escape'])
        test(`interaction lifetime two editor instances ${kind} ${outcome} strict=${strict}`, async () => {
          const { root } = interactionFixture(kind)
          select(root)
          const before = snapshot()
          const tree = (view: string) =>
            strict ? (
              <StrictMode>
                <Scene menu panes={panesFor(view)} />
              </StrictMode>
            ) : (
              <Scene menu panes={panesFor(view)} />
            )
          const first = await create(tree('3d'))
          const copy = await duplicate(first)
          const second = await create(tree('2d'))
          try {
            await settle(second)
            await first.unmount()
            expect(useScene.getState().nodes[copy.id]).toBeDefined()
            expect(surfaceAttachmentId(useScene.getState().nodes[copy.id]!)).toBe(
              kind === 'procedural-item' ? 'top' : null,
            )
            await planPointer(6, 5)
            if (outcome === 'commit') await planPointer(6, 5, true)
            else await key('Escape')
            await settle(second)
            expect(getMovingNode()).toBeNull()
            if (outcome === 'Escape') expect(snapshot()).toBe(before)
            else {
              const original = JSON.parse(before).nodes
              expect(
                Object.values(useScene.getState().nodes).filter((n) => !original[n.id]),
              ).toHaveLength(2)
              await act(async () => useScene.temporal.getState().undo())
              expect(snapshot()).toBe(before)
            }
          } finally {
            await second.unmount()
          }
        })

  for (const view of ['3d', '2d'])
    for (const kind of ['item', 'procedural-item'])
      for (const childless of [true, false])
        test(`review bot occupied commit ${view} ${kind} childless=${childless}`, async () => {
          const { root, host } = lifecycleFixture(kind, childless)
          select(root, view)
          const before = snapshot()
          const renderer = await create(<Scene menu />)
          try {
            const copy = await duplicate(renderer)
            const pointer = view === '3d' ? pointerDispatcher() : null
            const send = async (x: number, click = false) => {
              if (pointer) await pointer.send(new Vector3(x, 2, 0), 'grid first', click)
              else await planPointer(x, 0, click)
              await settle(renderer)
            }
            // A release at the source pose must not finalize the overlapping copy.
            if (!pointer) await send(-1)
            await send(-1, true)
            expect(getMovingNode()?.id).toBe(copy.id)
            expect(useScene.getState().nodes[copy.id]).toBeDefined()
            expect(surfaceAttachmentId(useScene.getState().nodes[copy.id]!)).toBe('top')
            for (const id of copy.children) expect(useScene.getState().nodes[id]).toBeDefined()
            expect(useScene.temporal.getState().pastStates).toHaveLength(0)
            await send(1)
            if (!pointer) {
              const lastValidPose = getEffectiveNode(useScene.getState().nodes[copy.id]!).position
              await send(-1)
              await send(-1, true)
              expect(getMovingNode()?.id).toBe(copy.id)
              expect(getEffectiveNode(useScene.getState().nodes[copy.id]!).position).toEqual(
                lastValidPose,
              )
              await send(1)
            }
            // Validation must also observe occupancy acquired after the last pointer tick.
            const obstacle = ItemNode.parse({ parentId: host.id, asset, position: [1, 0, 0] })
            const tracking = useScene.temporal.getState().isTracking
            useScene.temporal.getState().pause()
            useScene.getState().applyNodeChanges({
              create: [{ node: obstacle }],
              update: [
                {
                  id: host.id,
                  data: {
                    attachments: {
                      ...(useScene.getState().nodes[host.id] as ProceduralItemNode).attachments,
                      [obstacle.id]: 'top',
                    },
                  },
                },
              ],
            })
            if (tracking) useScene.temporal.getState().resume()
            const beforeRefusal = snapshot()
            await send(1, true)
            expect(snapshot()).toBe(beforeRefusal)
            expect(getMovingNode()?.id).toBe(copy.id)
            expect(useScene.getState().nodes[copy.id]).toBeDefined()
            expect(surfaceAttachmentId(useScene.getState().nodes[copy.id]!)).toBe('top')
            const attachments = {
              ...(useScene.getState().nodes[host.id] as ProceduralItemNode).attachments,
            }
            delete attachments[obstacle.id]
            useScene.temporal.getState().pause()
            useScene.getState().applyNodeChanges({
              delete: [obstacle.id],
              update: [{ id: host.id, data: { attachments } }],
            })
            if (tracking) useScene.temporal.getState().resume()
            await send(0.5)
            await send(0.5, true)
            expect(getMovingNode()).toBeNull()
            for (const id of [copy.id, ...copy.children])
              expect(useScene.getState().dirtyNodes.has(id as AnyNodeId)).toBe(false)
            expect(useScene.temporal.getState().pastStates).toHaveLength(1)
            const placed = snapshot()
            await act(async () => useScene.temporal.getState().undo())
            expect(snapshot()).toBe(before)
            await act(async () => useScene.temporal.getState().redo())
            expect(snapshot()).toBe(placed)
          } finally {
            await renderer.unmount()
          }
        })

  for (const kind of ['item', 'procedural-item'])
    for (const childless of [false, true])
      test(`review bot surface shrinks before release ${kind} childless=${childless}`, async () => {
        const { root, host } = lifecycleFixture(kind, childless)
        select(root, '2d')
        const renderer = await create(<Scene menu />)
        try {
          const copy = await duplicate(renderer)
          await planPointer(1.5, 0)
          const tracking = useScene.temporal.getState().isTracking
          useScene.temporal.getState().pause()
          useScene.getState().updateNode(host.id, {
            recipe: {
              ...host.recipe,
              surfaces: [{ id: 'top', label: 'Top', position: [0, 2, 0], size: [2.5, 4] }],
            },
          })
          if (tracking) useScene.temporal.getState().resume()
          const before = snapshot()
          await planPointer(1.5, 0, true)
          await settle(renderer)
          expect(snapshot()).toBe(before)
          expect(getMovingNode()?.id).toBe(copy.id)
          expect(useScene.temporal.getState().pastStates).toHaveLength(0)
          await planPointer(0.5, 0)
          await planPointer(0.5, 0, true)
          await settle(renderer)
          expect(getMovingNode()).toBeNull()
          expect(useScene.temporal.getState().pastStates).toHaveLength(1)
        } finally {
          await renderer.unmount()
        }
      })

  for (const strict of [false, true])
    for (const kind of ['item', 'shelf', 'procedural-item', 'cabinet'])
      for (const pending of [false, true])
        for (const outcome of ['commit', 'replace'])
          test(`review bot repeat begin ${kind} pending=${pending} ${outcome} strict=${strict}`, async () => {
            const { root } = interactionFixture(kind)
            select(root)
            const before = snapshot()
            const tree = (view: string, key = 'editor') => {
              const scene = (
                <Scene
                  key={key}
                  menu
                  panes={view === 'none' ? { plan: false, spatial: false } : panesFor(view)}
                />
              )
              return strict ? <StrictMode>{scene}</StrictMode> : scene
            }
            const renderer = await create(tree(pending ? 'none' : '3d'))
            try {
              // The pending case re-arms inside the menu gesture, before effects adopt it.
              await settle(renderer)
              await act(async () => {
                menuAction()!({ stopPropagation() {} })
                if (pending) {
                  const initial = useInteractionScope.getState()
                  useEditor.getState().setMovingNode(getMovingNode())
                  expect(useInteractionScope.getState().gesture).toBe(initial.gesture)
                  expect(useInteractionScope.getState().pendingSubtree).toBe(initial.pendingSubtree)
                }
              })
              await settle(renderer)
              const copy = getMovingNode()!
              const gesture = useInteractionScope.getState().gesture
              await act(async () => useEditor.getState().setMovingNode(copy))
              expect(useInteractionScope.getState().gesture).toBe(gesture)
              expect(useScene.getState().nodes[copy.id]).toBeDefined()
              await renderer.update(tree('2d', 'replay'))
              await settle(renderer)
              await act(async () =>
                useInteractionScope.getState().begin({
                  kind: pending ? 'moving' : 'placing',
                  node: copy,
                  nodeId: copy.id,
                  nodeType: copy.type,
                  view: '2d',
                  pressDrag: false,
                  driver: 'move-tool',
                }),
              )
              expect(useInteractionScope.getState().gesture).toBe(gesture)
              expect(useInteractionScope.getState().adoptSubtree(copy.id)).toBe(true)
              for (const id of copy.children) expect(useScene.getState().nodes[id]).toBeDefined()
              if (outcome === 'replace') {
                await act(async () => useEditor.getState().setMovingNode(root))
                expect(useScene.getState().nodes[copy.id]).toBeUndefined()
                for (const id of copy.children)
                  expect(useScene.getState().nodes[id]).toBeUndefined()
                await act(async () => useEditor.getState().setMovingNode(null))
                expect(snapshot()).toBe(before)
                expect(useScene.temporal.getState().pastStates).toHaveLength(0)
              } else {
                await planPointer(6, 5)
                await planPointer(6, 5, true)
                await settle(renderer)
                expect(getMovingNode()).toBeNull()
                expect(useScene.temporal.getState().pastStates).toHaveLength(1)
                const after = snapshot()
                await act(async () => useScene.temporal.getState().undo())
                expect(snapshot()).toBe(before)
                await act(async () => useScene.temporal.getState().redo())
                expect(snapshot()).toBe(after)
              }
            } finally {
              await renderer.unmount()
            }
          })

  for (const view of ['3d', '2d'])
    for (const kind of ['item', 'procedural-item', ...(view === '2d' ? ['cabinet'] : [])])
      test(`audit7 subscriber error rolls back ${view} ${kind}`, async () => {
        const { root } = interactionFixture(kind)
        select(root, view)
        const listeners = spyOn(window, 'addEventListener')
        const renderer = await create(<Scene menu />)
        let unsubscribe = () => {}
        try {
          const copy = await duplicate(renderer)
          if (view === '3d') await pointerDispatcher().send(new Vector3(1, 2, 0), 'grid first')
          else await planPointer(kind === 'cabinet' ? 6 : 1, 0)
          await settle(renderer)
          const before = useScene.getState()
          const graph = snapshot()
          const scope = useInteractionScope.getState()
          const history = useScene.temporal.getState()
          const fault = new Error('injected post-publication scene subscriber failure')
          unsubscribe = useScene.subscribe((scene) => {
            if (!scene.nodes[copy.id]) throw fault
          })
          let caught: unknown
          await act(async () => {
            try {
              // Invoke the mounted event callback directly so EventTarget cannot defer the throw.
              if (view === '2d') {
                const handler = listeners.mock.calls
                  .filter(([type]) => type === 'pointerup')
                  .at(-1)![1]
                ;(handler as (event: PointerEvent) => void)({
                  button: 0,
                  clientX: 1,
                  clientY: 0,
                } as PointerEvent)
              } else
                emitter.emit(kind === 'item' ? 'procedural-item:click' : 'grid:click', {
                  node: useScene.getState().nodes[root.parentId!],
                  stopPropagation() {},
                  position: [1, 2, 0],
                  localPosition: [1, 2, 0],
                  nativeEvent: { button: 0, stopPropagation() {}, preventDefault() {} },
                } as never)
            } catch (error) {
              caught = error
            }
          })
          expect(snapshot()).toBe(graph)
          expect(useScene.getState().nodes).toBe(before.nodes)
          expect(useScene.temporal.getState().pastStates).toEqual(history.pastStates)
          expect(useScene.temporal.getState().futureStates).toEqual(history.futureStates)
          expect(useInteractionScope.getState().ownedSubtree).toBe(scope.ownedSubtree)
          expect(getMovingNode()?.id).toBe(copy.id)
          expect(caught).toBe(fault)
          unsubscribe()
          if (view === '3d')
            await pointerDispatcher().send(new Vector3(1, 2, 0), 'grid first', true)
          else await planPointer(1, 0, true)
          await settle(renderer)
          expect(getMovingNode()).toBeNull()
          expect(useScene.temporal.getState().pastStates).toHaveLength(1)
        } finally {
          unsubscribe()
          listeners.mockRestore()
          await renderer.unmount()
        }
      })

  for (const view of ['2d', '3d'])
    for (const kind of ['item', 'procedural-item'])
      for (const refusal of view === '2d' ? ['occupied', 'shrunk'] : ['occupied'])
        for (const check of view === '2d' ? ['unchanged', 'feedback'] : ['unchanged'])
          test(`audit7 unregistered preset ${view} ${kind} ${refusal} ${check}`, async () => {
            const { root, host } = lifecycleFixture(kind, false)
            genericPlanDOM()
            const indicators: any[] = []
            const createElement = document.createElementNS.bind(document)
            const elements = spyOn(document, 'createElementNS').mockImplementation(
              (...args: any[]) => {
                const element = createElement(...(args as [string, string]))
                const attributes: Record<string, string> = {}
                Object.assign(element, {
                  setAttribute: (key: string, value: string) => {
                    attributes[key] = value
                  },
                  attributes,
                })
                indicators.push(element)
                return element
              },
            )
            useScene.getState().updateNode(root.id, { metadata: { isNew: true } })
            select(root, view)
            useEditor.getState().setMovingNode(useScene.getState().nodes[root.id]!)
            const renderer = await create(<Scene />)
            try {
              await settle(renderer)
              const pointer = view === '3d' ? pointerDispatcher() : null
              if (pointer) await pointer.send(new Vector3(1.5, 2, 0), 'grid first')
              else await planPointer(1.5, 0)
              await settle(renderer)
              useScene.temporal.getState().pause()
              if (refusal === 'shrunk')
                useScene.getState().updateNode(host.id, {
                  recipe: {
                    ...host.recipe,
                    surfaces: [{ id: 'top', label: 'Top', position: [0, 2, 0], size: [2.5, 4] }],
                  },
                })
              else {
                const obstacle = ItemNode.parse({ parentId: host.id, asset, position: [1.5, 0, 0] })
                useScene.getState().applyNodeChanges({
                  create: [{ node: obstacle }],
                  update: [
                    {
                      id: host.id,
                      data: {
                        attachments: {
                          ...(useScene.getState().nodes[host.id] as ProceduralItemNode).attachments,
                          [obstacle.id]: 'top',
                        },
                      },
                    },
                  ],
                })
              }
              const before = snapshot()
              const node = useScene.getState().nodes[root.id]
              if (pointer) await pointer.send(new Vector3(1.5, 2, 0), 'grid first', true)
              else await planPointer(1.5, 0, true)
              await settle(renderer)
              if (check === 'feedback')
                expect(indicators.some((el) => el.attributes.stroke === '#ef4444')).toBe(true)
              else {
                expect(snapshot()).toBe(before)
                expect(useScene.getState().nodes[root.id]).toBe(node)
              }
              expect(getMovingNode()?.id).toBe(root.id)
              expect(useScene.temporal.getState().pastStates).toHaveLength(0)
            } finally {
              elements.mockRestore()
              await renderer.unmount()
            }
          })

  for (const strict of [false, true])
    for (const kind of ['item', 'shelf', 'procedural-item', 'cabinet'])
      for (const outcome of ['replace', 'end'])
        test(`audit7 pending abandonment ${kind} ${outcome} strict=${strict}`, async () => {
          const { root } = interactionFixture(kind)
          select(root)
          const before = snapshot()
          const scene = <Scene menu panes={{ plan: false, spatial: false }} />
          const renderer = await create(strict ? <StrictMode>{scene}</StrictMode> : scene)
          try {
            const copy = await duplicate(renderer)
            expect(useInteractionScope.getState().pendingSubtree?.rootId).toBe(copy.id)
            expect(useInteractionScope.getState().ownedSubtree).toBeNull()
            await act(async () =>
              useEditor.getState().setMovingNode(outcome === 'replace' ? root : null),
            )
            expect(snapshot()).toBe(before)
            expect(useScene.temporal.getState().pastStates).toHaveLength(0)
            expect(useInteractionScope.getState().pendingSubtree).toBeNull()
          } finally {
            await renderer.unmount()
          }
        })

  for (const continuation of ['single', 'repeat'] as const)
    test(`audit7 fresh catalog ${continuation}`, async () => {
      seed([])
      useEditor.getState().setSelectedItem(asset)
      useEditor.getState().setContinuation('point', continuation)
      const renderer = await create(<Scene fresh />)
      try {
        await settle(renderer)
        const pointer = pointerDispatcher()
        const count = continuation === 'repeat' ? 3 : 1
        for (let index = 0; index < count; index++) {
          const point = new Vector3(2 + index, 0, 3)
          await pointer.send(point, 'grid first')
          await settle(renderer)
          await pointer.send(point, 'grid first', true)
          await settle(renderer)
          const placed = Object.values(useScene.getState().nodes).filter(
            (node) => node.type === 'item' && !node.metadata?.isNew && !node.metadata?.isTransient,
          )
          expect(placed).toHaveLength(index + 1)
          expect(placed.at(-1)!.position[0]).toBeCloseTo(2 + index)
          expect(placed.at(-1)!.position[1]).toBeCloseTo(0)
          expect(placed.at(-1)!.position[2]).toBeCloseTo(3)
          expect(useScene.temporal.getState().pastStates).toHaveLength(index + 1)
        }
        if (continuation === 'repeat') await key('Escape')
        const placed = snapshot()
        await act(async () => useScene.temporal.getState().undo())
        expect(
          Object.values(useScene.getState().nodes).filter((node) => node.type === 'item'),
        ).toHaveLength(count - 1)
        await act(async () => useScene.temporal.getState().redo())
        expect(snapshot()).toBe(placed)
      } finally {
        await renderer.unmount()
      }
    })

  for (const view of ['3d', '2d'])
    for (const kind of ['item', 'shelf', 'procedural-item', 'cabinet'])
      for (const adoption of ['unmounted', 'refused'])
        test(`review2 pending Escape ${view} ${kind} ${adoption}`, async () => {
          const { root } = interactionFixture(kind)
          select(root, view)
          const before = snapshot()
          const adopt =
            adoption === 'refused'
              ? spyOn(useInteractionScope.getState(), 'adoptSubtree').mockReturnValue(false)
              : null
          const renderer = await create(
            <Scene
              menu
              panes={adoption === 'unmounted' ? { plan: false, spatial: false } : panesFor(view)}
            />,
          )
          try {
            const copy = await duplicate(renderer)
            expect(useInteractionScope.getState().pendingSubtree?.rootId).toBe(copy.id)
            expect(useInteractionScope.getState().ownedSubtree).toBeNull()
            await key('Escape')
            await settle(renderer)
            expect(getMovingNode()).toBeNull()
            expect(snapshot()).toBe(before)
            expect(useScene.temporal.getState().pastStates).toHaveLength(0)
          } finally {
            adopt?.mockRestore()
            await renderer.unmount()
          }
        })

  for (const kind of ['item', 'shelf', 'procedural-item', 'cabinet'])
    for (const cancel of kind === 'item'
      ? ['tool', 'selection', 'right-click']
      : ['tool', 'selection'])
      test(`review2 pending cancel ${kind} ${cancel}`, async () => {
        const { root } = interactionFixture(kind)
        select(root)
        const before = snapshot()
        const adopt = spyOn(useInteractionScope.getState(), 'adoptSubtree').mockReturnValue(false)
        const renderer = await create(<Scene menu panes={panesFor('3d')} />)
        try {
          const copy = await duplicate(renderer)
          expect(useInteractionScope.getState().pendingSubtree?.rootId).toBe(copy.id)
          if (cancel === 'tool') await key('p')
          else if (cancel === 'selection')
            await act(async () => useEditor.getState().setMovingNode(null))
          else
            await act(async () => {
              for (const type of ['pointerdown', 'pointerup'])
                window.dispatchEvent(
                  Object.assign(new Event(type), {
                    button: 2,
                    clientX: 0,
                    clientY: 0,
                  }),
                )
            })
          await settle(renderer)
          expect(getMovingNode()).toBeNull()
          expect(snapshot()).toBe(before)
          expect(useScene.temporal.getState().pastStates).toHaveLength(0)
        } finally {
          adopt.mockRestore()
          await renderer.unmount()
        }
      })

  for (const view of ['3d', '2d'])
    for (const snapping of ['off', 'grid'] as const)
      for (const childKind of [
        'catalog',
        'generated',
        'generated-no-footprint',
        'generated-recipe-fallback',
        'generated-no-drag-bounds',
      ])
        test(`review2 real named surface ${view} ${snapping} ${childKind}`, async () => {
          const host = ProceduralItemNode.parse({
            parentId: level.id,
            recipe: {
              ...counterRecipe,
              parameters: counterRecipe.parameters.map((p) =>
                p.id === 'width' || p.id === 'depth' ? { ...p, max: 6 } : p,
              ),
              surfaces: [
                {
                  id: 'worktop',
                  label: 'Worktop',
                  position: [0.2, 0.9, -0.1],
                  rotation: [0.2, 0.35, 0],
                  size: [4, 3],
                },
              ],
            },
            parameters: { width: 4.5, depth: 3.5 },
          })
          const realAsset = CATALOG_ITEMS.find((a) => a.id === 'table-lamp')!
          const root =
            childKind === 'catalog'
              ? ItemNode.parse({ parentId: host.id, asset: realAsset, position: [-1, 0, 0] })
              : ProceduralItemNode.parse({
                  parentId: host.id,
                  position: [-1, -0.03, 0],
                  recipe: {
                    ...gridTableRecipe,
                    parts: gridTableRecipe.parts.map((part) => ({
                      ...part,
                      shapes: part.shapes.map((shape) => ({
                        ...shape,
                        position: shape.position.map((v, i) => ({
                          op: 'add',
                          args: [v, [0.11, 0.03, 0.035][i]],
                        })),
                      })),
                    })),
                  },
                })
          const leaf = ItemNode.parse({
            parentId: root.id,
            asset: CATALOG_ITEMS.find((a) => a.id === 'books')!,
            position: [0, 0.8, 0],
          })
          host.attachments[root.id] = 'worktop'
          seed([host, root, leaf])
          if (childKind === 'generated-no-footprint' || childKind === 'generated-recipe-fallback') {
            const definition = nodeRegistry.get('procedural-item')!
            registerNode({
              ...definition,
              capabilities: {
                ...definition.capabilities,
                floorPlaced: { ...definition.capabilities.floorPlaced, footprint: undefined },
              },
            } as never)
          }
          select(root, view)
          useEditor.getState().setSnappingMode('item', snapping)
          const before = snapshot()
          const renderer = await create(<Scene menu />)
          try {
            const copy = await duplicate(renderer)
            const point = (x: number) =>
              new Vector3(x, 0, 0)
                .applyEuler(new Euler(0.2, 0.35, 0))
                .add(new Vector3(0.2, 0.9, -0.1))
            const pointer = view === '3d' ? pointerDispatcher() : null
            const send = async (x: number, click = false) => {
              const p = point(x)
              if (pointer) await pointer.send(p, 'grid first', click)
              else await planPointer(p.x, p.z, click)
              await settle(renderer)
            }
            await send(1)
            expect(surfaceAttachmentId(useScene.getState().nodes[copy.id]!)).toBe('worktop')
            if (
              childKind === 'generated-recipe-fallback' ||
              childKind === 'generated-no-drag-bounds'
            ) {
              const definition = nodeRegistry.get('procedural-item')!
              registerNode({
                ...definition,
                capabilities: {
                  ...definition.capabilities,
                  dragBounds: undefined,
                },
              } as never)
            }
            await send(1, true)
            expect(getMovingNode()).toBeNull()
            expect(useScene.temporal.getState().pastStates).toHaveLength(1)
            const copied = Object.values(useScene.getState().nodes).filter(
              (n) => !(n.id in JSON.parse(before).nodes),
            )
            expect(copied).toHaveLength(2)
            const placed = copied.find((n) => n.parentId === host.id)!
            expect(surfaceAttachmentId(placed)).toBe('worktop')
            expect(copied.find((n) => n.id !== placed.id)?.parentId).toBe(placed.id)
          } finally {
            await renderer.unmount()
          }
        })

  for (const kind of ['item', 'fence', 'lean-to-extension', 'spawn', 'plugin'])
    for (const outcome of ['Escape', 'commit', 'unmount'])
      test(`review3 unregistered fresh overlay ${kind} ${outcome}`, async () => {
        Core.resetSceneHistoryPauseDepth()
        genericPlanDOM()
        const pluginRoot = kind === 'plugin' ? genericHost() : null
        if (pluginRoot) {
          const definition = nodeRegistry.get(pluginRoot.type)!
          registerNode({ ...definition, floorplan: nodeRegistry.get('shelf')!.floorplan } as never)
        }
        const definition = nodeRegistry.get(kind === 'plugin' ? pluginRoot!.type : kind)!
        const root = definition.schema.parse({
          ...definition.defaults(),
          ...(kind === 'item' ? { asset } : {}),
          ...(kind === 'lean-to-extension'
            ? { hostKind: 'freestanding', hostRoofId: 'roof_fixture', hostSlabId: 'slab_fixture' }
            : {}),
          ...(pluginRoot ?? {}),
          parentId: level.id,
          position: [-1, 0, 0],
          metadata: { isNew: true },
        }) as AnyNode
        seed([root])
        usePlacementPreview.getState().clear()
        useScene.temporal.getState().resume()
        select(root, '2d')
        const ids = new Map(
          Object.keys(useScene.getState().nodes).map((id, i) => [id, `node-${i}`]),
        )
        const trace: unknown[] = []
        const record = (stage: string) => {
          const temporal = useScene.temporal.getState()
          for (const id of Object.keys(useScene.getState().nodes))
            if (!ids.has(id)) ids.set(id, `node-${ids.size}`)
          let value = JSON.stringify({
            stage,
            scene: JSON.parse(snapshot()),
            moving: getMovingNode(),
            origin: useEditor.getState().movingNodeOrigin,
            past: temporal.pastStates,
            future: temporal.futureStates,
            tracking: temporal.isTracking,
          })
          for (const [id, replacement] of ids) value = value.replaceAll(id, replacement)
          trace.push(JSON.parse(value))
        }
        await act(async () => useEditor.getState().setMovingNode(root))
        const renderer = await create(<Scene panes={panesFor('2d')} />)
        try {
          await settle(renderer)
          expect(useInteractionScope.getState().ownedSubtree ?? null).toBeNull()
          expect(useInteractionScope.getState().pendingSubtree ?? null).toBeNull()
          record('start')
          await planPointer(1, 0)
          await planPointer(3, 4)
          await settle(renderer)
          record('pointer')
          if (outcome === 'Escape') await key('Escape')
          else if (outcome === 'commit') await planPointer(3, 4, true)
          else await renderer.update(<Scene panes={{ plan: false, spatial: false }} />)
          await settle(renderer)
          record(outcome)
          await act(async () => useScene.temporal.getState().undo())
          record('undo')
          await act(async () => useScene.temporal.getState().redo())
          record('redo')
          const name = `${kind}-${outcome}`
          if (process.env.DUPLICATE_CAPTURE_FRESH_OVERLAY)
            await Bun.write(
              `${process.env.DUPLICATE_CAPTURE_FRESH_OVERLAY}/${name}.json`,
              `${JSON.stringify(trace, null, 2)}\n`,
            )
          else
            expect(trace).toEqual(
              await Bun.file(
                new URL(`./fixtures/fresh-overlay-lifecycle/${name}.json`, import.meta.url),
              ).json(),
            )
        } finally {
          await renderer.unmount()
        }
      })

  for (const kind of ['item', 'procedural-item', 'procedural-generic'])
    for (const outcome of ['Escape', 'commit'])
      test(`review3 refused 2d release then 3d ${kind} ${outcome}`, async () => {
        Core.resetSceneHistoryPauseDepth()
        const { root, host } = lifecycleFixture(
          kind === 'procedural-generic' ? 'procedural-item' : kind,
          false,
        )
        if (kind === 'procedural-generic') {
          genericPlanDOM()
          const definition = nodeRegistry.get('procedural-item')!
          registerNode({ ...definition, floorplanMoveTarget: undefined } as never)
        }
        select(root)
        const before = snapshot()
        const renderer = await create(<Scene menu panes={{ plan: true, spatial: true }} />)
        try {
          const copy = await duplicate(renderer)
          const origin = useEditor.getState().movingNodeOrigin
          await planPointer(1, 0)
          const obstacle = ItemNode.parse({ parentId: host.id, asset, position: [1, 0, 0] })
          useScene.getState().applyNodeChanges({
            create: [{ node: obstacle }],
            update: [
              {
                id: host.id,
                data: {
                  attachments: {
                    ...(useScene.getState().nodes[host.id] as ProceduralItemNode).attachments,
                    [obstacle.id]: 'top',
                  },
                },
              },
            ],
          })
          const atRelease = snapshot()
          await planPointer(1, 0, true)
          await settle(renderer)
          expect(getMovingNode()?.id).toBe(copy.id)
          expect(snapshot()).toBe(atRelease)
          expect(useEditor.getState().movingNodeOrigin).toBe(origin)
          const attachments = {
            ...(useScene.getState().nodes[host.id] as ProceduralItemNode).attachments,
          }
          delete attachments[obstacle.id]
          useScene.getState().applyNodeChanges({
            delete: [obstacle.id],
            update: [{ id: host.id, data: { attachments } }],
          })
          await renderer.update(<Scene menu panes={panesFor('3d')} />)
          const pointer = pointerDispatcher()
          await pointer.send(new Vector3(1, 2, 0), 'grid first')
          await settle(renderer)
          if (outcome === 'Escape') await key('Escape')
          else await pointer.send(new Vector3(1, 2, 0), 'grid first', true)
          await settle(renderer)
          expect(getMovingNode()).toBeNull()
          if (outcome === 'Escape') {
            expect(snapshot()).toBe(before)
            expect(useScene.temporal.getState().pastStates).toHaveLength(0)
          } else {
            expect(useScene.temporal.getState().pastStates).toHaveLength(1)
            const committed = snapshot()
            const originalIds = new Set(Object.keys(JSON.parse(before).nodes))
            const copies = Object.values(useScene.getState().nodes).filter(
              (n) => !originalIds.has(n.id),
            )
            expect(copies).toHaveLength(2)
            const placed = copies.find((n) => n.parentId === host.id)!
            const position = (placed as ItemNode | ProceduralItemNode).position
            for (const [axis, value] of [1, 0, 0].entries())
              expect(position[axis]).toBeCloseTo(value, 8)
            expect(surfaceAttachmentId(placed)).toBe('top')
            expect(copies.find((n) => n.id !== placed.id)?.parentId).toBe(placed.id)
            expect(world(placed.id).y).toBeCloseTo(2)
            await act(async () => useScene.temporal.getState().undo())
            expect(snapshot()).toBe(before)
            await act(async () => useScene.temporal.getState().redo())
            expect(snapshot()).toBe(committed)
          }
        } finally {
          await renderer.unmount()
        }
      })

  test('review3 unregistered generic Escape cannot record deletion after flags change', async () => {
    Core.resetSceneHistoryPauseDepth()
    genericPlanDOM()
    const root = genericHost()
    const definition = nodeRegistry.get(root.type)!
    registerNode({ ...definition, floorplan: nodeRegistry.get('shelf')!.floorplan } as never)
    root.metadata = { isNew: true }
    seed([root])
    select(root, '2d')
    useScene.temporal.getState().resume()
    await act(async () => useEditor.getState().setMovingNode(root))
    const renderer = await create(<Scene panes={panesFor('2d')} />)
    try {
      await planPointer(3, 4)
      // A custom mover can clear its scene flags while the scope still carries the fresh payload.
      useScene.temporal.getState().pause()
      useScene.getState().updateNode(root.id, { metadata: {} })
      useScene.temporal.getState().resume()
      await key('Escape')
      await settle(renderer)
      expect(useScene.getState().nodes[root.id]).toBeUndefined()
      const historySteps = useScene.temporal.getState().pastStates.length
      await act(async () => useScene.temporal.getState().undo())
      expect(useScene.getState().nodes[root.id]).toBeUndefined()
      expect(historySteps).toBe(0)
      await act(async () => useScene.temporal.getState().redo())
      expect(useScene.getState().nodes[root.id]).toBeUndefined()
    } finally {
      await renderer.unmount()
    }
  })
}
