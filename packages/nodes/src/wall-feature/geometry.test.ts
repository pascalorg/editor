import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  applyHeightPatch,
  BuildingNode,
  buildWallFinishLayout,
  calculateLevelMiters,
  createTerrainField,
  DoorNode,
  encodeTerrainField,
  getEffectiveNode,
  getWallPlaneTop,
  initSpatialGridSync,
  LevelNode,
  resolveWallFeaturePlacement,
  SiteNode,
  SlabNode,
  sceneRegistry,
  spatialGridManager,
  useLiveNodeOverrides,
  useLiveTerrain,
  useScene,
  WallFeatureNode,
  WallNode,
  WindowNode,
  wallSupportForNodes,
} from '@pascal-app/core'
import { getFloorplanNodeExtension } from '@pascal-app/editor'
import {
  buildWallBatch,
  raycastWallFeature,
  resetWallFeatureGeometry,
  syncWallFeatureGeometry,
  wallDefinition,
  wallFeaturePaint,
  wallGeometryAdapter,
} from '@pascal-app/nodes'
import {
  drainRebuiltWalls,
  generateExtrudedWall,
  getWallBodyFaceAssignments,
  getWallFinishRefs,
  runWallBuildFrame,
} from '@pascal-app/viewer'
import {
  type BufferGeometry,
  DoubleSide,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  Vector3,
} from 'three'

globalThis.requestAnimationFrame ??= (callback) => {
  callback(0)
  return 0
}
globalThis.cancelAnimationFrame ??= () => {}

const material = new MeshBasicMaterial({ side: DoubleSide })
const originalScene = useScene.getState()
const geometries = new Set<BufferGeometry>()
const meshes = new Map<string, Mesh>()
let unsubscribeGrid: (() => void) | undefined

beforeEach(() => {
  resetWallFeatureGeometry()
  useLiveNodeOverrides.getState().clearAll()
  useLiveTerrain.getState().endAll()
  spatialGridManager.clear()
  useScene.setState({ nodes: {}, rootNodeIds: [], dirtyNodes: new Set(), readOnly: false })
  drainRebuiltWalls(new Set())
})

afterEach(() => {
  unsubscribeGrid?.()
  unsubscribeGrid = undefined
  for (const [id, mesh] of meshes) {
    sceneRegistry.nodes.delete(id)
    sceneRegistry.byType.wall.delete(id)
    geometries.add(mesh.geometry)
  }
  for (const geometry of geometries) geometry.dispose()
  geometries.clear()
  meshes.clear()
  resetWallFeatureGeometry()
  useLiveNodeOverrides.getState().clearAll()
  useLiveTerrain.getState().endAll()
  spatialGridManager.clear()
  useScene.setState(originalScene)
  drainRebuiltWalls(new Set())
})

function fixture(wallPatch: Partial<WallNode> = {}, featurePatch: Partial<WallFeatureNode> = {}) {
  const level = LevelNode.parse({ level: 0, height: 3 })
  const wall = WallNode.parse({
    parentId: level.id,
    start: [0, 0],
    end: [4, 0],
    thickness: 0.2,
    ...wallPatch,
  })
  const feature = WallFeatureNode.parse({ parentId: wall.id, face: 'a', u: 2, ...featurePatch })
  wall.children = [feature.id]
  level.children = [wall.id]
  const nodes: Record<string, AnyNode> = Object.fromEntries(
    [level, wall, feature].map((node) => [node.id, node]),
  )
  const mesh = new Mesh(undefined, [material, material, material])
  meshes.set(wall.id, mesh)
  sceneRegistry.nodes.set(wall.id, mesh)
  sceneRegistry.byType.wall.add(wall.id)
  return { nodes, level, wall, feature, mesh }
}

function build(nodes: Record<string, AnyNode>, raw: WallNode) {
  const wall = getEffectiveNode(raw)
  const support = wallSupportForNodes(wall, nodes)
  const geometry = generateExtrudedWall(
    wall,
    wall.children.flatMap((id) => (nodes[id] ? [nodes[id]!] : [])),
    calculateLevelMiters(
      Object.values(nodes).filter(
        (node): node is WallNode => node.type === 'wall' && node.parentId === wall.parentId,
      ),
    ),
    support.elevation,
    support.baseElevation,
    support.baseSegments,
    getWallPlaneTop(wall, wall.parentId!, nodes),
    undefined,
    support.faceDatum,
    buildWallFinishLayout(wall, []),
    nodes,
    wallGeometryAdapter.bodyModifier?.(wall, { nodes, elevation: support.elevation }),
  )
  geometries.add(geometry)
  return geometry
}

function hit(geometry: BufferGeometry, x: number, y: number, face: 'a' | 'b' = 'a') {
  const sign = face === 'a' ? 1 : -1
  const mesh = new Mesh(
    geometry,
    Array.from({ length: 3 + getWallFinishRefs(geometry).length }, () => material),
  )
  return new Raycaster(new Vector3(x, y, sign * 10), new Vector3(0, 0, -sign)).intersectObject(
    mesh,
    false,
  )[0]
}

function volume(geometry: BufferGeometry) {
  const position = geometry.getAttribute('position')
  const index = geometry.index
  let sum = 0
  const a = new Vector3(),
    b = new Vector3(),
    c = new Vector3()
  for (let i = 0; i < (index?.count ?? position.count); i += 3) {
    a.fromBufferAttribute(position, index ? index.getX(i) : i)
    b.fromBufferAttribute(position, index ? index.getX(i + 1) : i + 1)
    c.fromBufferAttribute(position, index ? index.getX(i + 2) : i + 2)
    sum += a.dot(b.cross(c)) / 6
  }
  return Math.abs(sum)
}

describe('wall feature boolean solids', () => {
  test('walls containing straight-wall features cannot be curved through their action menu', () => {
    for (const mode of ['niche', 'bump'] as const) {
      const { nodes, wall } = fixture({}, { mode })
      const canCurve = getFloorplanNodeExtension(wallDefinition)?.actionMenu?.canCurve
      expect(canCurve?.({ node: wall, nodes })).toBe(false)
    }
  })

  test('a niche subtracts its volume and preserves the backing and opposite face', () => {
    const { nodes, wall, feature } = fixture({}, { depth: 0.18 })
    const geometry = build(nodes, wall)
    expect(volume(geometry)).toBeCloseTo(
      4 * 3 * 0.2 - feature.width * feature.height * feature.depth,
      5,
    )
    expect(hit(geometry, 2, 1.175)?.point.z).toBeCloseTo(-0.08, 5)
    expect(hit(geometry, 2, 1.175, 'b')?.point.z).toBeCloseTo(-0.1, 5)
    expect(hit(geometry, 3, 1.175)?.point.z).toBeCloseTo(0.1, 5)
    expect(hit(geometry, 2, 1.175)?.face?.normal.z).toBeGreaterThan(0.99)
    for (const name of ['position', 'normal', 'uv', 'uv2'])
      expect(Array.from(geometry.getAttribute(name).array).every(Number.isFinite)).toBe(true)
  })

  test('bumps on either justified face add the exact volume and extend the bounds', () => {
    for (const face of ['a', 'b'] as const) {
      for (const justification of [undefined, 'a', 'b'] as const) {
        const { nodes, wall, feature } = fixture(
          { justification },
          { mode: 'bump', face, width: 1, height: 1, bottom: 0, depth: 0.3 },
        )
        const geometry = build(nodes, wall)
        expect(volume(geometry)).toBeCloseTo(2.4 + 0.3, 5)
        const offset =
          face === 'a'
            ? justification === 'b'
              ? 0
              : justification === 'a'
                ? 0.2
                : 0.1
            : justification === 'a'
              ? 0
              : justification === 'b'
                ? -0.2
                : -0.1
        expect(hit(geometry, feature.u, 0.5, face)?.point.z).toBeCloseTo(
          offset + (face === 'a' ? 0.3 : -0.3),
          5,
        )
        geometry.computeBoundingBox()
        expect(
          face === 'a' ? geometry.boundingBox?.max.z : geometry.boundingBox?.min.z,
        ).toBeCloseTo(offset + (face === 'a' ? 0.3 : -0.3), 5)
      }
    }
  })

  test('a nested niche cuts from the bump face regardless of graph insertion order', () => {
    const {
      nodes,
      wall,
      feature: bump,
    } = fixture({}, { mode: 'bump', bottom: 0, width: 1.2, height: 2, depth: 0.3 })
    const niche = WallFeatureNode.parse({ parentId: bump.id, u: 0.6, bottom: 1, depth: 0.35 })
    bump.children = [niche.id]
    const graph = { [niche.id]: niche, ...nodes }
    const geometry = build(graph, wall)
    expect(volume(geometry)).toBeCloseTo(2.4 + 1.2 * 2 * 0.3 - 0.6 * 0.35 * 0.35, 5)
    expect(hit(geometry, 2, 1.175)?.point.z).toBeCloseTo(0.05, 5)
    expect(hit(geometry, 2, 0.5)?.point.z).toBeCloseTo(0.4, 5)
  })

  test('floor and top contact produce clean, finite recesses', () => {
    for (const bottom of [0, 2.65]) {
      const { nodes, wall, feature } = fixture({}, { bottom })
      const geometry = build(nodes, wall)
      expect(volume(geometry)).toBeCloseTo(2.4 - feature.width * feature.height * feature.depth, 5)
      expect(hit(geometry, 2, bottom + 0.175)?.point.z).toBeCloseTo(0, 5)
    }
  })

  test('raised supports keep features in the correct wall-local vertical frame', () => {
    const { nodes, level, wall, feature } = fixture({}, { bottom: 0.2 })
    const slab = SlabNode.parse({
      parentId: level.id,
      elevation: 0.6,
      polygon: [
        [-1, -1],
        [5, -1],
        [5, 1],
        [-1, 1],
      ],
    })
    nodes[slab.id] = slab
    const geometry = build(nodes, wall)
    expect(volume(geometry)).toBeCloseTo(
      4 * 2.4 * 0.2 - feature.width * feature.height * feature.depth,
      5,
    )
    expect(hit(geometry, 2, 0.375)?.point.z).toBeCloseTo(0, 5)
  })

  test('hiding a bump removes its solid and all nested niche contributions', () => {
    const {
      nodes,
      wall,
      feature: bump,
    } = fixture({}, { mode: 'bump', bottom: 0, width: 1.2, height: 2, depth: 0.3, visible: false })
    const niche = WallFeatureNode.parse({ parentId: bump.id, u: 0.6, depth: 0.35 })
    nodes[niche.id] = niche
    expect(volume(build(nodes, wall))).toBeCloseTo(2.4, 5)
    const shown = {
      ...nodes,
      [bump.id]: { ...bump, visible: true },
      [niche.id]: { ...niche, visible: false },
    }
    expect(volume(build(shown, wall))).toBeCloseTo(3.12, 5)
  })

  test('feature surfaces inherit the mounting face finish', () => {
    for (const mode of ['niche', 'bump'] as const) {
      for (const face of ['a', 'b'] as const) {
        const { nodes, wall } = fixture({}, { mode, face })
        const geometry = build(nodes, wall)
        expect(hit(geometry, 2, 1.175, face)?.face?.materialIndex).toBe(face === 'a' ? 1 : 2)
        const mesh = new Mesh(geometry, [material, material, material])
        const z = face === 'a' ? (mode === 'bump' ? 0.15 : 0.05) : mode === 'bump' ? -0.15 : -0.05
        const shelf = new Raycaster(
          new Vector3(2, mode === 'bump' ? 2 : 1.1, z),
          new Vector3(0, -1, 0),
        ).intersectObject(mesh, false)[0]
        expect(shelf?.face?.materialIndex).toBe(face === 'a' ? 1 : 2)
      }
    }
  })

  test('feature finish overrides use the wall palette and nested niches inherit their bump', () => {
    const { nodes, wall, feature } = fixture(
      {},
      { mode: 'bump', width: 1, height: 1, depth: 0.2, slots: { surface: 'preset:concrete' } },
    )
    const niche = WallFeatureNode.parse({
      parentId: feature.id,
      u: 0.2,
      bottom: 0.2,
      width: 0.4,
      height: 0.4,
      depth: 0.1,
    })
    nodes[niche.id] = niche
    feature.children = [niche.id]
    const inherited = build(nodes, wall)
    expect(getWallFinishRefs(inherited)).toEqual(['preset:concrete'])
    expect(hit(inherited, 1.7, 1.4)?.face?.materialIndex).toBe(3)
    nodes[niche.id] = { ...niche, slots: { surface: 'preset:wood' } }
    const overridden = build({ ...nodes }, wall)
    expect(getWallFinishRefs(overridden)).toEqual(['preset:concrete', 'preset:wood'])
    const mesh = new Mesh(overridden, [material, material, material, material, material])
    const picks = new Raycaster(new Vector3(1.7, 1.4, 10), new Vector3(0, 0, -1)).intersectObject(
      mesh,
      false,
    )
    expect(picks[0]?.face?.materialIndex).toBe(4)
    expect(hit(overridden, 3, 1.4)?.face?.materialIndex).toBe(1)
  })

  test('niche selection reaches the recess back and respects later opening cuts', () => {
    const { nodes, wall, feature } = fixture(
      {},
      { u: 1, bottom: 1, width: 1, height: 1, depth: 0.1 },
    )
    const geometry = build(nodes, wall)
    const mesh = new Mesh(geometry, [material, material, material])
    mesh.updateMatrixWorld(true)
    const target = new Mesh()
    const hits: import('three').Intersection[] = []
    raycastWallFeature(
      target,
      mesh,
      resolveWallFeaturePlacement(nodes, feature),
      new Raycaster(new Vector3(1, 1.5, 10), new Vector3(0, 0, -1)),
      hits,
    )
    expect(hits[0]?.point.z).toBeCloseTo(0, 5)
    const door = DoorNode.parse({
      parentId: wall.id,
      wallId: wall.id,
      position: [1, 1, 0],
      width: 1,
      height: 2,
    })
    nodes[door.id] = door
    wall.children.push(door.id)
    mesh.geometry = build({ ...nodes }, wall)
    const cut: import('three').Intersection[] = []
    raycastWallFeature(
      target,
      mesh,
      resolveWallFeaturePlacement(nodes, feature),
      new Raycaster(new Vector3(1, 1.5, 10), new Vector3(0, 0, -1)),
      cut,
    )
    expect(cut).toHaveLength(0)
  })

  test('the modified body is disposed once when replaced by the feature solid', () => {
    const { nodes, wall } = fixture()
    const body = generateExtrudedWall(wall, [], calculateLevelMiters([wall]))
    const bodyVolume = volume(body)
    let disposals = 0
    body.addEventListener('dispose', () => disposals++)
    const result = wallGeometryAdapter.bodyModifier!(wall, { nodes, elevation: 0 })!(body)
    geometries.add(result.geometry)
    expect(disposals).toBe(1)
    expect(volume(result.geometry)).toBeCloseTo(bodyVolume - 0.021, 5)
  })

  test('batched output retains the complete feature solid, attributes, and transformed bounds', () => {
    const { nodes, level, wall, mesh } = fixture(
      {},
      { mode: 'bump', width: 1, height: 1, depth: 0.3 },
    )
    useScene.setState({ nodes, rootNodeIds: [level.id], dirtyNodes: new Set() })
    unsubscribeGrid = initSpatialGridSync()
    syncWallFeatureGeometry()
    runWallBuildFrame(wallGeometryAdapter)
    const geometry = mesh.geometry
    expect(geometry.index).toBeNull()
    const position = geometry.getAttribute('position')
    const normal = geometry.getAttribute('normal')
    const uv = geometry.getAttribute('uv')
    let frontVertices = 0
    for (let i = 0; i < position.count; i++) {
      if (position.getZ(i) < 0.39 || normal.getZ(i) < 0.99) continue
      expect(uv.getX(i)).toBeCloseTo(position.getX(i), 5)
      expect(uv.getY(i)).toBeCloseTo(1 - position.getY(i), 5)
      frontVertices++
    }
    expect(frontVertices).toBeGreaterThanOrEqual(3)
    const batch = buildWallBatch([
      { nodeId: wall.id, geometry, matrix: new Matrix4().makeTranslation(5, 0, 2) },
    ])
    if (!batch) throw new Error('Expected a wall batch')
    geometries.add(batch.geometry)
    expect(volume(batch.geometry)).toBeCloseTo(volume(geometry), 5)
    expect(batch.geometry.boundingBox?.min.x).toBeCloseTo(5)
    expect(batch.geometry.boundingBox?.max.z).toBeCloseTo(2.4)
    expect(batch.geometry.getAttribute('normal').count).toBe(
      batch.geometry.getAttribute('position').count,
    )
    expect(batch.geometry.getAttribute('uv').count).toBe(
      batch.geometry.getAttribute('position').count,
    )
  })
})

describe('openings through modified walls', () => {
  for (const face of ['a', 'b'] as const) {
    for (const kind of ['door', 'window'] as const) {
      test(`${kind} cuts through a deep bump on face ${face}`, () => {
        const { nodes, wall } = fixture(
          {},
          { mode: 'bump', face, width: 1.2, height: 2.5, bottom: 0, depth: 2 },
        )
        const opening =
          kind === 'door'
            ? DoorNode.parse({
                parentId: wall.id,
                wallId: wall.id,
                width: 0.8,
                height: 2.1,
                position: [2, 1.05, 0],
              })
            : WindowNode.parse({
                parentId: wall.id,
                wallId: wall.id,
                width: 0.8,
                height: 0.8,
                position: [2, 1.4, 0],
              })
        nodes[opening.id] = opening
        wall.children.push(opening.id)
        const geometry = build(nodes, wall)
        expect(hit(geometry, 2, 1.4, face)).toBeUndefined()
        expect(hit(geometry, 1.5, 1.4, face)?.point.z).toBeCloseTo(face === 'a' ? 2.1 : -2.1, 5)
      })
    }
  }

  test('an arched opening keeps its outline throughout a bump', () => {
    const { nodes, wall } = fixture(
      {},
      { mode: 'bump', width: 1.2, height: 2.5, bottom: 0, depth: 0.5 },
    )
    const door = DoorNode.parse({
      parentId: wall.id,
      wallId: wall.id,
      position: [2, 1.05, 0],
      width: 0.9,
      height: 2.1,
      openingShape: 'arch',
      archHeight: 0.4,
    })
    nodes[door.id] = door
    wall.children.push(door.id)
    const geometry = build(nodes, wall)
    expect(hit(geometry, 2, 2)).toBeUndefined()
    expect(hit(geometry, 1.56, 2)?.point.z).toBeCloseTo(0.6, 5)
  })

  test('extending a rounded opening cutter preserves the physical wall reveal radius', () => {
    const { nodes, wall } = fixture(
      { thickness: 0.02 },
      { mode: 'bump', width: 1.2, height: 2.5, bottom: 0, depth: 0.5 },
    )
    const window = WindowNode.parse({
      parentId: wall.id,
      wallId: wall.id,
      position: [2, 1.4, 0],
      width: 0.8,
      height: 0.8,
      openingShape: 'rounded',
      cornerRadius: 0.15,
      openingRevealRadius: 0.025,
    })
    nodes[window.id] = window
    wall.children.push(window.id)
    const geometry = build(nodes, wall)
    expect(hit(geometry, 2, 1.4)).toBeUndefined()
    expect(hit(geometry, 1.59, 1.4)?.point.z).toBeCloseTo(0.51, 5)
  })
})

describe('wall feature rebuild lifecycle', () => {
  test('features follow live terrain support without changing persisted feature coordinates', () => {
    const { nodes, level, wall, feature, mesh } = fixture()
    const building = BuildingNode.parse({ children: [level.id] })
    const base = createTerrainField({ cols: 9, rows: 9, spacing: 1, origin: [-2, -2] })
    const site = SiteNode.parse({ children: [building.id], terrain: encodeTerrainField(base) })
    const graph = {
      ...nodes,
      [level.id]: { ...level, parentId: building.id },
      [building.id]: { ...building, parentId: site.id },
      [site.id]: site,
    }
    useScene.setState({ nodes: graph, rootNodeIds: [site.id], dirtyNodes: new Set() })
    unsubscribeGrid = initSpatialGridSync()
    useLiveTerrain.getState().begin(site.id, base)
    const patch = {
      col0: 0,
      row0: 0,
      cols: base.cols,
      rows: base.rows,
      heights: new Int16Array(base.cols * base.rows).fill(60),
    }
    useLiveTerrain.getState().advance(site.id, applyHeightPatch(base, patch), patch)
    useScene.getState().markDirty(wall.id)
    syncWallFeatureGeometry()
    runWallBuildFrame(wallGeometryAdapter)
    expect(mesh.position.y).toBeCloseTo(0.6)
    expect(hit(mesh.geometry, 2, 1.175)?.point.z).toBeCloseTo(0, 5)
    expect((useScene.getState().nodes[feature.id] as WallFeatureNode).bottom).toBe(1)
  })

  test('feature edits and cleared live overrides rebuild the root through the existing wall queue', () => {
    const { nodes, level, wall, feature, mesh } = fixture()
    useScene.setState({ nodes, rootNodeIds: [level.id], dirtyNodes: new Set() })
    unsubscribeGrid = initSpatialGridSync()
    syncWallFeatureGeometry()
    expect(useScene.getState().dirtyNodes.has(wall.id)).toBe(true)
    runWallBuildFrame(wallGeometryAdapter)
    const rebuilt = new Set<string>()
    drainRebuiltWalls(rebuilt)
    expect(rebuilt.has(wall.id)).toBe(true)
    expect(hit(mesh.geometry, 2, 1.175)?.point.z).toBeCloseTo(0, 5)
    useScene.getState().dirtyNodes.clear()
    syncWallFeatureGeometry()
    expect(useScene.getState().dirtyNodes.has(wall.id)).toBe(false)

    useLiveNodeOverrides.getState().set(feature.id, { depth: 0.15 })
    syncWallFeatureGeometry()
    expect(useScene.getState().dirtyNodes.has(wall.id)).toBe(true)
    runWallBuildFrame(wallGeometryAdapter)
    expect(hit(mesh.geometry, 2, 1.175)?.point.z).toBeCloseTo(-0.05, 5)
    expect((useScene.getState().nodes[feature.id] as WallFeatureNode).depth).toBe(0.1)

    useLiveNodeOverrides.getState().clear(feature.id)
    syncWallFeatureGeometry()
    runWallBuildFrame(wallGeometryAdapter)
    expect(hit(mesh.geometry, 2, 1.175)?.point.z).toBeCloseTo(0, 5)

    useScene.setState({
      nodes: { ...nodes, [feature.id]: { ...feature, visible: false, slots: { body: '#123456' } } },
    })
    syncWallFeatureGeometry()
    runWallBuildFrame(wallGeometryAdapter)
    expect(hit(mesh.geometry, 2, 1.175)?.point.z).toBeCloseTo(0.1, 5)
  })

  test('nested changes, rehosting, and deletion invalidate only affected root walls', () => {
    const {
      nodes,
      level,
      wall,
      feature: bump,
    } = fixture({}, { mode: 'bump', bottom: 0, width: 1.2, height: 2, depth: 0.3 })
    const other = WallNode.parse({ parentId: level.id, start: [0, 4], end: [4, 4], thickness: 0.2 })
    const niche = WallFeatureNode.parse({ parentId: bump.id, u: 0.6, depth: 0.1 })
    const graph = { ...nodes, [other.id]: other, [niche.id]: niche }
    useScene.setState({ nodes: graph, dirtyNodes: new Set() })
    syncWallFeatureGeometry()
    useScene.getState().dirtyNodes.clear()
    useScene.setState({ nodes: { ...graph, [niche.id]: { ...niche, depth: 0.15 } } })
    syncWallFeatureGeometry()
    expect([...useScene.getState().dirtyNodes]).toEqual([wall.id])
    useScene.getState().dirtyNodes.clear()

    useLiveNodeOverrides.getState().set(bump.id, { parentId: other.id })
    syncWallFeatureGeometry()
    expect(new Set(useScene.getState().dirtyNodes)).toEqual(new Set([wall.id, other.id]))
    useScene.getState().dirtyNodes.clear()
    const deleted = { ...graph }
    delete deleted[bump.id]
    delete deleted[niche.id]
    useScene.setState({ nodes: deleted })
    syncWallFeatureGeometry()
    expect([...useScene.getState().dirtyNodes]).toEqual([other.id])
  })
})

test('feature paint previews affect only the owned faces, restore cleanly, and commit in one undo step', () => {
  const { nodes, wall, feature, mesh, level } = fixture({}, { slots: { surface: '#123456' } })
  useScene.setState({ nodes, rootNodeIds: [level.id], dirtyNodes: new Set() })
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
  mesh.geometry = build(nodes, wall)
  mesh.material = Array.from({ length: 4 }, () => material)
  const originalGroups = mesh.geometry.groups.map((g) => ({ ...g }))
  const originalMaterials = mesh.material
  const pick = (x: number, y: number) =>
    new Raycaster(new Vector3(x, y, 10), new Vector3(0, 0, -1)).intersectObject(mesh, false)[0]
  const assignments = getWallBodyFaceAssignments(mesh.geometry)
  expect(assignments.length).toBeGreaterThan(0)
  for (const face of assignments) {
    expect(face.ownerId).toBe(feature.id)
    expect(face.finishRef).toBe('#123456')
    expect(face.baseMaterialIndex).toBe(1)
    const group = mesh.geometry.groups.find(
      (g) => face.start >= g.start && face.start < g.start + g.count,
    )
    expect(group?.materialIndex).toBe(3)
  }
  const preview = wallFeaturePaint.applyPreview({
    node: feature,
    role: 'surface',
    material: undefined,
    materialPreset: '#abcdef',
    root: mesh,
  })
  expect(preview).not.toBeNull()
  expect(mesh.userData.pascalMaterialPreview).toBeDefined()
  expect(pick(2, 1.175)?.face?.materialIndex).toBe(4)
  expect(pick(3, 1.175)?.face?.materialIndex).toBe(1)
  expect(useScene.getState().nodes[feature.id]).toBe(feature)
  preview!()
  expect(mesh.geometry.groups).toEqual(originalGroups)
  expect(mesh.material).toBe(originalMaterials)
  expect(mesh.userData.pascalMaterialPreview).toBeUndefined()
  const erased = wallFeaturePaint.applyPreview({
    node: feature,
    role: 'surface',
    material: undefined,
    materialPreset: undefined,
    root: mesh,
  })
  expect(pick(2, 1.175)?.face?.materialIndex).toBe(1)
  erased!()
  wallFeaturePaint.commit!({
    node: feature,
    role: 'surface',
    material: undefined,
    materialPreset: '#abcdef',
  })
  expect((useScene.getState().nodes[feature.id] as WallFeatureNode).slots?.surface).toBe('#abcdef')
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect((useScene.getState().nodes[feature.id] as WallFeatureNode).slots?.surface).toBe('#123456')
})

test('completed niche backs, shelves, and reveals keep metre-scale UVs after finish splitting and wall transforms', () => {
  const { nodes, level, wall, feature, mesh } = fixture(
    { start: [2, 1], end: [2, 5] },
    { width: 1.2, height: 0.7, depth: 0.15 },
  )
  useScene.setState({ nodes, rootNodeIds: [level.id], dirtyNodes: new Set() })
  unsubscribeGrid = initSpatialGridSync()
  syncWallFeatureGeometry()
  runWallBuildFrame(wallGeometryAdapter)
  const geometry = mesh.geometry,
    uv = geometry.getAttribute('uv'),
    position = geometry.getAttribute('position')
  const indices = geometry.getIndex()
  const seen = new Set<string>()
  const a = new Vector3(),
    b = new Vector3(),
    c = new Vector3()
  for (const face of getWallBodyFaceAssignments(geometry)) {
    if (face.ownerId !== feature.id) continue
    const at = [0, 1, 2].map((i) => (indices ? indices.getX(face.start + i) : face.start + i))
    a.fromBufferAttribute(position, at[0]!)
    b.fromBufferAttribute(position, at[1]!)
    c.fromBufferAttribute(position, at[2]!)
    const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize()
    seen.add(Math.abs(normal.y) > 0.9 ? 'horizontal' : Math.abs(normal.x) > 0.9 ? 'reveal' : 'back')
    for (const [i, j] of [
      [0, 1],
      [1, 2],
      [2, 0],
    ] as const) {
      a.fromBufferAttribute(position, at[i]!)
      b.fromBufferAttribute(position, at[j]!)
      const distance = a.distanceTo(b)
      const uvDistance = Math.hypot(
        uv.getX(at[i]!) - uv.getX(at[j]!),
        uv.getY(at[i]!) - uv.getY(at[j]!),
      )
      expect(uvDistance).toBeCloseTo(distance, 5)
    }
  }
  expect(seen).toEqual(new Set(['horizontal', 'reveal', 'back']))
})
