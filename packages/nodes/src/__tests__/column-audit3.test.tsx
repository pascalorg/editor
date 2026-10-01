import { expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  ColumnNode,
  emitter,
  ItemNode,
  LevelNode,
  nodeRegistry,
  nodeType,
  objectId,
  registerNode,
  ShelfNode,
  SiteNode,
  SlabNode,
  sceneRegistry,
  spatialGridManager,
  useLiveTransforms,
  useScene,
  WallNode,
} from '@pascal-app/core'
import { ProceduralItemNode } from '@pascal-app/core/procedural-items'
import { MoveRegistryNodeTool, useEditor, useInteractionScope } from '@pascal-app/editor'
import { useViewer, WallSystem } from '@pascal-app/viewer'
import { events, type RootStore } from '@react-three/fiber'
import { act, create } from '@react-three/test-renderer'
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, type Object3D, Vector3 } from 'three'
import { resolveItemTransform } from '../item/floorplan'
import { restingNodePlanFrame } from '../shared/resting-surface-plan'
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
installMountedScene()

function Scene({ mover, child }: { mover?: Mover; child?: AnyNode }) {
  const moving = useInteractionScope((s) => s.scope.kind === 'moving')
  return (
    <>
      <LevelScene level={level} />
      {moving &&
        child &&
        (mover === 'catalog' ? (
          <CatalogMover source={child as ItemNode} />
        ) : (
          <MoveRegistryNodeTool node={child} />
        ))}
      <SceneSystems />
      <WallSystem />
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
test('wall-side item → shelf → catalog: plan equals the mounted wall-face pose', async () => {
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
    expect(plan(child).x).toBeCloseTo(expected.x, 8)
    expect(plan(child).y).toBeCloseTo(expected.z, 8)
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
