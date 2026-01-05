import { initScene, type Scene, SceneNode } from '@pascal/core'
import { SceneGraph } from '@pascal/core/scenegraph'
import { BuildingNode } from '@pascal/core/scenegraph/schema/nodes/building'
import { LevelNode } from '@pascal/core/scenegraph/schema/nodes/level'
import { SiteNode } from '@pascal/core/scenegraph/schema/nodes/site'
import { WallNode } from '@pascal/core/scenegraph/schema/nodes/wall'

console.log('=== Initializing scene ===')
const scene = initScene()
console.log('scene before create')
// console.dir(scene, { depth: null })
// console.log(scene)
// Create a structure: Site -> Building -> Level -> Wall
const wall1 = WallNode.parse({
  children: [],
  start: [0, 0],
  end: [10, 0],
  position: [0, 0],
  size: [10, 0.2],
  rotation: 0,
  // BaseNode properties might be needed if not defaulted?
  // BaseNode usually has id, type defaults?
  // BaseNode in schema/base.ts usually defines defaults for id/type if using nodeId helper.
  // But parse might require them if they are not optional?
  // Zod .parse() on a schema with defaults will use defaults if undefined.
})

const level1 = LevelNode.parse({
  children: [wall1],
  elevation: 0,
  height: 3,
})

const building1 = BuildingNode.parse({
  children: [level1],
  position: [0, 0],
  rotation: 0,
})

const site1 = SiteNode.parse({
  children: [building1],
  // Ensure site has an ID if we want to query by it later
})

// Replace default site
scene.root.children = [site1]

const graph = new SceneGraph(scene)
console.log(graph)

console.log('graph index before delete')
console.dir(graph.index, { depth: null })

console.log('=== Testing Find API ===')

// Find all walls
const walls = graph.nodes.find({ type: 'wall' })
const firstWall = walls[0]
if (firstWall) {
  console.log('Deleting first wall...')
  firstWall.delete()
  // Re-query to check length
  const remainingWalls = graph.nodes.find({ type: 'wall' })
  console.log(`Found ${remainingWalls.length} walls (expected 0)`)
}

console.log('graph index after delete')
console.dir(graph.index, { depth: null })

// Find nodes in building
const buildingNodes = graph.nodes.find({ buildingId: building1.id })
console.log(
  `Found ${buildingNodes.length} nodes in building (expected 2: level and the building itself, wall was deleted)`,
)

console.log('buildingNodes', buildingNodes)

console.log('buildings', graph.nodes.find({ type: 'building' }))

console.log('graph index after update')
console.dir(graph.index, { depth: null })

// Find walls in specific level
const levelWalls = graph.nodes.find({ type: 'wall', levelId: level1.id })
console.log(`Found ${levelWalls.length} walls in level1 (expected 0)`)

// Find nodes in site
const siteNodes = graph.nodes.find({ siteId: site1.id })
console.log(`Found ${siteNodes.length} nodes in site`)

console.log('=== Testing Create API ===')

// 1. Get the level handle
const levelHandle = graph.getNodeById<'level'>(level1.id)

if (levelHandle) {
  console.log('Creating new wall via level handle...')

  // 2. Create a child node directly from the handle (Type-safe!)
  // This uses the new unshift behavior
  const newWall = levelHandle.create('wall', {
    start: [5, 5],
    end: [10, 5],
    position: [5, 5],
    size: [5, 0.2],
    rotation: 0,
    height: 3,
    visible: true,
    opacity: 100,
    metadata: {},
    editor: { preview: true },
  })

  console.log('New wall created:', newWall?.id)

  // 3. Create another wall to test order (should be first)
  const newerWall = levelHandle.create('wall', {
    start: [0, 0],
    end: [0, 5],
    height: 3,
    size: [5, 0.2],
    rotation: 0,
    position: [5, 5],
    name: 'Newer Wall',
    visible: true,
    opacity: 100,
    metadata: {},
    editor: { preview: true },
  })
  console.log('Newer wall created:', newerWall?.id)

  // 4. Verify children order
  const children = levelHandle.children()
  console.log(`Level has ${children.length} children`)
  console.log('First child ID:', children[0].id)
  console.log('Is first child the newer wall?', children[0].id === newerWall?.id) // Should be true due to unshift

  // 5. Update the new wall
  if (newWall) {
    newWall.update({ name: 'Updated Created Wall' })
    console.log('Updated wall name:', newWall.data().name)
  }
}

console.log('graph scene after create')
console.dir(graph.scene, { depth: null })

const wallNodes = graph.nodes.find({ buildingId: building1.id, type: 'wall' })
console.log(
  'wall nodes',
  wallNodes.map((node) => node.data()),
)
console.log('Done')
