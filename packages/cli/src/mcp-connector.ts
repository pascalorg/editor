import { readFile } from 'node:fs/promises'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import { getEditorStatus, startEditor } from './editor-process.js'
import { CliError } from './errors.js'
import type { PascalPaths } from './paths.js'

export async function connectManagedMcp(paths: PascalPaths): Promise<void> {
  let status = await getEditorStatus(paths)
  if (!status.healthy) {
    await startEditor({ paths })
    status = await getEditorStatus(paths)
  }
  if (!(status.healthy && status.state?.mcp)) {
    throw new CliError('mcp_unavailable', 'Pascal MCP is not healthy. Run "pascal doctor".')
  }

  const token = (await readFile(paths.mcpToken, 'utf8')).trim()
  if (!token) throw new CliError('mcp_unavailable', 'Pascal MCP credentials are missing.')

  const remote = new StreamableHTTPClientTransport(new URL(status.state.mcp.url), {
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
