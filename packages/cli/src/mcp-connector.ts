import { readFile } from 'node:fs/promises'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import { CliError } from './errors.js'
import { ensureMcpService } from './mcp-service.js'
import type { PascalPaths } from './paths.js'

/**
 * Bridges stdio to the managed MCP service. The service ships with the CLI, so this never
 * starts the web editor and never needs the downloaded web runtime.
 */
export async function connectManagedMcp(paths: PascalPaths): Promise<void> {
  const { state } = await ensureMcpService({ paths })
  const token = await readMcpToken(paths)

  const remote = new StreamableHTTPClientTransport(new URL(state.url), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  })
  const stdio = new StdioServerTransport()
  let initializeRequestId: string | number | null = null

  stdio.onmessage = (message) => {
    if ('method' in message && message.method === 'initialize' && 'id' in message) {
      initializeRequestId = message.id
    }
    remote.send(message).catch(reportConnectorError)
  }
  stdio.onerror = reportConnectorError
  remote.onmessage = (message) => {
    applyProtocolVersion(remote, message, initializeRequestId)
    stdio.send(message).catch(reportConnectorError)
  }
  remote.onerror = reportConnectorError

  await remote.start()
  await stdio.start()
}

async function readMcpToken(paths: PascalPaths): Promise<string> {
  let token = ''
  try {
    token = (await readFile(paths.mcpToken, 'utf8')).trim()
  } catch {}
  if (!token) throw new CliError('mcp_unavailable', 'Pascal MCP credentials are missing.')
  return token
}

function applyProtocolVersion(
  transport: StreamableHTTPClientTransport,
  message: JSONRPCMessage,
  initializeRequestId: string | number | null,
): void {
  if (!(initializeRequestId !== null && 'id' in message && message.id === initializeRequestId)) {
    return
  }
  if (!('result' in message) || typeof message.result !== 'object' || message.result === null)
    return
  const protocolVersion = (message.result as { protocolVersion?: unknown }).protocolVersion
  if (typeof protocolVersion === 'string') transport.setProtocolVersion(protocolVersion)
}

function reportConnectorError(error: Error): void {
  process.stderr.write(`[pascal-mcp] ${error.message}\n`)
}
