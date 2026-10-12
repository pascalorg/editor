// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { afterEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  LevelNode,
  RoofNode,
  RoofSegmentNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import * as THREE from 'three'
import { runRoofClipFrame } from './roof-clip'

const STOREY = 3.05

/** A ground storey under a low porch roof and an upper storey whose room stands over the porch. */
function scene() {
  const nodes: Record<string, AnyNode> = {}
  const add = (node: AnyNode) => {
    nodes[node.id] = node
  }
  add(BuildingNode.parse({ id: 'building_a', type: 'building', children: ['level_0', 'level_1'] }))
  add(
    LevelNode.parse({
      id: 'level_0',
      type: 'level',
      parentId: 'building_a',
      level: 0,
      height: STOREY,
      children: ['roof_porch'],
    }),
  )
  add(
    LevelNode.parse({
      id: 'level_1',
      type: 'level',
      parentId: 'building_a',
      level: 1,
      height: 2.5,
      children: [],
    }),
  )
  add(
    RoofNode.parse({
      id: 'roof_porch',
      type: 'roof',
      parentId: 'level_0',
      position: [0, 0, 0],
      children: ['rseg_porch'],
    }),
  )
  add(
    RoofSegmentNode.parse({
      id: 'rseg_porch',
      type: 'roof-segment',
      parentId: 'roof_porch',
      roofType: 'shed',
      width: 4,
      depth: 4,
      pitch: 17,
      wallHeight: 2.2,
      overhang: 0,
      wallThickness: 0.1,
      deckThickness: 0.2,
      wallShell: 'omit',
    }),
  )
  useScene.setState({ nodes: nodes as Record<AnyNodeId, AnyNode> })

  const levels = (['level_0', 'level_1'] as const).map((id, index) => {
    const object = new THREE.Group()
    object.position.y = index * STOREY
    sceneRegistry.nodes.set(id, object)
    sceneRegistry.byType.level!.add(id)
    return object
  })
  const box = (level: THREE.Object3D, height: number) => {
    const geometry = new THREE.BoxGeometry(0.2, height, 0.2)
    geometry.translate(0, height / 2, 0)
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial())
    level.add(mesh)
    return mesh
  }
  const post = box(levels[0]!, 3)
  const upstairs = box(levels[1]!, 1)
  for (const level of levels) level.updateMatrixWorld(true)
  return { nodes, post, upstairs }
}

afterEach(() => {
  sceneRegistry.clear()
  useScene.setState({ nodes: {} as Record<AnyNodeId, AnyNode> })
})

describe('roof clip frame', () => {
  test('a room over a lower roof is left alone; the post under it is cut', () => {
    const { post, upstairs } = scene()
    const postSource = post.geometry
    const upstairsSource = upstairs.geometry
    runRoofClipFrame()
    expect(post.geometry).not.toBe(postSource)
    expect(upstairs.geometry).toBe(upstairsSource)
  })

  test('a roof that goes away gives the meshes it cut their own geometry back', () => {
    const { nodes, post } = scene()
    const source = post.geometry
    runRoofClipFrame()
    expect(post.geometry).not.toBe(source)
    const { roof_porch: _roof, rseg_porch: _segment, ...rest } = nodes
    useScene.setState({
      nodes: {
        ...rest,
        level_0: { ...nodes.level_0, children: [] },
      } as unknown as Record<AnyNodeId, AnyNode>,
    })
    runRoofClipFrame()
    expect(post.geometry).toBe(source)
  })

  test('a mesh taken off the scene drops its cut copy', () => {
    const { post } = scene()
    const source = post.geometry
    runRoofClipFrame()
    const cut = post.geometry
    let disposed = false
    cut.addEventListener('dispose', () => {
      disposed = true
    })
    post.removeFromParent()
    runRoofClipFrame()
    expect(disposed).toBe(true)
    expect(post.geometry).toBe(source)
  })
})
