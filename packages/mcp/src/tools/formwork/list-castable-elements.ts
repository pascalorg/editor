import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  castableElementSummary,
  LIST_CASTABLE_ELEMENTS_DESCRIPTION,
} from '@pascal-app/core/formwork'
import type { AnyNode } from '@pascal-app/core/schema'
import type { CastableHostNode } from '@pascal-app/nodes/formwork-assembly/headless'
import { z } from 'zod'
import type { SceneOperations } from '../../operations'
import { NodeIdSchema } from '../schemas'
import { noSuchLevel, sceneNodeList, sceneNodes, textResult } from './shared'

export const listCastableElementsOutput = {
  scope: z.string(),
  elementCount: z.number(),
  shutteredCount: z.number(),
  unshuttered: z.array(z.string()),
  // Passthrough rather than a field list: the summary is core's shape, and restating it
  // here is how the MCP reply comes to omit a field the editor's AI can see.
  elements: z.array(z.record(z.string(), z.unknown())),
}

/**
 * Every element that gets cast, and how each one is built — the read before any other
 * formwork call.
 *
 * `find_nodes` reaches these by type already, so what this adds is the shape a formwork
 * question needs: the extent the concrete is placed over, and the construction fields the
 * whole design is solved from, in one list rather than a `get_node` per element.
 *
 * `unshuttered` is the field that earns the tool. An element with no `formworkType` is
 * absent from every bill, and a bill listing only what exists reads as complete — so a
 * floor with three unformed walls totals cleanly and is short by three walls, with nothing
 * in the figures to show it. Named here, and named the same way by
 * `inspect_project_formwork`, because the agent should meet it before it quotes a total
 * rather than after.
 */
export function registerListCastableElements(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'list_castable_elements',
    {
      title: 'List castable elements',
      description: LIST_CASTABLE_ELEMENTS_DESCRIPTION,
      inputSchema: { levelId: NodeIdSchema.optional() },
      outputSchema: listCastableElementsOutput,
    },
    async ({ levelId }) => {
      const nodes = sceneNodes(bridge)
      if (levelId !== undefined && nodes[levelId]?.type !== 'level') return noSuchLevel(levelId)

      const all = sceneNodeList(bridge)
      const shuttered = new Set(
        all
          .filter((node) => node.type === 'formwork-assembly')
          .map((node) => node.parentId as string),
      )
      const elements = all
        .filter((node) => CASTABLE_TYPES.includes(node.type))
        .filter((node) => levelId === undefined || node.parentId === levelId)
        .sort((a, b) => (a.id as string).localeCompare(b.id as string))
        .map((node) => castableElementSummary(node as unknown as CastableHostNode))

      return textResult({
        scope: levelId ?? 'whole scene',
        elementCount: elements.length,
        shutteredCount: elements.filter((element) => shuttered.has(element.id)).length,
        // The elements a bill will silently leave out. See the doc comment.
        unshuttered: elements.filter((element) => !shuttered.has(element.id)).map((e) => e.id),
        elements: elements as unknown as Array<Record<string, unknown>>,
      })
    },
  )
}

const CASTABLE_TYPES: readonly AnyNode['type'][] = ['wall', 'column', 'slab']
