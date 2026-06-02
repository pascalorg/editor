import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import type { AssetInput } from '@pascal-app/core'
import { type NextRequest, NextResponse } from 'next/server'
import {
  createGeneratedAssetId,
  findRepoRoot,
  generatedManifestPath,
  itemRoot,
  upsertGeneratedAsset,
} from '@/lib/generated-assets/manifest'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const execFileAsync = promisify(execFile)

const CATALOG_CATEGORIES = new Set([
  'safety',
  'lighting',
  'electronics',
  'equipment',
  'structural',
  'opening',
  'nature',
  'outdoor',
  'vehicle',
])

type Vec3 = [number, number, number]

type CadWorkerResult =
  | {
      status: 'generated'
      name: string
      sourcePath: string
      stepPath: string
      glbPath: string
      thumbnailPath: string
      logPath: string
      warnings?: string[]
    }
  | {
      status: 'failed'
      message: string
      warnings?: string[]
    }

type GlbAssetTransform = {
  dimensions: Vec3
  offset: Vec3
}

type CadIntent = {
  family: string
  materialColor?: string
  dimensions?: Record<string, number>
  mountingHoles?: Record<string, number | string>
  plannerSource?: 'llm' | 'fallback'
  plannerModel?: string
}

function readString(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function readBool(value: unknown, fallback: boolean) {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return fallback
  const normalized = value.trim().toLowerCase()
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true
  return fallback
}

function normalizeCatalogCategory(value: string) {
  return CATALOG_CATEGORIES.has(value) ? value : 'equipment'
}

function timeoutMs() {
  const seconds = Number(process.env.TEXT_TO_CAD_TIMEOUT_SECONDS ?? 45)
  return Math.max(10, Math.min(300, Number.isFinite(seconds) ? seconds : 45)) * 1000
}

function plannerTimeoutMs() {
  const seconds = Number(process.env.TEXT_TO_CAD_PLANNER_TIMEOUT_SECONDS ?? 12)
  return Math.max(3, Math.min(60, Number.isFinite(seconds) ? seconds : 12)) * 1000
}

function chatCompletionsUrl(baseUrl: string) {
  const trimmed = baseUrl.replace(/\/+$/, '')
  if (trimmed.endsWith('/chat/completions')) return trimmed
  return `${trimmed}/chat/completions`
}

function normalizeApiKey(value: string | undefined) {
  return value?.trim().replace(/^bearer\s+/i, '') || undefined
}

function aiThinking() {
  const value = (process.env.AI_THINKING || 'disabled').trim().toLowerCase()
  if (value === 'enabled' || value === 'true' || value === '1') return { type: 'enabled' }
  return { type: 'disabled' }
}

function extractJsonObject(content: string) {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const source = fenced ?? content
  const start = source.indexOf('{')
  const end = source.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('Planner did not return a JSON object')
  return JSON.parse(source.slice(start, end + 1)) as Record<string, unknown>
}

function finiteDimension(value: unknown, fallback: number, min: number, max: number) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

function fallbackCadIntent(prompt: string): CadIntent {
  const fourHoles = /四个|4\s*个|four/i.test(prompt)
  return {
    family: /支架|bracket|mount/i.test(prompt) ? 'motor_bracket' : 'generic_bracket',
    materialColor: /蓝色|blue/i.test(prompt)
      ? '#2563eb'
      : /黑色|black/i.test(prompt)
        ? '#111827'
        : '#cc2222',
    dimensions: {
      length: 1.4,
      width: 0.85,
      baseThickness: 0.12,
      wallHeight: 0.55,
      wallThickness: 0.12,
    },
    mountingHoles: {
      count: fourHoles ? 4 : 0,
      diameter: 0.12,
      marginX: 0.24,
      marginZ: 0.18,
    },
    plannerSource: 'fallback',
  }
}

function normalizeCadIntent(
  value: Record<string, unknown>,
  prompt: string,
  model?: string,
): CadIntent {
  const fallback = fallbackCadIntent(prompt)
  const dimensions =
    value.dimensions && typeof value.dimensions === 'object'
      ? (value.dimensions as Record<string, unknown>)
      : {}
  const holes =
    value.mountingHoles && typeof value.mountingHoles === 'object'
      ? (value.mountingHoles as Record<string, unknown>)
      : {}
  return {
    family: readString(value.family, fallback.family),
    materialColor: readString(value.materialColor, fallback.materialColor ?? '#cc2222'),
    dimensions: {
      length: finiteDimension(dimensions.length, fallback.dimensions?.length ?? 1.4, 0.3, 4),
      width: finiteDimension(dimensions.width, fallback.dimensions?.width ?? 0.85, 0.2, 3),
      baseThickness: finiteDimension(
        dimensions.baseThickness,
        fallback.dimensions?.baseThickness ?? 0.12,
        0.03,
        0.5,
      ),
      wallHeight: finiteDimension(
        dimensions.wallHeight,
        fallback.dimensions?.wallHeight ?? 0.55,
        0.1,
        2,
      ),
      wallThickness: finiteDimension(
        dimensions.wallThickness,
        fallback.dimensions?.wallThickness ?? 0.12,
        0.03,
        0.5,
      ),
    },
    mountingHoles: {
      count: Math.round(
        finiteDimension(
          holes.count,
          (fallback.mountingHoles?.count as number | undefined) ?? 0,
          0,
          12,
        ),
      ),
      diameter: finiteDimension(
        holes.diameter,
        (fallback.mountingHoles?.diameter as number | undefined) ?? 0.12,
        0.02,
        0.4,
      ),
      marginX: finiteDimension(
        holes.marginX,
        (fallback.mountingHoles?.marginX as number | undefined) ?? 0.24,
        0.05,
        1,
      ),
      marginZ: finiteDimension(
        holes.marginZ,
        (fallback.mountingHoles?.marginZ as number | undefined) ?? 0.18,
        0.05,
        1,
      ),
    },
    plannerSource: 'llm',
    plannerModel: model,
  }
}

async function resolveCadIntent(
  prompt: string,
): Promise<{ intent: CadIntent; warnings: string[] }> {
  const baseUrl =
    process.env.TEXT_TO_CAD_AI_BASE_URL ??
    process.env.AI_BASE_URL ??
    process.env.NEXT_PUBLIC_AI_BASE_URL
  const apiKey = normalizeApiKey(
    process.env.TEXT_TO_CAD_AI_API_KEY ??
      process.env.AI_API_KEY ??
      process.env.NEXT_PUBLIC_AI_API_KEY,
  )
  const model =
    process.env.TEXT_TO_CAD_MODEL ??
    process.env.AI_MODEL ??
    process.env.NEXT_PUBLIC_AI_MODEL ??
    'deepseek-chat'
  if (!baseUrl || !apiKey) {
    return {
      intent: fallbackCadIntent(prompt),
      warnings: ['DeepSeek/LLM CAD planner is not configured; used deterministic prompt parsing.'],
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), plannerTimeoutMs())
  try {
    const response = await fetch(chatCompletionsUrl(baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        thinking: aiThinking(),
        messages: [
          {
            role: 'system',
            content: [
              'You are a CAD intent planner. Return strict JSON only.',
              'Extract a compact parametric intent for a GLB/STEP CAD worker.',
              'Schema: {family, materialColor, dimensions:{length,width,baseThickness,wallHeight,wallThickness}, mountingHoles:{count,diameter,marginX,marginZ}}.',
              'Units are meters. For “带四个安装孔” set mountingHoles.count=4.',
            ].join('\n'),
          },
          { role: 'user', content: prompt },
        ],
      }),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`Planner HTTP ${response.status}`)
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> }
    const content = data.choices?.[0]?.message?.content
    if (!content) throw new Error('Planner returned no content')
    return { intent: normalizeCadIntent(extractJsonObject(content), prompt, model), warnings: [] }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      intent: fallbackCadIntent(prompt),
      warnings: [
        `DeepSeek/LLM CAD planner failed (${message}); used deterministic prompt parsing.`,
      ],
    }
  } finally {
    clearTimeout(timer)
  }
}

async function replaceAssetDir(tmpDir: string, assetDir: string) {
  await fs.rm(assetDir, { force: true, recursive: true })
  try {
    await fs.rename(tmpDir, assetDir)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'EPERM' && code !== 'EACCES' && code !== 'EXDEV') throw error

    await fs.rm(assetDir, { force: true, recursive: true })
    await fs.cp(tmpDir, assetDir, { recursive: true })
    await fs.rm(tmpDir, { force: true, recursive: true })
  }
}

function finitePositiveDimension(value: number) {
  return Number.isFinite(value) && value > 0 ? Math.max(0.05, value) : null
}

async function readGlbAssetTransform(modelPath: string): Promise<GlbAssetTransform | null> {
  try {
    const [{ Box3, Vector3 }, { GLTFLoader }] = await Promise.all([
      // @ts-expect-error apps/editor does not ship app-local three declarations.
      import('three'),
      // @ts-expect-error apps/editor does not ship app-local three declarations.
      import('three/examples/jsm/loaders/GLTFLoader.js'),
    ])
    ;(globalThis as unknown as { self?: unknown }).self ??= globalThis
    const buffer = await fs.readFile(modelPath)
    const arrayBuffer = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ) as ArrayBuffer
    const loader = new GLTFLoader()
    const gltf = await new Promise<{ scene: unknown }>((resolve, reject) => {
      loader.parse(arrayBuffer, '', resolve, reject)
    })
    const box = new Box3().setFromObject(gltf.scene)
    const size = new Vector3()
    box.getSize(size)
    const width = finitePositiveDimension(size.x)
    const height = finitePositiveDimension(size.y)
    const depth = finitePositiveDimension(size.z)
    if (!width || !height || !depth || !Number.isFinite(box.min.y)) return null

    return {
      dimensions: [width, height, depth],
      offset: [0, -box.min.y, 0],
    }
  } catch (error) {
    console.warn('[text-to-cad] Failed to read GLB bounds for asset placement', error)
    return null
  }
}

async function readWorkerResult(resultPath: string): Promise<CadWorkerResult> {
  const raw = await fs.readFile(resultPath, 'utf8')
  const parsed = JSON.parse(raw.replace(/^\uFEFF/, '')) as CadWorkerResult
  return parsed
}

export async function POST(req: NextRequest) {
  let payload: Record<string, unknown>
  try {
    payload = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request body' }, { status: 400 })
  }

  const prompt = readString(payload.prompt, '')
  if (!prompt) return NextResponse.json({ error: 'prompt is required' }, { status: 400 })

  const displayName = readString(payload.name, prompt)
  const category = normalizeCatalogCategory(readString(payload.category, 'equipment'))
  const shouldSave = readBool(payload.save, true)
  const planner = await resolveCadIntent(prompt)

  const repoRoot = await findRepoRoot()
  const root = itemRoot(repoRoot)
  const assetId = createGeneratedAssetId('text-to-cad', displayName)
  const assetDir = path.join(root, assetId)
  const tmpDir = `${assetDir}.tmp`
  const requestPath = path.join(tmpDir, 'request.json')
  const workerPath = path.join(repoRoot, 'tools', 'cad-worker', 'worker.mjs')

  try {
    await fs.rm(tmpDir, { force: true, recursive: true })
    await fs.mkdir(tmpDir, { recursive: true })
    await fs.writeFile(
      requestPath,
      `${JSON.stringify(
        {
          prompt,
          name: displayName,
          units: readString(payload.units, 'mm'),
          cadIntent: planner.intent,
          outputs: ['step', 'glb', 'thumbnail'],
          constraints: {
            maxRuntimeMs: timeoutMs(),
            maxOutputMb: 50,
          },
        },
        null,
        2,
      )}\n`,
      'utf8',
    )

    await execFileAsync(
      process.execPath,
      [workerPath, 'generate', '--input', requestPath, '--output', tmpDir],
      {
        cwd: repoRoot,
        timeout: timeoutMs(),
        windowsHide: true,
        env: {
          ...process.env,
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          TEMP: process.env.TEMP,
          TMP: process.env.TMP,
        },
        maxBuffer: 1024 * 1024,
      },
    )

    const workerResult = await readWorkerResult(path.join(tmpDir, 'result.json'))
    if (workerResult.status !== 'generated') {
      const log = await fs.readFile(path.join(tmpDir, 'run.log'), 'utf8').catch(() => '')
      return NextResponse.json(
        {
          status: 'failed',
          error: workerResult.message,
          warnings: workerResult.warnings ?? [],
          log,
        },
        { status: 502 },
      )
    }

    const modelPath = path.join(tmpDir, workerResult.glbPath)
    const transform = await readGlbAssetTransform(modelPath)
    await fs.writeFile(
      path.join(tmpDir, 'metadata.json'),
      `${JSON.stringify(
        {
          source: 'text-to-cad',
          prompt,
          cadIntent: planner.intent,
          name: displayName,
          createdAt: new Date().toISOString(),
          worker: workerResult,
          assetTransform: transform,
          mode:
            planner.intent.plannerSource === 'llm'
              ? 'llm-planned-parametric-preview'
              : 'fallback-parametric-preview',
        },
        null,
        2,
      )}\n`,
      'utf8',
    )

    await replaceAssetDir(tmpDir, assetDir)

    const asset: AssetInput = {
      id: assetId,
      category,
      name: displayName,
      thumbnail: `/items/${assetId}/${workerResult.thumbnailPath}`,
      floorPlanUrl: `/items/${assetId}/${workerResult.thumbnailPath}`,
      source: 'mine',
      src: `/items/${assetId}/${workerResult.glbPath}`,
      dimensions: transform?.dimensions ?? [1.2, 0.66, 0.8],
      offset: transform?.offset ?? [0, 0, 0],
      tags: ['floor', 'generated', 'text-to-cad', 'cad'],
    }

    if (shouldSave) {
      await upsertGeneratedAsset(
        generatedManifestPath(repoRoot),
        asset as AssetInput & { id: string; source: 'mine' },
      )
    }

    return NextResponse.json({
      status: 'generated',
      asset,
      saved: shouldSave,
      cad: {
        sourceCadUrl: `/items/${assetId}/${workerResult.sourcePath}`,
        stepUrl: `/items/${assetId}/${workerResult.stepPath}`,
        logUrl: `/items/${assetId}/${workerResult.logPath}`,
        metadataUrl: `/items/${assetId}/metadata.json`,
      },
      warnings: [...planner.warnings, ...(workerResult.warnings ?? [])],
    })
  } catch (error) {
    await fs.rm(tmpDir, { force: true, recursive: true }).catch(() => {})
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ status: 'failed', error: message }, { status: 500 })
  }
}
