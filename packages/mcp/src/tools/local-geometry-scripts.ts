import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { CompiledGeometryScript } from '@pascal-app/core'
import { compileBlenderBuild } from '@pascal-app/geometry-script/blender'
import { runBlenderLocally } from '@pascal-app/geometry-script/blender-local'
import { DiskArtifactStore } from '../storage/disk-artifact-store'
import type { GeometryScriptHost } from './add-object'

/**
 * Local compile is opt-in: a separate process is not an untrusted-code sandbox.
 * three.js modules need PASCAL_SERVER_SCRIPT_COMPILE=1; bpy modules run in the
 * Blender binary PASCAL_BLENDER names.
 */
export function localGeometryScripts(projectPath: string): GeometryScriptHost {
  const artifacts = new DiskArtifactStore(projectPath)
  return {
    compile: async (input) => {
      if (input.language === 'bpy') {
        const blender = process.env.PASCAL_BLENDER
        if (!blender)
          throw new Error('bpy scripts need PASCAL_BLENDER, the path to a Blender binary')
        const run = await runBlenderLocally({ blender, code: input.code, params: input.params })
        const { glb, ...compiled } = await compileBlenderBuild({ ...input, run })
        return { ...compiled, glb: new Uint8Array(glb) }
      }
      if (process.env.PASCAL_SERVER_SCRIPT_COMPILE !== '1') {
        throw new Error('Local script compilation requires PASCAL_SERVER_SCRIPT_COMPILE=1')
      }
      return new Promise((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [fileURLToPath(new URL('./geometry-script-worker.js', import.meta.url))],
          { env: {}, stdio: ['pipe', 'pipe', 'pipe'] },
        )
        const chunks: Buffer[] = []
        let stderr = ''
        const timer = setTimeout(() => {
          child.kill('SIGKILL')
          reject(new Error('Geometry script compilation timed out'))
        }, 20_000)
        child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
        child.stderr.on('data', (chunk: Buffer) => {
          stderr = (stderr + chunk.toString()).slice(-2000)
        })
        child.stdin.on('error', reject)
        child.on('error', (error) => {
          clearTimeout(timer)
          reject(error)
        })
        child.on('close', () => {
          clearTimeout(timer)
          try {
            const message = JSON.parse(Buffer.concat(chunks).toString()) as
              | { ok: true; compiled: CompiledGeometryScript; glb: string }
              | { ok: false; error: string }
            if (!message.ok) return reject(new Error(message.error))
            resolve({
              ...message.compiled,
              glb: new Uint8Array(Buffer.from(message.glb, 'base64')),
            })
          } catch {
            reject(new Error(`Geometry script compilation failed: ${stderr}`))
          }
        })
        child.stdin.end(JSON.stringify(input))
      })
    },
    storeArtifact: async ({ sha256, bytes }) => {
      await artifacts.put(sha256, bytes)
      return sha256
    },
    readArtifact: ({ sha256 }) => artifacts.read(sha256),
  }
}
