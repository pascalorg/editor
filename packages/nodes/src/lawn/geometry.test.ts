import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  buildLawn,
  type GeometryContext,
  LawnBuildError,
  LawnNode,
  PlantingNode,
  plantingContains,
  plantingOrganicOutline,
  SiteNode,
  SlabNode,
  useScene,
} from '@pascal-app/core'
import { Group, Mesh, PerspectiveCamera } from 'three'
import { buildLawnBakeGeometry } from './bake-geometry'
import { lawnBladePoint } from './blade-shape'
import { buildLawnFloorplan } from './floorplan'
import { buildLawnGeometry, disposeLawnGeometry } from './geometry'
import { lawnsOnChangedScene } from './ground-invalidation'
import { updateLawnLOD } from './lod'
import { buildLawnReplacementGeometry } from './static-renderer'

function fixture(size = 10, id = 'lawn_test') {
  const lawn = LawnNode.parse({
    id,
    parentId: 'site_test',
    outline: [
      [0, 0],
      [size, 0],
      [size, size],
      [0, size],
    ],
  })
  const site = SiteNode.parse({
    id: 'site_test',
    children: [lawn.id],
    polygon: { type: 'polygon', points: lawn.outline },
  })
  const nodes: Record<string, AnyNode> = { [site.id]: site, [lawn.id]: lawn }
  const resolve: GeometryContext['resolve'] = <N = AnyNode>(id: string) =>
    nodes[id] as N | undefined
  const context = { parent: site, sceneNodes: nodes, resolve }
  return { lawn, site, nodes, context }
}

function meshes(group: Group): Mesh[] {
  const result: Mesh[] = []
  group.traverse((object) => {
    if (object instanceof Mesh) result.push(object)
  })
  return result
}

function cameraAt(distance: number, center = 5) {
  const camera = new PerspectiveCamera(45, 1, 0.01, 10000)
  camera.position.set(center, distance, center)
  camera.lookAt(center, 0, center)
  camera.updateMatrixWorld()
  return camera
}

describe('lawn render adapter', () => {
  test('a later patio may cover a saved lawn without crashing render, plan or portable export', () => {
    const { lawn, nodes, site, context } = fixture()
    const initial = buildLawnGeometry(lawn, context)
    expect(meshes(initial).length).toBeGreaterThan(0)
    disposeLawnGeometry(initial)
    const patio = SlabNode.parse({
      id: 'slab_covering_patio',
      parentId: site.id,
      polygon: lawn.outline,
      metadata: { flatwork: 'patio' },
    })
    const parent = { ...site, children: [...site.children, patio.id] }
    const snapshot = { ...nodes, [parent.id]: parent, [patio.id]: patio }
    const covered = { parent, sceneNodes: snapshot }
    const geometry = buildLawnGeometry(lawn, covered)
    const baked = buildLawnBakeGeometry(lawn, covered)
    expect(meshes(geometry)).toHaveLength(0)
    expect(meshes(baked)).toHaveLength(0)
    expect(buildLawnFloorplan(lawn, covered)).toBeNull()
    let refusal: unknown
    try {
      buildLawn(lawn, snapshot)
    } catch (error) {
      refusal = error
    }
    expect(refusal).toBeInstanceOf(LawnBuildError)
    if (refusal instanceof LawnBuildError) expect(refusal.code).toBe('lawn_empty')
    disposeLawnGeometry(geometry)
    disposeLawnGeometry(baked)
  })

  test('render adapters do not conceal work-budget or validation failures as empty lawns', () => {
    const { lawn, site } = fixture()
    const outline: [number, number][] = [
      [0, 0],
      [70, 70],
      [63, 77],
      [-7, 7],
    ]
    const large = LawnNode.parse({ ...lawn, outline })
    const parent = SiteNode.parse({ ...site, polygon: { type: 'polygon', points: outline } })
    const context = { parent, sceneNodes: { [parent.id]: parent, [large.id]: large } }
    expect(() => buildLawnGeometry(large, context)).toThrow(LawnBuildError)
    expect(() => buildLawnFloorplan(large, context)).toThrow(LawnBuildError)
    expect(() => buildLawnBakeGeometry(large, context)).toThrow(LawnBuildError)
    const invalid = { ...lawn, height: Number.NaN }
    expect(() => buildLawnGeometry(invalid, context)).toThrow()
    expect(() => buildLawnFloorplan(invalid, context)).toThrow()
    expect(() => buildLawnBakeGeometry(invalid, context)).toThrow()
  })

  test('camera-only changes retain population buffers and far submits only ground', () => {
    const { lawn, context } = fixture()
    const group = buildLawnGeometry(lawn, context)
    const blades = meshes(group).filter((mesh) => mesh.name.startsWith('lawn-blades'))
    const attributes = blades.map((mesh) => mesh.geometry.getAttribute('lawnRootHeight'))
    const near = updateLawnLOD(group, cameraAt(1), 1000)
    expect(near.near).toBeGreaterThan(0)
    const mid = updateLawnLOD(group, cameraAt(60), 1000)
    expect(mid.mid).toBeGreaterThan(0)
    expect(mid.near).toBe(0)
    const far = updateLawnLOD(group, cameraAt(1000), 1000)
    expect(far).toEqual({ near: 0, mid: 0, flowers: 0 })
    expect(blades.every((mesh) => !mesh.visible)).toBe(true)
    blades.forEach((mesh, index) => {
      expect(mesh.geometry.getAttribute('lawnRootHeight')).toBe(attributes[index])
    })
    expect(meshes(group).find((mesh) => mesh.name === 'lawn-ground')?.visible).toBe(true)
    disposeLawnGeometry(group)
  })

  test('detail remains discoverable when the geometry system adopts built children', () => {
    const { lawn, context } = fixture()
    const built = buildLawnGeometry(lawn, context)
    const mounted = new Group()
    for (const child of [...built.children]) mounted.add(child)
    expect(updateLawnLOD(mounted, cameraAt(1), 1000).near).toBeGreaterThan(0)
    disposeLawnGeometry(mounted)
  })

  test('two lawns share view budgets rather than resetting caps for each node', () => {
    const scene = new Group()
    for (const id of ['lawn_one', 'lawn_two']) {
      const { lawn, context } = fixture(40, id)
      scene.add(buildLawnGeometry(lawn, context))
    }
    const counts = updateLawnLOD(scene, cameraAt(80), 10000)
    expect(counts.near).toBeGreaterThan(0)
    expect(counts.near).toBe(64000)
    for (const mesh of meshes(scene).filter((mesh) => mesh.name.startsWith('lawn-blades-near'))) {
      expect(mesh.visible).toBe(true)
      const count = 'instanceCount' in mesh.geometry ? Number(mesh.geometry.instanceCount) : 0
      expect(count / mesh.geometry.getAttribute('lawnRootHeight').count).toBeGreaterThan(0.15)
    }
    expect(counts.mid).toBeLessThanOrEqual(32000)
    expect(counts.flowers).toBeLessThanOrEqual(1024)
    const mid = updateLawnLOD(scene, cameraAt(80), 1000)
    expect(mid.near).toBe(0)
    expect(mid.mid).toBe(32000)
    for (const child of scene.children) disposeLawnGeometry(child)
  })

  test('ground is opaque, detail uses two packed instance streams and owns disposal', () => {
    const { lawn, context } = fixture()
    const group = buildLawnGeometry(lawn, context)
    const ground = meshes(group).find((mesh) => mesh.name === 'lawn-ground')
    expect(ground).toBeDefined()
    const material = ground?.material
    expect(Array.isArray(material)).toBe(false)
    if (material && !Array.isArray(material)) {
      expect(material.transparent).toBe(false)
      expect(material.depthWrite).toBe(true)
    }
    const blade = meshes(group).find((mesh) => mesh.name.startsWith('lawn-blades-near'))
    expect(blade).toBeDefined()
    expect(Object.keys(blade?.geometry.attributes ?? {}).sort()).toEqual([
      'lawnRootHeight',
      'lawnTraits',
      'normal',
      'position',
    ])
    let disposed = 0
    ground?.geometry.addEventListener('dispose', () => {
      disposed++
    })
    disposeLawnGeometry(group)
    disposeLawnGeometry(group)
    expect(disposed).toBe(1)
  })

  test('complete flower heads share one view cap across multiple lawns', () => {
    const scene = new Group()
    let canonicalHeads = 0
    for (const id of ['lawn_flower_one', 'lawn_flower_two']) {
      const { lawn, context, nodes } = fixture(40, id)
      const flowering = LawnNode.parse({
        ...lawn,
        density: 1,
        flowerDensity: 2,
        flowers: [{ species: 'daisy', share: 1 }],
      })
      canonicalHeads += buildLawn(flowering, nodes).flowers.count
      scene.add(buildLawnGeometry(flowering, context))
    }
    const counts = updateLawnLOD(scene, cameraAt(80), 10000)
    expect(canonicalHeads).toBeGreaterThan(1024)
    expect(counts.flowers).toBe(1024)
    expect(
      meshes(scene).filter((mesh) => mesh.name === 'lawn-flowers' && mesh.visible),
    ).toHaveLength(2)
    const drawnIndices = meshes(scene)
      .filter((mesh) => mesh.name === 'lawn-flowers' && mesh.visible)
      .reduce((sum, mesh) => sum + mesh.geometry.drawRange.count, 0)
    expect(drawnIndices).toBeLessThanOrEqual(1024 * 64 * 3)
    expect(updateLawnLOD(scene, cameraAt(1000), 1000).flowers).toBe(0)
    expect(
      meshes(scene)
        .filter((mesh) => mesh.name === 'lawn-flowers')
        .every((mesh) => !mesh.visible),
    ).toBe(true)
    for (const child of scene.children) disposeLawnGeometry(child)
  })

  test('wind and rest curvature keep roots fixed and finite', () => {
    for (const time of [0, 1, 15]) {
      expect(lawnBladePoint(0, 0, 0.06, 0, 0.2, 1, time, 4, 8)).toEqual([0, 0, 0])
      expect(lawnBladePoint(0.004, 0, 0.06, 1, 0.2, 1, time, 4, 8)).toEqual(
        lawnBladePoint(0.004, 0, 0.06, 1, 0.2, 0, 0, 4, 8),
      )
      expect(lawnBladePoint(0, 1, 0.06, 1, 0, 0, time, 4, 8).every(Number.isFinite)).toBe(true)
    }
    const calm = lawnBladePoint(0, 1, 0.3, 1, 0.5, 0, 2, 4, 8)
    const windy = lawnBladePoint(0, 1, 0.3, 1, 0.5, 1, 2, 4, 8)
    expect(calm).not.toEqual(windy)
    const neighbor = lawnBladePoint(0, 1, 0.3, 1, 0.5, 1, 2, 4.01, 8)
    expect(Math.hypot(windy[0] - neighbor[0], windy[2] - neighbor[2])).toBeLessThan(0.001)
  })

  test('portable bake expands the canonical population independent of live LOD', () => {
    const { lawn, context, nodes } = fixture()
    const saved = JSON.stringify(nodes)
    const canonical = buildLawn(lawn, nodes)
    const live = buildLawnGeometry(lawn, context)
    updateLawnLOD(live, cameraAt(1000), 1000)
    const baked = buildLawnBakeGeometry(lawn, context)
    const bakedMeshes = meshes(baked)
    expect(bakedMeshes.some((mesh) => mesh.name === 'lawn-ground')).toBe(true)
    const bladeIndices = bakedMeshes
      .filter((mesh) => mesh.name.startsWith('lawn-blades'))
      .reduce((sum, mesh) => sum + (mesh.geometry.index?.count ?? 0), 0)
    expect(bladeIndices).toBe(canonical.blades.count * 36)
    for (const mesh of bakedMeshes) {
      expect(mesh.geometry.type).toBe('BufferGeometry')
      expect(mesh.geometry.index?.array.BYTES_PER_ELEMENT).toBe(2)
      expect(mesh.geometry.getAttribute('lawnRootHeight')).toBeUndefined()
      expect(Array.isArray(mesh.material)).toBe(false)
      if (!Array.isArray(mesh.material)) expect(mesh.material.type).toBe('MeshStandardMaterial')
    }
    disposeLawnGeometry(live)
    disposeLawnGeometry(baked)
    expect(JSON.stringify(nodes)).toBe(saved)
  })

  // Keep the real 1,600 m² fixture; its bake now also rasterizes portable ground maps.
  test('portable flowers split at the 16-bit vertex limit without losing geometry', () => {
    const { lawn, context, nodes } = fixture(40)
    const flowering = LawnNode.parse({
      ...lawn,
      density: 1,
      flowerDensity: 2,
      flowers: [{ species: 'clover', share: 1 }],
    })
    const canonical = buildLawn(flowering, nodes)
    const group = buildLawnBakeGeometry(flowering, context)
    const flowers = meshes(group).filter((mesh) => mesh.name.startsWith('lawn-flowers'))
    expect(flowers.length).toBeGreaterThan(1)
    expect(flowers.reduce((count, mesh) => count + (mesh.geometry.index?.count ?? 0), 0)).toBe(
      canonical.flowers.indices.length,
    )
    for (const mesh of flowers) {
      expect(mesh.geometry.getAttribute('position').count).toBeLessThanOrEqual(65535)
      expect(mesh.geometry.index?.array.BYTES_PER_ELEMENT).toBe(2)
    }
    disposeLawnGeometry(group)
  }, 30_000)

  test('the plan uses retained holes and scene changes are Site scoped', () => {
    const { lawn, context, nodes, site } = fixture()
    const plan = buildLawnFloorplan(lawn, context)
    expect(plan?.kind).toBe('group')
    if (plan?.kind === 'group')
      expect(plan.children[0]).toMatchObject({ kind: 'path', fillRule: 'evenodd' })
    const previous = lawnsOnChangedScene(nodes, new Map()).parts
    const unrelated = SiteNode.parse({
      id: 'site_other',
      polygon: {
        type: 'polygon',
        points: [
          [0, 0],
          [1, 0],
          [0, 1],
        ],
      },
    })
    expect(lawnsOnChangedScene({ ...nodes, [unrelated.id]: unrelated }, previous).dirty).toEqual([])
    const changed = SiteNode.parse({
      ...site,
      polygon: {
        type: 'polygon',
        points: [
          [0, 0],
          [9, 0],
          [9, 9],
          [0, 9],
        ],
      },
    })
    expect(lawnsOnChangedScene({ ...nodes, [site.id]: changed }, previous).dirty).toEqual([lawn.id])
  })

  test('retained planting-bed holes survive the vector plan and resolver-only replacement', () => {
    const { lawn, nodes, site } = fixture()
    const bed = PlantingNode.parse({
      id: 'planting_bed',
      parentId: site.id,
      outline: [
        [3, 3],
        [5, 3],
        [5, 5],
        [3, 5],
      ],
    })
    const snapshot = {
      ...nodes,
      [bed.id]: bed,
      [site.id]: { ...site, children: [...site.children, bed.id] },
    }
    const resolve: GeometryContext['resolve'] = <N = AnyNode>(id: string) =>
      snapshot[id] as N | undefined
    const plan = buildLawnFloorplan(lawn, { resolve })
    expect(plan?.kind).toBe('group')
    if (plan?.kind === 'group') {
      const body = plan.children[0]
      expect(body?.kind).toBe('path')
      if (body?.kind === 'path') expect(body.d.match(/M/g)?.length).toBe(2)
    }
    const group = buildLawnReplacementGeometry([lawn], resolve)
    const ground = meshes(group).find((mesh) => mesh.name === 'lawn-ground')
    expect(ground).toBeDefined()
    const bedOutline = plantingOrganicOutline(bed.outline ?? [], bed.seed)
    const position = ground?.geometry.getAttribute('position')
    const indices = ground?.geometry.index
    for (let index = 0; indices && position && index < indices.count; index += 3) {
      const corners = [0, 1, 2].map((corner) => indices.getX(index + corner))
      const x = corners.reduce((sum, corner) => sum + position.getX(corner), 0) / 3
      const z = corners.reduce((sum, corner) => sum + position.getZ(corner), 0) / 3
      expect(plantingContains(bedOutline, x, z)).toBe(false)
    }
    disposeLawnGeometry(group)
  })

  test('baked replacement reads its resolver while the live store is empty', () => {
    const { lawn, context } = fixture(2)
    const before = useScene.getState()
    useScene.setState({ nodes: {} })
    try {
      const group = buildLawnReplacementGeometry([lawn], context.resolve)
      expect(meshes(group).filter((mesh) => mesh.name === 'lawn-ground')).toHaveLength(1)
      expect(updateLawnLOD(group, cameraAt(1, 1), 1000).near).toBeGreaterThan(0)
      expect(useScene.getState().nodes).toEqual({})
      disposeLawnGeometry(group)
    } finally {
      useScene.setState(before)
    }
  })
})

test('live flowers carry the normals and colours of the generator, one rounded byte a channel', () => {
  const { lawn, context, nodes } = fixture(6)
  const flowering = LawnNode.parse({
    ...lawn,
    flowerDensity: 2,
    flowers: [{ species: 'daisy', share: 1 }],
  })
  const canonical = buildLawn(flowering, nodes).flowers
  const group = buildLawnGeometry(flowering, context)
  try {
    const [flowers] = meshes(group).filter((mesh) => mesh.name === 'lawn-flowers')
    if (!flowers) throw new Error('A flowering lawn builds a flower mesh')
    expect(canonical.normals.length).toBeGreaterThan(0)
    const normal = flowers.geometry.getAttribute('normal')
    const color = flowers.geometry.getAttribute('color')
    expect(normal.normalized && color.normalized).toBe(true)
    expect(normal.array).toEqual(
      new Int8Array(Array.from(canonical.normals, (channel) => Math.round(channel * 127))),
    )
    expect(color.array).toEqual(
      new Uint8Array(Array.from(canonical.colors, (channel) => Math.round(channel * 255))),
    )
  } finally {
    disposeLawnGeometry(group)
  }
})
