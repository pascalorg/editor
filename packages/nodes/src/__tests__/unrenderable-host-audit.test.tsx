import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import {
  type AnyNode,
  type BlockNode,
  BuildingNode,
  createSceneApi,
  emitter,
  getBlockFaceFrame,
  getSurfaceProvider,
  ItemNode,
  LevelNode,
  NON_PHYSICAL_HOST_KINDS,
  nodeRegistry,
  nodeType,
  objectId,
  registerNode,
  rendersHostedChildren,
  resolveSurfacePlacement,
  SiteNode,
  sceneRegistry,
  spatialGridManager,
  useLiveNodeOverrides,
  useLiveTransforms,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import { ProceduralItemNode, type Recipe } from '@pascal-app/core/procedural-items'
import { AnyNode as AnyNodeSchema } from '@pascal-app/core/schema'
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
  Vector3,
} from 'three'
import { NODE_REQUIRED_FIELDS } from '../../../core/src/schema/__fixtures__/node-fixtures'
import { FloorplanRegistryLayer } from '../../../editor/src/components/editor-2d/renderers/floorplan-registry-layer'
import { MoveRegistryNodeTool } from '../../../editor/src/components/tools/registry/move-registry-node-tool'
import useEditor from '../../../editor/src/store/use-editor'
import useInteractionScope from '../../../editor/src/store/use-interaction-scope'
import { FloorElevationSystem } from '../../../viewer/src/systems/floor-elevation/floor-elevation-system'
import { GeometrySystem } from '../../../viewer/src/systems/geometry/geometry-system'
import { ItemSystem } from '../../../viewer/src/systems/item/item-system'
import { addCornerRun } from '../cabinet/run-ops'
import type { CabinetModuleNode, CabinetNode } from '../cabinet/schema'
import { builtinPlugin } from '../index'
import browserNodes from '../item/__fixtures__/final-browser-hosting.json'
import { ItemGLTFLoader } from '../item/model-loader'
import { MoveItemTool } from '../item/move-tool'
import { getDefaultPanelMaterial } from '../solar-panel/geometry'

// Other node tests install process-global renderer mocks; this audit must observe production modules.
if (process.env.PASCAL_HOST_AUDIT_ISOLATED !== '1') {
  test('production hosting regression in an isolated module registry', async () => {
    const child = Bun.spawn(
      [process.execPath, 'run', 'test', 'src/__tests__/unrenderable-host-audit.test.tsx'],
      {
        cwd: new URL('../..', import.meta.url).pathname,
        env: { ...process.env, PASCAL_HOST_AUDIT_ISOLATED: '1' },
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

  beforeEach(() => {
    savedScene = useScene.getState()
    savedEditor = useEditor.getState()
    savedViewer = useViewer.getState()
    savedScope = useInteractionScope.getState()
    const names = ['window', 'document', 'requestAnimationFrame', 'cancelAnimationFrame'] as const
    const descriptors = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name))
    restoreGlobals = () =>
      names.forEach((name, i) => {
        const descriptor = descriptors[i]
        if (descriptor) Object.defineProperty(globalThis, name, descriptor)
        else Reflect.deleteProperty(globalThis, name)
      })
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

  function makeHost(kind: string) {
    const def = nodeRegistry.get(kind)!
    const fields = {
      ...NODE_REQUIRED_FIELDS[kind],
      parentId: level.id,
      ...(kind === 'item' ? { asset: { ...asset, dimensions: [2, 1, 2] } } : {}),
      ...(kind === 'procedural-item'
        ? {
            recipe: {
              ...recipe,
              parts: [
                {
                  ...recipe.parts[0]!,
                  shapes: [
                    {
                      id: 'box',
                      primitive: 'box',
                      size: [2, 1, 2],
                      position: [0, 0.5, 0],
                      slot: 'body',
                    },
                  ],
                },
              ],
            },
          }
        : {}),
    }
    const host = def.schema.parse({
      ...fields,
      ...(kind === 'elevator' ? { parentId: building.id } : {}),
    }) as AnyNode
    if ('position' in host && Array.isArray(host.position)) host.position = [0.7, 0.2, -0.4]
    if ('rotation' in host) host.rotation = typeof host.rotation === 'number' ? 0.31 : [0, 0.31, 0]
    const nodes: Record<string, AnyNode> = { [host.id]: host }
    const parse = (type: string, values: Record<string, unknown>) =>
      nodeRegistry.get(type)!.schema.parse(values) as AnyNode
    if (
      (!['item', 'door', 'window'].includes(kind) &&
        'roofSegmentId' in (def.schema as unknown as { shape: object }).shape) ||
      kind === 'downspout'
    ) {
      const roof = parse('roof', { parentId: level.id })
      const segment = parse('roof-segment', { parentId: roof.id, roofType: 'flat' })
      ;(roof as AnyNode & { children: string[] }).children = [segment.id]
      ;(segment as AnyNode & { children: string[] }).children = [host.id]
      host.parentId = segment.id
      Object.assign(host, { roofSegmentId: segment.id })
      if (kind === 'downspout') {
        const gutter = parse('gutter', {
          parentId: segment.id,
          roofSegmentId: segment.id,
          outlets: [{ id: 'audit-outlet' }],
        })
        Object.assign(host, { gutterId: gutter.id, outletId: 'audit-outlet' })
        ;(segment as AnyNode & { children: string[] }).children.push(gutter.id)
        nodes[gutter.id] = gutter
      }
      nodes[roof.id] = roof
      nodes[segment.id] = segment
    }
    if (kind === 'door' || kind === 'window') {
      const wall = parse('wall', {
        ...NODE_REQUIRED_FIELDS.wall,
        parentId: level.id,
        children: [host.id],
      })
      host.parentId = wall.id
      nodes[wall.id] = wall
    }
    if (kind === 'roof-segment' || kind === 'stair-segment' || kind === 'cabinet-module') {
      const parent = parse(
        kind === 'roof-segment' ? 'roof' : kind === 'stair-segment' ? 'stair' : 'cabinet',
        { parentId: level.id, children: [host.id] },
      )
      host.parentId = parent.id
      nodes[parent.id] = parent
    }
    if (kind === 'cabinet') {
      const module = nodeRegistry
        .get('cabinet-module')!
        .schema.parse({ parentId: host.id }) as AnyNode
      nodes[module.id] = module
      ;(host as AnyNode & { children: string[] }).children = [module.id]
    }
    return { host, nodes }
  }
  function seed(kind: string, mover: Mover) {
    const { host, nodes } = makeHost(kind)
    const child =
      mover === 'registry'
        ? ProceduralItemNode.parse({
            recipe,
            parentId: level.id,
            position: [-5, 0, -5],
            supportSlabId: 'ground',
          })
        : ItemNode.parse({
            asset,
            parentId: level.id,
            position: [-5, 0, -5],
            supportSlabId: 'ground',
          })
    useScene.setState({
      nodes: {
        ...nodes,
        [child.id]: child,
        [site.id]: { ...site, children: [building.id] },
        [building.id]: {
          ...building,
          children: [
            level.id,
            ...Object.values(nodes)
              .filter((n) => n.parentId === building.id)
              .map((n) => n.id),
          ],
        },
        [level.id]: {
          ...level,
          children: [
            ...Object.values(nodes)
              .filter((n) => n.parentId === level.id)
              .map((n) => n.id),
            child.id,
          ],
        },
      },
      rootNodeIds: [site.id],
      dirtyNodes: new Set(),
      readOnly: false,
      materials: {},
      collections: {},
      installedPlugins: [],
    })
    spatialGridManager.clear()
    sceneRegistry.nodes.clear()
    useLiveNodeOverrides.getState().clearAll()
    useLiveTransforms.getState().clearAll()
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
  function probe(host: AnyNode) {
    const scene = createSceneApi(useScene)
    const def = nodeRegistry.get(host.type)!
    const bounds = def.capabilities.dragBounds?.(host, scene.nodes())
    const center = bounds?.center ?? [0, 0, 0]
    const surfaces = getSurfaceProvider(host).surfaces?.(host, { scene }) ?? []
    const candidates = [
      ...surfaces.map((s) => [
        s.position[0] + (s.region.center?.[0] ?? 0),
        s.position[1],
        s.position[2] + (s.region.center?.[1] ?? 0),
      ]),
      [center[0], center[1] + (bounds?.size[1] ?? 2) / 2, center[2]],
      [0, 1, 0],
      [0, 0, 0],
    ] as [number, number, number][]
    return (
      candidates.find((point) =>
        resolveSurfacePlacement({
          host,
          childKind: 'procedural-item',
          childFootprint: { size: [0.1, 0.2, 0.1], rotationY: 0 },
          hit: { point, normalWorldY: 1 },
          scene,
        }),
      ) ?? candidates[0]!
    )
  }
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
  function Scene({ mover, child }: { mover?: Mover; child?: AnyNode }) {
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
        <group ref={buildingRef}>
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
  function r3fPointer() {
    const root = (sceneRegistry.nodes.get(level.id)! as Object3D & { __r3f: { root: RootStore } })
      .__r3f.root
    const manager = events(root)
    root.setState({ events: manager })
    const state = root.getState()
    state.setSize(1000, 1000)
    state.camera.position.set(0, 15, 0)
    state.camera.up.set(0, 0, -1)
    state.camera.lookAt(0, 0, 0)
    state.camera.updateMatrixWorld()
    state.raycaster.layers.enableAll()
    return async (point: Vector3, click = false) => {
      state.scene.updateMatrixWorld(true)
      const p = point.clone().project(state.camera)
      const native = Object.assign(new Event(click ? 'pointerup' : 'pointermove'), {
        offsetX: (p.x + 1) * 500,
        offsetY: (1 - p.y) * 500,
        pointerId: 1,
        button: 0,
      })
      await act(async () =>
        manager.handlers![click ? 'onPointerUp' : 'onPointerMove'](native as never),
      )
    }
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

  function seedBrowser(mover: Mover) {
    seed('item', mover)
    const relevant =
      mover === 'registry'
        ? ['cabinet_f1', 'cabinet-module_f1', 'procedural-item_probe']
        : ['procedural-item_f1named', 'item_f1named', 'item_probe']
    const selected = Object.values(structuredClone(browserNodes))
      .filter((raw) => relevant.includes(raw.id))
      .map((raw) => ({
        ...raw,
        children: raw.children.filter((id) => relevant.includes(id)),
        parentId: raw.parentId.startsWith('level_') ? level.id : raw.parentId,
      })) as AnyNode[]
    const nodes = Object.fromEntries(
      selected.map((raw) => [raw.id, nodeRegistry.get(raw.type)!.schema.parse(raw)]),
    )
    useScene.setState({
      nodes: {
        ...nodes,
        [level.id]: {
          ...level,
          children: selected.filter((n) => n.parentId === level.id).map((n) => n.id),
        },
        [building.id]: { ...building, children: [level.id] },
        [site.id]: { ...site, children: [building.id] },
      },
      dirtyNodes: new Set(selected.map((n) => n.id)),
    })
    return nodes[mover === 'catalog' ? 'item_probe' : 'procedural-item_probe'] as AnyNode
  }

  for (const degrees of [0, 45, 90])
    test(`browser exact: generated countertop preview equals commit at ${degrees} degrees`, async () => {
      const child = seedBrowser('registry')
      useScene.getState().updateNode('cabinet_f1', { rotation: (degrees * Math.PI) / 180 } as never)
      useEditor.getState().setMovingNode(child)
      const renderer = await create(<Scene mover="registry" child={child} />)
      try {
        await settle(renderer)
        const host = useScene.getState().nodes['cabinet-module_f1']!
        const object = sceneRegistry.nodes.get(host.id)!
        const point: [number, number, number] = [
          -0.4380499772232196, 0.9199999997764826, 0.2234751571494149,
        ]
        const world = object.localToWorld(new Vector3(...point)).toArray()
        const pointer = r3fPointer()
        await pointer(new Vector3(...world))
        await settle(renderer)
        const preview = matrix(sceneRegistry.nodes.get(child.id))!
        await pointer(new Vector3(...world), true)
        await settle(renderer)
        expect(useInteractionScope.getState().scope.kind).toBe('idle')
        const committed = matrix(sceneRegistry.nodes.get(child.id))!
        expect(Math.atan2(committed[8]!, committed[10]!)).toBeCloseTo(1.7707963267948965, 6)
        expect(committed[13]).toBeCloseTo(0.92, 6)
        const stored = useScene.getState().nodes[child.id] as unknown as ProceduralItemNode
        expect(stored.parentId).toBe(host.parentId)
        expect(stored.rotation[0]).toBe(0)
        expect(stored.rotation[1]).toBeCloseTo(1.7707963267948965 - (degrees * Math.PI) / 180, 6)
        expect(stored.rotation[2]).toBe(0)
        preview.forEach((v, i) => {
          expect(v).toBeCloseTo(committed[i]!, 6)
        })
      } finally {
        await renderer.unmount()
      }
    })

  test('browser exact: occupied named surface rejects without mutating the preview or committing', async () => {
    const child = seedBrowser('catalog')
    useEditor.getState().setMovingNode(child)
    const renderer = await create(<Scene mover="catalog" child={child} />)
    try {
      await settle(renderer)
      const host = useScene.getState().nodes['procedural-item_f1named']!
      const object = sceneRegistry.nodes.get(host.id)!
      const eventAt = (world: [number, number, number]) => ({
        node: host,
        object,
        normal: [0, 1, 0],
        position: world,
        localPosition: object.worldToLocal(new Vector3(...world)).toArray(),
        nativeEvent: { nativeEvent: {} },
        stopPropagation() {},
      })
      const valid = eventAt([3.65, 1, 3.35])
      const move = async (event: ReturnType<typeof eventAt>) => {
        await act(async () => {
          emitter.emit(`${host.type}:move` as never, event as never)
          emitter.emit('node:move', event as never)
        })
        await settle(renderer)
      }
      await move(valid)
      const before = matrix(sceneRegistry.nodes.get(child.id))!
      const saved = snapshot()
      for (const world of [
        [3.3506380372041304, 1, 2.937638828256883],
        [3.4516666662740807, 1, 3.2194840717804447],
      ] as [number, number, number][]) {
        const blocked = eventAt(world)
        await move(blocked)
        await act(async () => {
          emitter.emit(`${host.type}:click` as never, blocked as never)
          emitter.emit('node:click', blocked as never)
        })
        await settle(renderer)
        expect(useInteractionScope.getState().scope.kind).toBe('moving')
        expect(snapshot()).toEqual(saved)
        matrix(sceneRegistry.nodes.get(child.id))!.forEach((v, i) => {
          expect(v).toBeCloseTo(before[i]!, 6)
        })
      }
      await move(valid)
      const preview = matrix(sceneRegistry.nodes.get(child.id))!
      await act(async () => {
        emitter.emit(`${host.type}:click` as never, valid as never)
        emitter.emit('node:click', valid as never)
      })
      await settle(renderer)
      expect(useInteractionScope.getState().scope.kind).toBe('idle')
      const after = matrix(sceneRegistry.nodes.get(child.id))!
      preview.forEach((v, i) => {
        expect(v).toBeCloseTo(after[i]!, 6)
      })
      expect(
        (useScene.getState().nodes[host.id] as unknown as ProceduralItemNode).attachments[child.id],
      ).toBe('top')
    } finally {
      await renderer.unmount()
    }
  })

  test('final blocker: catalog block-face preview follows the live face before commit', async () => {
    const { host, child } = seed('block', 'catalog')
    const source = ItemNode.parse({
      ...child,
      parentId: host.id,
      blockFaceId: 'f-front',
      position: [0.2, 0.4, 0.02],
      asset: { ...asset, attachTo: 'wall' },
    })
    useScene.getState().updateNode(source.id, source)
    const renderer = await create(<Scene />)
    try {
      await settle(renderer)
      const patch = {
        blockFaceId: 'f-right',
        position: [0.3, 0.5, 0.02] as [number, number, number],
      }
      await act(async () => useLiveNodeOverrides.getState().set(source.id, patch))
      await settle(renderer)
      const preview = matrix(sceneRegistry.nodes.get(source.id))!
      await act(async () => {
        useScene.getState().updateNode(source.id, patch)
        useLiveNodeOverrides.getState().clear(source.id)
      })
      await settle(renderer)
      const committed = matrix(sceneRegistry.nodes.get(source.id))!
      expect(preview).toBeDefined()
      preview.forEach((v, i) => {
        expect(v).toBeCloseTo(committed[i]!, 6)
      })
    } finally {
      await renderer.unmount()
    }
  })

  for (const order of ['grid first', 'host first'])
    test(`final blocker: catalog stays on countertop over sink cutout, ${order}`, async () => {
      const { host, child } = seed('cabinet', 'catalog')
      const moduleId = (host as CabinetNode).children[0]!
      const module = useScene.getState().nodes[moduleId]!
      useScene.getState().updateNode(
        moduleId,
        nodeRegistry.get('cabinet-module')!.schema.parse({
          ...module,
          width: 1.2,
          depth: 0.6,
          position: [0, 0.1, 0],
          stack: [{ id: 'sink', type: 'sink', height: 0.72 }],
        }),
      )
      useEditor.getState().setMovingNode(child)
      const surface = getSurfaceProvider(host).surfaces!(host, {
        scene: createSceneApi(useScene),
      })[0]!
      const hole = surface.region.holes![0]!
      const cx = hole.reduce((sum, p) => sum + p[0], 0) / hole.length
      const cz = hole.reduce((sum, p) => sum + p[1], 0) / hole.length
      const start: [number, number, number] = [
        surface.region.center![0] - surface.region.size![0] + 0.06,
        surface.position[1],
        surface.region.center![1],
      ]
      const renderer = await create(<Scene mover="catalog" child={child} />, {
        camera: { position: [cx, 10, cz] },
      })
      try {
        await settle(renderer)
        const object = sceneRegistry.nodes.get(host.id)!
        const move = async (point: [number, number, number]) => {
          const world = object.localToWorld(new Vector3(...point)).toArray()
          const nativeEvent = {}
          const event = {
            node: host,
            object,
            position: world,
            localPosition: point,
            normal: [0, 1, 0],
            nativeEvent: { nativeEvent },
            stopPropagation() {},
          }
          const grid = {
            position: [world[0], 0, world[2]],
            localPosition: [world[0], 0, world[2]],
            nativeEvent,
            stopPropagation() {},
          }
          await act(async () => {
            if (order === 'grid first') emitter.emit('grid:move', grid as never)
            emitter.emit('cabinet:move', event as never)
            if (order === 'host first') emitter.emit('grid:move', grid as never)
          })
          await settle(renderer)
        }
        await move(start)
        expect(useScene.getState().nodes[child.id]!.parentId).toBe(host.id)
        const before = matrix(sceneRegistry.nodes.get(child.id))!
        await move([cx, surface.position[1], cz])
        expect(useScene.getState().nodes[child.id]!.parentId).toBe(host.id)
        expect((useScene.getState().nodes[child.id] as ItemNode).position[1]).toBeCloseTo(
          surface.position[1],
          6,
        )
        expect(matrix(sceneRegistry.nodes.get(child.id))![13]).toBeCloseTo(before[13]!, 6)
        expect(hasRedPreview(renderer)).toBe(true)
      } finally {
        await renderer.unmount()
      }
    })

  test('Table Lamp overhang keeps the catalog preview pose when committed to each host', async () => {
    loadModel.mockImplementation((url, onLoad) => {
      const dimensions: [number, number, number] =
        url === '/table-lamp.glb' ? [0.29, 0.74, 0.67] : asset.dimensions
      const scene = new Group()
      scene.add(
        new Mesh(
          new BoxGeometry(...dimensions).translate(0, dimensions[1] / 2, 0),
          new MeshBasicMaterial(),
        ),
      )
      onLoad({
        scene,
        scenes: [scene],
        animations: [],
        cameras: [],
        asset: { version: '2.0' },
        parser: {},
      })
    })
    for (const kind of ['shelf', 'cabinet', 'item']) {
      const seeded = seed(kind, 'catalog')
      const lamp = ItemNode.parse({
        ...seeded.child,
        asset: {
          ...asset,
          id: 'table-lamp',
          name: 'Table Lamp',
          category: 'table-lamps',
          src: '/table-lamp.glb',
          dimensions: [0.29, 0.74, 0.67],
        },
      })
      const host = nodeRegistry.get(kind)!.schema.parse({
        ...seeded.host,
        ...(kind === 'shelf' ? { width: 1.2, depth: 0.3, rows: 3, height: 1.8 } : {}),
        ...(kind === 'item' ? { asset: { ...asset, dimensions: [0.2, 0.4, 0.3] } } : {}),
      }) as AnyNode
      expect(lamp.asset.attachTo).toBeUndefined()
      expect(lamp.asset.surface).toBeUndefined()
      useScene.setState({
        nodes: { ...useScene.getState().nodes, [host.id]: host, [lamp.id]: lamp },
      })
      useEditor.getState().setMovingNode(lamp)
      const renderer = await create(<Scene mover="catalog" child={lamp} />)
      try {
        await settle(renderer)
        const object = sceneRegistry.nodes.get(host.id)!
        const surface = getSurfaceProvider(host)
          .surfaces?.(host, { scene: createSceneApi(useScene) })
          ?.find((entry) => kind !== 'cabinet' || entry.label === 'Countertop')
        const point: [number, number, number] = surface
          ? [
              surface.position[0] + (surface.region.center?.[0] ?? 0),
              surface.position[1],
              surface.position[2] + (surface.region.center?.[1] ?? 0),
            ]
          : [0, 0.4, 0]
        const world = object.localToWorld(new Vector3(...point)).toArray()
        const nativeEvent = {}
        const event = {
          node: host,
          object,
          position: world,
          localPosition: point,
          normal: [0, 1, 0],
          nativeEvent: { nativeEvent },
          stopPropagation() {},
        }
        const grid = {
          position: [world[0], 0, world[2]],
          localPosition: [world[0], 0, world[2]],
          nativeEvent,
          stopPropagation() {},
        }
        await act(async () => {
          emitter.emit('grid:move', grid as never)
          emitter.emit(`${kind}:move` as never, event as never)
          emitter.emit('node:move', event as never)
        })
        await settle(renderer)
        const before = matrix(sceneRegistry.nodes.get(lamp.id))!
        expect(before, `${kind}: rendered preview`).toBeDefined()
        expect(visible(sceneRegistry.nodes.get(lamp.id)), `${kind}: preview visible`).toBe(true)
        expect(useScene.getState().nodes[lamp.id]!.parentId, `${kind}: preview host`).toBe(host.id)
        expect(before[12]).toBeCloseTo(world[0], 6)
        expect(before[13]).toBeCloseTo(world[1], 6)
        expect(before[14]).toBeCloseTo(world[2], 6)
        await act(async () => {
          emitter.emit(`${kind}:click` as never, event as never)
          emitter.emit('node:click', event as never)
          emitter.emit('grid:click', grid as never)
        })
        await settle(renderer)
        expect(useInteractionScope.getState().scope.kind).toBe('idle')
        expect(useScene.getState().nodes[lamp.id]!.parentId, `${kind}: committed host`).toBe(
          host.id,
        )
        expect(visible(sceneRegistry.nodes.get(lamp.id))).toBe(true)
        const after = matrix(sceneRegistry.nodes.get(lamp.id))!
        before.forEach((value, index) => {
          expect(value, `${kind}: pose component ${index}`).toBeCloseTo(after[index]!, 6)
        })
      } finally {
        await renderer.unmount()
      }
    }
  })

  for (const kind of ['cabinet', 'cabinet-module'])
    test(`audit: generated preview matches commit on rotated ${kind}`, async () => {
      const { host, child } = seed(kind, 'registry')
      const nodes = useScene.getState().nodes
      const run = kind === 'cabinet' ? host : nodes[host.parentId!]
      Object.assign(run!, { rotation: Math.PI / 2 })
      child.rotation = [0, Math.PI / 2 + 0.2, 0]
      if (kind === 'cabinet-module')
        Object.assign(host, { position: [0, 0.1, 0], rotation: 0, width: 2, depth: 1 })
      useScene.setState({ nodes: { ...nodes } })
      useEditor.getState().setMovingNode(child)
      const renderer = await create(<Scene mover="registry" child={child} />)
      try {
        await settle(renderer)
        const surface = getSurfaceProvider(run!).surfaces!(run!, {
          scene: createSceneApi(useScene),
        }).find((s) => s.label === 'Countertop')!
        const world = sceneRegistry.nodes
          .get(run!.id)!
          .localToWorld(
            new Vector3(
              surface.region.center?.[0] ?? 0,
              surface.position[1],
              surface.region.center?.[1] ?? 0,
            ),
          )
          .toArray()
        const pointer = r3fPointer()
        await pointer(new Vector3(...world))
        await settle(renderer)
        const before = matrix(sceneRegistry.nodes.get(child.id))!
        expect(Math.atan2(before[8]!, before[10]!)).toBeCloseTo(Math.PI / 2 + 0.2, 6)
        expect(useScene.getState().nodes[child.id]!.parentId).toBe(run!.id)
        await pointer(new Vector3(...world), true)
        await settle(renderer)
        expect(useInteractionScope.getState().scope.kind).toBe('idle')
        const after = matrix(sceneRegistry.nodes.get(child.id))!
        expect(before).toBeDefined()
        expect(before[13]).toBeCloseTo(world[1], 6)
        before.forEach((v, i) => {
          expect(v).toBeCloseTo(after[i]!, 6)
        })
      } finally {
        await renderer.unmount()
      }
    })

  for (const kind of ['slab', 'wall'])
    for (const mover of ['registry', 'catalog'] as const)
      for (const order of ['grid first', 'host first'])
        test(`audit: occluded floor pose ${kind}/${mover}/${order}`, async () => {
          const { host, child } = seed(kind, mover)
          useEditor.getState().setMovingNode(child)
          const renderer = await create(<Scene mover={mover} child={child} />)
          try {
            await settle(renderer)
            const object = sceneRegistry.nodes.get(host.id)!
            const point = probe(host)
            const world = object.localToWorld(new Vector3(...point)).toArray()
            const nativeEvent = {}
            const event = {
              node: host,
              object,
              position: world,
              localPosition: point,
              normal: [0, 1, 0],
              nativeEvent: { nativeEvent },
              stopPropagation() {},
            }
            const grid = {
              position: [world[0], 0, world[2]],
              localPosition: [world[0], 0, world[2]],
              nativeEvent,
              stopPropagation() {},
            }
            await act(async () =>
              emitter.emit('grid:move', {
                ...grid,
                position: [-5, 0, -5],
                localPosition: [-5, 0, -5],
              } as never),
            )
            await settle(renderer)
            await act(async () => {
              if (order === 'grid first') emitter.emit('grid:move', grid as never)
              emitter.emit(`${kind}:move` as never, event as never)
              emitter.emit('node:move', event as never)
              if (order === 'host first') emitter.emit('grid:move', grid as never)
            })
            await settle(renderer)
            const before = matrix(sceneRegistry.nodes.get(child.id))!
            await act(async () => {
              emitter.emit(`${kind}:click` as never, event as never)
              emitter.emit('node:click', event as never)
              emitter.emit('grid:click', grid as never)
            })
            await settle(renderer)
            expect(useScene.getState().nodes[child.id]!.parentId).toBe(level.id)
            const after = matrix(sceneRegistry.nodes.get(child.id))!
            before.forEach((v, i) => {
              expect(v).toBeCloseTo(after[i]!, 6)
            })
            expect(after[12]).toBeCloseTo(world[0], 6)
            expect(after[14]).toBeCloseTo(world[2], 6)
          } finally {
            await renderer.unmount()
          }
        })

  test('audit: undeclared geometry plugin renders and reloads hosted children', async () => {
    const kind = 'plugin:geometry'
    const schema = nodeRegistry
      .get('shelf')!
      .schema.extend({ type: nodeType(kind), id: objectId(kind) })
    registerNode({
      kind,
      schemaVersion: 1,
      schema,
      category: 'furnish',
      defaults: () => ({}),
      capabilities: {},
      geometry: () => {
        const group = new Group()
        group.add(new Mesh(new BoxGeometry(2, 1, 2), new MeshBasicMaterial()))
        return group
      },
    } as never)
    const { host, child } = seed(kind, 'registry')
    const placement = resolveSurfacePlacement({
      host,
      childKind: child.type,
      childFootprint: { size: [0.1, 0.2, 0.1], rotationY: 0 },
      hit: { point: [0, 0.5, 0], normalWorldY: 1 },
      scene: createSceneApi(useScene),
    })
    expect(placement).not.toBeNull()
    useScene
      .getState()
      .updateNode(child.id, { parentId: host.id, position: placement!.position } as never)
    const renderer = await create(<Scene />)
    try {
      await settle(renderer)
      expect(visible(sceneRegistry.nodes.get(child.id))).toBe(true)
      expect(under(sceneRegistry.nodes.get(child.id), sceneRegistry.nodes.get(host.id))).toBe(true)
      expect(plan(child.id).plan).toBe(true)
      const saved = snapshot()
      expect(schema.parse(saved.nodes[host.id]).children).toContain(child.id)
      await act(async () => useScene.getState().setScene(saved.nodes, saved.rootNodeIds, saved))
      await settle(renderer)
      expect(visible(sceneRegistry.nodes.get(child.id))).toBe(true)
    } finally {
      await renderer.unmount()
    }
  })

  // No production definition, schema, renderer or capability is replaced.
  test('mounted built-in host audit: registry and catalog commits, rendering, JSON reload and plan layer', async () => {
    const rows: Row[] = []
    const excluded: string[] = []
    const errors: string[] = []
    for (const [kind, def] of nodeRegistry.entries()) {
      const initial = seed(kind, 'registry')
      const point = probe(initial.host)

      if (def.renderer?.kind === 'parametric') await def.renderer.module()
      for (const mover of ['registry', 'catalog'] as const) {
        for (const order of ['grid first', 'host first'] as const) {
          const { host, child } = seed(kind, mover)
          let renderer: Awaited<ReturnType<typeof create>> | undefined
          try {
            useEditor.getState().setMovingNode(child)
            renderer = await create(<Scene mover={mover} child={child} />)
            await settle(renderer)
            const object = sceneRegistry.nodes.get(host.id)
            if (!NON_PHYSICAL_HOST_KINDS.includes(kind))
              expect(object, `${kind}: production host mounted`).toBeDefined()
            expect(
              visible(sceneRegistry.nodes.get(child.id)),
              `${kind}: baseline child visible`,
            ).toBe(true)
            const world = (object ?? new Group()).localToWorld(new Vector3(...point)).toArray()
            const nativeEvent = {}
            let hitObject = object ?? new Group()
            let faceIndex: number | undefined
            if (kind === 'block')
              object!.traverse((entry) => {
                const ranges = (entry as Mesh).geometry?.userData.blockFaces as
                  | Array<{ faceId: string; start: number }>
                  | undefined
                const top = ranges?.find(
                  (range) =>
                    (getBlockFaceFrame((host as BlockNode).topology, range.faceId)?.normal[1] ??
                      0) > 0.99,
                )
                if (top) {
                  hitObject = entry
                  faceIndex = top.start / 3
                }
              })
            const event = {
              node: host,
              object: hitObject,
              faceIndex,
              normal: [0, 1, 0],
              position: world,
              localPosition: point,
              nativeEvent: { nativeEvent },
              stopPropagation() {},
            }
            const grid = {
              position: [20, 0, 20],
              localPosition: [20, 0, 20],
              nativeEvent,
              stopPropagation() {},
            }
            await act(async () =>
              emitter.emit('grid:move', {
                ...grid,
                position: [-5, 0, -5],
                localPosition: [-5, 0, -5],
              } as never),
            )
            await settle(renderer)
            let moveError = ''
            try {
              await act(async () => {
                if (order === 'grid first') emitter.emit('grid:move', grid as never)
                emitter.emit(`${kind}:move` as never, event as never)
                emitter.emit('node:move', event as never)
                if (order === 'host first') emitter.emit('grid:move', grid as never)
              })
              await settle(renderer)
              const preview = renderer.scene.children.at(-1)?.instance
              expect(preview, `${kind}/${mover}: preview mounted`).toBeDefined()
              let red = false
              preview?.traverse((entry) => {
                const material = (entry as Mesh).material as MeshBasicMaterial | undefined
                if (material?.color?.getHex() === 0xef4444) red = true
              })
              expect(red, `${kind}/${mover}: valid preview`).toBe(false)
              await act(async () => {
                emitter.emit(`${kind}:click` as never, event as never)
                emitter.emit('node:click', event as never)
                emitter.emit('grid:click', grid as never)
              })
              await settle(renderer)
              expect(useInteractionScope.getState().scope.kind, `${kind}/${mover}: committed`).toBe(
                'idle',
              )
            } catch (error) {
              moveError = String(error)
              await act(async () => emitter.emit('tool:cancel'))
              await settle(renderer)
            }
            const committed = useScene.getState().nodes[child.id]!
            expect(committed).toBeDefined()
            const accepted = committed.parentId === host.id
            if (!accepted && !moveError) {
              expect(committed.parentId, `${kind}/${mover}: floor parent`).toBe(level.id)
              expect((committed as typeof child).position[1], `${kind}/${mover}: floor datum`).toBe(
                0,
              )
            }
            const childObject = sceneRegistry.nodes.get(child.id)
            const mounted = under(childObject, sceneRegistry.nodes.get(committed.parentId!))
            const rendered = visible(childObject)
            const beforeMatrix = storedWorldMatrix(committed)
            expect(beforeMatrix, `${kind}/${mover}: committed world frame`).toBeDefined()
            const beforePose = JSON.stringify({
              parentId: committed.parentId,
              position: (committed as typeof child).position,
              rotation: (committed as typeof child).rotation,
            })
            const saved = snapshot()
            const planResult = plan(child.id)
            const parsedHost = def.schema.safeParse(saved.nodes[host.id])
            const retainsChildren =
              parsedHost.success &&
              ((parsedHost.data as { children?: string[] }).children?.includes(child.id) ?? false)
            await renderer.unmount()
            renderer = undefined
            sceneRegistry.nodes.clear()
            useScene.getState().setScene(saved.nodes, saved.rootNodeIds, saved)
            const reloaded = useScene.getState().nodes[child.id] as typeof child | undefined
            const survives = !!reloaded
            let samePose = false
            let reloadRendered = false
            if (reloaded) {
              expect(
                JSON.stringify({
                  parentId: reloaded.parentId,
                  position: reloaded.position,
                  rotation: reloaded.rotation,
                }),
              ).toBe(beforePose)
              renderer = await create(<Scene />)
              await settle(renderer)
              const afterMatrix = storedWorldMatrix(reloaded)
              reloadRendered = visible(sceneRegistry.nodes.get(child.id))
              samePose =
                !!beforeMatrix &&
                !!afterMatrix &&
                beforeMatrix.every((v, i) => Math.abs(v - afterMatrix[i]!) < 1e-6)
              await renderer.unmount()
              renderer = undefined
            }
            let parsedSurvives: boolean | null = null
            let parsedRendered: boolean | null = null
            let parsedSamePose: boolean | null = null
            let parseError = ''
            try {
              const parsedNodes = Object.fromEntries(
                Object.entries(saved.nodes).map(([id, node]) => [id, AnyNodeSchema.parse(node)]),
              )
              useScene.getState().setScene(parsedNodes as never, saved.rootNodeIds, saved)
              parsedSurvives = !!useScene.getState().nodes[child.id]
              renderer = await create(<Scene />)
              await settle(renderer)
              parsedRendered = visible(sceneRegistry.nodes.get(child.id))
              const parsedMatrix = storedWorldMatrix(useScene.getState().nodes[child.id]!)
              parsedSamePose =
                !!parsedMatrix &&
                beforeMatrix!.every((v, i) => Math.abs(v - parsedMatrix[i]!) < 1e-6)
              await renderer.unmount()
              renderer = undefined
            } catch (error) {
              parseError = String(error)
            }
            rows.push({
              kind,
              mover,
              order,
              accepted,
              parent:
                useScene.getState().nodes[committed.parentId!]?.type ?? String(committed.parentId),
              mounted,
              rendered,
              survives,
              samePose,
              reloadRendered,
              parsedRendered,
              parsedSamePose,
              parsedSurvives,
              retainsChildren,
              moveError,
              parseError,
              ...planResult,
            })
          } catch (error) {
            errors.push(
              `${kind}/${mover}/${order}: ${error instanceof Error ? error.stack : error}`,
            )
          } finally {
            if (renderer) await renderer.unmount()
          }
        }
      }
    }
    console.log('AUDIT_EXCLUDED', JSON.stringify(excluded))
    for (const row of rows) console.log('AUDIT_ROW', JSON.stringify(row))
    for (const error of errors) console.log('AUDIT_HARNESS_ERROR', error)
    expect(errors).toEqual([])
    expect(rows.length).toBe((builtinPlugin.nodes!.length - excluded.length) * 4)
    for (const row of rows) {
      const label = `${row.kind}/${row.mover}`
      expect(row.moveError, `${label}: no thrown entry`).toBe('')
      expect(row.parent, `${label}: host or floor`).toBe(row.accepted ? row.kind : 'level')
      expect(row.rendered, `${label}: visible after commit`).toBe(true)
      expect(row.survives, `${label}: survives autosave reload`).toBe(true)
      expect(row.samePose, `${label}: preserves world pose`).toBe(true)
      expect(row.reloadRendered, `${label}: visible after reload`).toBe(true)
      expect(row.plan, `${label}: plan renders child: ${row.planError}`).toBe(true)
      expect(row.parseError, `${label}: schema parse`).toBe('')
      expect(row.parsedSurvives, `${label}: survives parsed reload`).toBe(true)
      expect(row.parsedSamePose, `${label}: parsed reload preserves pose`).toBe(true)
      expect(row.parsedRendered, `${label}: visible after parsed reload`).toBe(true)
      if (row.accepted) expect(row.retainsChildren, `${label}: schema retains child`).toBe(true)
      const pair = rows.find(
        (other) =>
          other.kind === row.kind && other.mover === row.mover && other.order !== row.order,
      )!
      expect({ ...row, order: '', parseError: !!row.parseError }).toEqual({
        ...pair,
        order: '',
        parseError: !!pair.parseError,
      })
    }
    const tuple = (row: Row) =>
      [row.accepted, row.rendered, row.survives && row.samePose, row.plan]
        .map((v) => (v ? 'Y' : 'N'))
        .join('/')
    console.log('| Kind | Registry A/R/S/P | Catalog A/R/S/P |')
    console.log('| --- | --- | --- |')
    for (const row of rows.filter((r) => r.mover === 'registry' && r.order === 'grid first')) {
      const catalog = rows.find((r) => r.kind === row.kind && r.mover === 'catalog')!
      console.log(`| ${row.kind} | ${tuple(row)} | ${tuple(catalog)} |`)
    }
    console.log(
      `AUDIT_TOTAL ${rows.length} drops; ${rows.length / 4} production kinds; both event orders`,
    )
  }, 120_000)

  test('every production renderer agrees with its child-mounting capability', async () => {
    const observations: string[] = []
    for (const [kind, def] of nodeRegistry.entries()) {
      const { host, child } = seed(kind, 'registry')
      if (def.renderer?.kind === 'parametric') await def.renderer.module()
      const nodes = useScene.getState().nodes
      useScene.setState({
        nodes: {
          ...nodes,
          [level.id]: {
            ...nodes[level.id],
            children: (nodes[level.id] as LevelNode).children.filter((id) => id !== child.id),
          },
          [host.id]: {
            ...host,
            children: [...((host as { children?: string[] }).children ?? []), child.id],
          },
          [child.id]: { ...child, parentId: host.id, position: [0, 1, 0] },
        } as never,
      })
      const renderer = await create(<Scene />)
      try {
        await settle(renderer)
        const observed =
          visible(sceneRegistry.nodes.get(child.id)) &&
          under(sceneRegistry.nodes.get(child.id), sceneRegistry.nodes.get(host.id))
        observations.push(`${kind}: declared=${rendersHostedChildren(def)}, observed=${observed}`)
      } finally {
        await renderer.unmount()
      }
    }
    console.log('RENDERER_OBSERVATIONS', observations.join('\n'))
    expect(
      observations.filter(
        (row) =>
          row.includes('declared=true, observed=false') ||
          row.includes('declared=false, observed=true'),
      ),
    ).toEqual([])
  }, 30_000)

  function hasRedPreview(renderer: Awaited<ReturnType<typeof create>>) {
    let red = false
    renderer.scene.children.at(-1)?.instance.traverse((entry) => {
      const material = (entry as Mesh).material as MeshBasicMaterial | undefined
      if (material?.color?.getHex() === 0xef4444) red = true
    })
    return red
  }

  for (const childKind of [
    'cabinet',
    'column',
    'stair',
    'elevator',
    'fence',
    'shelf',
    'item',
    'procedural-item',
    'audit:plugin',
  ]) {
    const floorOnly = ['cabinet', 'column', 'stair', 'elevator', 'fence'].includes(childKind)
    for (const hostKind of floorOnly ? ['cabinet', 'item', 'shelf', 'procedural-item'] : ['item']) {
      test(`${childKind} over ${hostKind}: ${floorOnly ? 'floor-only' : 'hostable'} preview and commit`, async () => {
        if (childKind === 'audit:plugin') {
          const shelf = nodeRegistry.get('shelf')!
          registerNode({
            ...shelf,
            kind: childKind,
            schema: shelf.schema.extend({ id: objectId(childKind), type: nodeType(childKind) }),
            capabilities: {
              movable: shelf.capabilities.movable,
              floorPlaced: shelf.capabilities.floorPlaced,
            },
          })
        }
        const seeded = seed(hostKind, 'registry')
        const extra =
          childKind === 'procedural-item' || childKind === 'item'
            ? {
                host:
                  childKind === 'item'
                    ? ItemNode.parse({ asset, parentId: level.id, position: [-5, 0, -5] })
                    : seeded.child,
                nodes: {},
              }
            : makeHost(childKind)
        const child = extra.host
        if ('position' in child && Array.isArray(child.position)) child.position = [-5, 0, -5]
        if ('supportSlabId' in child) child.supportSlabId = 'ground'
        if (childKind === 'fence') Object.assign(child, { start: [-5, -5], end: [-3, -5] })
        if (childKind === 'stair') Object.assign(child, { stairType: 'spiral' })
        const nodes = { ...useScene.getState().nodes, ...extra.nodes, [child.id]: child }
        if (child.id !== seeded.child.id) delete nodes[seeded.child.id]
        for (const parent of [level, building]) {
          nodes[parent.id] = {
            ...nodes[parent.id],
            children: Object.values(nodes)
              .filter((n) => n.parentId === parent.id)
              .map((n) => n.id),
          } as AnyNode
        }
        useScene.setState({ nodes })
        const initialParent = child.parentId
        const point = probe(seeded.host)
        useEditor.getState().setMovingNode(child)
        const renderer = await create(<Scene mover="registry" child={child} />)
        try {
          await settle(renderer)
          const object = sceneRegistry.nodes.get(seeded.host.id)!
          const nativeEvent = {}
          const event = {
            node: seeded.host,
            object,
            position: object.localToWorld(new Vector3(...point)).toArray(),
            localPosition: point,
            normal: [0, 1, 0],
            nativeEvent: { nativeEvent },
            stopPropagation() {},
          }
          const grid = {
            position: [20, 0, 20],
            localPosition: [20, 0, 20],
            nativeEvent,
            stopPropagation() {},
          }
          await act(async () =>
            emitter.emit('grid:move', {
              ...grid,
              position: [-5, 0, -5],
              localPosition: [-5, 0, -5],
            } as never),
          )
          await settle(renderer)
          await act(async () => {
            emitter.emit(`${hostKind}:move` as never, event as never)
            emitter.emit('node:move', event as never)
            emitter.emit('grid:move', grid as never)
          })
          await settle(renderer)
          expect(useScene.getState().nodes[child.id]!.parentId, 'preview parent').toBe(
            floorOnly ? initialParent : seeded.host.id,
          )
          expect(hasRedPreview(renderer), 'valid preview').toBe(false)
          expect(renderer.scene.children.at(-1)?.instance.visible, 'visible preview').toBe(true)
          await act(async () => {
            emitter.emit(`${hostKind}:click` as never, event as never)
            emitter.emit('node:click', event as never)
            emitter.emit('grid:click', grid as never)
          })
          await settle(renderer)
          expect(useInteractionScope.getState().scope.kind, 'commit completes').toBe('idle')
          const committed = useScene.getState().nodes[child.id]!
          expect(committed.parentId, 'committed parent').toBe(
            floorOnly ? initialParent : seeded.host.id,
          )
          expect(visible(sceneRegistry.nodes.get(child.id)), 'committed 3D child visible').toBe(
            true,
          )
          if (floorOnly && 'position' in committed && Array.isArray(committed.position))
            expect(committed.position[1]).toBe(0)
        } finally {
          await renderer.unmount()
        }
      })
    }
  }

  test('cabinet tool corner operation keeps nested runs and modules through mounted save/load', async () => {
    const { host } = seed('cabinet', 'registry')
    const scene = createSceneApi(useScene)
    const run = host as CabinetNode
    const module = scene.get(run.children[0]!) as CabinetModuleNode
    scene.update(module.id, { width: 0.9, position: [0, 0.1, 0.325], depth: 0.65 } as never)
    const selected = addCornerRun({
      module: scene.get(module.id) as CabinetModuleNode,
      run,
      sceneApi: scene,
      side: 'right',
    })
    expect(selected).toBeTruthy()
    const nested = Object.values(scene.nodes()).find(
      (n) => n.type === 'cabinet' && n.name === 'Corner Base Run',
    ) as CabinetNode
    expect(nested).toBeDefined()
    expect(nested.parentId).toBe(run.id)
    expect((scene.get(run.id) as CabinetNode).children).toContain(nested.id)
    const moduleIds = nested.children.filter((id) => scene.get(id)?.type === 'cabinet-module')
    expect(moduleIds.length).toBeGreaterThan(1)
    for (const id of moduleIds) expect(scene.get(id)!.parentId).toBe(nested.id)
    let renderer = await create(<Scene />)
    try {
      await settle(renderer)
      const ids = [nested.id, ...moduleIds]
      const poses = ids.map((id) => matrix(sceneRegistry.nodes.get(id)))
      for (const id of ids)
        expect(visible(sceneRegistry.nodes.get(id)), `${id}: visible`).toBe(true)
      const saved = snapshot()
      await renderer.unmount()
      const parsed = Object.fromEntries(
        Object.entries(saved.nodes).map(([id, node]) => [id, AnyNodeSchema.parse(node)]),
      )
      useScene.getState().setScene(parsed as never, saved.rootNodeIds, saved)
      renderer = await create(<Scene />)
      await settle(renderer)
      expect(scene.get(nested.id)!.parentId).toBe(run.id)
      for (const [index, id] of ids.entries()) {
        expect(visible(sceneRegistry.nodes.get(id))).toBe(true)
        const actual = matrix(sceneRegistry.nodes.get(id))!
        expect(actual.every((v, i) => Math.abs(v - poses[index]![i]!) < 1e-6)).toBe(true)
      }
    } finally {
      await renderer.unmount()
    }
  })

  for (const mover of ['registry', 'catalog'] as const)
    for (const key of ['r', 't'] as const)
      for (const occupied of [true, false])
        test(`review bot 2: ${mover} ${key} rotation occupied=${occupied}`, async () => {
          const seeded = seed('procedural-item', mover)
          const host = ProceduralItemNode.parse({
            ...seeded.host,
            position: [2, 0, 3],
            rotation: [0, 0.6, 0],
            recipe: {
              ...(seeded.host as ProceduralItemNode).recipe,
              surfaces: [{ id: 'top', label: 'Top', position: [0.3, 1, 0.2], size: [4, 4] }],
            },
          })
          const child =
            mover === 'catalog'
              ? ItemNode.parse({
                  ...seeded.child,
                  rotation: [0, 0.6, 0],
                  asset: { ...asset, dimensions: [0.8, 0.2, 0.2] },
                })
              : ProceduralItemNode.parse({
                  ...seeded.child,
                  rotation: [0, 0.6, 0],
                  recipe: {
                    ...recipe,
                    parts: [
                      {
                        ...recipe.parts[0]!,
                        shapes: [{ ...recipe.parts[0]!.shapes[0]!, size: [0.8, 0.2, 0.2] }],
                      },
                    ],
                  },
                })
          const occupant = ItemNode.parse({
            asset: { ...asset, dimensions: [0.2, 0.2, 0.2] },
            parentId: host.id,
            position: [0, 0, occupied ? 0.35 : 1],
          })
          useScene.setState({
            nodes: {
              ...useScene.getState().nodes,
              [host.id]: {
                ...host,
                children: [occupant.id],
                attachments: { [occupant.id]: 'top' },
              },
              [child.id]: child,
              [occupant.id]: occupant,
            },
          })
          const globals = ['HTMLInputElement', 'HTMLTextAreaElement'] as const
          const descriptors = globals.map((name) =>
            Object.getOwnPropertyDescriptor(globalThis, name),
          )
          globals.forEach((name) => {
            Object.defineProperty(globalThis, name, { configurable: true, value: class {} })
          })
          const keys: EventListener[] = []
          const addListener = window.addEventListener.bind(window)
          const listen = spyOn(window, 'addEventListener').mockImplementation(
            (type, listener, options) => {
              if (type === 'keydown') keys.push(listener as EventListener)
              addListener(type, listener, options)
            },
          )
          useEditor.getState().setMovingNode(child)
          const renderer = await create(<Scene mover={mover} child={child} />)
          try {
            await settle(renderer)
            const object = sceneRegistry.nodes.get(host.id)!
            const point: [number, number, number] = [0.3, 1, 0.2]
            const event = {
              node: host,
              object,
              position: object.localToWorld(new Vector3(...point)).toArray(),
              localPosition: point,
              normal: [0, 1, 0],
              nativeEvent: { nativeEvent: {} },
              stopPropagation() {},
            }
            for (let tick = 0; tick < 2; tick++) {
              await act(async () => {
                emitter.emit('procedural-item:move', event as never)
                emitter.emit('node:move', event as never)
              })
              await settle(renderer)
            }
            const before = matrix(sceneRegistry.nodes.get(child.id))!
            const saved = structuredClone(useScene.getState().nodes[child.id]) as
              | ItemNode
              | ProceduralItemNode
            expect(saved.parentId).toBe(host.id)
            expect(saved.rotation[1]).toBeCloseTo(0)
            await act(async () => {
              expect(() => {
                for (const handler of keys)
                  handler(
                    Object.assign(new Event('keydown', { cancelable: true }), {
                      key,
                      metaKey: false,
                      ctrlKey: false,
                      altKey: false,
                    }),
                  )
              }).not.toThrow()
            })
            await settle(renderer)
            const after = matrix(sceneRegistry.nodes.get(child.id))!
            const stored = useScene.getState().nodes[child.id] as ItemNode | ProceduralItemNode
            if (occupied) {
              expect(stored.position).toEqual(saved.position)
              expect(stored.rotation).toEqual(saved.rotation)
              before.forEach((value, index) => {
                expect(after[index]).toBeCloseTo(value, 6)
              })
              expect(hasRedPreview(renderer)).toBe(true)
            } else {
              const expected = ((key === 'r' ? 1 : -1) * Math.PI) / 4
              expect(stored.rotation[1]).toBeCloseTo(expected)
              expect(Math.atan2(after[8]!, after[10]!)).toBeCloseTo(0.6 + expected)
              expect(hasRedPreview(renderer)).toBe(false)
            }
          } finally {
            await renderer.unmount()
            listen.mockRestore()
            globals.forEach((name, i) => {
              if (descriptors[i]) Object.defineProperty(globalThis, name, descriptors[i]!)
              else Reflect.deleteProperty(globalThis, name)
            })
          }
        })

  for (const mover of ['catalog', 'registry'] as const)
    for (const tilt of ['pitch', 'roll'] as const)
      test(`review bot 4: differential ${mover} ${tilt} floor exit`, async () => {
        const seeded = seed('procedural-item', mover)
        const child = {
          ...seeded.child,
          parentId: seeded.host.id,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          supportSlabId: undefined,
        } as ItemNode | ProceduralItemNode
        const host = ProceduralItemNode.parse({
          ...seeded.host,
          position: [2, 0, 3],
          rotation: [0, 0.6, 0],
          children: [child.id],
          attachments: { [child.id]: 'top' },
          recipe: {
            ...(seeded.host as ProceduralItemNode).recipe,
            surfaces: [
              {
                id: 'top',
                label: 'Top',
                position: [0.3, 1, 0.2],
                size: [2, 2],
                rotation: tilt === 'pitch' ? [0.2, 0, 0] : [0, 0, 0.2],
              },
            ],
          },
        })
        const baseline = {
          ...useScene.getState().nodes,
          [level.id]: { ...level, children: [host.id] },
          [host.id]: host,
          [child.id]: child,
        }
        const results: { rotation: number[]; initialHeading: number; heading: number }[] = []
        for (const view of ['3d', '2d'] as const) {
          useLiveNodeOverrides.getState().clearAll()
          useLiveTransforms.getState().clearAll()
          useScene.setState({ nodes: structuredClone(baseline), dirtyNodes: new Set() })
          useInteractionScope.getState().end()
          useEditor.setState({ movingNode: null, movingNodeOrigin: view, viewMode: view })
          const source = useScene.getState().nodes[child.id] as typeof child
          const renderer = await create(
            <Scene mover={view === '3d' ? mover : undefined} child={source} />,
          )
          try {
            await settle(renderer)
            const before = matrix(sceneRegistry.nodes.get(child.id))!
            const heading = Math.atan2(before[8]!, before[10]!)
            expect(heading).toBeCloseTo(0.6, 6)
            if (view === '3d') {
              await act(async () => useEditor.getState().setMovingNode(source))
              await settle(renderer)
              const event = {
                position: [8, 0, 8],
                localPosition: [8, 0, 8],
                normal: [0, 1, 0],
                nativeEvent: {},
                stopPropagation() {},
              }
              await act(async () => {
                if (mover === 'catalog') {
                  const object = sceneRegistry.nodes.get(host.id)!
                  emitter.emit(
                    'procedural-item:leave' as never,
                    {
                      ...event,
                      node: host,
                      object,
                      localPosition: object.worldToLocal(new Vector3(8, 0, 8)).toArray(),
                    } as never,
                  )
                }
                emitter.emit('grid:move', event as never)
                await new Promise((resolve) => setTimeout(resolve, 1))
              })
              await settle(renderer)
              await act(async () => emitter.emit('grid:click', event as never))
              await settle(renderer)
              expect(useInteractionScope.getState().scope.kind).toBe('idle')
            } else {
              const session = nodeRegistry.get(source.type)!.floorplanMoveTarget!({
                node: source,
                nodes: useScene.getState().nodes,
                sceneApi: createSceneApi(useScene),
              } as never)
              const modifiers = { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false }
              await act(async () => {
                session.apply({ planPoint: [before[12]!, before[14]!], modifiers })
                session.apply({ planPoint: [8, 8], modifiers })
              })
              await settle(renderer)
              expect(session.canCommit()).toBe(true)
              await act(async () => session.commit!())
              await settle(renderer)
            }
            const stored = useScene.getState().nodes[child.id] as typeof child
            expect(stored.parentId).toBe(level.id)
            expect(stored.position[1]).toBe(0)
            expect(
              (useScene.getState().nodes[host.id] as ProceduralItemNode).attachments[child.id],
            ).toBeUndefined()
            const after = matrix(sceneRegistry.nodes.get(child.id))!
            results.push({
              rotation: [...stored.rotation],
              initialHeading: heading,
              heading: Math.atan2(after[8]!, after[10]!),
            })
          } finally {
            await renderer.unmount()
          }
        }
        console.log(`review bot 4 ${mover} ${tilt}: ${JSON.stringify(results)}`)
        results[1]!.rotation.forEach((v, i) => {
          expect(v).toBeCloseTo(results[0]!.rotation[i]!, 6)
        })
        expect(results[1]!.heading).toBeCloseTo(results[0]!.heading, 6)
      })
}
