import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeDefinition,
  BuildingNode,
  createTerrainField,
  encodeTerrainField,
  LevelNode,
  nodeRegistry,
  RockNode,
  registerNode,
  SiteNode,
  SlabNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { exportSceneToGlb } from '@pascal-app/editor'
import { Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial, type Object3D } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { rockRenderDefinition } from './definition.render'
import { buildRockGeometry } from './geometry'

// Bun lacks FileReader. This is only the browser Blob transport required by three's actual
// GLTFExporter; geometry, hooks, preparation, serialization and GLTFLoader are all real.
class BlobReader {
  result: ArrayBuffer | null = null
  onloadend: (() => void) | null = null
  readAsArrayBuffer(blob: Blob) {
    void blob.arrayBuffer().then((buffer) => {
      this.result = buffer
      this.onloadend?.()
    })
  }
}
const globals = globalThis as unknown as Record<string, unknown>
let previousReader: unknown
let restoreRegistry: () => void
let previousNodes: Record<string, AnyNode>
const owned: Object3D[] = []

function meshes(root: Object3D) {
  const result: Mesh[] = []
  root.traverse((object) => {
    if (object instanceof Mesh) result.push(object)
  })
  return result
}

beforeEach(() => {
  previousReader = globals.FileReader
  globals.FileReader = BlobReader
  previousNodes = useScene.getState().nodes
  restoreRegistry = nodeRegistry._snapshot()
  nodeRegistry._reset()
  registerNode(rockRenderDefinition)
})

afterEach(() => {
  if (previousReader === undefined) delete globals.FileReader
  else globals.FileReader = previousReader
  useScene.setState({ nodes: previousNodes })
  sceneRegistry.clear()
  restoreRegistry()
  for (const root of owned.splice(0)) {
    for (const mesh of meshes(root)) {
      mesh.geometry.dispose()
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
        material.dispose()
    }
  }
})

async function roundTrip(root: Object3D, nodes: Record<string, AnyNode>) {
  const binary = await exportSceneToGlb(root, nodes, { timeoutMs: 5_000 })
  expect(new DataView(binary).getUint32(0, true)).toBe(0x46546c67)
  const loaded = await new GLTFLoader().parseAsync(binary, '')
  owned.push(loaded.scene)
  return loaded.scene
}

function scene(gen: 1 | 2, textures = true, ground: number | null = 2) {
  const field = createTerrainField({ origin: [0, 0], cols: 65, rows: 65, spacing: 0.5 })
  field.heights.fill(Math.round((ground ?? 0) / field.step))
  const site = SiteNode.parse({
    ...(ground === null ? {} : { terrain: encodeTerrainField(field) }),
    polygon: {
      type: 'polygon',
      points: [
        [0, 0],
        [32, 0],
        [32, 32],
        [0, 32],
      ],
    },
  })
  const rock = RockNode.parse({
    parentId: site.id,
    gen,
    height: 2.4,
    seed: 17,
    polygon: [
      [4, 4],
      [6, 4],
      [6, 6],
      [4, 6],
    ],
  })
  const building = BuildingNode.parse({ parentId: site.id })
  const level = LevelNode.parse({ parentId: building.id, level: 0 })
  const slab = SlabNode.parse({
    parentId: level.id,
    polygon: [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ],
    elevation: (ground ?? -0.05) + 1,
  })
  const nodes = {
    [site.id]: { ...site, children: [building.id, rock.id] },
    [building.id]: { ...building, children: [level.id] },
    [level.id]: { ...level, children: [slab.id] },
    [slab.id]: slab,
    [rock.id]: rock,
  }
  useScene.setState({ nodes })
  const live = buildRockGeometry(rock, { parent: site }, undefined, textures)
  if (gen === 1 && textures) {
    // Legacy look materials are shared in production. Own only a clone for fixture cleanup.
    for (const mesh of meshes(live)) mesh.material = (mesh.material as MeshStandardMaterial).clone()
  }
  const root = new Group()
  root.add(live)
  owned.push(root)
  sceneRegistry.nodes.set(rock.id, live)
  return { site, rock, root, live, nodes }
}

describe('real GLB export preserves the rock document and legacy presentation', () => {
  test('main flat Site export stays at -0.05 rather than climbing the intersecting slab', async () => {
    const { root, nodes } = scene(2, true, null)
    const exported = await roundTrip(root, nodes)
    expect(meshes(exported)).toHaveLength(1)
    const bounds = new Box3().setFromObject(exported)
    expect(bounds.min.y).toBeCloseTo(-0.35, 5)
    expect(bounds.max.y).toBeCloseTo(2.35, 5)
  })

  test('gen 2 uses captured persisted single-grid +2m terrain, not an absent live store', async () => {
    const { site, root, live, nodes } = scene(2)
    expect(site.terrain).toBeDefined()
    expect(new Box3().setFromObject(live).min.y).toBeCloseTo(1.7, 5)
    // Main has no TerrainTileNode. Keep the source snapshot isolation guarantee on its
    // persisted Site grid: an empty current store must not erase captured ground.
    useScene.setState({ nodes: {} })
    const exported = await roundTrip(root, nodes)
    expect(meshes(exported)).toHaveLength(1)
    const bounds = new Box3().setFromObject(exported)
    expect(bounds.min.y).toBeCloseTo(1.7, 5)
    expect(bounds.max.y).toBeCloseTo(4.4, 5)
    expect(new Box3().setFromObject(live).min.y).toBeCloseTo(1.7, 5)
  })

  // Baseline provenance: e2ca3a128 nodes/rock/{geometry,material}.ts and the existing
  // NodeMaterial export fallback: textured default white/.92; plain #a8a39a/.95.
  // Procedural strata/lichen were not serialized by that fallback; no new promise is made.
  for (const textures of [true, false]) {
    test(`gen 1 retains its ${textures ? 'textured' : 'plain'} legacy GLB material and mesh`, async () => {
      const { root, live, nodes } = scene(1, textures)
      const [source] = meshes(live)
      if (!source || Array.isArray(source.material))
        throw new Error('Expected one legacy rock material')
      const material = source.material as MeshStandardMaterial
      const positions = Array.from(source.geometry.getAttribute('position').array)
      const index = source.geometry.index ? Array.from(source.geometry.index.array) : null
      const expectedColor = textures ? 'ffffff' : 'a8a39a'
      const expectedRoughness = textures ? 0.92 : 0.95
      expect(material.color.getHexString()).toBe(expectedColor)
      expect(material.roughness).toBe(expectedRoughness)
      const exported = await roundTrip(root, nodes)
      expect(meshes(exported)).toHaveLength(1)
      const output = meshes(exported)[0]!
      const outputMaterial = output.material as MeshStandardMaterial
      expect(outputMaterial.color.getHexString()).toBe(expectedColor)
      expect(outputMaterial.roughness).toBeCloseTo(expectedRoughness, 8)
      expect(Array.from(output.geometry.getAttribute('position').array)).toEqual(positions)
      expect(output.geometry.index ? Array.from(output.geometry.index.array) : null).toEqual(index)
      expect(source.material).toBe(material)
      expect(Array.from(source.geometry.getAttribute('position').array)).toEqual(positions)
      expect(source.geometry.index ? Array.from(source.geometry.index.array) : null).toEqual(index)
    })
  }

  test('gen 1 preserves live presentation overrides rather than rebuilding its default material', async () => {
    const { root, live, nodes } = scene(1, false)
    const source = meshes(live)[0]!
    const material = source.material as MeshStandardMaterial
    material.color.set('#345678')
    material.roughness = 0.42
    material.opacity = 0.75
    material.transparent = true
    const exported = await roundTrip(root, nodes)
    const output = meshes(exported)[0]!.material as MeshStandardMaterial
    expect(output.color.getHexString()).toBe('345678')
    expect(output.roughness).toBeCloseTo(0.42, 8)
    expect(output.opacity).toBeCloseTo(0.75, 8)
    expect(output.transparent).toBe(true)
    expect(source.material).toBe(material)
    expect(material.color.getHexString()).toBe('345678')
    expect(material.roughness).toBe(0.42)
    expect(material.opacity).toBe(0.75)
  })

  test('a synchronous hook returning null retains the live clone in real GLB export', async () => {
    let calls = 0
    const kind = 'test:nullable-rock-bake'
    registerNode({
      kind,
      schemaVersion: 1,
      schema: RockNode,
      category: 'utility',
      defaults: () => ({}),
      capabilities: {},
      bake: 'replace',
      bakeGeometry: () => {
        calls += 1
        return null
      },
    } as AnyNodeDefinition)
    const node = {
      ...RockNode.parse({
        polygon: [
          [0, 0],
          [2, 0],
          [0, 2],
        ],
      }),
      type: kind,
    } as unknown as AnyNode
    const live = new Mesh(
      new BoxGeometry(2, 3, 4),
      new MeshStandardMaterial({ color: '#345678', roughness: 0.42 }),
    )
    live.position.set(1, 2, 3)
    const root = new Group()
    root.add(live)
    owned.push(root)
    sceneRegistry.nodes.set(node.id, live)
    const exported = await roundTrip(root, { [node.id]: node })
    expect(calls).toBe(1)
    expect(meshes(exported)).toHaveLength(1)
    expect(new Box3().setFromObject(exported)).toEqual(new Box3().setFromObject(root))
    expect((meshes(exported)[0]!.material as MeshStandardMaterial).color.getHexString()).toBe(
      '345678',
    )
    expect(root.children[0]).toBe(live)
  })
})
