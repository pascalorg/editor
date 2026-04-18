import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SceneBridge } from './bridge/scene-bridge'
import { registerPrompts } from './prompts'
import { registerResources } from './resources'
import { registerTools } from './tools'
import { registerVisionTools } from './tools/vision'

export type CreatePascalMcpServerOptions = {
  bridge: SceneBridge
  name?: string
  version?: string
}

export function createPascalMcpServer(opts: CreatePascalMcpServerOptions): McpServer {
  const server = new McpServer({
    name: opts.name ?? 'pascal-mcp',
    version: opts.version ?? '0.1.0',
  })
  registerTools(server, opts.bridge)
  registerVisionTools(server, opts.bridge)
  registerResources(server, opts.bridge)
  registerPrompts(server, opts.bridge)
  return server
}
