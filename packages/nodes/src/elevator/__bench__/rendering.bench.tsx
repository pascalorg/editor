// Run: bun test ./packages/nodes/src/elevator/__bench__/rendering.bench.tsx
import { test } from 'bun:test'
import { BuildingNode, ElevatorNode, LevelNode, useScene } from '@pascal-app/core'
import { InstancedMesh, Mesh } from 'three'
import { installMountedScene, mount } from '../../__tests__/harness'
import { ElevatorRenderer } from '../renderer'

installMountedScene()
test('reports elevator mesh and triangle counts for two and twenty floors', async () => {
  for (const count of [2, 20]) {
    const building = BuildingNode.parse({})
    const levels = Array.from({ length: count }, (_, level) =>
      LevelNode.parse({ parentId: building.id, level, height: 3 }),
    )
    const node = ElevatorNode.parse({
      parentId: building.id,
      fromLevelId: levels[0]!.id,
      toLevelId: levels.at(-1)!.id,
    })
    building.children = [...levels.map((level) => level.id), node.id]
    useScene.setState({
      nodes: Object.fromEntries([building, ...levels, node].map((n) => [n.id, n])),
    })
    const renderer = await mount(<ElevatorRenderer node={node} />)
    let meshes = 0,
      triangles = 0
    renderer.scene.instance.traverse((object) => {
      if (object instanceof Mesh) {
        meshes++
        triangles +=
          ((object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3) *
          (object instanceof InstancedMesh ? object.count : 1)
      }
    })
    console.log(JSON.stringify({ floors: count, meshes, triangles }))
    await renderer.unmount()
  }
})
