import {
  buildSceneIndex,
  getNodeByPath,
  initScene,
  loadScene,
  type Scene,
  updateNodeByPath,
} from '@/lib/scenegraph/schema/index'

// Test 1: Basic scene
console.log('=== Test 1: Basic Scene ===')
const scene = initScene()
const index = buildSceneIndex(scene)

console.log('Nodes by type:')
for (const [type, ids] of index.byType.entries()) {
  console.log(`  ${type}: ${ids.size} node(s)`)
}
console.log('Total nodes indexed:', index.byId.size)
console.log('\nPaths in basic scene:')
for (const [id, nodeIndex] of index.byId.entries()) {
  console.log(`  ${nodeIndex.type} (${id}): ${nodeIndex.path.join('.')}`)
}

// Test 2: Scene with walls and children
console.log('\n=== Test 2: Complex Scene ===')
const sceneData = {
  metadata: {},
  root: {
    id: 'root_test123456789',
    type: 'root',
    environment: {
      id: 'environment_test1234',
      type: 'environment',
      latitude: 40.7128,
      longitude: -74.006,
      altitude: 10,
    },
    site: {
      id: 'site_test123456789',
      type: 'site',
    },
    buildings: [
      {
        id: 'building_test12345',
        type: 'building',
        name: 'Test Building',
        position: [0, 0],
        rotation: 0,
        visible: true,
        opacity: 1,
        metadata: {},
        levels: [
          {
            id: 'level_test12345678',
            type: 'level',
            name: 'Ground Floor',
            level: 0,
            visible: true,
            opacity: 1,
            metadata: {},
            children: [
              {
                id: 'wall_test123456789',
                type: 'wall',
                start: [0, 0],
                end: [10, 0],
                visible: true,
                opacity: 1,
                metadata: {},
                children: [
                  {
                    id: 'door_test123456789',
                    type: 'door',
                    position: 5,
                    visible: true,
                    opacity: 1,
                    metadata: {},
                  },
                  {
                    id: 'window_test1234567',
                    type: 'window',
                    position: 8,
                    height: 1,
                    visible: true,
                    opacity: 1,
                    metadata: {},
                  },
                ],
              },
              {
                id: 'column_test1234567',
                type: 'column',
                position: [5, 5],
                visible: true,
                opacity: 1,
                metadata: {},
              },
              {
                id: 'roof_test1234567',
                type: 'roof',
                position: [8, 8],
                rotation: 0,
                size: [10, 10],
                height: 10,
                leftWidth: 5,
                rightWidth: 5,
                visible: true,
                opacity: 1,
                metadata: {},
              },
            ],
          },
          {
            id: 'level_test23456789',
            type: 'level',
            name: 'First Floor',
            level: 1,
            visible: true,
            opacity: 1,
            metadata: {},
            children: [],
          },
        ],
      },
    ],
  },
} satisfies Scene
const loadedScene = loadScene(sceneData)

const sceneIndex = buildSceneIndex(loadedScene)

// console.log('Scene index:')
// console.log(sceneIndex)

// console.log('Nodes by type:')
// for (const [type, ids] of sceneIndex.byType.entries()) {
//   console.log(`  ${type}: ${ids.size} node(s)`)
// }
// console.log('Total nodes indexed:', sceneIndex.byId.size)

// console.log('\nNode paths and relationships:')
// for (const [nodeId, nodeIndex] of sceneIndex.byId.entries()) {
//   const pathStr = nodeIndex.path.join('.')
//   console.log(`  ${nodeIndex.type} (${nodeId})`)
//   console.log(`    path: ${pathStr}`)
//   console.log(`    parent: ${nodeIndex.parent || 'null'}`)
//   if (nodeIndex.children.length > 0) {
//     console.log(`    children: ${nodeIndex.children.join(', ')}`)
//   }
// }

// console.log('\n✅ Generic traversal successfully indexed all nodes with paths!')

// // Test 3: Path-based node access
// console.log('\n=== Test 3: Path-Based Node Access ===')

// // Find the wall node in the index
// const wallNodeIndex = Array.from(sceneIndex.byId.values()).find((n) => n.type === 'wall')
// if (wallNodeIndex) {
//   console.log('Wall found at path:', wallNodeIndex.path.join('.'))

//   // Access the wall using its path
//   const wallNode = getNodeByPath(loadedScene, wallNodeIndex.path)
//   console.log('Wall node:', wallNode)

//   // Update the wall's visibility using its path
//   const updatedScene = updateNodeByPath(loadedScene, wallNodeIndex.path, (node) => ({
//     ...node,
//     visible: false,
//     opacity: 0.5,
//   }))

//   // Verify the update
//   const updatedWall = getNodeByPath(updatedScene, wallNodeIndex.path)
//   console.log('Updated wall node:', updatedWall)
//   if (updatedWall && 'visible' in updatedWall && 'opacity' in updatedWall) {
//     console.log(
//       '✅ Wall visibility updated:',
//       updatedWall.visible,
//       '(opacity:',
//       updatedWall.opacity,
//       ')',
//     )
//   }
// }

// // Test 4: Update a door via path
// console.log('\n=== Test 4: Update Door Via Path ===')
// const doorNodeIndex = Array.from(sceneIndex.byId.values()).find((n) => n.type === 'door')
// if (doorNodeIndex) {
//   console.log('Door found at path:', doorNodeIndex.path.join('.'))

//   const updatedScene = updateNodeByPath(loadedScene, doorNodeIndex.path, (node) => {
//     if (node.type === 'door') {
//       return {
//         ...node,
//         position: 7, // Move door along wall
//         metadata: { ...(node.metadata as Record<string, unknown>), updated: true },
//       }
//     }
//     return node
//   })

//   const updatedDoor = getNodeByPath(updatedScene, doorNodeIndex.path)
//   if (updatedDoor && 'position' in updatedDoor) {
//     console.log('Updated door position:', updatedDoor.position)
//     console.log('✅ Door successfully moved via path!')
//   }
// }

const node = getNodeByPath<'wall'>(loadedScene, [
  'root',
  'buildings',
  0,
  'levels',
  0,
  'children',
  0,
])
if (node?.type === 'wall') {
  console.log('Wall node:', node)
}
