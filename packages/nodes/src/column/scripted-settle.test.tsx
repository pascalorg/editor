import { expect, test } from 'bun:test'
import {
  artifactUrl,
  ColumnNode,
  GeometryArtifactManifest,
  LevelNode,
  useScene,
} from '@pascal-app/core'
import { useLoader } from '@react-three/fiber'
import { installMountedScene, LevelScene, mount, SceneSystems, settle } from '../__tests__/harness'
import { ItemGLTFLoader } from '../item/model-loader'

installMountedScene()

// A gate pier as an agent authors it: a plain square column, then its own three.js module.
const pier = {
  crossSection: 'square',
  depth: 0.68,
  height: 0.95,
  style: 'plain',
  width: 0.66,
} as const
const source = {
  kind: 'script' as const,
  script: 'b'.repeat(64),
  artifact: 'a'.repeat(64),
  manifest: GeometryArtifactManifest.parse({
    bounds: { min: [-0.39, 0, -0.39], max: [0.39, 0.99, 0.39] },
    triangles: 48,
  }),
}

test('a column built from a script settles once its model has loaded, as a parametric one does', async () => {
  const level = LevelNode.parse({ id: 'level_gate', children: ['column_scripted', 'column_plain'] })
  const scripted = ColumnNode.parse({ ...pier, id: 'column_scripted', parentId: level.id, source })
  const plain = ColumnNode.parse({ ...pier, id: 'column_plain', parentId: level.id })
  useScene.setState({
    nodes: { [level.id]: level, [scripted.id]: scripted, [plain.id]: plain },
    rootNodeIds: [level.id],
    dirtyNodes: new Set(),
  })
  useLoader.preload(ItemGLTFLoader, artifactUrl(source.artifact))
  await Promise.resolve()
  const renderer = await mount(
    <>
      <LevelScene level={level} />
      <SceneSystems />
    </>,
  )
  useScene.getState().markDirty(scripted.id)
  useScene.getState().markDirty(plain.id)
  await settle(renderer, 10)
  // What scene-ready and the 3D export wait on: no built-in node left dirty.
  expect([...useScene.getState().dirtyNodes]).toEqual([])
})
