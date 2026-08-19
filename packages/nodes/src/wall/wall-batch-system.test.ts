import { afterEach, describe, expect, test } from 'bun:test'
import { sceneRegistry, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { BufferGeometry, Float32BufferAttribute, Mesh, MeshBasicMaterial } from 'three'
import { collectTintedWalls, collectWallBatchCandidates } from './wall-batch-system'

const registeredIds: string[] = []

afterEach(() => {
  for (const id of registeredIds.splice(0)) {
    const mesh = sceneRegistry.nodes.get(id) as Mesh | undefined
    mesh?.geometry.dispose()
    const materials = Array.isArray(mesh?.material) ? mesh.material : [mesh?.material]
    for (const material of materials) material?.dispose()
    sceneRegistry.nodes.delete(id)
  }
  useScene.setState({ nodes: {}, rootNodeIds: [] } as never)
  useViewer.setState({ hoverHighlightMode: 'default', hoveredId: null } as never)
})

function registerWall(id: string) {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3))
  const mesh = new Mesh(geometry, [new MeshBasicMaterial()])
  sceneRegistry.nodes.set(id, mesh)
  registeredIds.push(id)
}

describe('collectWallBatchCandidates', () => {
  test('keeps tinted walls out when a stale level is re-sewn', () => {
    const wallIds = Array.from({ length: 10 }, (_, index) => `wall_${index}`)
    for (const id of wallIds) registerWall(id)

    useScene.setState({
      nodes: {
        level: { id: 'level', type: 'level', children: wallIds },
        ...Object.fromEntries(
          wallIds.map((id) => [id, { id, type: 'wall', parentId: 'level', visible: true }]),
        ),
      },
      rootNodeIds: ['level'],
    } as never)

    const tinted = new Set(wallIds.slice(0, 8))
    const candidates = [...collectWallBatchCandidates('level', tinted).values()].flat()

    expect(candidates.map((candidate) => candidate.nodeId)).toEqual(wallIds.slice(8))
  })
})

describe('collectTintedWalls', () => {
  // Regression: hover feedback for a wall is an outline, and the outline node
  // renders through the main camera — which never sees a sewn wall. A hovered
  // wall has to leave its batch or hovering it lights up nothing, in select
  // mode and in paint mode alike.
  const wallIds = new Set(['wall_a', 'wall_b'])

  test.each([
    'default',
    'paint-ready',
    'paint-disabled',
    'delete',
  ])('a %s hover takes the wall out of its batch', (hoverHighlightMode) => {
    useViewer.setState({ hoverHighlightMode, hoveredId: 'wall_a' } as never)

    expect([...collectTintedWalls(wallIds)]).toEqual(['wall_a'])
  })

  test('a hover over a non-wall node tints nothing', () => {
    useViewer.setState({ hoverHighlightMode: 'default', hoveredId: 'slab_a' } as never)

    expect([...collectTintedWalls(wallIds)]).toEqual([])
  })
})
