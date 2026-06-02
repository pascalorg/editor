import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import { type NextRequest, NextResponse } from 'next/server'
import type { SemanticJSON } from '@pascal-app/core/importers'
import { writeRunOutput } from '@pascal-app/core/job-store'

// ─── Constants ────────────────────────────────────────────────────────────────

// Sonnet-class model with vision support (configurable via env for future upgrades).
const VISION_MODEL =
  (process.env['VISION_MODEL'] as string | undefined) ?? 'claude-sonnet-4-5-20251001'

// Maximum accepted base64 payload (≈ 5 MB decoded image).
// Rejects oversized requests before they reach the Anthropic API.
const MAX_BASE64_LEN = 7 * 1024 * 1024 // 7 MB base64 string ≈ 5 MB decoded

// Server-side timeout — slightly longer than the client's 10 s so the client
// abort fires first and the route can return a clean fallback shape.
const SERVER_TIMEOUT_MS = 14_000

// ─── Prompt loading ───────────────────────────────────────────────────────────

let promptCache: string | null = null

async function getSystemPrompt(): Promise<string> {
  if (promptCache) return promptCache

  // process.cwd() is the app dir when started from apps/editor,
  // but the monorepo root when started via bun --filter from root.
  const candidates = [
    join(process.cwd(), 'app/api/vision-analyze/prompts/floor-plan-analyzer.md'),
    join(process.cwd(), 'apps/editor/app/api/vision-analyze/prompts/floor-plan-analyzer.md'),
  ]

  let raw: string | null = null
  for (const p of candidates) {
    try { raw = await readFile(p, 'utf-8'); break } catch { /* try next */ }
  }
  if (!raw) throw new Error('floor-plan-analyzer.md not found in any candidate path')

  // Strip file-level comment lines (starting with #) and separator lines (---).
  const lines = raw.split('\n')
  const bodyStart = lines.findIndex(
    l => l.trim() !== '' && !l.startsWith('#') && l.trim() !== '---',
  )
  promptCache = lines.slice(bodyStart).join('\n').trim()
  return promptCache
}

// ─── Response normalisation ───────────────────────────────────────────────────

const VALID_OPENING_TYPES = new Set(['door', 'window', 'sliding_door', 'opening'])
const VALID_WALL_TYPES = new Set(['exterior', 'interior', 'load_bearing'])
const VALID_FACINGS = new Set(['north', 'south', 'east', 'west'])
const MIN_CONFIDENCE = 0.55

/**
 * Coerce and validate the raw model response into a SemanticJSON object.
 *
 * - Accepts `wallHints` as an alias for `wallTypes` in case the model drifts.
 * - Drops any entry whose `confidence` is below MIN_CONFIDENCE.
 * - Returns a valid-false fallback if the overall structure is unusable.
 */
export function normalizeSemanticResponse(raw: unknown): SemanticJSON {
  const fallback = (reason: string): SemanticJSON => ({
    valid: false,
    reason,
    confidence: 0,
    rooms: [],
    openings: [],
    wallTypes: [],
    warnings: [],
  })

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return fallback('invalid_response_shape')
  }

  const r = raw as Record<string, unknown>

  // valid=false path — trust the model's assessment
  if (r['valid'] === false) {
    return {
      valid: false,
      reason: typeof r['reason'] === 'string' ? r['reason'] : 'model_rejected',
      confidence: 0,
      rooms: [],
      openings: [],
      wallTypes: [],
      warnings: [],
    }
  }

  const confidence = typeof r['confidence'] === 'number' ? r['confidence'] : 0
  if (confidence < MIN_CONFIDENCE) return fallback('confidence_too_low')

  // Rooms
  const rawRooms = Array.isArray(r['rooms']) ? r['rooms'] : []
  const rooms = rawRooms
    .filter((room): room is Record<string, unknown> => typeof room === 'object' && room !== null)
    .filter(room => typeof room['confidence'] !== 'number' || room['confidence'] >= MIN_CONFIDENCE)
    .map(room => ({
      name: typeof room['name'] === 'string' ? room['name'] : '未知房间',
      center: normalizeRelCoord(room['center']),
      approxAreaM2: typeof room['approxAreaM2'] === 'number' ? Math.round(room['approxAreaM2']) : 0,
      confidence: typeof room['confidence'] === 'number' ? round2(room['confidence']) : 0,
    }))

  // Openings — accept both 'location' and 'position' field names
  const rawOpenings = Array.isArray(r['openings']) ? r['openings'] : []
  const openings = rawOpenings
    .filter((o): o is Record<string, unknown> => typeof o === 'object' && o !== null)
    .filter(o => typeof o['confidence'] !== 'number' || o['confidence'] >= MIN_CONFIDENCE)
    .map(o => {
      const type = VALID_OPENING_TYPES.has(String(o['type']))
        ? (String(o['type']) as SemanticJSON['openings'][number]['type'])
        : 'opening'
      const location = normalizeRelCoord(o['location'] ?? o['position'])
      const facing = VALID_FACINGS.has(String(o['facing']))
        ? (String(o['facing']) as 'north' | 'south' | 'east' | 'west')
        : undefined
      return {
        type,
        location,
        ...(facing !== undefined ? { facing } : {}),
        confidence: typeof o['confidence'] === 'number' ? round2(o['confidence']) : 0,
      }
    })

  // wallTypes — accept 'wallHints' as alias (prompt drift guard)
  const rawWallTypes = Array.isArray(r['wallTypes'])
    ? r['wallTypes']
    : Array.isArray(r['wallHints'])
      ? r['wallHints']
      : []

  const wallTypes = rawWallTypes
    .filter((w): w is Record<string, unknown> => typeof w === 'object' && w !== null)
    .filter(w => typeof w['confidence'] !== 'number' || w['confidence'] >= 0.7)
    .map(w => ({
      location: normalizeRelCoord(w['location']),
      type: VALID_WALL_TYPES.has(String(w['type']))
        ? (String(w['type']) as SemanticJSON['wallTypes'][number]['type'])
        : 'interior',
      confidence: typeof w['confidence'] === 'number' ? round2(w['confidence']) : 0,
    }))

  // Warnings
  const warnings = Array.isArray(r['warnings'])
    ? r['warnings'].filter((w): w is string => typeof w === 'string')
    : []

  return {
    valid: true,
    confidence: round2(confidence),
    rooms,
    openings,
    wallTypes,
    warnings,
  }
}

function normalizeRelCoord(raw: unknown): [number, number] {
  if (Array.isArray(raw) && raw.length >= 2) {
    const x = typeof raw[0] === 'number' ? Math.max(0, Math.min(1, raw[0])) : 0.5
    const y = typeof raw[1] === 'number' ? Math.max(0, Math.min(1, raw[1])) : 0.5
    return [round2(x), round2(y)]
  }
  return [0.5, 0.5]
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── API key guard ─────────────────────────────────────────────────────────
  const apiKey = process.env['ANTHROPIC_API_KEY']
  if (!apiKey) {
    return NextResponse.json(
      { error: 'ANTHROPIC_API_KEY not configured' },
      { status: 503 },
    )
  }

  // ── Parse + validate request body ────────────────────────────────────────
  let imageDataUrl: string
  let jobId: string | undefined
  try {
    const body = (await req.json()) as { imageDataUrl?: string; jobId?: string }
    imageDataUrl = body.imageDataUrl ?? ''
    jobId = body.jobId
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!imageDataUrl.startsWith('data:image/')) {
    return NextResponse.json(
      { error: 'imageDataUrl must start with data:image/' },
      { status: 400 },
    )
  }

  const commaIdx = imageDataUrl.indexOf(',')
  if (commaIdx === -1) {
    return NextResponse.json({ error: 'Malformed data URL' }, { status: 400 })
  }

  const base64Data = imageDataUrl.slice(commaIdx + 1)

  if (base64Data.length > MAX_BASE64_LEN) {
    return NextResponse.json(
      { error: `Image too large (max ${MAX_BASE64_LEN / 1024 / 1024} MB base64)` },
      { status: 413 },
    )
  }

  // Determine media type — only png and jpeg are accepted by the Anthropic API
  const rawMediaType = imageDataUrl.slice(5, commaIdx).replace(';base64', '')
  const mediaType: 'image/png' | 'image/jpeg' =
    rawMediaType === 'image/jpeg' ? 'image/jpeg' : 'image/png'

  // ── Load prompt (module-level cache) ──────────────────────────────────────
  let systemPrompt: string
  try {
    systemPrompt = await getSystemPrompt()
  } catch (err) {
    console.error('[vision-analyze] failed to load system prompt:', err)
    return channelBFallback('prompt_load_failed')
  }

  // ── Call Anthropic Vision API ──────────────────────────────────────────────
  const client = new Anthropic({ apiKey })
  const timeoutCtrl = new AbortController()
  const timeoutId = setTimeout(() => timeoutCtrl.abort(), SERVER_TIMEOUT_MS)

  let rawText: string
  try {
    const message = await client.messages.create(
      {
        model: VISION_MODEL,
        max_tokens: 2048,
        // Prompt caching: the system prompt is large and identical across
        // all requests — cache it to save input tokens (5-min TTL).
        system: [
          {
            type: 'text',
            text: systemPrompt,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: mediaType, data: base64Data },
              },
              {
                type: 'text',
                text: '请分析这张建筑平面图并返回 JSON 对象，严格遵循系统提示中的格式要求。',
              },
            ],
          },
        ],
      },
      { signal: timeoutCtrl.signal },
    )

    rawText = message.content.find(b => b.type === 'text')?.text ?? ''
  } catch (err) {
    const isAbort =
      err instanceof Error && (err.name === 'AbortError' || err.message.includes('aborted'))
    const reason = isAbort ? 'server_timeout' : (err instanceof Error ? err.message : 'api_error')
    console.error('[vision-analyze] Anthropic API error:', reason)
    return channelBFallback(reason, isAbort ? 504 : 502)
  } finally {
    clearTimeout(timeoutId)
  }

  // ── Parse + normalise model output ────────────────────────────────────────
  let parsed: unknown
  try {
    // Strip accidental markdown fences if the model ignores the instruction
    const cleaned = rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
    parsed = JSON.parse(cleaned)
  } catch {
    console.warn('[vision-analyze] model returned non-JSON:', rawText.slice(0, 200))
    return channelBFallback('model_returned_non_json')
  }

  const semantic = normalizeSemanticResponse(parsed)

  let semanticFile: string | undefined
  if (jobId) {
    try {
      semanticFile = await writeRunOutput(jobId, 'semantic', semantic)
    } catch (err) {
      console.warn('[vision-analyze] failed to save semantic output for job', jobId, err)
    }
  }

  return NextResponse.json({ ...semantic, ...(semanticFile ? { semanticFile } : {}) })
}

/** Returns a valid "channel B unavailable" shape so the client continues with Channel A. */
function channelBFallback(reason: string, status = 200): NextResponse {
  const body: SemanticJSON = {
    valid: false,
    reason,
    confidence: 0,
    rooms: [],
    openings: [],
    wallTypes: [],
    warnings: [],
  }
  return NextResponse.json(body, { status })
}
