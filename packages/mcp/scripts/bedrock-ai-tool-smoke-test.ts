#!/usr/bin/env bun
/**
 * Smoke test: Bedrock Claude Sonnet 5 driving the Pascal scene graph as a
 * tool-using agent, using the same AWS creds as the pi Bedrock provider.
 *
 * This is a standalone proof that the "AI is a first-class editor
 * participant" loop works end-to-end against the real model:
 *
 *   user turn -> Converse (with tool) -> tool_use -> SceneBridge.applyPatch
 *   -> tool_result -> Converse -> final answer
 *
 * Not wired into the app yet — this only proves the wiring before we build
 * the in-app chat panel (option A).
 *
 * Usage: bun run packages/mcp/scripts/bedrock-ai-tool-smoke-test.ts
 * Requires AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_REGION in env
 * (same creds pi's bedrock provider uses).
 */
import {
  BedrockRuntimeClient,
  ConverseCommand,
  type Message,
  type Tool,
} from '@aws-sdk/client-bedrock-runtime'
import { WallNode } from '@pascal-app/core/schema'
import { SceneBridge } from '../src/bridge/scene-bridge'

const MODEL_ID = 'us.anthropic.claude-sonnet-5'

const setWallConstructionTool: Tool = {
  toolSpec: {
    name: 'set_wall_construction',
    description:
      'Set formwork/construction properties on a wall in the currently open scene.',
    inputSchema: {
      json: {
        type: 'object',
        properties: {
          wallId: { type: 'string', description: 'Wall node id' },
          formworkType: {
            type: 'string',
            enum: ['plywood', 'aluminium', 'steel-panel', 'none'],
          },
          shutterMaterial: { type: 'string' },
          tieSpacing: { type: 'number', description: 'meters' },
          walerSpacing: { type: 'number', description: 'meters' },
          scaffoldRequired: { type: 'boolean' },
        },
        required: ['wallId'],
      },
    },
  },
}

async function main() {
  const bridge = new SceneBridge()
  bridge.setScene({}, [])
  bridge.loadDefault()
  const level = Object.values(bridge.getNodes()).find((n) => n.type === 'level')!
  const wall = WallNode.parse({ start: [0, 0], end: [5, 0], thickness: 0.3, height: 3 })
  bridge.applyPatch([{ op: 'create', node: wall, parentId: level.id }])

  console.log(`Seeded wall ${wall.id}: thickness=${wall.thickness}m height=${wall.height}m`)

  const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? 'us-east-1' })

  const messages: Message[] = [
    {
      role: 'user',
      content: [
        {
          text:
            `There is one wall in the scene with id "${wall.id}", thickness 0.3m, height 3m. ` +
            'This is a load-bearing concrete wall being cast in place. ' +
            'Decide reasonable formwork (shuttering) properties for it and call ' +
            'set_wall_construction to apply them. Then explain your reasoning in one sentence.',
        },
      ],
    },
  ]

  let turns = 0
  while (turns++ < 4) {
    const res = await client.send(
      new ConverseCommand({
        modelId: MODEL_ID,
        messages,
        toolConfig: { tools: [setWallConstructionTool] },
      }),
    )
    const output = res.output?.message
    if (!output) throw new Error('No output message from Bedrock')
    messages.push(output)

    const toolUses = (output.content ?? []).filter((b) => b.toolUse)
    if (toolUses.length === 0) {
      const text = (output.content ?? []).map((b) => b.text ?? '').join('')
      console.log(`\nFinal answer (stop_reason=${res.stopReason}):\n${text}`)
      break
    }

    const toolResults = toolUses.map((block) => {
      const use = block.toolUse!
      console.log(`\nTool call: ${use.name}`, JSON.stringify(use.input))
      const input = use.input as Record<string, unknown>
      try {
        bridge.applyPatch([
          {
            op: 'update',
            id: input.wallId as never,
            data: {
              formworkType: input.formworkType,
              shutterMaterial: input.shutterMaterial,
              tieSpacing: input.tieSpacing,
              walerSpacing: input.walerSpacing,
              scaffoldRequired: input.scaffoldRequired,
            } as never,
          },
        ])
        return {
          toolResult: {
            toolUseId: use.toolUseId,
            content: [{ text: 'Applied.' }],
          },
        }
      } catch (err) {
        return {
          toolResult: {
            toolUseId: use.toolUseId,
            content: [{ text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
            status: 'error' as const,
          },
        }
      }
    })
    messages.push({ role: 'user', content: toolResults })
  }

  const stored = bridge.getNode(wall.id) as WallNode
  console.log('\nStored wall construction properties:', {
    formworkType: stored.formworkType,
    shutterMaterial: stored.shutterMaterial,
    tieSpacing: stored.tieSpacing,
    walerSpacing: stored.walerSpacing,
    scaffoldRequired: stored.scaffoldRequired,
  })

  if (!stored.formworkType) {
    console.error('\nFAIL: model did not call set_wall_construction')
    process.exit(1)
  }
  console.log('\nPASS: AI tool loop mutated the scene via SceneBridge.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
