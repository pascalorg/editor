import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * A stand-in for the bundled `services/pascal-mcp.mjs`: it answers the authenticated health
 * probe the CLI uses to identify its own MCP process, and records the environment it was
 * started with so tests can assert the editor origin handed to it.
 */
const FAKE_MCP_SERVICE = `import { writeFileSync } from 'node:fs'
import http from 'node:http'
const token = process.env.PASCAL_MCP_HTTP_TOKEN
const server = http.createServer((request, response) => {
  if (request.headers.authorization !== \`Bearer \${token}\`) {
    response.writeHead(401).end()
    return
  }
  response.setHeader('content-type', 'application/json')
  if (request.url === '/health') {
    response.end(JSON.stringify({
      status: 'ok',
      app: 'mcp',
      version: process.env.PASCAL_RUNTIME_VERSION,
      instanceId: process.env.PASCAL_INSTANCE_ID,
      editorOrigin: process.env.PASCAL_EDITOR_ORIGIN ?? null,
    }))
    return
  }
  response.writeHead(404).end('{}')
})
const portIndex = process.argv.indexOf('--port')
server.listen(Number(process.argv[portIndex + 1]), '127.0.0.1')
if (process.env.PASCAL_MCP_TEST_RECORD) {
  writeFileSync(process.env.PASCAL_MCP_TEST_RECORD, JSON.stringify({
    pid: process.pid,
    editorOrigin: process.env.PASCAL_EDITOR_ORIGIN ?? null,
    dataDirectory: process.env.PASCAL_DATA_DIR,
  }))
}
process.on('SIGTERM', () => server.close(() => process.exit(0)))
`

export async function writeFakeMcpService(directory: string): Promise<string> {
  await mkdir(directory, { recursive: true })
  const servicePath = path.join(directory, 'pascal-mcp.mjs')
  await writeFile(servicePath, FAKE_MCP_SERVICE)
  return servicePath
}
