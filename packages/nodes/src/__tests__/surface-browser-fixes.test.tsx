import { beforeEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BlockNode,
  BuildingNode,
  CabinetModuleNode,
  CabinetNode,
  ColumnNode,
  createBoxBlockTopology,
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
  useScene,
} from '@pascal-app/core'
import { ProceduralItemNode } from '@pascal-app/core/procedural-items'
import { MoveRegistryNodeTool, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { events, type RootStore, useThree } from '@react-three/fiber'
import { act, create } from '@react-three/test-renderer'
import { Children, isValidElement, type ReactNode } from 'react'
import {
  BoxGeometry,
  Euler,
  Group,
  Matrix3,
  type Matrix4,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  Plane,
  Raycaster,
  Vector2,
  Vector3,
} from 'three'
import { FloatingActionMenu } from '../../../editor/src/components/editor/floating-action-menu'
import { NodeActionMenu } from '../../../editor/src/components/editor/node-action-menu'
import { useGridEvents } from '../../../editor/src/hooks/use-grid-events'
import {
  createFreshPlacementSubtree,
  duplicatesAsFreshSubtree,
} from '../../../editor/src/lib/fresh-planar-placement'
import useInteractionScope, {
  getMovingNode,
  useMovingNode,
} from '../../../editor/src/store/use-interaction-scope'
import ItemTool from '../item/tool'
import {
  boxAsset as asset,
  CatalogMover,
  installMountedScene,
  LevelScene,
  boxRecipe as recipe,
  SceneSystems,
  settle,
} from './harness'

const site = SiteNode.parse({})
const building = BuildingNode.parse({ parentId: site.id })
const level = LevelNode.parse({ parentId: building.id })
type Mover = 'registry' | 'catalog'
let htmlChildren: ReactNode[] = []
installMountedScene({
  html: (props) => {
    htmlChildren.push(props.children)
    return null
  },
})
beforeEach(() => {
  htmlChildren = []
})

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
}: {
  mover?: Mover
  child?: AnyNode
  fresh?: boolean
  menu?: boolean
}) {
  const activeNode = useMovingNode()
  const source = child ?? activeNode
  const moving = useInteractionScope((s) => s.scope.kind === 'moving' || s.scope.kind === 'placing')
  const armed = useEditor((s) => s.mode === 'build' && s.tool === 'item')
  return (
    <>
      <LevelScene level={level} />
      <Grid />
      {menu && <FloatingActionMenu />}
      {fresh && armed && <ItemTool />}
      {moving &&
        source &&
        (source.type === 'item' ? (
          <CatalogMover source={source as ItemNode} />
        ) : (
          <MoveRegistryNodeTool node={source} />
        ))}
      <SceneSystems />
    </>
  )
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
  return {
    ray,
    async send(point: Vector3, order: string, click = false) {
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
      await act(async () => {
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
      })
    },
  }
}
function kitchen(production = false) {
  const run = CabinetNode.parse({
    id: 'cabinet_browser',
    parentId: level.id,
    position: [0, 0, 0],
    withCountertop: true,
    barLedge: { edge: 'back', height: 1.2, depth: 0.4 },
  })
  const moduleDefaults = production ? nodeRegistry.get('cabinet-module')!.defaults() : {}
  const sink = CabinetModuleNode.parse({
    ...moduleDefaults,
    id: 'cabinet-module_sink',
    parentId: run.id,
    position: [0, 0.1, 0],
    width: 1,
    depth: 0.65,
    stack: [{ id: 'sink', type: 'sink', sinkLayout: 'single' }],
  })
  const plain = CabinetModuleNode.parse({
    ...moduleDefaults,
    id: 'cabinet-module_plain',
    parentId: run.id,
    position: [1, 0.1, 0],
    width: 1,
    depth: 0.65,
  })
  return { run, sink, plain }
}
function childFor(mover: Mover, fresh = false) {
  const data = {
    parentId: level.id,
    position: [-4, 0, -4],
    visible: !fresh,
    metadata: fresh ? { isNew: true } : {},
  }
  return mover === 'catalog'
    ? ItemNode.parse({ ...data, asset })
    : ProceduralItemNode.parse({ ...data, recipe })
}
function arm(mover: Mover, child: AnyNode, fresh: boolean) {
  if (mover === 'catalog' && fresh) useEditor.setState({ selectedItem: asset })
  else useEditor.getState().setMovingNode(child)
}
function liveChild(mover: Mover) {
  return Object.values(useScene.getState().nodes).find(
    (n) => n.type === (mover === 'catalog' ? 'item' : 'procedural-item'),
  )! as ItemNode
}
function topSurface(run: CabinetNode) {
  return getSurfaceProvider(run).surfaces!(useScene.getState().nodes[run.id]!, {
    scene: createSceneApi(useScene),
  }).find((s) => s.id.startsWith('countertop'))!
}
for (const mover of ['catalog', 'registry'] as const)
  for (const order of ['grid first', 'host first'])
    for (const fresh of [true, false])
      for (const production of [false, true])
        test(`${mover} ${fresh ? 'fresh' : 'move'}: ${production ? 'production module defaults' : 'browser seeded module defaults'} sink mesh bubbles to run, cutout refuses and keeps counter plane (${order})`, async () => {
          const { run, sink, plain } = kitchen(production),
            child = childFor(mover, fresh)
          seed([run, sink, plain, ...(mover === 'catalog' && fresh ? [] : [child])])
          arm(mover, child, fresh)
          const renderer = await create(
            <Scene mover={mover} child={child} fresh={fresh && mover === 'catalog'} />,
          )
          const seen: string[] = []
          const observe = (e: { node: AnyNode }) => seen.push(e.node.id)
          emitter.on('node:move', observe)
          try {
            await settle(renderer)
            const pointer = pointerDispatcher(),
              height = topSurface(run).position[1]
            await pointer.send(new Vector3(-4, 0, -4), order)
            await settle(renderer)
            await pointer.send(new Vector3(1, height, 0.1), order)
            await settle(renderer)
            expect(liveChild(mover).parentId).toBe(run.id)
            expect(world(liveChild(mover).id).y).toBeCloseTo(height, 6)
            const before = world(liveChild(mover).id).toArray()
            const basin = new Vector3(0.1, 0.826, 0.03)
            const hit = pointer
              .ray(basin)
              .cast.intersectObject(sceneRegistry.nodes.get(sink.id)!, true)[0]!
            expect(hit).toBeDefined()
            expect(hit.point.y).toBeLessThan(height - 0.05)
            expect(
              hit
                .face!.normal.clone()
                .applyNormalMatrix(new Matrix3().getNormalMatrix(hit.object.matrixWorld)).y,
            ).toBeGreaterThan(0.75)
            seen.length = 0
            await pointer.send(basin, order)
            await settle(renderer)
            expect(seen).toContain(sink.id)
            expect(seen).toContain(run.id)
            expect(liveChild(mover).parentId).toBe(run.id)
            expect(world(liveChild(mover).id).toArray()).toEqual(before)
            await pointer.send(basin, order, true)
            await settle(renderer)
            expect(
              mover === 'catalog' && fresh
                ? useEditor.getState().mode
                : useInteractionScope.getState().scope.kind,
            ).toBe(mover === 'catalog' && fresh ? 'build' : fresh ? 'placing' : 'moving')
          } finally {
            emitter.off('node:move', observe)
            await renderer.unmount()
          }
        })
for (const mover of ['catalog', 'registry'] as const)
  for (const order of ['grid first', 'host first'])
    for (const fresh of [true, false])
      test(`${mover} ${fresh ? 'fresh' : 'move'}: proven column vertical-side intersection silently commits paired floor (${order})`, async () => {
        const host = ColumnNode.parse({
          parentId: level.id,
          height: 0.8,
          radius: 0.3,
          capitalStyle: 'none',
          baseStyle: 'none',
          shaftTaper: 0,
          shaftProfile: 'straight',
        })
        const child = childFor(mover, fresh)
        seed([host, ...(mover === 'catalog' && fresh ? [] : [child])])
        arm(mover, child, fresh)
        const renderer = await create(
          <Scene mover={mover} child={child} fresh={fresh && mover === 'catalog'} />,
        )
        try {
          await settle(renderer)
          const pointer = pointerDispatcher(true)
          await pointer.send(new Vector3(-4, 0, -4), order)
          await settle(renderer)
          await pointer.send(new Vector3(-4, 0, -4), order)
          await settle(renderer)
          const point = new Vector3(0, 0.4, 0.216)
          const { cast } = pointer.ray(point)
          const hits = cast.intersectObject(sceneRegistry.nodes.get(host.id)!, true)
          expect(hits.length).toBeGreaterThan(0)
          const hit = hits[0]!
          expect(hit.object.type).toBe('Mesh')
          const normal = hit
            .face!.normal.clone()
            .applyNormalMatrix(new Matrix3().getNormalMatrix(hit.object.matrixWorld))
          expect(Math.abs(normal.y)).toBeLessThan(0.01)
          const floor = cast.ray.at(-cast.ray.origin.y / cast.ray.direction.y, new Vector3())
          await pointer.send(point, order)
          await settle(renderer)
          expect(liveChild(mover).parentId).toBe(level.id)
          expect(world(liveChild(mover).id).x).toBeCloseTo(floor.x, 6)
          expect(world(liveChild(mover).id).z).toBeCloseTo(floor.z, 6)
          await pointer.send(point, order, true)
          await settle(renderer)
          expect(useInteractionScope.getState().scope.kind).toBe('idle')
          expect(liveChild(mover).parentId).toBe(level.id)
          expect(liveChild(mover).position[1]).toBe(0)
        } finally {
          await renderer.unmount()
        }
      })
for (const order of ['grid first', 'host first'])
  test(`standalone module retains registry top hosting through real R3F (${order})`, async () => {
    const host = CabinetModuleNode.parse({ parentId: level.id })
    const child = childFor('registry')
    seed([host, child])
    arm('registry', child, false)
    const renderer = await create(<Scene mover="registry" child={child} />)
    try {
      await settle(renderer)
      const pointer = pointerDispatcher()
      await pointer.send(new Vector3(-4, 0, -4), order)
      await settle(renderer)
      const point = new Vector3(0, 1.02, 0.1)
      await pointer.send(point, order)
      await settle(renderer)
      expect(liveChild('registry').parentId).toBe(host.id)
      const before = world(child.id).toArray()
      await pointer.send(point, order, true)
      await settle(renderer)
      expect(useInteractionScope.getState().scope.kind).toBe('idle')
      expect(liveChild('registry').parentId).toBe(host.id)
      expect(world(child.id).toArray()).toEqual(before)
    } finally {
      await renderer.unmount()
    }
  })
function lBlock() {
  const poly = [
    [-1, -1],
    [1, -1],
    [1, 0],
    [0, 0],
    [0, 1],
    [-1, 1],
  ]
  return BlockNode.parse({
    parentId: level.id,
    topology: {
      vertices: poly.flatMap(([x, z], i) => [
        { id: `b${i}`, position: [x, 0, z] },
        { id: `t${i}`, position: [x, 1.5, z] },
      ]),
      edges: poly.flatMap((_, i) => [
        { id: `be${i}`, vertexIds: [`b${i}`, `b${(i + 1) % 6}`] },
        { id: `te${i}`, vertexIds: [`t${i}`, `t${(i + 1) % 6}`] },
        { id: `ve${i}`, vertexIds: [`b${i}`, `t${i}`] },
      ]),
      faces: [
        { id: 'top', vertexIds: poly.map((_, i) => `t${i}`).reverse() },
        { id: 'bottom', vertexIds: poly.map((_, i) => `b${i}`) },
        ...poly.map((_, i) => ({
          id: `side${i}`,
          vertexIds: [`b${i}`, `t${i}`, `t${(i + 1) % 6}`, `b${(i + 1) % 6}`],
        })),
      ],
    },
  })
}
for (const mover of ['catalog', 'registry'] as const)
  for (const order of ['grid first', 'host first'])
    for (const fresh of [false, true])
      test(`${mover} ${fresh ? 'fresh' : 'move'}: L notch uses the conservative floor collision: red preview blocks click, clear floor commits (${order})`, async () => {
        const host = lBlock(),
          child = childFor(mover, fresh)
        seed([host, ...(mover === 'catalog' && fresh ? [] : [child])])
        arm(mover, child, fresh)
        const renderer = await create(
          <Scene mover={mover} child={child} fresh={fresh && mover === 'catalog'} />,
        )
        try {
          await settle(renderer)
          const pointer = pointerDispatcher()
          await pointer.send(new Vector3(-4, 0, -4), order)
          await settle(renderer)
          await pointer.send(new Vector3(-4, 0, -4), order)
          await settle(renderer)
          await pointer.send(new Vector3(-0.5, 1.5, -0.5), order)
          await settle(renderer)
          expect(liveChild(mover).parentId).toBe(host.id)
          expect(
            spatialGridManager.canPlaceOnFloor(
              level.id,
              [-0.5, 0, -0.5],
              [0.1, 0.2, 0.1],
              [0, 0, 0],
              [child.id],
            ).valid,
          ).toBe(false)
          expect(
            spatialGridManager.canPlaceOnFloor(
              level.id,
              [0.02, 0, 0.5],
              [0.1, 0.2, 0.1],
              [0, 0, 0],
              [child.id],
            ).valid,
          ).toBe(false)
          expect(
            spatialGridManager.canPlaceOnFloor(
              level.id,
              [0.5, 0, 0.5],
              [0.1, 0.2, 0.1],
              [0, 0, 0],
              [child.id],
            ).valid,
          ).toBe(false)
          const notch = new Vector3(0.5, 0, 0.5)
          expect(
            pointer.ray(notch).cast.intersectObject(sceneRegistry.nodes.get(host.id)!, true),
          ).toHaveLength(0)
          await pointer.send(notch, order)
          await settle(renderer)
          expect(liveChild(mover).parentId).toBe(level.id)
          world(liveChild(mover).id)
            .toArray()
            .forEach((v, i) => {
              expect(v).toBeCloseTo([0.5, 0, 0.5][i]!, 6)
            })
          expect(previewColors(renderer)).toContain('ef4444')
          expect(previewColors(renderer)).not.toContain('22c55e')
          await pointer.send(notch, order, true)
          await settle(renderer)
          expect(
            mover === 'catalog' && fresh
              ? useEditor.getState().mode
              : useInteractionScope.getState().scope.kind,
          ).toBe(mover === 'catalog' && fresh ? 'build' : fresh ? 'placing' : 'moving')
          const clearFloor = new Vector3(2, 0, 2)
          await pointer.send(clearFloor, order)
          await settle(renderer)
          expect(previewColors(renderer)).toContain('22c55e')
          await pointer.send(clearFloor, order, true)
          await settle(renderer)
          expect(useInteractionScope.getState().scope.kind).toBe('idle')
          expect(liveChild(mover).parentId).toBe(level.id)
          liveChild(mover).position.forEach((v, i) => {
            expect(v).toBeCloseTo([2, 0, 2][i]!, 6)
          })
        } finally {
          await renderer.unmount()
        }
      })
for (const shape of ['rotated item', 'warped face'])
  test(`conservative collision catches ${shape} against mounted block geometry`, async () => {
    const topology = createBoxBlockTopology(0.4, 1, 0.4)
    if (shape === 'warped face') {
      const corners = [
        [0, 0, 0],
        [2, 0, 2],
        [0, 3, 2],
        [2, 3, 0],
      ]
      topology.vertices.forEach((v, i) => {
        const p = corners[i % 4]!
        v.position = [p[0]!, p[1]! + (i >= 4 ? 0.1 : 0), p[2]!]
      })
    }
    const host = BlockNode.parse({
      parentId: level.id,
      topology,
      position: shape === 'rotated item' ? [1.2, 0, -1.2] : [0, 0, 0],
    })
    seed([host])
    const renderer = await create(<Scene />)
    try {
      await settle(renderer)
      const position: [number, number, number] = shape === 'rotated item' ? [0, 0, 0] : [1.7, 0, 1]
      const dimensions: [number, number, number] =
        shape === 'rotated item' ? [4, 1, 0.2] : [0.1, 5, 0.1]
      const rotation: [number, number, number] = [0, shape === 'rotated item' ? Math.PI / 4 : 0, 0]
      const point = shape === 'rotated item' ? new Vector3(1.2, 0, -1.2) : new Vector3(...position)
      expect(
        pointerDispatcher().ray(point).cast.intersectObject(sceneRegistry.nodes.get(host.id)!, true)
          .length,
      ).toBeGreaterThan(0)
      expect(
        spatialGridManager.canPlaceOnFloor(level.id, position, dimensions, rotation).valid,
      ).toBe(false)
    } finally {
      await renderer.unmount()
    }
  })
function previewColors(renderer: Awaited<ReturnType<typeof create>>) {
  const colors: string[] = []
  renderer.scene.instance.traverse((object) => {
    const material = (object as Mesh).material as MeshBasicMaterial | undefined
    if (object.renderOrder === 999 && material?.color) colors.push(material.color.getHexString())
  })
  return colors
}
for (const order of ['grid first', 'host first'])
  test(`catalog reaches a declared plugin provider with real bubbling (${order})`, async () => {
    const host = genericHost(true)
    const child = childFor('catalog', true)
    seed([host])
    arm('catalog', child, true)
    const renderer = await create(<Scene fresh child={child} />)
    try {
      await settle(renderer)
      const pointer = pointerDispatcher()
      const point = new Vector3(0.2, 1, 0.1)
      expect(
        pointer.ray(point).cast.intersectObject(sceneRegistry.nodes.get(host.id)!, true)[0]!.point
          .y,
      ).toBeCloseTo(1)
      await pointer.send(point, order)
      await settle(renderer)
      expect(liveChild('catalog').parentId).toBe(host.id)
      expect(world(liveChild('catalog').id).y).toBeCloseTo(1)
      await pointer.send(point, order, true)
      await settle(renderer)
      expect(useInteractionScope.getState().scope.kind).toBe('idle')
      expect(liveChild('catalog').parentId).toBe(host.id)
    } finally {
      await renderer.unmount()
    }
  })
function menuAction(): ((event: { stopPropagation(): void }) => void) | undefined {
  const search = (value: ReactNode): any => {
    for (const element of Children.toArray(value)) {
      if (!isValidElement(element)) continue
      if (element.type === NodeActionMenu) return (element.props as any).onDuplicate
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
for (const kind of ['column', 'block', 'plugin', 'shelf', 'item', 'procedural-item', 'cabinet'])
  test(`Duplicate ${kind}: legacy policy or occupied host subtree, remapped attachments, drop/delete/undo`, async () => {
    const host =
      kind === 'plugin'
        ? genericHost()
        : kind === 'column'
          ? ColumnNode.parse({ parentId: level.id, height: 0.8 })
          : kind === 'block'
            ? BlockNode.parse({ parentId: level.id, topology: createBoxBlockTopology() })
            : kind === 'shelf'
              ? ShelfNode.parse({ parentId: level.id })
              : kind === 'item'
                ? ItemNode.parse({ parentId: level.id, asset })
                : kind === 'cabinet'
                  ? CabinetNode.parse({ parentId: level.id })
                  : ProceduralItemNode.parse({
                      parentId: level.id,
                      recipe: {
                        ...recipe,
                        surfaces: [
                          {
                            id: 'top',
                            label: 'Top',
                            position: [0, 0.2, 0],
                            rotation: [0, 0, 0],
                            size: [1, 1],
                          },
                        ],
                      },
                    })
    const child = ProceduralItemNode.parse({
      parentId: host.id,
      position: [0, 0, 0],
      recipe: {
        ...recipe,
        surfaces: [
          { id: 'top', label: 'Top', position: [0, 0.2, 0], rotation: [0, 0, 0], size: [1, 1] },
        ],
      },
    })
    const grandchild = ItemNode.parse({ parentId: child.id, asset, position: [0, 0, 0] })
    child.attachments[grandchild.id] = 'top'
    if (host.type === 'procedural-item') host.attachments[child.id] = 'top'
    seed([host, child, grandchild])
    useEditor.setState({ mode: 'select', tool: null })
    useViewer.getState().setSelection({ selectedIds: [host.id] })
    const renderer = await create(<Scene menu />)
    try {
      await settle(renderer)
      const carries = ['column', 'block', 'cabinet', 'item', 'shelf', 'procedural-item'].includes(
        kind,
      )
      if (kind === 'block') {
        expect(menuAction()).toBeUndefined()
        expect(duplicatesAsFreshSubtree(useScene.getState().nodes[host.id]!)).toBe(true)
        await act(async () => {
          const id = createFreshPlacementSubtree(host.id)!
          useEditor.getState().setMovingNode(useScene.getState().nodes[id]!)
        })
      } else {
        const duplicate = menuAction()
        expect(duplicate).toBeDefined()
        await act(async () => duplicate!({ stopPropagation() {} }))
      }
      await settle(renderer)
      if (!carries) {
        expect(getMovingNode()!.children).toHaveLength(0)
        expect(useScene.getState().nodes[host.id]!.children).toEqual([child.id])
        return
      }
      const clone = Object.values(useScene.getState().nodes).find(
        (n) => n.type === host.type && n.id !== host.id && n.parentId === level.id,
      )!
      expect(clone).toBeDefined()
      expect(clone.children).toHaveLength(1)
      const clonedChild = useScene.getState().nodes[clone.children[0]!]! as typeof child
      expect(clonedChild.id).not.toBe(child.id)
      expect(clonedChild.parentId).toBe(clone.id)
      expect(clonedChild.position).toEqual(child.position)
      const clonedGrandchild = useScene.getState().nodes[clonedChild.children[0]!]!
      expect(clonedGrandchild.id).not.toBe(grandchild.id)
      expect(clonedGrandchild.parentId).toBe(clonedChild.id)
      expect(clonedChild.attachments).toEqual({ [clonedGrandchild.id]: 'top' })
      const pointer = pointerDispatcher()
      await pointer.send(new Vector3(4, 0, 4), 'grid first')
      await settle(renderer)
      await pointer.send(new Vector3(4, 0, 4), 'grid first', true)
      await settle(renderer)
      expect(useInteractionScope.getState().scope.kind).toBe('idle')
      const placed = Object.values(useScene.getState().nodes).find(
        (n) => n.type === host.type && n.id !== host.id && n.parentId === level.id,
      )!
      expect(placed.children).toHaveLength(1)
      const placedChild = useScene.getState().nodes[placed.children[0]!]! as typeof child
      expect(placedChild.attachments).toEqual({ [placedChild.children[0]!]: 'top' })
      const ids = [placed.id, placedChild.id, ...placedChild.children]
      await act(async () => useScene.getState().deleteNode(placed.id))
      await settle(renderer)
      for (const id of ids) expect(useScene.getState().nodes[id]).toBeUndefined()
      await act(async () => useScene.temporal.getState().undo())
      await settle(renderer)
      for (const id of ids) expect(useScene.getState().nodes[id]).toBeDefined()
      expect(useScene.getState().nodes[host.id]!.children).toEqual([child.id])
    } finally {
      await renderer.unmount()
    }
  })
/** Drops `child` at `point` with the given event order; returns the commit and the preview at release. */
async function dropOnCounter(
  mover: Mover,
  order: string,
  layout: 'run' | 'nested corner' | 'standalone module',
  point: (nodes: ReturnType<typeof kitchen>) => Vector3,
) {
  const counters = kitchen(true)
  const { run, sink, plain } = counters
  const child = childFor(mover)
  if (layout === 'run') seed([run, sink, plain, child])
  else {
    const outer = CabinetNode.parse({
      id: 'cabinet_outer',
      parentId: level.id,
      position: [-2, 0, -1],
      rotation: 0.3,
    })
    run.parentId = outer.id
    run.position = [3, 0, 2]
    run.rotation = Math.PI / 2
    if (layout === 'standalone module') {
      plain.parentId = level.id
      plain.position = [0, 0, 0]
      plain.withCountertop = true
      plain.countertopThickness = 0.02
      plain.showPlinth = true
      plain.plinthHeight = 0.1
    }
    seed([...(layout === 'nested corner' ? [outer, run, sink] : []), plain, child])
  }
  arm(mover, child, false)
  const renderer = await create(<Scene mover={mover} child={child} />)
  try {
    await settle(renderer)
    const pointer = pointerDispatcher(layout === 'standalone module')
    await pointer.send(new Vector3(-4, 0, -4), order)
    await settle(renderer)
    const target = point(counters)
    await pointer.send(target, order)
    await settle(renderer)
    const previewMesh = sceneRegistry.nodes.get(child.id)!
    previewMesh.updateWorldMatrix(true, false)
    const preview = previewMesh.matrixWorld.clone()
    await pointer.send(target, order, true)
    await settle(renderer)
    expect(useInteractionScope.getState().scope.kind).toBe('idle')
    const committed = useScene.getState().nodes[child.id] as ItemNode | ProceduralItemNode
    const mesh = sceneRegistry.nodes.get(child.id)!
    mesh.updateWorldMatrix(true, false)
    return {
      committed,
      preview,
      world: mesh.matrixWorld.clone(),
      ray: pointer.ray(target).cast.ray,
    }
  } finally {
    await renderer.unmount()
  }
}
function expectSameMatrix(actual: Matrix4, expected: Matrix4) {
  for (const [i, value] of actual.elements.entries())
    expect(value).toBeCloseTo(expected.elements[i]!, 6)
}

// A countertop or bar-ledge hit hosts the child on that surface, under the pointer, exactly where
// the preview showed it, whatever the mover and whichever of grid or host event arrives first.
for (const [x, y, z] of [
  [1, 1.02, 0.1],
  [0.4, 1.02, 0.2],
  [1.4, 1.02, -0.2],
  [0.5, 1.2, -0.5],
  [1.1, 1.2, -0.5],
])
  test(`counter drop at ${x},${y},${z} lands on the surface under the pointer for both movers and event orders`, async () => {
    const surfaceY = y > 1.1 ? 1.2 : 0.92
    const drops = []
    for (const mover of ['catalog', 'registry'] as const)
      for (const order of ['grid first', 'host first'])
        drops.push(await dropOnCounter(mover, order, 'run', () => new Vector3(x, y, z)))
    for (const { committed, preview, world, ray } of drops) {
      expect(committed.parentId).toBe('cabinet_browser')
      expect(committed.rotation).toEqual([0, 0, 0])
      expect(committed.position[1]).toBeCloseTo(surfaceY, 6)
      const hit = ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -surfaceY), new Vector3())!
      expect(committed.position[0]).toBeCloseTo(hit.x, 6)
      expect(committed.position[2]).toBeCloseTo(hit.z, 6)
      expectSameMatrix(world, preview)
    }
    for (const { committed } of drops.slice(1))
      expect(committed.position).toEqual(drops[0]!.committed.position)
  })

for (const mover of ['catalog', 'registry'] as const)
  test(`${mover} drop on a counter inside a rotated corner run keeps its world heading and lands on the countertop`, async () => {
    const drops = []
    for (const order of ['grid first', 'host first'])
      drops.push(
        await dropOnCounter(mover, order, 'nested corner', ({ run }) =>
          sceneRegistry.nodes.get(run.id)!.localToWorld(new Vector3(1, 0.92, 0.1)),
        ),
      )
    for (const { committed, preview, world } of drops) {
      expect(committed.parentId).toBe('cabinet_browser')
      expect(committed.position[0]).toBeCloseTo(1, 6)
      expect(committed.position[1]).toBeCloseTo(0.92, 6)
      expect(committed.position[2]).toBeCloseTo(0.1, 6)
      expect(new Euler().setFromRotationMatrix(world).y).toBeCloseTo(0, 6)
      expectSameMatrix(world, preview)
    }
    expect({ ...drops[1]!.committed, id: null }).toEqual({ ...drops[0]!.committed, id: null })
  })

test('a standalone module with a countertop hosts a registry drop on its top for either event order', async () => {
  const drops = []
  for (const order of ['grid first', 'host first'])
    drops.push(
      await dropOnCounter(
        'registry',
        order,
        'standalone module',
        () => new Vector3(0.15, 0.92, 0.1),
      ),
    )
  for (const { committed, preview, world } of drops) {
    expect(committed.parentId).toBe('cabinet-module_plain')
    expect(committed.position[0]).toBeCloseTo(0.15, 6)
    expect(committed.position[1]).toBeCloseTo(0.92, 6)
    expect(committed.position[2]).toBeCloseTo(0.1, 6)
    expectSameMatrix(world, preview)
  }
})

for (const kind of ['column', 'box', 'L notch'] as const)
  for (const mode of ['offset', 'grab-offset', 'centred grab', 'centred with neighbour'] as const)
    for (const key of ['r', 't'] as const)
      for (const order of ['grid first', 'host first'])
        test(`registry ${key} rotation on ${kind}: ${mode}, resolver-valid stored pose (${order})`, async () => {
          const host =
            kind === 'column'
              ? ColumnNode.parse({
                  parentId: level.id,
                  height: 0.8,
                  radius: 0.3,
                  capitalStyle: 'none',
                  baseStyle: 'none',
                  shaftTaper: 0,
                  shaftProfile: 'straight',
                })
              : kind === 'box'
                ? BlockNode.parse({
                    parentId: level.id,
                    topology: createBoxBlockTopology(2, 1.5, 2),
                  })
                : lBlock()
          const centred = mode === 'centred grab' || mode === 'centred with neighbour'
          const offset: [number, number, number] = centred
            ? [0, 0.1, 0]
            : kind === 'column'
              ? [0.7, 0.1, 0]
              : [0, 0.1, key === 'r' ? 0.7 : -0.7]
          const center: [number, number, number] =
            kind === 'column' ? [0, 0.8, 0] : kind === 'box' ? [0.9, 1.5, 0] : [-0.1, 1.5, 0.3]
          if (kind === 'column')
            center[1] = getSurfaceProvider(host).surfaces!(host, {
              scene: createSceneApi(useScene),
            })[0]!.position[1]
          const fresh = mode === 'offset' || mode === 'centred with neighbour'
          const child = ProceduralItemNode.parse({
            ...childFor('registry', fresh),
            ...(fresh
              ? {}
              : {
                  parentId: host.id,
                  position: [center[0] - offset[0], center[1], center[2] - offset[2]],
                }),
            recipe: {
              ...recipe,
              parts: [
                {
                  ...recipe.parts[0]!,
                  shapes: [
                    {
                      ...recipe.parts[0]!.shapes[0]!,
                      position: offset,
                      size: mode === 'centred with neighbour' ? [0.8, 0.2, 0.2] : [0.1, 0.2, 0.1],
                    },
                  ],
                },
              ],
            },
          })
          const neighbour = ItemNode.parse({
            parentId: host.id,
            position: [center[0], center[1], center[2] + 0.2],
            asset,
          })
          seed([host, child, ...(mode === 'centred with neighbour' ? [neighbour] : [])])
          arm('registry', child, fresh)
          const renderer = await create(<Scene mover="registry" child={child} />)
          try {
            await settle(renderer)
            const pointer = pointerDispatcher()
            const point = new Vector3(...center)
            if (!fresh) point.x += 0.03
            expect(
              pointer.ray(point).cast.intersectObject(sceneRegistry.nodes.get(host.id)!, true)[0]!
                .face!.normal.y,
            ).toBeGreaterThan(0.75)
            await pointer.send(point, order)
            await settle(renderer)
            const before = structuredClone(
              useScene.getState().nodes[child.id],
            ) as ProceduralItemNode
            expect(before.parentId).toBe(host.id)
            const bounds = nodeRegistry.get(child.type)!.capabilities.dragBounds!(
              before,
              useScene.getState().nodes,
            )
            const midpoint = bounds.center ?? [0, bounds.size[1] / 2, 0]
            const localBounds = {
              min: midpoint.map((v, i) => v - bounds.size[i]! / 2) as [number, number, number],
              max: midpoint.map((v, i) => v + bounds.size[i]! / 2) as [number, number, number],
            }
            const fit = (pose: ProceduralItemNode, yaw: number) => {
              const rotatedCenter = new Vector3(...midpoint).applyEuler(new Euler(0, yaw, 0))
              return resolveSurfacePlacement({
                host: useScene.getState().nodes[host.id]!,
                childKind: child.type,
                childId: child.id,
                childFootprint: { size: bounds.size, rotationY: yaw, localBounds },
                hit: {
                  point: [
                    pose.position[0] + rotatedCenter.x,
                    pose.position[1],
                    pose.position[2] + rotatedCenter.z,
                  ],
                  normalWorldY: 1,
                },
                origin: pose.position,
                scene: createSceneApi(useScene),
              })
            }
            expect(fit(before, before.rotation[1])).not.toBeNull()
            const proposedYaw = before.rotation[1] + ((key === 'r' ? 1 : -1) * Math.PI) / 4
            expect(fit(before, proposedYaw) === null).toBe(!centred)
            const beforeWorld = world(child.id).toArray()
            await act(async () =>
              window.dispatchEvent(
                Object.assign(new Event('keydown', { cancelable: true }), {
                  key,
                  code: key === 'r' ? 'KeyR' : 'KeyT',
                  metaKey: false,
                  ctrlKey: false,
                  altKey: false,
                }),
              ),
            )
            await settle(renderer)
            const rotated = useScene.getState().nodes[child.id] as ProceduralItemNode
            expect(rotated.parentId).toBe(host.id)
            expect(rotated.position).toEqual(before.position)
            expect(rotated.rotation[1]).toBeCloseTo(centred ? proposedYaw : before.rotation[1])
            expect(sceneRegistry.nodes.get(child.id)!.rotation.y).toBeCloseTo(rotated.rotation[1])
            expect(fit(rotated, rotated.rotation[1])).not.toBeNull()
            expect(world(child.id).toArray()).toEqual(beforeWorld)
            expect(previewColors(renderer)).toContain(centred ? '22c55e' : 'ef4444')
            if (!centred) {
              await pointer.send(point, order, true)
              await settle(renderer)
              expect(useInteractionScope.getState().scope.kind).toBe(fresh ? 'placing' : 'moving')
              await pointer.send(point, order)
              await settle(renderer)
              expect(previewColors(renderer)).toContain('22c55e')
              await pointer.send(point, order, true)
              await settle(renderer)
              expect(useInteractionScope.getState().scope.kind).toBe('idle')
              expect(liveChild('registry').parentId).toBe(host.id)
            }
          } finally {
            await renderer.unmount()
          }
        })
