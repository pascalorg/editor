import { expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeDefinition,
  nodeRegistry,
  RockNode,
  registerNode,
  sceneRegistry,
} from '@pascal-app/core'
import { Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three'
import { prepareSceneForExport, prepareSceneForExportAsync } from './glb-export'

// A null synchronous bake result means "keep the cloned live subtree", in both preparation
// entrypoints. The generic contract is tested separately from the production rock hook.
for (const mode of ['sync', 'async'] as const) {
  test(`${mode} export preparation retains the live subtree when its bake hook declines`, async () => {
    const restoreRegistry = nodeRegistry._snapshot()
    const geometry = new BoxGeometry(2, 3, 4)
    const material = new MeshStandardMaterial({ color: '#345678', roughness: 0.42 })
    const source = new Mesh(geometry, material)
    source.position.set(1, 2, 3)
    const root = new Group()
    root.add(source)
    const kind = 'test:nullable-bake'
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
    let calls = 0
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
    sceneRegistry.nodes.set(node.id, source)
    try {
      const prepare = mode === 'sync' ? prepareSceneForExport : prepareSceneForExportAsync
      const prepared = await prepare(root, { [node.id]: node })
      try {
        expect(calls).toBe(1)
        const exported = prepared.scene.getObjectByName(node.id) as Mesh
        expect(exported).toBeDefined()
        expect(exported).not.toBe(source)
        expect(new Box3().setFromObject(exported)).toEqual(new Box3().setFromObject(source))
        expect((exported.material as MeshStandardMaterial).color.getHexString()).toBe('345678')
        expect((exported.material as MeshStandardMaterial).roughness).toBe(0.42)
      } finally {
        prepared.dispose()
      }
      expect(root.children).toEqual([source])
      expect(source.geometry).toBe(geometry)
      expect(source.material).toBe(material)
      expect(material.color.getHexString()).toBe('345678')
      expect(material.roughness).toBe(0.42)
    } finally {
      sceneRegistry.clear()
      restoreRegistry()
      geometry.dispose()
      material.dispose()
    }
  })
}
