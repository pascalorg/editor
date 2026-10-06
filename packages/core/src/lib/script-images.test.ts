import { afterEach, expect, test } from 'bun:test'
import { addObject, applySceneChanges } from '../agent-operations'
import {
  type CompiledGeometryScript,
  DoorNode,
  GeometryArtifactManifest,
  GeometryScriptSource,
  ItemNode,
  LevelNode,
} from '../schema'
import { configureArtifactStore } from './artifact-store'
import { loadAssetUrl } from './asset-storage'
import { scriptImages } from './geometry-script-node'

const glb = 'a'.repeat(64)
const compiled: CompiledGeometryScript = {
  sha256: glb,
  script: 'b'.repeat(64),
  mount: 'floor',
  params: {},
  manifest: GeometryArtifactManifest.parse({
    bounds: { min: [-0.5, 0, -0.25], max: [0.5, 0.8, 0.25] },
    triangles: 12,
  }),
}
const images = { artifact: glb, thumbnail: 'c'.repeat(64), floorPlan: 'd'.repeat(64) }

const level = LevelNode.parse({ id: 'level_script_images' })
const nodes = { [level.id]: level }

afterEach(() => configureArtifactStore(null))

function created(): ItemNode {
  const { changes, result } = addObject(nodes, { compiled }, { activeLevelId: level.id })
  return ItemNode.parse(applySceneChanges(nodes, changes)[result.nodeId as string])
}

test('a scripted source saved before images existed still parses, without images', () => {
  const { images: _images, ...stored } = GeometryScriptSource.parse({
    kind: 'script',
    script: compiled.script,
    artifact: glb,
    manifest: compiled.manifest,
  })
  const node = ItemNode.parse({ ...created(), source: stored })
  expect(node.source?.images).toBeUndefined()
  expect(scriptImages(node)).toBeNull()
})

test('images taken of the current GLB are the node’s, as artifact URLs', () => {
  const node = ItemNode.parse({ ...created(), source: { ...created().source, images } })
  expect(scriptImages(node)).toEqual({
    thumbnail: `artifact://${images.thumbnail}`,
    floorPlan: `artifact://${images.floorPlan}`,
  })
  const door = DoorNode.parse({ id: 'door_script_images', source: node.source })
  expect(scriptImages(door)?.thumbnail).toBe(`artifact://${images.thumbnail}`)
})

test('images of an earlier GLB do not describe a rebuilt node', () => {
  const node = { ...created(), source: { ...created().source!, images } }
  const before = { ...nodes, [node.id]: node }
  const rebuilt = addObject(
    before,
    { nodeId: node.id, compiled: { ...compiled, sha256: 'e'.repeat(64) } },
    { activeLevelId: level.id },
  )
  const after = ItemNode.parse(applySceneChanges(before, rebuilt.changes)[node.id])
  expect(scriptImages(after)).toBeNull()
  expect(scriptImages({ ...after, source: { ...after.source!, images } })).toBeNull()
})

test('malformed image hashes are refused', () => {
  expect(() =>
    GeometryScriptSource.parse({ ...created().source, images: { ...images, thumbnail: 'x' } }),
  ).toThrow()
})

test('an artifact URL loads through the configured artifact store', async () => {
  configureArtifactStore({
    url: (sha256) => `/api/projects/p/artifacts/${sha256}`,
    put: async () => {},
    text: async () => null,
  })
  expect(await loadAssetUrl(`artifact://${images.thumbnail}`)).toBe(
    `/api/projects/p/artifacts/${images.thumbnail}`,
  )
  expect(await loadAssetUrl('artifact://not-a-hash')).toBeNull()
})
