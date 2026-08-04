#!/usr/bin/env bun
/**
 * End-to-end proof of option A's chat loop, calling the same `runChatTurn`
 * used by /api/chat, against a plain in-memory SceneGraph (no HTTP server,
 * no live SceneBridge — matches what the route actually does now).
 */
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import { WallNode } from '@pascal-app/core/schema'
import { runChatTurn } from '../lib/chat-ai'

async function main() {
  const wall = WallNode.parse({ start: [0, 0], end: [5, 0], thickness: 0.3, height: 3 })
  const graph: SceneGraph = { nodes: { [wall.id]: wall }, rootNodeIds: [wall.id] }

  console.log(`Seeded wall ${wall.id}`)

  const first = await runChatTurn(graph, [
    {
      role: 'user',
      text:
        `Wall ${wall.id} is a load-bearing concrete wall, thickness 0.3m, height 3m being cast ` +
        'in place. List the walls, then set reasonable formwork properties on it.',
    },
  ])
  console.log('\nTurn 1 reply:', first.reply)
  console.log(
    'Turn 1 tool calls:',
    first.toolCalls.map((c) => c.name),
  )

  const result = await runChatTurn(graph, [
    {
      role: 'user',
      text:
        `Wall ${wall.id} is a load-bearing concrete wall, thickness 0.3m, height 3m being cast ` +
        'in place. List the walls, then set reasonable formwork properties on it.',
    },
    { role: 'assistant', text: first.reply },
    {
      role: 'user',
      text: 'Use plywood, 0.6m tie spacing, 0.9m waler spacing, and yes scaffold is required.',
    },
  ])

  console.log('\nAssistant reply:', result.reply)
  console.log('Tool calls:', JSON.stringify(result.toolCalls, null, 2))
  console.log('mutated:', result.mutated)

  const stored = graph.nodes[wall.id] as WallNode
  console.log('\nStored wall:', {
    formworkType: stored.formworkType,
    tieSpacing: stored.tieSpacing,
    walerSpacing: stored.walerSpacing,
    scaffoldRequired: stored.scaffoldRequired,
  })

  if (!result.mutated || !stored.formworkType) {
    console.error('\nFAIL: chat turn did not mutate the wall')
    process.exit(1)
  }

  const formworkNodes = Object.values(graph.nodes).filter((n) => n.type === 'formwork-assembly')
  console.log(
    'formwork-assembly nodes attached:',
    formworkNodes.length,
    'wall.children:',
    stored.children,
  )
  if (formworkNodes.length === 0 && result.toolCalls.some((c) => c.name === 'attach_formwork')) {
    console.error('\nFAIL: attach_formwork was called but no formwork-assembly node exists')
    process.exit(1)
  }

  console.log('\nPASS: apps/editor chat-ai loop mutated the plain scene graph.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
