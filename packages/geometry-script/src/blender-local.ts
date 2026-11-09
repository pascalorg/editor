import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { GeometryScriptParamValue } from '@pascal-app/core'
import { type BlenderRun, blenderRun } from './blender'

/** The runner every Blender host executes; it ships beside `dist` and `src`. */
export const BLENDER_RUNNER_PATH = fileURLToPath(new URL('../bpy/runner.py', import.meta.url))

/**
 * Runs a bpy module with a local Blender binary (`blender -b`). No sandbox: the
 * module runs with this process's user, so it is for a developer's own machine
 * and local agents, the way the local three.js compile is opt-in.
 */
export async function runBlenderLocally(input: {
  blender: string
  code: string
  params?: Record<string, GeometryScriptParamValue>
  timeoutMs?: number
}): Promise<BlenderRun> {
  const directory = await mkdtemp(join(tmpdir(), 'pascal-bpy-'))
  try {
    await writeFile(
      join(directory, 'request.json'),
      JSON.stringify({ code: input.code, params: input.params ?? {} }),
    )
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        input.blender,
        [
          '-b',
          '--factory-startup',
          '--python-exit-code',
          '1',
          '--python',
          BLENDER_RUNNER_PATH,
          '--',
          directory,
        ],
        { stdio: 'ignore', env: { PATH: process.env.PATH ?? '' } },
      )
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        reject(new Error(`The script ran longer than ${(input.timeoutMs ?? 60_000) / 1000} s`))
      }, input.timeoutMs ?? 60_000)
      child.on('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      child.on('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
    const report = JSON.parse(
      await readFile(join(directory, 'result.json'), 'utf8').catch(() => '{}'),
    )
    const glb = report.ok ? new Uint8Array(await readFile(join(directory, 'model.glb'))) : null
    return blenderRun(report, glb)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
