import { callConfiguredAi } from '@/lib/ai-provider'
import { findCatalogItem, searchCatalogItems } from '@pascal-app/core/lib/asset-catalog'
import { buildFactoryAgentSystemPrompt } from './factory-agent-prompt'

export type FactoryPlan =
  | {
      kind: 'layout'
      reason: string
      layoutType: 'house' | 'room' | 'factory' | 'production_line' | 'unknown'
      suggestedOperations: string[]
    }
  | {
      kind: 'catalog_item'
      reason: string
      catalogItemId: string
      equipmentName: string
    }
  | {
      kind: 'geometry'
      reason: string
      equipmentName: string
      lineRole?: string
      desiredDimensions?: Record<string, unknown>
    }
  | {
      kind: 'missing'
      reason: string
      missingName: string
    }

type FactoryLayoutType = Extract<FactoryPlan, { kind: 'layout' }>['layoutType']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeToolArgumentsSource(raw: string) {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return fenced?.[1]?.trim() ?? trimmed
}

function extractFirstBalancedJsonObject(source: string) {
  const start = source.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < source.length; index += 1) {
    const char = source[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
  }
  return null
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function layoutType(value: unknown): FactoryLayoutType {
  return value === 'house' ||
    value === 'room' ||
    value === 'factory' ||
    value === 'production_line'
    ? value
    : 'unknown'
}

function normalizePlan(value: unknown, fallbackPrompt: string): FactoryPlan | null {
  if (!isRecord(value)) return null
  const kind = value.kind
  const reason = stringValue(value.reason) ?? 'Factory planner decision.'
  if (kind === 'layout') {
    return {
      kind: 'layout',
      reason,
      layoutType: layoutType(value.layoutType),
      suggestedOperations: stringArray(value.suggestedOperations),
    }
  }
  if (kind === 'catalog_item') {
    const catalogItemId = stringValue(value.catalogItemId)
    const item = catalogItemId ? findCatalogItem(catalogItemId) : undefined
    if (!item) return null
    return {
      kind: 'catalog_item',
      reason,
      catalogItemId: item.id,
      equipmentName: stringValue(value.equipmentName) ?? item.name,
    }
  }
  if (kind === 'geometry') {
    return {
      kind: 'geometry',
      reason,
      equipmentName: stringValue(value.equipmentName) ?? fallbackPrompt,
      lineRole: stringValue(value.lineRole),
      desiredDimensions: isRecord(value.desiredDimensions) ? value.desiredDimensions : undefined,
    }
  }
  if (kind === 'missing') {
    return {
      kind: 'missing',
      reason,
      missingName: stringValue(value.missingName) ?? fallbackPrompt,
    }
  }
  return null
}

export function parseFactoryPlan(content: string, fallbackPrompt: string): FactoryPlan | null {
  const source = normalizeToolArgumentsSource(content || '{}') || '{}'
  try {
    return normalizePlan(JSON.parse(source), fallbackPrompt)
  } catch {
    const firstObject = extractFirstBalancedJsonObject(source)
    if (!firstObject) return null
    try {
      return normalizePlan(JSON.parse(firstObject), fallbackPrompt)
    } catch {
      return null
    }
  }
}

const LAYOUT_PATTERNS = [
  /\u623f\u5b50|\u623f\u95f4|\u5382\u623f|\u5de5\u5382|\u8f66\u95f4|\u4ed3\u5e93|\u5efa\u7b51|\u5899|\u95e8|\u7a97|\u697c\u677f|\u5730\u677f|\u5929\u82b1|\u533a\u57df|\u5e03\u5c40|\u52a8\u7ebf|\u4ea7\u7ebf|\u751f\u4ea7\u7ebf/,
  /\b(house|room|factory shell|workshop|warehouse|building|wall|door|window|floor|zone|layout|production line|assembly line)\b/i,
]

const GEOMETRY_PATTERNS = [
  /\u8f93\u9001\u673a|\u4f20\u9001\u5e26|\u6cf5|\u98ce\u673a|\u98ce\u6247|\u7f50|\u53cd\u5e94\u91dc|\u53cd\u5e94\u5668|\u6405\u62cc\u7f50|\u7acb\u5f0f\u7f50|\u538b\u529b\u5bb9\u5668|\u538b\u7f29\u673a|\u6362\u70ed\u5668|\u673a\u5e8a|\u673a\u5668\u81c2|\u673a\u68b0\u81c2|\u63a7\u5236\u67dc|\u7535\u63a7\u67dc|\u7ba1\u9053|\u9600|\u88c5\u7f6e|\u8bbe\u5907/,
  /\b(conveyor|pump|fan|tank|reactor|reactor vessel|stirred tank|pressure vessel|compressor|heat exchanger|machine tool|lathe|robot arm|cabinet|pipe|valve|labeling machine|palletizer|equipment|device)\b/i,
]

function inferLayoutType(prompt: string): FactoryLayoutType {
  if (/\u623f\u5b50|\bhouse\b/i.test(prompt)) return 'house'
  if (/\u623f\u95f4|\broom\b/i.test(prompt)) return 'room'
  if (/\u4ea7\u7ebf|\u751f\u4ea7\u7ebf|\bproduction line\b|\bassembly line\b/i.test(prompt)) return 'production_line'
  if (/\u5382\u623f|\u5de5\u5382|\u8f66\u95f4|\bfactory\b|\bworkshop\b/i.test(prompt)) return 'factory'
  return 'unknown'
}

export function fallbackFactoryPlan(prompt: string): FactoryPlan {
  const normalized = prompt.trim()
  const type = inferLayoutType(normalized)
  const isProductionLine = type === 'production_line'
  const catalogMatches = searchCatalogItems({ query: normalized }).slice(0, 1)
  const catalogItem = catalogMatches[0]
  if (!isProductionLine && catalogItem) {
    return {
      kind: 'catalog_item',
      reason: 'Request matches a provided catalog item; use the catalog item instead of geometry generation.',
      catalogItemId: catalogItem.id,
      equipmentName: catalogItem.name,
    }
  }

  if (!isProductionLine && GEOMETRY_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return {
      kind: 'geometry',
      reason:
        'Request is for custom or missing equipment; use geometry generation after catalog lookup.',
      equipmentName: normalized,
    }
  }

  if (LAYOUT_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return {
      kind: 'layout',
      reason:
        'Request is architectural or layout work; use scene/MCP layout operations instead of geometry generation.',
      layoutType: type,
      suggestedOperations:
        type === 'house' || type === 'room'
          ? ['create_room', 'add_door', 'add_window', 'validate_scene']
          : ['create_story_shell', 'create_room', 'place_item/apply_patch', 'validate_scene'],
    }
  }

  if (catalogItem) {
    return {
      kind: 'catalog_item',
      reason: 'Request matches a provided catalog item; use the catalog item instead of geometry generation.',
      catalogItemId: catalogItem.id,
      equipmentName: catalogItem.name,
    }
  }

  if (GEOMETRY_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return {
      kind: 'geometry',
      reason:
        'Request is for custom or missing equipment; use geometry generation after catalog lookup.',
      equipmentName: normalized,
    }
  }

  return {
    kind: 'missing',
    reason: 'Could not confidently map the request to layout, catalog, or geometry capabilities.',
    missingName: normalized || 'unknown request',
  }
}

export function shouldPreferFallbackFactoryPlan(plan: FactoryPlan, fallbackPlan: FactoryPlan) {
  if (plan.kind === 'missing' && fallbackPlan.kind !== 'missing') return true
  if (fallbackPlan.kind === 'geometry' && plan.kind === 'layout') return true
  return (
    fallbackPlan.kind === 'layout' &&
    fallbackPlan.layoutType === 'production_line' &&
    (plan.kind !== 'layout' || plan.layoutType !== 'production_line')
  )
}

export function buildFactoryPlannerPrompt(prompt: string) {
  return [
    buildFactoryAgentSystemPrompt({ query: prompt }),
    '',
    '===== PLANNER TASK =====',
    'Decide exactly one route for the user request. Return strict JSON only; no markdown.',
    'Schema:',
    '{',
    '  "kind": "layout" | "catalog_item" | "geometry" | "missing",',
    '  "reason": "short reason",',
    '  "layoutType"?: "house" | "room" | "factory" | "production_line" | "unknown",',
    '  "suggestedOperations"?: ["create_room", "place_item", "apply_patch"],',
    '  "catalogItemId"?: "existing catalog id",',
    '  "equipmentName"?: "equipment name for catalog or geometry",',
    '  "lineRole"?: "station role",',
    '  "desiredDimensions"?: { "length"?: number, "width"?: number, "height"?: number },',
    '  "missingName"?: "unresolved requested object"',
    '}',
    '',
    `User request: ${prompt.trim()}`,
  ].join('\n')
}

export async function planFactoryRequest(input: {
  prompt: string
  signal?: AbortSignal
}): Promise<{ plan: FactoryPlan; source: 'llm' | 'fallback'; plannerText?: string }> {
  try {
    const { res, text } = await callConfiguredAi(
      {
        messages: [
          {
            role: 'system',
            content:
              'You are a strict JSON factory planning router. Return one JSON object and no prose.',
          },
          { role: 'user', content: buildFactoryPlannerPrompt(input.prompt) },
        ],
        max_tokens: 1200,
      },
      input.signal,
    )
    if (!res.ok) throw new Error(text)
    const data = JSON.parse(text)
    const content =
      typeof data.choices?.[0]?.message?.content === 'string'
        ? data.choices[0].message.content
        : ''
    const plan = parseFactoryPlan(content, input.prompt)
    if (plan) {
      const fallbackPlan = fallbackFactoryPlan(input.prompt)
      if (shouldPreferFallbackFactoryPlan(plan, fallbackPlan)) {
        return { plan: fallbackPlan, source: 'fallback', plannerText: content }
      }
      return { plan, source: 'llm', plannerText: content }
    }
  } catch {
    // Fall back below. The runner still records deterministic decisions.
  }
  return { plan: fallbackFactoryPlan(input.prompt), source: 'fallback' }
}
