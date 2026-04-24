#!/usr/bin/env bun
// Load shims FIRST so any subsequent core import sees the RAF polyfill.
import '../bridge/node-shims'

import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { SceneBridge } from '../bridge/scene-bridge'
import { version } from '../index'
import { createPascalMcpServer } from '../server'
import { connectHttp } from '../transports/http'
import { connectStdio } from '../transports/stdio'

const HELP = `pascal-mcp — MCP server for the Pascal editor

USAGE:
  pascal-mcp [--stdio | --http --port <n>] [--scene <path>]

OPTIONS:
  --stdio          Use stdio transport (default)
  --http           Use Streamable HTTP transport
  --port <n>       HTTP port (default 3917)
  --scene <path>   Initial scene JSON to load
  --version        Print version
  --help           Print this help
`

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      stdio: { type: 'boolean', default: false },
      http: { type: 'boolean', default: false },
      port: { type: 'string', default: '3917' },
      scene: { type: 'string' },
      help: { type: 'boolean', default: false },
      version: { type: 'boolean', default: false },
    },
  })

  if (values.help) {
    console.log(HELP)
    process.exit(0)
  }

  if (values.version) {
    console.log(version)
    process.exit(0)
  }

  const bridge = new SceneBridge()
  if (values.scene) {
    const raw = readFileSync(values.scene, 'utf8')
    bridge.loadJSON(raw)
  } else {
    bridge.loadDefault()
  }

  const server = createPascalMcpServer({ bridge })

  if (values.http) {
    const portNum = Number.parseInt(values.port ?? '3917', 10)
    if (!Number.isFinite(portNum) || portNum < 0 || portNum > 65535) {
      throw new Error(`invalid --port value: ${values.port}`)
    }
    const handle = await connectHttp(server, portNum)
    console.error(`[pascal-mcp] HTTP server listening on :${handle.port}`)
    const shutdown = async () => {
      try {
        await handle.close()
      } finally {
        process.exit(0)
      }
    }
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
  } else {
    // --stdio is the default when no transport flag is passed.
    await connectStdio(server)
    console.error('[pascal-mcp] stdio server running')
  }
}

main().catch((err) => {
  console.error('[pascal-mcp] fatal:', err instanceof Error ? (err.stack ?? err.message) : err)
  process.exit(1)
})
