import { beforeEach, expect, test } from 'bun:test'
import { SiteNode, SlabNode, sceneRegistry, TreeNode, useScene } from '@pascal-app/core'
import { disposeObject3DResources, NodeRenderer } from '@pascal-app/viewer'
import { act } from '@react-three/test-renderer'
import { Mesh, Vector3 } from 'three'
import { GeometrySystem, installMountedScene, mount, settle } from '../__tests__/harness'
import { treeDefinition } from './definition'
import TreeGroundSystem from './system'

installMountedScene({ nodes: [treeDefinition] })
const site = SiteNode.parse({ id: 'site_tree_render', children: ['tree_render', 'slab_tree_lawn'] })
const tree = TreeNode.parse({
  id: 'tree_render',
  parentId: site.id,
  position: [12, 0, 7],
  seed: 29,
})
const lawn = SlabNode.parse({
  id: 'slab_tree_lawn',
  parentId: site.id,
  polygon: [
    [10, 5],
    [14, 5],
    [14, 9],
    [10, 9],
  ],
  elevation: 0.6,
})
beforeEach(() => {
  useScene.setState({
    nodes: { [site.id]: site, [tree.id]: tree, [lawn.id]: lawn },
    rootNodeIds: [site.id],
    readOnly: false,
    dirtyNodes: new Set(),
  })
})

function renderedTree() {
  const root = sceneRegistry.nodes.get(tree.id)
  if (!root) throw new Error('The generic renderer did not register the tree')
  const meshes: Mesh[] = []
  root.traverse((object) => {
    if (object instanceof Mesh) meshes.push(object)
  })
  expect(meshes).toHaveLength(1)
  const mesh = meshes[0]
  if (!mesh) throw new Error('Missing rendered tree mesh')
  root.updateMatrixWorld(true)
  return { root, mesh }
}

test('the real generic renderer translates the local tree once, not twice', async () => {
  const renderer = await mount(
    <>
      <NodeRenderer nodeId={tree.id} />
      <GeometrySystem />
    </>,
  )
  await settle(renderer)
  const { root, mesh } = renderedTree()
  try {
    expect(root.position.toArray()).toEqual([12, 0, 7])
    expect(mesh.getWorldPosition(new Vector3()).toArray()).toEqual([12, 0.6, 7])
    expect(mesh.geometry.boundingBox?.min.x).toBeLessThan(0)
    expect(mesh.geometry.boundingBox?.max.x).toBeGreaterThan(0)
  } finally {
    disposeObject3DResources(root)
  }
})

test('a support edit dirties and lifts the actual mesh without changing the stored tree', async () => {
  const renderer = await mount(
    <>
      <NodeRenderer nodeId={tree.id} />
      <GeometrySystem />
      <TreeGroundSystem />
    </>,
  )
  await settle(renderer)
  const original = renderedTree()
  await act(async () => useScene.getState().updateNode(lawn.id, { elevation: 1.4 }))
  await settle(renderer)
  const rebuilt = renderedTree()
  try {
    expect(rebuilt.mesh.geometry).toBe(original.mesh.geometry)
    expect(rebuilt.mesh.getWorldPosition(new Vector3()).toArray()).toEqual([12, 1.4, 7])
    expect(useScene.getState().nodes[tree.id]).toBe(tree)
    expect(useScene.getState().nodes[tree.id]).toMatchObject({ position: [12, 0, 7] })
  } finally {
    disposeObject3DResources(rebuilt.root)
  }
})

test('unmounting the renderer releases the last geometry owner without an explicit scene disposer', async () => {
  const renderer = await mount(
    <>
      <NodeRenderer nodeId={tree.id} />
      <GeometrySystem />
    </>,
  )
  await settle(renderer)
  const { mesh } = renderedTree()
  let disposals = 0
  mesh.geometry.addEventListener('dispose', () => disposals++)
  await renderer.unmount()
  expect(disposals).toBe(1)
})
