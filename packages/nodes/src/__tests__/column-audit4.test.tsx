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
  useScene,
} from '@pascal-app/core'
import { ProceduralItemNode } from '@pascal-app/core/procedural-items'
import { MoveRegistryNodeTool, useEditor, useInteractionScope } from '@pascal-app/editor'
import { CeilingSystem, RoofSystem, useViewer, WallSystem } from '@pascal-app/viewer'
import { events, type RootStore } from '@react-three/fiber'
import { act, create } from '@react-three/test-renderer'
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, type Object3D, Vector3 } from 'three'
import { columnTopSurfaces } from '../column/surface'
import { buildItemFloorplan, resolveItemTransform } from '../item/floorplan'
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
      <CeilingSystem />
      <RoofSystem />
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
    viewLayouts: {},
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
function genericHost(parentId: AnyNodeId = level.id) {
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
    test(`${mover} centre leaving the column top detaches and commits at the floor datum (${order})`, async () => {
      const host = ColumnNode.parse({
        parentId: level.id,
        height: 0.8,
        radius: 0.2,
        shaftTaper: 0,
        shaftProfile: 'straight',
        capitalStyle: 'none',
        baseStyle: 'none',
      })
      const top = columnTopSurfaces(host)[0]!.position[1]
      const child =
        mover === 'catalog'
          ? ItemNode.parse({ parentId: host.id, asset, position: [0.1, top, 0] })
          : ProceduralItemNode.parse({ parentId: host.id, recipe, position: [0.1, top, 0] })
      seed([host, child])
      useEditor.getState().setMovingNode(child)
      const renderer = await create(<Scene mover={mover} child={child} />)
      try {
        await settle(renderer)
        const pointer = pointerDispatcher()
        await paired(pointer, new Vector3(-0.12, top, 0), order)
        await settle(renderer)
        expect(useScene.getState().nodes[child.id]!.parentId).toBe(host.id)
        expect(world(child.id).x).toBeCloseTo(0.1, 8)
        expect(world(child.id).y).toBeCloseTo(top, 8)
        const point = new Vector3(0.12, top, 0)
        await paired(pointer, point, order)
        await settle(renderer)
        expect(useScene.getState().nodes[child.id]!.parentId).toBe(level.id)
        expect(world(child.id).toArray()).toEqual([8, 0, 8])
        let invalid = false
        let valid = false
        renderer.scene.instance.traverse((o) => {
          const materials = (o as Mesh).material
          for (const m of Array.isArray(materials) ? materials : [materials]) {
            if ((m as MeshBasicMaterial)?.color?.getHex() === 0xef4444) invalid = true
            if ((m as MeshBasicMaterial)?.color?.getHex() === 0x22c55e) valid = true
          }
        })
        expect(invalid).toBe(false)
        expect(valid).toBe(true)
        await act(async () => pointer(point, 'onPointerUp').dispatch())
        await settle(renderer)
        expect(useInteractionScope.getState().scope.kind).toBe('idle')
        expect(useScene.getState().nodes[child.id]!.parentId).toBe(level.id)
        expect((useScene.getState().nodes[child.id] as ItemNode).position).toEqual([8, 0, 8])
      } finally {
        await renderer.unmount()
      }
    })

function wrapper(
  kind: string,
  parentId: AnyNodeId,
  position: [number, number, number],
  rotation: [number, number, number],
): AnyNode {
  if (kind === 'shelf') return ShelfNode.parse({ parentId, position, rotation })
  if (kind === 'item') return ItemNode.parse({ parentId, position, rotation, asset })
  return ProceduralItemNode.parse({ parentId, position, rotation, recipe })
}
for (const hostKind of ['plugin', 'column'])
  for (const intermediate of ['shelf', 'item', 'generated'])
    for (const depth of [1, 2, 3])
      for (const location of ['root', 'nested'])
        for (const tilted of [false, true])
          test(`full mounted frame: ${hostKind} ${location}, ${intermediate} depth ${depth}, tilted ${tilted}`, async () => {
            const entries: AnyNode[] = []
            let parentId: AnyNodeId = level.id
            if (location === 'nested') {
              const above = wrapper(
                intermediate,
                parentId,
                [1, 0.4, -1],
                tilted ? [0.4, 0.6, -0.2] : [0, 0.6, 0],
              )
              entries.push(above)
              parentId = above.id
            }
            const host =
              hostKind === 'plugin'
                ? genericHost(parentId)
                : ColumnNode.parse({
                    parentId,
                    height: 0.8,
                    position: [1, 0.3, -1],
                    rotation: 0.6,
                  })
            if (hostKind === 'plugin' && tilted) Object.assign(host, { rotation: [0.4, 0.6, -0.2] })
            entries.push(host)
            parentId = host.id
            for (let i = 0; i < depth; i++) {
              const middle = wrapper(
                intermediate,
                parentId,
                [0.1, 0.8, 0.1],
                tilted ? [0.2, 0.3, -0.1] : [0, 0.3, 0],
              )
              entries.push(middle)
              parentId = middle.id
            }
            const child = ItemNode.parse({
              parentId,
              asset,
              position: [0.2, 0.3, 0.1],
              rotation: tilted ? [0.1, -0.2, 0.15] : [0, -0.2, 0],
            })
            entries.push(child)
            seed(entries, true)
            const renderer = await create(<Scene />)
            try {
              await settle(renderer)
              const expected = world(child.id)
              const actual = plan(child)
              expect(actual.x).toBeCloseTo(expected.x, 8)
              expect(actual.y).toBeCloseTo(expected.z, 8)
              const matrix = sceneRegistry.nodes.get(child.id)!.matrixWorld.elements
              const yaw = Math.atan2(matrix[8]!, matrix[10]!)
              expect(Math.sin(actual.rotation)).toBeCloseTo(Math.sin(yaw), 8)
              expect(Math.cos(actual.rotation)).toBeCloseTo(Math.cos(yaw), 8)
              const glyph = buildItemFloorplan(child, {
                resolve: (id) => useScene.getState().nodes[id],
              } as never)!
              if (glyph.kind !== 'group' || glyph.children[0]?.kind !== 'polygon')
                throw Error('missing item polygon')
              const points = glyph.children[0].points
              expect(points.reduce((sum, p) => sum + p[0], 0) / points.length).toBeCloseTo(
                expected.x,
                8,
              )
              expect(points.reduce((sum, p) => sum + p[1], 0) / points.length).toBeCloseTo(
                expected.z,
                8,
              )
            } finally {
              await renderer.unmount()
            }
          })

test('pitched plugin -> shelf -> catalog plan matches rendered XZ', async () => {
  const root = genericHost()
  Object.assign(root, { rotation: [0.4, 0.6, -0.2] })
  const shelf = ShelfNode.parse({
    parentId: root.id,
    position: [0.1, 0.8, 0.1],
    rotation: [0, 0.2, 0],
  })
  const child = ItemNode.parse({ parentId: shelf.id, asset, position: [0.2, 0.3, 0.1] })
  seed([root, shelf, child])
  const renderer = await create(<Scene />)
  try {
    await settle(renderer)
    const expected = world(child.id)
    expect(plan(child).x).toBeCloseTo(expected.x, 8)
    expect(plan(child).y).toBeCloseTo(expected.z, 8)
  } finally {
    await renderer.unmount()
  }
})

for (const kind of ['shelf', 'item', 'generated'])
  test(`identity plugin nested under tilted ${kind} still composes the complete mounted frame`, async () => {
    const ancestor = wrapper(kind, level.id, [1, 0.4, -1], [0.4, 0.6, -0.2])
    const host = genericHost(ancestor.id)
    Object.assign(host, { position: [0, 0, 0], rotation: [0, 0, 0] })
    const shelf = ShelfNode.parse({ parentId: host.id, position: [0.1, 0.8, 0.1] })
    const child = ItemNode.parse({ parentId: shelf.id, asset, position: [0.2, 0.3, 0.1] })
    seed([ancestor, host, shelf, child], true)
    const renderer = await create(<Scene />)
    try {
      await settle(renderer)
      const expected = world(child.id)
      expect(plan(child).x).toBeCloseTo(expected.x, 8)
      expect(plan(child).y).toBeCloseTo(expected.z, 8)
    } finally {
      await renderer.unmount()
    }
  })
