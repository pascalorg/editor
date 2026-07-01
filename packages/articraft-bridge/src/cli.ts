import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import type {
  ArticraftLink,
  ArticraftModelData,
  ArticraftOrigin,
  ArticraftVisual,
  ArticraftVisualGeometry,
  GenerateOptions,
  Vec3,
  Vec4,
} from './types'

const _dirname = path.dirname(fileURLToPath(import.meta.url))

const DEFAULT_REPO_ROOT = path.resolve(_dirname, '..', '..', '..', 'articraft')
const BRIDGE_SCRIPT_RELATIVE_PATH = path.join('python', 'bridge.py')
const MODERN_CLI_RELATIVE_PATH = path.join('cli', 'main.py')

type CommandInvocation = {
  command: string
  args: string[]
}

function bridgeScriptPath(repoRoot: string): string {
  return path.join(repoRoot, BRIDGE_SCRIPT_RELATIVE_PATH)
}

function isArticraftRepoRoot(repoRoot: string): boolean {
  return (
    existsSync(bridgeScriptPath(repoRoot)) ||
    existsSync(path.join(repoRoot, MODERN_CLI_RELATIVE_PATH))
  )
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
      `Articraft repo root is invalid: ${resolved}. Expected ${BRIDGE_SCRIPT_RELATIVE_PATH} or ${MODERN_CLI_RELATIVE_PATH}.`,
    )
  }

  for (const candidate of candidateRepoRoots(process.cwd())) {
    if (isArticraftRepoRoot(candidate)) return candidate
  }

  throw new Error(
    `Articraft repo root not found. Set ARTICRAFT_REPO_ROOT to a checkout containing ${BRIDGE_SCRIPT_RELATIVE_PATH} or ${MODERN_CLI_RELATIVE_PATH}.`,
  )
}

function hasLegacyBridge(repoRoot: string): boolean {
  return existsSync(bridgeScriptPath(repoRoot))
}

function venvPythonPath(repoRoot: string): string {
  return path.join(
    repoRoot,
    '.venv',
    process.platform === 'win32' ? 'Scripts' : 'bin',
    process.platform === 'win32' ? 'python.exe' : 'python',
  )
}

export function modernCliInvocation(repoRoot: string, args: string[]): CommandInvocation {
  const python = venvPythonPath(repoRoot)
  const cliEntry = path.join(repoRoot, MODERN_CLI_RELATIVE_PATH)
  if (existsSync(python) && existsSync(cliEntry)) {
    return {
      command: python,
      args: [cliEntry, ...args],
    }
  }
  return {
    command: 'uv',
    args: ['run', '--directory', repoRoot, 'articraft', ...args],
  }
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
  if (!hasLegacyBridge(repoRoot)) {
    return generateModelWithModernCli(repoRoot, options)
  }
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
    env.ARTICRAFT_MODEL ||= env.AI_MODEL || env.NEXT_PUBLIC_AI_MODEL || ''
    env.DEEPSEEK_API_KEY ||= env.AI_API_KEY || env.NEXT_PUBLIC_AI_API_KEY || ''
    env.DEEPSEEK_BASE_URL ||= env.AI_BASE_URL || env.NEXT_PUBLIC_AI_BASE_URL || ''
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

function spawnAndCollect(
  command: string,
  args: string[],
  options: {
    cwd: string
    env: NodeJS.ProcessEnv
    signal?: AbortSignal
    onProgress?: (message: string) => void
  },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let proc: ChildProcess
    try {
      proc = spawn(command, args, {
        cwd: options.cwd,
        env: options.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch (err) {
      reject(
        new Error(
          `Failed to spawn ${command}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      )
      return
    }

    let stdout = ''
    let stderr = ''
    let settled = false
    const onChunk = (chunk: Buffer, stream: 'stdout' | 'stderr') => {
      const text = chunk.toString()
      if (stream === 'stdout') stdout += text
      else stderr += text
      for (const line of text.split(/\r?\n/)) {
        const message = line.trim()
        if (message) options.onProgress?.(message)
      }
    }

    proc.stdout?.on('data', (chunk: Buffer) => onChunk(chunk, 'stdout'))
    proc.stderr?.on('data', (chunk: Buffer) => onChunk(chunk, 'stderr'))

    proc.on('close', (code) => {
      if (settled) return
      settled = true
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(`${command} exited with code ${code}${stderr ? `: ${stderr}` : ''}`))
    })
    proc.on('error', (err) => {
      if (settled) return
      settled = true
      reject(new Error(`${command} process error: ${err.message}`))
    })
    options.signal?.addEventListener('abort', () => {
      if (settled) return
      settled = true
      proc.kill('SIGTERM')
      reject(new DOMException('Generation cancelled', 'AbortError'))
    })
  })
}

function listRecordIds(repoRoot: string): Set<string> {
  const recordsRoot = path.join(repoRoot, 'data', 'records')
  try {
    return new Set(
      readdirSync(recordsRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name),
    )
  } catch {
    return new Set()
  }
}

function extractRecordId(output: string): string | null {
  const patterns = [
    /\brecord_id=([A-Za-z0-9_.-]+)/,
    /\brecord_id["':\s]+([A-Za-z0-9_.-]+)/,
    /(?:data[\\/]+records[\\/]+)([A-Za-z0-9_.-]+)/,
  ]
  for (const pattern of patterns) {
    const match = pattern.exec(output)
    if (match?.[1]) return match[1]
  }
  return null
}

function newestCreatedRecordId(
  repoRoot: string,
  before: Set<string>,
  startedAtMs: number,
): string | null {
  const recordsRoot = path.join(repoRoot, 'data', 'records')
  try {
    const candidates = readdirSync(recordsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !before.has(entry.name))
      .map((entry) => {
        const recordPath = path.join(recordsRoot, entry.name)
        return { id: entry.name, mtimeMs: statSync(recordPath).mtimeMs }
      })
      .filter((entry) => entry.mtimeMs >= startedAtMs - 5000)
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
    return candidates[0]?.id ?? null
  } catch {
    return null
  }
}

function jsonFile(pathname: string): unknown {
  return JSON.parse(readFileSync(pathname, 'utf8'))
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function xmlDecode(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function attr(xml: string, name: string): string | undefined {
  const match = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`).exec(xml)
  return match?.[1] ? xmlDecode(match[1]) : undefined
}

function numbers(value: string | undefined, fallback: number[]): number[] {
  if (!value) return fallback
  const parsed = value
    .trim()
    .split(/\s+/)
    .map((part) => Number(part))
  return parsed.length
    ? parsed.map((part, index) => (Number.isFinite(part) ? part : (fallback[index] ?? 0)))
    : fallback
}

function vec3(value: string | undefined): [number, number, number] {
  const parsed = numbers(value, [0, 0, 0])
  return [parsed[0] ?? 0, parsed[1] ?? 0, parsed[2] ?? 0]
}

function vec4(value: string | undefined): Vec4 {
  const parsed = numbers(value, [1, 1, 1, 1])
  return [parsed[0] ?? 1, parsed[1] ?? 1, parsed[2] ?? 1, parsed[3] ?? 1]
}

function origin(xml: string) {
  const match = /<origin\b[^>]*\/?>/s.exec(xml)
  const tag = match?.[0] ?? ''
  return { xyz: vec3(attr(tag, 'xyz')), rpy: vec3(attr(tag, 'rpy')) }
}

function tagBlocks(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'g'))].map(
    (match) => match[0],
  )
}

function parseUrdfMaterials(xml: string): Map<string, Vec4> {
  const materials = new Map<string, Vec4>()
  for (const materialXml of tagBlocks(xml, 'material')) {
    const materialTag = /<material\b[^>]*>/s.exec(materialXml)?.[0] ?? ''
    const name = attr(materialTag, 'name')
    const colorTag = /<color\b[^>]*\/?>/s.exec(materialXml)?.[0]
    if (name && colorTag) materials.set(name, vec4(attr(colorTag, 'rgba')))
  }
  return materials
}

function visualMaterial(
  visualXml: string,
  materialByName: Map<string, Vec4>,
): ArticraftVisual['material'] | undefined {
  const materialTag = /<material\b[^>]*(?:\/>|>[\s\S]*?<\/material>)/s.exec(visualXml)?.[0]
  if (!materialTag) return undefined
  const name = attr(materialTag, 'name') ?? 'material'
  const colorTag = /<color\b[^>]*\/?>/s.exec(materialTag)?.[0]
  return {
    name,
    rgba: colorTag ? vec4(attr(colorTag, 'rgba')) : (materialByName.get(name) ?? vec4(undefined)),
  }
}

function addVec3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

function scaleVec3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] * b[0], a[1] * b[1], a[2] * b[2]]
}

function rotateRpyVector(vector: Vec3, rpy: Vec3): Vec3 {
  const [roll, pitch, yaw] = rpy
  const cr = Math.cos(roll)
  const sr = Math.sin(roll)
  const cp = Math.cos(pitch)
  const sp = Math.sin(pitch)
  const cy = Math.cos(yaw)
  const sy = Math.sin(yaw)

  const x1 = vector[0]
  const y1 = cr * vector[1] - sr * vector[2]
  const z1 = sr * vector[1] + cr * vector[2]

  const x2 = cp * x1 + sp * z1
  const y2 = y1
  const z2 = -sp * x1 + cp * z1

  return [cy * x2 - sy * y2, sy * x2 + cy * y2, z2]
}

function readObjBounds(objPath: string): { center: Vec3; size: Vec3 } | null {
  let min: Vec3 = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]
  let max: Vec3 = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY]
  let vertexCount = 0

  try {
    const text = readFileSync(objPath, 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const match =
        /^v\s+([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s+([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s+([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)/i.exec(
          line.trim(),
        )
      if (!match) continue
      const vertex: Vec3 = [Number(match[1]), Number(match[2]), Number(match[3])]
      if (!vertex.every(Number.isFinite)) continue
      vertexCount += 1
      min = [Math.min(min[0], vertex[0]), Math.min(min[1], vertex[1]), Math.min(min[2], vertex[2])]
      max = [Math.max(max[0], vertex[0]), Math.max(max[1], vertex[1]), Math.max(max[2], vertex[2])]
    }
  } catch {
    return null
  }

  if (vertexCount === 0) return null
  const center: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
  const size: Vec3 = [
    Math.max(0.01, max[0] - min[0]),
    Math.max(0.01, max[1] - min[1]),
    Math.max(0.01, max[2] - min[2]),
  ]
  return { center, size }
}

function meshGeometryFromTag(
  meshTag: string | undefined,
  urdfDir: string,
  parsedOrigin: ReturnType<typeof origin>,
): { origin: ArticraftOrigin; geometry: ArticraftVisualGeometry } {
  const meshPath = attr(meshTag ?? '', 'filename')
  const meshScale = vec3(attr(meshTag ?? '', 'scale') ?? '1 1 1')
  const resolvedMeshPath = meshPath
    ? path.resolve(urdfDir, path.normalize(meshPath.replace(/\\/g, path.sep)))
    : null
  const bounds =
    resolvedMeshPath && existsSync(resolvedMeshPath) ? readObjBounds(resolvedMeshPath) : null
  if (!bounds) {
    return {
      origin: parsedOrigin,
      geometry: {
        type: 'mesh' as const,
        params: {},
        meshPath,
      },
    }
  }

  const center = scaleVec3(bounds.center, meshScale)
  const size = scaleVec3(bounds.size, [
    Math.abs(meshScale[0]),
    Math.abs(meshScale[1]),
    Math.abs(meshScale[2]),
  ])
  return {
    origin: {
      xyz: addVec3(parsedOrigin.xyz, rotateRpyVector(center, parsedOrigin.rpy)),
      rpy: parsedOrigin.rpy,
    },
    geometry: {
      type: 'mesh' as const,
      params: {
        sx: size[0],
        sy: size[1],
        sz: size[2],
      },
      meshPath,
    },
  }
}

export function buildModelDataFromUrdf(
  urdfPath: string,
): Pick<ArticraftModelData, 'links' | 'joints' | 'name'> {
  const xml = readFileSync(urdfPath, 'utf8')
  const urdfDir = path.dirname(urdfPath)
  const robotTag = /<robot\b[^>]*>/s.exec(xml)?.[0] ?? ''
  const materialByName = parseUrdfMaterials(xml)
  const links: ArticraftLink[] = tagBlocks(xml, 'link').map((linkXml) => {
    const linkTag = /<link\b[^>]*>/s.exec(linkXml)?.[0] ?? ''
    const name = attr(linkTag, 'name') ?? 'link'
    return {
      name,
      visuals: tagBlocks(linkXml, 'visual').map((visualXml, index): ArticraftVisual => {
        const geometryXml = tagBlocks(visualXml, 'geometry')[0] ?? ''
        const boxTag = /<box\b[^>]*\/?>/s.exec(geometryXml)?.[0]
        const cylinderTag = /<cylinder\b[^>]*\/?>/s.exec(geometryXml)?.[0]
        const sphereTag = /<sphere\b[^>]*\/?>/s.exec(geometryXml)?.[0]
        const meshTag = /<mesh\b[^>]*\/?>/s.exec(geometryXml)?.[0]
        const visualTag = /<visual\b[^>]*>/s.exec(visualXml)?.[0] ?? ''
        const parsedOrigin = origin(visualXml)
        const material = visualMaterial(visualXml, materialByName)
        if (boxTag) {
          const size = numbers(attr(boxTag, 'size'), [1, 1, 1])
          return {
            name: attr(visualTag, 'name') ?? `${name}_visual_${index}`,
            origin: parsedOrigin,
            geometry: {
              type: 'box' as const,
              params: { length: size[0] ?? 1, width: size[1] ?? 1, height: size[2] ?? 1 },
            },
            material,
          }
        }
        if (cylinderTag) {
          return {
            name: attr(visualTag, 'name') ?? `${name}_visual_${index}`,
            origin: parsedOrigin,
            geometry: {
              type: 'cylinder' as const,
              params: {
                radius: Number(attr(cylinderTag, 'radius') ?? 0.5),
                length: Number(attr(cylinderTag, 'length') ?? 1),
              },
            },
            material,
          }
        }
        if (sphereTag) {
          return {
            name: attr(visualTag, 'name') ?? `${name}_visual_${index}`,
            origin: parsedOrigin,
            geometry: {
              type: 'sphere' as const,
              params: { radius: Number(attr(sphereTag, 'radius') ?? 0.5) },
            },
            material,
          }
        }
        const mesh = meshGeometryFromTag(meshTag, urdfDir, parsedOrigin)
        return {
          name: attr(visualTag, 'name') ?? `${name}_visual_${index}`,
          origin: mesh.origin,
          geometry: mesh.geometry,
          material,
        }
      }),
    }
  })
  const joints = tagBlocks(xml, 'joint').map((jointXml) => {
    const jointTag = /<joint\b[^>]*>/s.exec(jointXml)?.[0] ?? ''
    const limitTag = /<limit\b[^>]*\/?>/s.exec(jointXml)?.[0]
    const mimicTag = /<mimic\b[^>]*\/?>/s.exec(jointXml)?.[0]
    return {
      name: attr(jointTag, 'name') ?? 'joint',
      type: (attr(jointTag, 'type') ?? 'fixed') as ArticraftModelData['joints'][number]['type'],
      parent: attr(/<parent\b[^>]*\/?>/s.exec(jointXml)?.[0] ?? '', 'link') ?? '',
      child: attr(/<child\b[^>]*\/?>/s.exec(jointXml)?.[0] ?? '', 'link') ?? '',
      origin: origin(jointXml),
      axis: vec3(attr(/<axis\b[^>]*\/?>/s.exec(jointXml)?.[0] ?? '', 'xyz') ?? '1 0 0'),
      limits: limitTag
        ? {
            effort: Number(attr(limitTag, 'effort') ?? 0),
            velocity: Number(attr(limitTag, 'velocity') ?? 0),
            lower:
              attr(limitTag, 'lower') === undefined ? undefined : Number(attr(limitTag, 'lower')),
            upper:
              attr(limitTag, 'upper') === undefined ? undefined : Number(attr(limitTag, 'upper')),
          }
        : undefined,
      mimic: mimicTag
        ? {
            joint: attr(mimicTag, 'joint') ?? '',
            multiplier: Number(attr(mimicTag, 'multiplier') ?? 1),
            offset: Number(attr(mimicTag, 'offset') ?? 0),
          }
        : undefined,
    }
  })
  return { name: attr(robotTag, 'name') ?? 'Articraft model', links, joints }
}

function buildModelDataFromRecord(repoRoot: string, recordId: string): ArticraftModelData {
  const recordPath = path.join(repoRoot, 'data', 'records', recordId)
  const record = asRecord(jsonFile(path.join(recordPath, 'record.json')))
  const revisionId = String(record.active_revision_id || 'rev_000001')
  const modelPyPath = path.join(recordPath, 'revisions', revisionId, 'model.py')
  const materializationPath = path.join(
    repoRoot,
    'data',
    'cache',
    'record_materialization',
    recordId,
  )
  const urdfPath = path.join(materializationPath, 'model.urdf')
  const compileReportPath = path.join(materializationPath, 'compile_report.json')
  const parsed = buildModelDataFromUrdf(urdfPath)
  const display = asRecord(record.display)
  const compileReport = existsSync(compileReportPath) ? asRecord(jsonFile(compileReportPath)) : {}
  const warnings = Array.isArray(compileReport.warnings)
    ? compileReport.warnings.map((warning) => {
        if (typeof warning === 'string') return warning
        const record = asRecord(warning)
        return String(record.message ?? JSON.stringify(warning))
      })
    : []
  const meshesDir = path.join(materializationPath, 'assets', 'meshes')
  const meshes = existsSync(meshesDir)
    ? readdirSync(meshesDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.obj'))
        .map((entry) => ({
          name: path.basename(entry.name, path.extname(entry.name)),
          objPath: path.join(
            'data',
            'cache',
            'record_materialization',
            recordId,
            'assets',
            'meshes',
            entry.name,
          ),
        }))
    : []
  return {
    recordId,
    name: String(display.title ?? parsed.name ?? recordId),
    links: parsed.links,
    joints: parsed.joints,
    meshes,
    modelPyPath,
    recordPath,
    warnings,
  }
}

async function generateModelWithModernCli(
  repoRoot: string,
  options: GenerateOptions,
): Promise<ArticraftModelData> {
  const env = { ...process.env }
  env.ARTICRAFT_REPO_ROOT ??= repoRoot
  env.ARTICRAFT_MODEL ||= env.AI_MODEL || env.NEXT_PUBLIC_AI_MODEL || ''
  env.DEEPSEEK_API_KEY ||= env.AI_API_KEY || env.NEXT_PUBLIC_AI_API_KEY || ''
  env.DEEPSEEK_BASE_URL ||= env.AI_BASE_URL || env.NEXT_PUBLIC_AI_BASE_URL || ''
  env.PYTHONUTF8 ??= '1'
  env.PYTHONIOENCODING ??= 'utf-8'

  const before = listRecordIds(repoRoot)
  const startedAtMs = Date.now()
  const args = ['generate', '--repo-root', repoRoot, options.prompt]
  if (options.model) args.push('--model', options.model)
  if (options.provider) args.push('--provider', options.provider)
  if (options.maxTurns !== undefined) args.push('--max-turns', String(options.maxTurns))
  if (options.imagePath) args.push('--image', options.imagePath)

  const generateCommand = modernCliInvocation(repoRoot, args)
  const output = await spawnAndCollect(generateCommand.command, generateCommand.args, {
    cwd: repoRoot,
    env,
    signal: options.signal,
    onProgress: options.onProgress,
  })
  const combinedOutput = `${output.stdout}\n${output.stderr}`
  const recordId =
    extractRecordId(combinedOutput) ?? newestCreatedRecordId(repoRoot, before, startedAtMs)
  if (!recordId) {
    throw new Error(
      `Articraft generation completed but no record id was found.\n\nOutput:\n${combinedOutput}`,
    )
  }

  const urdfPath = path.join(
    repoRoot,
    'data',
    'cache',
    'record_materialization',
    recordId,
    'model.urdf',
  )
  if (!existsSync(urdfPath)) {
    const compileCommand = modernCliInvocation(repoRoot, [
      'compile',
      '--repo-root',
      repoRoot,
      recordId,
      '--target',
      'full',
    ])
    await spawnAndCollect(compileCommand.command, compileCommand.args, {
      cwd: repoRoot,
      env,
      signal: options.signal,
      onProgress: options.onProgress,
    })
  }
  return buildModelDataFromRecord(repoRoot, recordId)
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
