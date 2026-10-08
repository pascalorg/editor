import { Console } from 'node:console'
import { compileGeometryScript } from '@pascal-app/geometry-script/compile'

const stdout = process.stdout
// stdout carries only the result; a script's own logging goes to stderr.
globalThis.console = new Console({ stdout: process.stderr, stderr: process.stderr })
const chunks: Buffer[] = []
for await (const chunk of process.stdin) chunks.push(chunk)
const input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
for (const name of ['fetch', 'WebSocket', 'EventSource', 'XMLHttpRequest', 'Request', 'Response']) {
  Reflect.deleteProperty(globalThis, name)
}
for (const name of ['getBuiltinModule', 'binding', 'dlopen']) Reflect.deleteProperty(process, name)

try {
  const { glb, ...compiled } = await compileGeometryScript(input)
  stdout.write(JSON.stringify({ ok: true, compiled, glb: Buffer.from(glb).toString('base64') }))
} catch (error) {
  stdout.write(
    JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }),
  )
}
