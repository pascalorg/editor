import { findCatalogItem, searchCatalogItems } from '@pascal-app/core/lib/asset-catalog'
import { callConfiguredAi } from '@/lib/ai-provider'
import { buildFactoryAgentSystemPrompt } from './factory-agent-prompt'
import type {
  ProcessConnectionMedium,
  ProcessConnectionPlan,
  ProcessConnectionVisualKind,
  ProcessLineDomain,
  ProcessLineLayoutStyle,
  ProcessLinePlan,
  ProcessStationPlan,
} from './process-line-types'
import {
  allProcessTemplates,
  buildProcessLinePlanFromTemplate,
  matchProcessTemplate,
} from './process-template-registry'

export type FactoryPlan =
  | {
      kind: 'layout'
      reason: string
      layoutType: 'house' | 'room' | 'factory' | 'production_line' | 'unknown'
      suggestedOperations: string[]
    }
  | {
      kind: 'process_line'
      reason: string
      process: ProcessLinePlan
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
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

function integerValue(value: string | undefined) {
  if (!value) return undefined
  if (/^\d+$/.test(value)) return Number(value)
  const chineseDigits: Record<string, number> = {
    '\u4e00': 1,
    '\u4e8c': 2,
    '\u4e24': 2,
    '\u4e09': 3,
    '\u56db': 4,
    '\u4e94': 5,
    '\u516d': 6,
    '\u4e03': 7,
    '\u516b': 8,
    '\u4e5d': 9,
    '\u5341': 10,
  }
  return chineseDigits[value]
}

function clampInteger(value: number | undefined, min: number, max: number) {
  return value == null ? undefined : Math.max(min, Math.min(max, Math.floor(value)))
}

function slugValue(value: string, fallback: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return slug || fallback
}

function processDomain(value: unknown): ProcessLineDomain {
  return value === 'chemical' ||
    value === 'energy' ||
    value === 'food' ||
    value === 'assembly' ||
    value === 'logistics' ||
    value === 'metallurgy'
    ? value
    : 'generic'
}

function processLayoutStyle(value: unknown): ProcessLineLayoutStyle {
  return value === 'u_shape' || value === 'cell' || value === 'parallel_bays' ? value : 'linear'
}

const PROCESS_CONNECTION_VISUAL_KINDS: ProcessConnectionVisualKind[] = [
  'pipe',
  'cable_tray',
  'flow_arrow',
  'material_conveyor',
  'hot_material_chute',
  'air_duct',
  'hot_gas_duct',
]

function processConnectionVisualKind(
  value: unknown,
  medium?: ProcessConnectionMedium,
): ProcessConnectionVisualKind {
  if (value === 'busbar') return 'cable_tray'
  if (value === 'pneumatic_pipe') return 'pipe'
  if (value === 'fume_duct') return 'air_duct'
  if (value === 'hot_metal_transfer' || value === 'hot_metal_chute') return 'hot_material_chute'
  if (value === 'crane_transfer') return 'flow_arrow'
  if (
    typeof value === 'string' &&
    PROCESS_CONNECTION_VISUAL_KINDS.includes(value as ProcessConnectionVisualKind)
  ) {
    return value as ProcessConnectionVisualKind
  }
  return medium === 'power' ? 'cable_tray' : 'pipe'
}

function normalizeStation(value: unknown, index: number): ProcessStationPlan | null {
  if (!isRecord(value)) return null
  const label =
    stringValue(value.label) ??
    stringValue(value.name) ??
    stringValue(value.role) ??
    `Station ${index + 1}`
  const role = stringValue(value.role) ?? slugValue(label, `station_${index + 1}`)
  const id = stringValue(value.id) ?? slugValue(role, `station_${index + 1}`)
  if (!id || !role) return null
  return {
    id,
    label,
    ...(stringValue(value.displayLabel) ? { displayLabel: stringValue(value.displayLabel) } : {}),
    role,
    equipmentHint: stringValue(value.equipmentHint) ?? label,
    footprintHint:
      value.footprintHint === 'small' ||
      value.footprintHint === 'medium' ||
      value.footprintHint === 'large' ||
      value.footprintHint === 'long' ||
      value.footprintHint === 'tall'
        ? value.footprintHint
        : undefined,
    safetyTags: stringArray(value.safetyTags),
  }
}

function normalizeConnection(value: unknown): ProcessConnectionPlan | null {
  if (!isRecord(value)) return null
  const fromStationId = stringValue(value.fromStationId) ?? stringValue(value.from)
  const toStationId = stringValue(value.toStationId) ?? stringValue(value.to)
  if (!fromStationId || !toStationId) return null
  const medium =
    value.medium === 'water' ||
    value.medium === 'hydrogen' ||
    value.medium === 'oxygen' ||
    value.medium === 'power' ||
    value.medium === 'cooling' ||
    value.medium === 'material' ||
    value.medium === 'gas' ||
    value.medium === 'molten_metal'
      ? value.medium
      : undefined
  return {
    fromStationId,
    toStationId,
    medium,
    ...(stringValue(value.fromPortId) ? { fromPortId: stringValue(value.fromPortId) } : {}),
    ...(stringValue(value.toPortId) ? { toPortId: stringValue(value.toPortId) } : {}),
    visualKind: processConnectionVisualKind(value.visualKind, medium),
  }
}

function templateById(processId: string | undefined) {
  return processId
    ? allProcessTemplates().find((template) => template.processId === processId)
    : undefined
}

function promptQuantity(prompt: string, target: RegExp) {
  const numberToken = String.raw`(\d+|[\u4e00\u4e8c\u4e24\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341])`
  const beforeTarget = new RegExp(`${numberToken}\\s*(?:\u4e2a|\u6761|\u5957)?\\s*${target.source}`, 'i')
  const afterTarget = new RegExp(`${target.source}\\s*${numberToken}`, 'i')
  return integerValue(beforeTarget.exec(prompt)?.[1] ?? afterTarget.exec(prompt)?.[1])
}

function duplicateStation(
  station: ProcessStationPlan,
  index: number,
  overrides?: Partial<ProcessStationPlan>,
): ProcessStationPlan {
  return {
    ...station,
    id: `${station.id}_${index}`,
    label: `${station.label} ${index}`,
    ...(station.displayLabel ? { displayLabel: `${station.displayLabel} ${index}` } : {}),
    ...overrides,
  }
}

function duplicateConnection(
  connection: ProcessConnectionPlan,
  fromStationId: string,
  toStationId: string,
): ProcessConnectionPlan {
  return {
    ...connection,
    fromStationId,
    toStationId,
  }
}

function duplicateConnectionsForStationSet(
  connections: ProcessConnectionPlan[],
  stationIds: Set<string>,
  index: number,
) {
  return connections
    .filter(
      (connection) =>
        stationIds.has(connection.fromStationId) || stationIds.has(connection.toStationId),
    )
    .map((connection) =>
      duplicateConnection(
        connection,
        stationIds.has(connection.fromStationId)
          ? `${connection.fromStationId}_${index}`
          : connection.fromStationId,
        stationIds.has(connection.toStationId)
          ? `${connection.toStationId}_${index}`
          : connection.toStationId,
      ),
    )
}

function applyPromptProcessQuantities(plan: ProcessLinePlan, prompt: string): ProcessLinePlan {
  if (plan.processId !== 'cement_plant_full') return plan
  const clinkerLineCount = clampInteger(
    promptQuantity(prompt, /\u719f\u6599(?:\u5de5\u5e8f|\u7ebf|\u751f\u4ea7\u7ebf)/),
    1,
    8,
  )
  const cementMillCount = clampInteger(
    promptQuantity(prompt, /(?:\u6c34\u6ce5)?\u78e8(?:\u673a)?|cement\s+mill/),
    1,
    12,
  )
  if ((clinkerLineCount ?? 1) <= 1 && (cementMillCount ?? 1) <= 1) return plan

  const stations = [...plan.stations]
  const connections = [...plan.connections]
  const stationById = new Map(plan.stations.map((station) => [station.id, station]))
  const clinkerStationIds = new Set(['preheater_tower', 'rotary_kiln', 'kiln_hood', 'grate_cooler'])
  const clinkerStations = [...clinkerStationIds]
    .map((stationId) => stationById.get(stationId))
    .filter((station): station is ProcessStationPlan => Boolean(station))
  for (let index = 2; index <= (clinkerLineCount ?? 1); index += 1) {
    stations.push(...clinkerStations.map((station) => duplicateStation(station, index)))
    connections.push(...duplicateConnectionsForStationSet(plan.connections, clinkerStationIds, index))
  }

  const cementMill = stationById.get('cement_mill')
  if (cementMill) {
    const cementMillConnections = plan.connections.filter(
      (connection) =>
        connection.fromStationId === 'cement_mill' || connection.toStationId === 'cement_mill',
    )
    for (let index = 2; index <= (cementMillCount ?? 1); index += 1) {
      stations.push(duplicateStation(cementMill, index))
      connections.push(
        ...cementMillConnections.map((connection) =>
          duplicateConnection(
            connection,
            connection.fromStationId === 'cement_mill'
              ? `cement_mill_${index}`
              : connection.fromStationId,
            connection.toStationId === 'cement_mill' ? `cement_mill_${index}` : connection.toStationId,
          ),
        ),
      )
    }
  }

  const clinkerMultiplier = Math.max(0, (clinkerLineCount ?? 1) - 1)
  const millMultiplier = Math.max(0, (cementMillCount ?? 1) - 1)
  return {
    ...plan,
    dimensions: {
      length: Math.round(((plan.dimensions?.length ?? 66) * (1 + clinkerMultiplier * 0.12 + millMultiplier * 0.06)) * 10) / 10,
      width: Math.round(((plan.dimensions?.width ?? 28) * (1 + clinkerMultiplier * 0.18 + millMultiplier * 0.08)) * 10) / 10,
    },
    stations,
    connections,
    architecture: plan.architecture
      ? {
          ...plan.architecture,
          keyFocusStationIds: [
            ...(plan.architecture.keyFocusStationIds ?? []),
            ...stations
              .map((station) => station.id)
              .filter((id) => /^(preheater_tower|rotary_kiln|cement_mill)_\d+$/.test(id)),
          ],
        }
      : plan.architecture,
  }
}

function sourceDimensions(source: Record<string, unknown>, templatePlan?: ProcessLinePlan) {
  const dimensions = isRecord(source.dimensions) ? source.dimensions : {}
  return {
    length: numberValue(dimensions.length) ?? templatePlan?.dimensions?.length,
    width: numberValue(dimensions.width) ?? templatePlan?.dimensions?.width,
  }
}

function normalizeProcessLinePlan(value: unknown, fallbackPrompt: string): ProcessLinePlan | null {
  const source = isRecord(value) && isRecord(value.process) ? value.process : value
  if (!isRecord(source)) return null
  const processId = stringValue(source.processId)
  const explicitTemplate = templateById(processId)
  const template = explicitTemplate ?? matchProcessTemplate(fallbackPrompt)
  const templatePlan = template
    ? applyPromptProcessQuantities(buildProcessLinePlanFromTemplate(template, fallbackPrompt), fallbackPrompt)
    : undefined
  const stations = Array.isArray(source.stations)
    ? source.stations
        .map((station, index) => normalizeStation(station, index))
        .filter((station): station is ProcessStationPlan => Boolean(station))
    : []
  const connections = Array.isArray(source.connections)
    ? source.connections
        .map(normalizeConnection)
        .filter((connection): connection is ProcessConnectionPlan => Boolean(connection))
    : []

  if (stations.length < 2 && templatePlan) return templatePlan
  if (stations.length < 2) return null

  return {
    processId: processId ?? templatePlan?.processId,
    processLabel:
      stringValue(source.processLabel) ??
      stringValue(source.label) ??
      templatePlan?.processLabel ??
      fallbackPrompt,
    ...(templatePlan?.processDisplayLabel
      ? { processDisplayLabel: templatePlan.processDisplayLabel }
      : {}),
    ...(templatePlan?.architecture ? { architecture: { ...templatePlan.architecture } } : {}),
    ...(templatePlan?.sourcePack ? { sourcePack: { ...templatePlan.sourcePack } } : {}),
    domain: processDomain(source.domain ?? templatePlan?.domain),
    layoutStyle: processLayoutStyle(source.layoutStyle ?? templatePlan?.layoutStyle),
    dimensions: sourceDimensions(source, templatePlan),
    stations,
    connections: connections.length ? connections : (templatePlan?.connections ?? []),
    safetyTags: stringArray(source.safetyTags).length
      ? stringArray(source.safetyTags)
      : templatePlan?.safetyTags,
  }
}

function layoutType(value: unknown): FactoryLayoutType {
  return value === 'house' || value === 'room' || value === 'factory' || value === 'production_line'
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
  if (kind === 'process_line') {
    const process = normalizeProcessLinePlan(value, fallbackPrompt)
    if (!process) return null
    return {
      kind: 'process_line',
      reason,
      process,
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
  if (/\u4ea7\u7ebf|\u751f\u4ea7\u7ebf|\bproduction line\b|\bassembly line\b/i.test(prompt))
    return 'production_line'
  if (/\u5382\u623f|\u5de5\u5382|\u8f66\u95f4|\bfactory\b|\bworkshop\b/i.test(prompt))
    return 'factory'
  return 'unknown'
}

export function fallbackFactoryPlan(prompt: string): FactoryPlan {
  const normalized = prompt.trim()
  const processTemplate = matchProcessTemplate(normalized)
  if (processTemplate) {
    return {
      kind: 'process_line',
      reason:
        'Request matches a known process-line template; compose stations, equipment, and connections.',
      process: applyPromptProcessQuantities(
        buildProcessLinePlanFromTemplate(processTemplate, normalized),
        normalized,
      ),
    }
  }
  const type = inferLayoutType(normalized)
  const isProductionLine = type === 'production_line'
  const catalogMatches = searchCatalogItems({ query: normalized }).slice(0, 1)
  const catalogItem = catalogMatches[0]
  if (!isProductionLine && catalogItem) {
    return {
      kind: 'catalog_item',
      reason:
        'Request matches a provided catalog item; use the catalog item instead of geometry generation.',
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
      reason:
        'Request matches a provided catalog item; use the catalog item instead of geometry generation.',
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
  if (fallbackPlan.kind === 'process_line') {
    if (plan.kind !== 'process_line') return true
    if (plan.process.processId !== fallbackPlan.process.processId) return true
    const fallbackStationIds = new Set(fallbackPlan.process.stations.map((station) => station.id))
    const plannedStationIds = new Set(plan.process.stations.map((station) => station.id))
    const missingTemplateStations = [...fallbackStationIds].some((id) => !plannedStationIds.has(id))
    const explicitTopology =
      plan.process.stations.length > fallbackPlan.process.stations.length ||
      plan.process.connections.length > fallbackPlan.process.connections.length
    if (!explicitTopology && (missingTemplateStations || plannedStationIds.size !== fallbackStationIds.size)) {
      return true
    }
    return plan.process.connections.length < fallbackPlan.process.connections.length
  }
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
    '  "kind": "layout" | "process_line" | "catalog_item" | "geometry" | "missing",',
    '  "reason": "short reason",',
    '  "layoutType"?: "house" | "room" | "factory" | "production_line" | "unknown",',
    '  "process"?: { "processId"?: string, "processLabel": string, "domain": "chemical|energy|food|assembly|logistics|metallurgy|generic", "layoutStyle": "linear|u_shape|cell|parallel_bays", "stations": [{ "id": string, "label": string, "role": string, "equipmentHint": string }], "connections": [{ "fromStationId": string, "toStationId": string, "medium"?: "water|hydrogen|oxygen|power|cooling|material|gas|molten_metal", "visualKind": "pipe|cable_tray|flow_arrow|material_conveyor|hot_material_chute|air_duct|hot_gas_duct" }] },',
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
  params?: Record<string, unknown>
  signal?: AbortSignal
}): Promise<{ plan: FactoryPlan; source: 'llm' | 'fallback'; plannerText?: string }> {
  if (
    process.env.FACTORY_E2E_SMOKE === '1' ||
    input.params?.e2eSmoke === true ||
    input.params?.forceFallbackFactoryPlan === true
  ) {
    return { plan: fallbackFactoryPlan(input.prompt), source: 'fallback' }
  }

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
      typeof data.choices?.[0]?.message?.content === 'string' ? data.choices[0].message.content : ''
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
