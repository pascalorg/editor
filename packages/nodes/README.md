# @pascal-app/nodes

Built-in node definitions for the Pascal viewer and editor.

## Installation

```bash
npm install @pascal-app/core @pascal-app/viewer @pascal-app/editor @pascal-app/nodes
```

The package declares the remaining React, Next.js, Three.js, and UI libraries it needs as peer
dependencies. Install any peers reported by your package manager.

## Usage

Load `builtinPlugin` once before mounting a Pascal viewer or editor:

```typescript
import { loadPlugin } from '@pascal-app/core'
import { builtinPlugin } from '@pascal-app/nodes'

await loadPlugin(builtinPlugin)
```

The plugin registers the built-in schemas, renderers, geometry builders, tools, and systems. Hosts
can load additional plugins through the same `loadPlugin` API.

See the
[`@pascal-app/viewer` quick start](https://github.com/pascalorg/editor/tree/main/packages/viewer#usage)
for bootstrap ordering in a React application.

## License

MIT

## Kitchen agent tools

The built-in plugin exports `builtinAgentTools` from `@pascal-app/nodes/agent-tools`
(zod-only contracts) and `builtinAgentOperations` from
`@pascal-app/nodes/agent-operations` (headless planners). Both the inspector and
agents execute the same finishing planner, including hosted-item support checks.
- `kitchen_finish_run({ runId, action: 'align' | 'fill' })` aligns a run or closes
  50–150 mm wall gaps. Results apply in one undo step. Missing runs and unsupported
  hosted items return `cabinet_run_not_found` and `hosted_items_unsupported`.
- `kitchen_check_clearance({ nodeId })` returns an advisory opening warning for a
  run or module. It shares the registry notice used during placement, movement,
  and inspection. It checks conservative envelopes against visible floor objects
  and straight walls; curved walls and wall openings are not resolved.

A host that installs the plugin registers its tools on its MCP server with
`registerOperationTool`, the shared tools' runner, under its own reviewed
annotations (see the MCP README's plugin tools). Load the plugin definitions into
the scene registry as usual: clearance queries read each installed kind's
floor-placement capability.

```ts
import { registerOperationTool } from '@pascal-app/mcp/tools/shared-tools'
import { builtinAgentOperations } from '@pascal-app/nodes/agent-operations'
import { builtinAgentTools } from '@pascal-app/nodes/agent-tools'

for (const contract of builtinAgentTools.tools) {
  registerOperationTool(server, operations, {
    contract,
    operation: builtinAgentOperations[contract.name],
    annotations: {
      readOnlyHint: contract.name === 'kitchen_check_clearance',
      destructiveHint: false,
      openWorldHint: false,
    },
  })
}
```

Hosted chat declares the same contracts and applies the same operation outcomes
through its shared executor. These tools run as `operation` tools, so they do not
need a browser executor or custom chat card. Hosts retain control of which tools
are offered. The generic MCP server does not install a node plugin implicitly.
