import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type ArtifactStore,
  artifactUrl,
  BuildingNode,
  GeometryArtifactManifest,
  generateId,
  ItemNode,
  LevelNode,
  scriptSource,
} from '@pascal-app/core'
import {
  captureRegistryVersions,
  effectIds,
  openDetachedScene,
  SceneEnvironmentDisposedError,
  type SceneSnapshot,
} from '@pascal-app/core/runtime'
import { compileAndStoreGeometryScript } from './author'

// A compile of an object for a detached scene reads the scene and mints the object's id before
// its first await: the scene records those reads and allocates that id in its synchronous scope,
// and a compile that resolves after the scene is disposed reaches nothing of it.

const sha = 'a'.repeat(64)
const compiled = {
  sha256: sha,
  script: 'b'.repeat(64),
  language: 'three' as const,
  mount: 'floor' as const,
  params: {},
  manifest: GeometryArtifactManifest.parse({
    bounds: { min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] },
    triangles: 12,
  }),
}

function scene() {
  const screen = ItemNode.parse({
    id: 'item_screen',
    parentId: 'level_0',
    name: 'Screen',
    source: scriptSource(compiled),
    asset: {
      id: 'script_screen',
      category: 'screen',
      name: 'Screen',
      thumbnail: '',
      source: 'mine',
      src: artifactUrl(sha),
      dimensions: [1, 1, 1],
    },
  })
  const level = LevelNode.parse({ id: 'level_0', parentId: 'building_0', children: [screen.id] })
  const building = BuildingNode.parse({ id: 'building_0', children: [level.id] })
  const snapshot = {
    nodes: Object.fromEntries([building, level, screen].map((node) => [node.id, node])),
    rootNodeIds: [building.id],
    collections: {},
    materials: {},
    installedPlugins: [],
  } as unknown as SceneSnapshot
  return openDetachedScene(snapshot, {
    base: { kind: 'authority', seq: 1 },
    context: {
      activeLevelId: 'level_0',
      selection: [],
      units: 'metric',
      catalogVersion: 'test',
      registryVersions: captureRegistryVersions(),
    },
    ids: effectIds('effect_compile'),
  })
}

const artifacts = {
  url: () => null,
  put: async (hash: string) => hash,
  text: async () => 'export default function build() {}',
} as unknown as ArtifactStore

describe('compileAndStoreGeometryScript on a detached scene', () => {
  test('reads the node it rebuilds before the first await', async () => {
    const detached = scene()
    const compiling = detached.run(() =>
      compileAndStoreGeometryScript(
        { nodeId: 'item_screen', params: {} },
        { nodes: detached.reader().nodes as Record<string, AnyNode>, artifacts },
      ),
    )
    expect(detached.dependencies()).toContainEqual(
      expect.objectContaining({ kind: 'node', id: 'item_screen' }),
    )
    detached.dispose()
    const error = await compiling.catch((thrown: unknown) => thrown)
    expect(error).not.toBeInstanceOf(SceneEnvironmentDisposedError)
  })

  test("mints a new object's id in the scene's scope, before the first await", async () => {
    const detached = scene()
    const next = detached.run(() => {
      void compileAndStoreGeometryScript(
        { code: 'export default function build() {}', kind: 'item' },
        { nodes: detached.reader().nodes as Record<string, AnyNode>, artifacts },
      ).catch(() => {})
      return generateId('item')
    })
    const ids = effectIds('effect_compile')
    ids('item')
    expect(next as string).toBe(ids('item'))
    detached.dispose()
  })
})
