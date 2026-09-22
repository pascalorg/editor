import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BlockNode,
  BuildingNode,
  CabinetModuleNode,
  CabinetNode,
  CeilingNode,
  ColumnNode,
  emitter,
  ItemNode,
  LevelNode,
  nodeRegistry,
  nodeType,
  objectId,
  RoofNode,
  RoofSegmentNode,
  registerNode,
  ShelfNode,
  SiteNode,
  SlabNode,
  sceneRegistry,
  spatialGridManager,
  useLiveNodeOverrides,
  useLiveTransforms,
  useRegistry,
  useScene,
  WallNode,
} from '@pascal-app/core'
import { ProceduralItemNode, type Recipe } from '@pascal-app/core/procedural-items'
import { NodeRenderer, useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { events, type RootStore } from '@react-three/fiber'
import { act, create } from '@react-three/test-renderer'
import { type ReactNode, useMemo, useRef } from 'react'
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, type Object3D, Vector3 } from 'three'
import { MoveRegistryNodeTool } from '../../../editor/src/components/tools/registry/move-registry-node-tool'
import useEditor from '../../../editor/src/store/use-editor'
import useInteractionScope from '../../../editor/src/store/use-interaction-scope'
import { CeilingSystem } from '../../../viewer/src/systems/ceiling/ceiling-system'
import { FloorElevationSystem } from '../../../viewer/src/systems/floor-elevation/floor-elevation-system'
import { GeometrySystem } from '../../../viewer/src/systems/geometry/geometry-system'
import { ItemSystem } from '../../../viewer/src/systems/item/item-system'
import { RoofSystem } from '../../../viewer/src/systems/roof/roof-system'
import { WallSystem } from '../../../viewer/src/systems/wall/wall-system'
import { builtinPlugin } from '../index'
import {
  buildItemFloorplan as mainFloorplan,
  resolveItemTransform as mainTransform,
} from '../item/__fixtures__/main-floorplan'
import { buildItemFloorplan, resolveItemTransform } from '../item/floorplan'
import { ItemGLTFLoader } from '../item/model-loader'
import { MoveItemTool } from '../item/move-tool'
import { restingNodePlanFrame } from '../shared/resting-surface-plan'
import { getDefaultPanelMaterial } from '../solar-panel/geometry'

// Other node tests install process-global renderer mocks; this audit must observe production modules.
if (process.env.PASCAL_COLUMN_AUDIT3_ISOLATED !== '1') {
  test('third column audit with production registrations', async () => {
    const child = Bun.spawn(
      [process.execPath, 'run', 'test', 'src/__tests__/column-audit3.test.tsx'],
      {
        cwd: new URL('../..', import.meta.url).pathname,
        env: { ...process.env, PASCAL_COLUMN_AUDIT3_ISOLATED: '1' },
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

  function CatalogMover({ source }: { source: ItemNode }) {
    const node = useMemo(() => structuredClone(source), [source])
    return <MoveItemTool node={node} />
  }
  function Scene({ mover, child }: { mover?: Mover; child?: AnyNode }) {
    const children = useScene((s) => (s.nodes[level.id] as LevelNode).children)
    const moving = useInteractionScope((s) => s.scope.kind === 'moving')
    const ref = useRef<Group>(null!)
    useRegistry(level.id, 'level', ref)
    return (
      <>
        <group ref={ref}>
          {children.map((id) => (
            <NodeRenderer key={id} nodeId={id} />
          ))}
        </group>
        {moving &&
          child &&
          (mover === 'catalog' ? (
            <CatalogMover source={child as ItemNode} />
          ) : (
            <MoveRegistryNodeTool node={child} />
          ))}
        <FloorElevationSystem />
        <ItemSystem />
        <GeometrySystem />
        <WallSystem />
        <CeilingSystem />
        <RoofSystem />
      </>
    )
  }
  async function settle(renderer: Awaited<ReturnType<typeof create>>) {
    for (let frame = 0; frame < 4; frame++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 5))
      })
      await act(async () => renderer.advanceFrames(1, 1 / 60))
    }
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
      viewMode: '3d',
    })
    useEditor.getState().setSnappingMode('item', 'off')
    useViewer.setState({
      textures: false,
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
  function plan(item: ItemNode) {
    return resolveItemTransform(item, {
      resolve: (id: AnyNodeId) => useScene.getState().nodes[id],
    } as never)!
  }
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
  function pointerDispatcher(side = false) {
    const object = sceneRegistry.nodes.get(level.id)! as Object3D & { __r3f: { root: RootStore } }
    const store = object.__r3f.root
    const manager = events(store)
    store.setState({ events: manager })
    const state = store.getState()
    state.setSize(1000, 1000)
    state.camera.position.set(...((side ? [0, 2, 5] : [1, 12, -1]) as [number, number, number]))
    state.camera.up.set(0, 0, -1)
    state.camera.lookAt(...((side ? [0, 0.4, 0] : [1, 0, -1]) as [number, number, number]))
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

  async function paired(
    pointer: ReturnType<typeof pointerDispatcher>,
    point: Vector3,
    order: string,
    floor: [number, number, number] = [8, 0, 8],
  ) {
    const move = pointer(point)
    const grid = {
      position: floor,
      localPosition: floor,
      nativeEvent: { nativeEvent: move.native },
      stopPropagation() {},
    }
    await act(async () => {
      if (order === 'grid first') emitter.emit('grid:move', grid as never)
      move.dispatch()
      if (order === 'host first') emitter.emit('grid:move', grid as never)
    })
  }
  for (const mover of ['catalog', 'registry'] as const)
    for (const order of ['grid first', 'host first'])
      test(`${mover} generic side yields silently to the floor through R3F, ${order}`, async () => {
        const host = ColumnNode.parse({
          parentId: level.id,
          height: 0.8,
          radius: 0.2,
          capitalStyle: 'none',
          baseStyle: 'none',
        })
        const child =
          mover === 'catalog'
            ? ItemNode.parse({ parentId: level.id, asset, position: [-4, 0, -4] })
            : ProceduralItemNode.parse({ parentId: level.id, recipe, position: [-4, 0, -4] })
        seed([host, child])
        useEditor.getState().setMovingNode(child)
        const renderer = await create(<Scene mover={mover} child={child} />)
        const seen: string[] = []
        const observe = (e: { node: AnyNode }) => seen.push(e.node.id)
        emitter.on('node:move', observe)
        try {
          await settle(renderer)
          const pointer = pointerDispatcher(true)
          await paired(pointer, new Vector3(-4, 0, -4), order, [-4, 0, -4])
          await settle(renderer)
          const point = new Vector3(0, 0.4, 0.2)
          await paired(pointer, point, order)
          await settle(renderer)
          expect(seen).toContain(host.id)
          const draft = useScene.getState().nodes[child.id] as ItemNode
          expect(draft.parentId).toBe(level.id)
          expect(world(child.id).toArray()).toEqual([8, 0, 8])
          await act(async () => pointer(point, 'onPointerUp').dispatch())
          await settle(renderer)
          expect(useInteractionScope.getState().scope.kind).toBe('idle')
          expect(useScene.getState().nodes[child.id]!.parentId).toBe(level.id)
          expect((useScene.getState().nodes[child.id] as ItemNode).position).toEqual([8, 0, 8])
        } finally {
          emitter.off('node:move', observe)
          await renderer.unmount()
        }
      })
  test('wall-side item → shelf → catalog: plan equals main and mounted wall-face pose', async () => {
    const wall = WallNode.parse({ parentId: level.id, start: [2, 3], end: [6, 5], thickness: 0.4 })
    const mounted = ItemNode.parse({
      parentId: wall.id,
      asset: { ...asset, attachTo: 'wall-side' },
      position: [1, 1, 0],
      side: 'front',
    })
    const shelf = ShelfNode.parse({ parentId: mounted.id, position: [0, 0.2, 0] })
    const child = ItemNode.parse({ parentId: shelf.id, asset, position: [0, 0.3, 0] })
    seed([wall, mounted, shelf, child])
    const renderer = await create(<Scene />)
    try {
      await settle(renderer)
      const expected = world(child.id)
      expect(expected.x).toBeCloseTo(2.804984472, 8)
      expect(expected.z).toBeCloseTo(3.626099034, 8)
      expect(plan(child)).toEqual(
        mainTransform(child, { resolve: (id) => useScene.getState().nodes[id] } as never),
      )
      expect(plan(child).x).toBeCloseTo(expected.x, 8)
      expect(plan(child).y).toBeCloseTo(expected.z, 8)
    } finally {
      await renderer.unmount()
    }
  })

  const anchors = [
    'level',
    'wall-front',
    'wall-back',
    'ceiling',
    'roof-front',
    'roof-back',
    'roof-left',
    'roof-right',
    'item',
    'shelf',
    'shelf-wall',
    'cabinet',
    'cabinet-module',
    'named',
    'unnamed',
    'block-top',
    'block-side',
    'block-bottom',
    'slab',
    'identity-plugin',
  ] as const
  for (const anchor of anchors)
    for (const attachTo of [undefined, 'wall', 'wall-side', 'ceiling'] as const)
      for (const depth of [1, 2, 3])
        for (const transformed of [false, true])
          test(`main differential: ${anchor}, ${attachTo ?? 'floor'}, depth ${depth}, transformed ${transformed}`, async () => {
            const pos: [number, number, number] = transformed ? [2, 0.4, 3] : [0, 0, 0]
            const yaw = transformed ? 0.6 : 0
            const entries: AnyNode[] = []
            let host: AnyNode = level
            let face: string | undefined
            if (anchor.startsWith('wall') || anchor === 'shelf-wall') {
              host = WallNode.parse({
                parentId: level.id,
                start: transformed ? [2, 3] : [0, 0],
                end: transformed ? [6, 5] : [4, 0],
                thickness: 0.4,
              })
              entries.push(host)
              if (anchor === 'shelf-wall')
                host = ShelfNode.parse({ parentId: host.id, position: pos, rotation: [0, yaw, 0] })
            } else if (anchor === 'ceiling')
              host = CeilingNode.parse({
                parentId: level.id,
                polygon: [
                  [0, 0],
                  [8, 0],
                  [8, 8],
                  [0, 8],
                ],
                height: 3,
              })
            else if (anchor.startsWith('roof-')) {
              const roof = RoofNode.parse({ parentId: level.id, position: pos, rotation: yaw })
              entries.push(roof)
              host = RoofSegmentNode.parse({
                parentId: roof.id,
                position: [1, 2, 1],
                rotation: yaw / 2,
                roofType: 'hip',
              })
              face = anchor.slice(5)
            } else if (anchor === 'item')
              host = ItemNode.parse({
                parentId: level.id,
                asset,
                position: pos,
                rotation: [0, yaw, 0],
              })
            else if (anchor === 'shelf')
              host = ShelfNode.parse({ parentId: level.id, position: pos, rotation: [0, yaw, 0] })
            else if (anchor === 'cabinet' || anchor === 'cabinet-module') {
              host = CabinetNode.parse({ parentId: level.id, position: pos, rotation: yaw })
              if (anchor === 'cabinet-module') {
                entries.push(host)
                host = CabinetModuleNode.parse({
                  parentId: host.id,
                  position: [0.5, 0.1, 0.2],
                  rotation: yaw / 2,
                })
              }
            } else if (anchor === 'named' || anchor === 'unnamed')
              host = ProceduralItemNode.parse({
                parentId: level.id,
                position: pos,
                rotation: [0, yaw, 0],
                recipe: {
                  ...recipe,
                  surfaces:
                    anchor === 'named'
                      ? [
                          {
                            id: 'top',
                            label: 'Top',
                            position: [0.1, 1, 0.2],
                            rotation: [0, 0.4, 0],
                            size: [2, 2],
                          },
                        ]
                      : [],
                },
              })
            else if (anchor.startsWith('block-')) {
              host = BlockNode.parse({ parentId: level.id, position: pos, rotation: yaw })
              face =
                anchor === 'block-top' ? 'f-top' : anchor === 'block-side' ? 'f-front' : 'f-bottom'
            } else if (anchor === 'slab')
              host = SlabNode.parse({
                parentId: level.id,
                elevation: 0.4,
                polygon: [
                  [0, 0],
                  [8, 0],
                  [8, 8],
                  [0, 8],
                ],
              })
            else if (anchor === 'identity-plugin') {
              host = genericHost()
              Object.assign(host, { position: [0, 0, 0], rotation: [0, 0, 0] })
            }
            if (host !== level && !entries.includes(host)) entries.push(host)
            const first = ItemNode.parse({
              parentId: host.id,
              asset: { ...asset, attachTo },
              side: anchor === 'wall-back' ? 'back' : 'front',
              position: [0.2, 0.4, 0.1],
              rotation: [0, anchor === 'wall-back' ? Math.PI + yaw : yaw, 0],
              ...(anchor.startsWith('roof-') ? { roofFace: face, roofSegmentId: host.id } : {}),
              ...(anchor.startsWith('block-') ? { blockFaceId: face } : {}),
            })
            entries.push(first)
            if (anchor === 'named') (host as ProceduralItemNode).attachments[first.id] = 'top'
            let parent: AnyNode = first
            for (let i = 1; i < depth; i++) {
              const shelf = ShelfNode.parse({
                parentId: parent.id,
                position: [0.1, 0.2, -0.1],
                rotation: [0, yaw / 3, 0],
              })
              entries.push(shelf)
              const child = ItemNode.parse({
                parentId: shelf.id,
                asset: { ...asset, attachTo },
                position: [0.1, 0.3, 0.2],
                rotation: [0, yaw / 4, 0],
              })
              entries.push(child)
              parent = child
            }
            seed(entries)
            const renderer = await create(<Scene />)
            try {
              await settle(renderer)
              const ctx = { resolve: (id: AnyNodeId) => useScene.getState().nodes[id] } as never
              for (const item of entries.filter((n): n is ItemNode => n.type === 'item')) {
                expect(sceneRegistry.nodes.get(item.id)).toBeDefined()
                expect(resolveItemTransform(item, ctx)).toEqual(mainTransform(item, ctx))
                expect(buildItemFloorplan(item, ctx)).toEqual(mainFloorplan(item, ctx))
              }
            } finally {
              await renderer.unmount()
            }
          })
  for (const rootKind of ['column', 'plugin'])
    for (const depth of [1, 2, 3])
      for (const kind of ['catalog', 'generated'])
        test(`new ${rootKind} chain depth ${depth}: ${kind} plan equals mounted pose`, async () => {
          const root =
            rootKind === 'column'
              ? ColumnNode.parse({
                  parentId: level.id,
                  position: [5, 0, 3],
                  rotation: Math.PI / 2,
                  height: 0.8,
                })
              : genericHost()
          const entries: AnyNode[] = [root]
          let parent = root
          for (let i = 0; i < depth; i++) {
            const shelf = ShelfNode.parse({
              parentId: parent.id,
              position: [0.1, i === 0 ? 0.8 : 0.2, 0.1],
              rotation: [0, 0.2, 0],
            })
            entries.push(shelf)
            parent = shelf
          }
          const child =
            kind === 'catalog'
              ? ItemNode.parse({ asset, parentId: parent.id, position: [0.2, 0.3, 0.1] })
              : ProceduralItemNode.parse({ recipe, parentId: parent.id, position: [0.2, 0.3, 0.1] })
          entries.push(child)
          seed(entries, true)
          const renderer = await create(<Scene />)
          try {
            await settle(renderer)
            const p =
              child.type === 'item'
                ? plan(child)
                : (() => {
                    const f = restingNodePlanFrame(child, (id) => useScene.getState().nodes[id])
                    return {
                      x: f.position[0],
                      y: f.position[2],
                      rotation: Math.atan2(f.axes[2][0], f.axes[2][2]),
                    }
                  })()
            const rendered = world(child.id)
            expect(p.x).toBeCloseTo(rendered.x, 8)
            expect(p.y).toBeCloseTo(rendered.z, 8)
            const matrix = sceneRegistry.nodes.get(child.id)!.matrixWorld.elements
            const yaw = Math.atan2(matrix[8]!, matrix[10]!)
            expect(Math.sin(p.rotation)).toBeCloseTo(Math.sin(yaw), 8)
            expect(Math.cos(p.rotation)).toBeCloseTo(Math.cos(yaw), 8)
          } finally {
            await renderer.unmount()
          }
        })
  for (const kind of ['column', 'plugin'])
    test(`${kind} initially identity: hosted plan follows live move and rotation`, async () => {
      const root =
        kind === 'column' ? ColumnNode.parse({ parentId: level.id, height: 0.8 }) : genericHost()
      Object.assign(root, { position: [0, 0, 0], rotation: kind === 'column' ? 0 : [0, 0, 0] })
      const shelf = ShelfNode.parse({ parentId: root.id, position: [0, 0.8, 0] })
      const child = ItemNode.parse({ parentId: shelf.id, asset, position: [0.2, 0.3, 0.1] })
      seed([root, shelf, child])
      const renderer = await create(<Scene />)
      try {
        await settle(renderer)
        expect(plan(child).x).toBeCloseTo(world(child.id).x, 8)
        await act(async () =>
          useLiveTransforms.getState().set(root.id, { position: [5, 0, 3], rotation: Math.PI / 2 }),
        )
        await settle(renderer)
        expect(plan(child).x).toBeCloseTo(world(child.id).x, 8)
        expect(plan(child).y).toBeCloseTo(world(child.id).z, 8)
      } finally {
        await renderer.unmount()
      }
    })
}
