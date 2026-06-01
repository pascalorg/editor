import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import type { ArticraftModelData, GenerateOptions } from './types'

const _dirname = path.dirname(fileURLToPath(import.meta.url))

const DEFAULT_REPO_ROOT = path.resolve(_dirname, '..', '..', '..', 'articraft')
const BRIDGE_SCRIPT_RELATIVE_PATH = path.join('python', 'bridge.py')

function bridgeScriptPath(repoRoot: string): string {
  return path.join(repoRoot, BRIDGE_SCRIPT_RELATIVE_PATH)
}

function isArticraftRepoRoot(repoRoot: string): boolean {
  return existsSync(bridgeScriptPath(repoRoot))
}

function candidateRepoRoots(startDir: string): string[] {
  const candidates: string[] = []
  let current = path.resolve(startDir)
  for (let i = 0; i < 8; i += 1) {
    candidates.push(path.join(current, 'articraft'))
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  candidates.push(DEFAULT_REPO_ROOT)
  return [...new Set(candidates.map((candidate) => path.resolve(candidate)))]
}

export function resolveRepoRoot(repoRoot?: string): string {
  const configuredRoot = repoRoot || process.env.ARTICRAFT_REPO_ROOT
  if (configuredRoot) {
    const resolved = path.resolve(configuredRoot)
    if (isArticraftRepoRoot(resolved)) return resolved
    throw new Error(
      `Articraft repo root is invalid: ${resolved}. Expected ${BRIDGE_SCRIPT_RELATIVE_PATH}.`,
    )
  }

  for (const candidate of candidateRepoRoots(process.cwd())) {
    if (isArticraftRepoRoot(candidate)) return candidate
  }

  throw new Error(
    `Articraft repo root not found. Set ARTICRAFT_REPO_ROOT to a checkout containing ${BRIDGE_SCRIPT_RELATIVE_PATH}.`,
  )
}

function parseBridgeLine(line: string) {
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
}

/**
 * Generate an articulated model by spawning the Articraft Python bridge.
 *
 * The bridge script writes JSON-lines to stdout:
 *   {"type": "progress", "message": "..."}
 *   {"type": "result", "data": <ArticraftModelData>}
 *   {"type": "error", "message": "..."}
 *
 * On success, resolves with the parsed model data.
 * On failure, rejects with the error message.
 */
export function generateModel(options: GenerateOptions): Promise<ArticraftModelData> {
  const repoRoot = resolveRepoRoot(options.repoRoot)
  const bridgeScript = bridgeScriptPath(repoRoot)
  const { signal, onProgress } = options

  return new Promise((resolve, reject) => {
    const args = [bridgeScript, 'generate', '--prompt', options.prompt, '--mode', options.mode]
    if (options.model) args.push('--model', options.model)
    if (options.provider) args.push('--provider', options.provider)
    if (options.maxTurns !== undefined) args.push('--max-turns', String(options.maxTurns))
    if (options.imagePath) args.push('--image', options.imagePath)

    const env = { ...process.env }
    if (!env.ARTICRAFT_REPO_ROOT) {
      env.ARTICRAFT_REPO_ROOT = repoRoot
    }
    env.PYTHONUTF8 ??= '1'
    env.PYTHONIOENCODING ??= 'utf-8'

    let proc: ChildProcess
    try {
      proc = spawn('uv', ['run', '--directory', repoRoot, 'python', ...args], {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch (err) {
      reject(
        new Error(
          `Failed to spawn articraft bridge: ${err instanceof Error ? err.message : String(err)}`,
        ),
      )
      return
    }

    const rl = createInterface({ input: proc.stdout! })
    let resolved = false
    const progressLines: string[] = []

    rl.on('line', (line: string) => {
      if (resolved) return
      const parsed = parseBridgeLine(line)
      if (!parsed) {
        progressLines.push(line)
        return
      }

      if (parsed.type === 'progress') {
        const msg = parsed.message ?? ''
        progressLines.push(msg)
        onProgress?.(msg)
      } else if (parsed.type === 'result') {
        resolved = true
        rl.close()
        resolve(parsed.data as ArticraftModelData)
      } else if (parsed.type === 'error') {
        resolved = true
        rl.close()
        const allProgress = progressLines.join('\n')
        reject(new Error(parsed.message + (allProgress ? `\n\nOutput:\n${allProgress}` : '')))
      }
    })

    let stderr = ''
    proc.stderr!.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    proc.on('close', (code) => {
      if (!resolved) {
        const allProgress = progressLines.join('\n')
        const msg = `articraft bridge exited with code ${code}${stderr ? `: ${stderr}` : ''}`
        reject(new Error(allProgress ? `${msg}\n\nOutput:\n${allProgress}` : msg))
      }
    })

    proc.on('error', (err) => {
      if (!resolved) {
        resolved = true
        rl.close()
        reject(new Error(`articraft bridge process error: ${err.message}`))
      }
    })

    signal?.addEventListener('abort', () => {
      if (!resolved) {
        resolved = true
        rl.close()
        proc.kill('SIGTERM')
        reject(new DOMException('Generation cancelled', 'AbortError'))
      }
    })
  })
}

/**
 * Regenerate a model by modifying parameters in model.py and recompiling.
 */
export function regenerateModel(
  recordPath: string,
  paramChanges: Record<string, number | string>,
  options?: { repoRoot?: string; signal?: AbortSignal; onProgress?: (msg: string) => void },
): Promise<ArticraftModelData> {
  const repoRoot = resolveRepoRoot(options?.repoRoot)
  const bridgeScript = bridgeScriptPath(repoRoot)

  return new Promise((resolve, reject) => {
    const args = [
      bridgeScript,
      'regenerate',
      '--record-path',
      recordPath,
      '--params',
      JSON.stringify(paramChanges),
    ]

    const env = { ...process.env }
    if (!env.ARTICRAFT_REPO_ROOT) {
      env.ARTICRAFT_REPO_ROOT = repoRoot
    }

    let proc: ChildProcess
    try {
      proc = spawn('uv', ['run', '--directory', repoRoot, 'python', ...args], {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch (err) {
      reject(
        new Error(
          `Failed to spawn articraft bridge: ${err instanceof Error ? err.message : String(err)}`,
        ),
      )
      return
    }

    const rl = createInterface({ input: proc.stdout! })
    let resolved = false

    rl.on('line', (line: string) => {
      if (resolved) return
      const parsed = parseBridgeLine(line)
      if (!parsed) {
        options?.onProgress?.(line)
        return
      }

      if (parsed.type === 'progress') {
        options?.onProgress?.(parsed.message ?? '')
      } else if (parsed.type === 'result') {
        resolved = true
        rl.close()
        resolve(parsed.data as ArticraftModelData)
      } else if (parsed.type === 'error') {
        resolved = true
        rl.close()
        reject(new Error(parsed.message))
      }
    })

    let stderr = ''
    proc.stderr!.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    proc.on('close', (code) => {
      if (!resolved) {
        reject(new Error(`articraft bridge exited with code ${code}${stderr ? `: ${stderr}` : ''}`))
      }
    })

    proc.on('error', (err) => {
      if (!resolved) {
        resolved = true
        rl.close()
        reject(err)
      }
    })

    options?.signal?.addEventListener('abort', () => {
      if (!resolved) {
        resolved = true
        rl.close()
        proc.kill('SIGTERM')
        reject(new DOMException('Regeneration cancelled', 'AbortError'))
      }
    })
  })
}
