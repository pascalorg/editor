/**
 * Phase 0.5 bridge spike — prove that @pascal-app/core's useScene works in Node
 * after a RAF polyfill. Run with: bun run packages/mcp/scripts/spike.ts
 */

// Polyfill BEFORE importing core.
if (typeof (globalThis as any).requestAnimationFrame === 'undefined') {
  ;(globalThis as any).requestAnimationFrame = (cb: (t: number) => void): number => {
    return setTimeout(() => cb(performance.now()), 0) as unknown as number
  }
  ;(globalThis as any).cancelAnimationFrame = (id: number) => {
    clearTimeout(id as unknown as NodeJS.Timeout)
  }
}

import { WallNode } from '@pascal-app/core/schema'
import useScene from '@pascal-app/core/store'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`)
}

async function main() {
  console.log('---- Phase 0.5 bridge spike ----')

  // 1. Load default scene
  useScene.getState().loadScene()
  const state1 = useScene.getState()
  assert(state1.rootNodeIds.length === 1, 'expected 1 root')
  // NOTE: SiteNode.children holds node objects (not IDs); everything else uses ID arrays.
  // Resolve building/level via the flat nodes dict, filtering by type.
  const allNodes = Object.values(state1.nodes)
  const building = allNodes.find((n) => n.type === 'building')
  const level = allNodes.find((n) => n.type === 'level')
  assert(building, 'expected building node in dict')
  assert(level, 'expected level node in dict')
  const levelId = level.id
  console.log('OK 1: default scene loaded —', Object.keys(state1.nodes).length, 'nodes')

  // 2. Clear temporal history so we measure our own undo steps
  useScene.temporal.getState().clear()

  // 3. Create a wall via WallNode.parse
  const wall = WallNode.parse({
    start: [0, 0],
    end: [5, 0],
  })
  useScene.getState().createNode(wall, levelId as any)
  const state2 = useScene.getState()
  assert(wall.id in state2.nodes, 'wall not created')
  const levelAfter = state2.nodes[levelId]!
  assert(
    'children' in levelAfter &&
      Array.isArray(levelAfter.children) &&
      levelAfter.children.includes(wall.id),
    'wall not linked as level child',
  )
  console.log('OK 2: created wall', wall.id)

  // 4. Wait for any RAF-queued dirty markings (from updateNodesAction polyfill)
  await new Promise((r) => setTimeout(r, 5))

  // 5. Update wall
  useScene.getState().updateNode(wall.id, { thickness: 0.25, height: 3.0 })
  await new Promise((r) => setTimeout(r, 5))
  const state3 = useScene.getState()
  const w3 = state3.nodes[wall.id] as any
  assert(w3.thickness === 0.25, 'thickness not updated')
  assert(w3.height === 3.0, 'height not updated')
  console.log('OK 3: updated wall thickness + height')

  // 6. Undo (thickness/height revert)
  useScene.temporal.getState().undo()
  await new Promise((r) => setTimeout(r, 5))
  const state4 = useScene.getState()
  const w4 = state4.nodes[wall.id] as any
  console.log('   after undo: thickness =', w4?.thickness, 'height =', w4?.height)
  assert(w4, 'wall still exists after 1 undo (update was undone)')
  // default thickness/height come from schema defaults, not required to be exact values; just prove they changed back
  assert(w4.thickness !== 0.25 || w4.height !== 3.0, 'undo did not revert update')
  console.log('OK 4: undo reverted update')

  // 7. Undo again (wall creation reverted)
  useScene.temporal.getState().undo()
  await new Promise((r) => setTimeout(r, 5))
  const state5 = useScene.getState()
  assert(!(wall.id in state5.nodes), 'wall was not removed by second undo')
  console.log('OK 5: undo removed the wall')

  // 8. Redo twice (wall comes back with the updated props)
  useScene.temporal.getState().redo(2)
  await new Promise((r) => setTimeout(r, 5))
  const state6 = useScene.getState()
  const w6 = state6.nodes[wall.id] as any
  assert(w6, 'redo did not restore wall')
  assert(w6.thickness === 0.25 && w6.height === 3.0, 'redo did not restore updated props')
  console.log('OK 6: redo restored wall + update')

  // 9. Delete wall
  useScene.getState().deleteNode(wall.id)
  const state7 = useScene.getState()
  assert(!(wall.id in state7.nodes), 'wall was not deleted')
  console.log('OK 7: delete removed wall')

  // 10. setScene round-trip
  const snapshot = {
    nodes: { ...state7.nodes },
    rootNodeIds: [...state7.rootNodeIds],
  }
  useScene.getState().unloadScene()
  useScene.getState().setScene(snapshot.nodes, snapshot.rootNodeIds)
  const state8 = useScene.getState()
  assert(
    Object.keys(state8.nodes).length === Object.keys(snapshot.nodes).length,
    'setScene node-count mismatch',
  )
  console.log('OK 8: setScene round-trip preserved node count')

  console.log('\n✅ BRIDGE SPIKE PASSED — headless useScene is viable with RAF polyfill\n')
}

main().catch((err) => {
  console.error('\n❌ SPIKE FAILED:', err)
  process.exit(1)
})
