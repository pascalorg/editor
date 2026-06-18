import { searchCatalogItems } from '@pascal-app/core/lib/asset-catalog'
import type { AssetInput } from '@pascal-app/core/schema'
import { ItemNode, ZoneNode } from '@pascal-app/core/schema'
import type {
  GeneratedGeometryCreatePatch,
  GeneratedGeometryPlacementSpec,
} from '../../../../packages/editor/src/lib/ai-generated-geometry-nodes'
import {
  buildFactoryLayoutCreatePatches,
  inferFactoryLayoutDimensions,
  type FactoryLayoutPatchPlan,
} from './factory-layout-patches'
import type { FactoryPlan } from './factory-planner'

type LayoutPlan = Extract<FactoryPlan, { kind: 'layout' }>
type Vec2 = [number, number]

type MissingAsset = {
  name: string
  reason: string
  required: boolean
}

export type FactoryLineStation = {
  name: string
  role: string
  index: number
  asset?: AssetInput
}

export type FactoryLayoutComposerResult = FactoryLayoutPatchPlan & {
  missingAssets: MissingAsset[]
  stations: FactoryLineStation[]
}

const DEFAULT_LINE_STATIONS = [
  { name: 'Feeding station', role: 'feeding' },
  { name: 'Processing station', role: 'process' },
  { name: 'Inspection station', role: 'inspection' },
  { name: 'Packing station', role: 'packing' },
]

const KNOWN_STATION_PATTERNS: Array<{ name: string; role: string; patterns: RegExp[] }> = [
  {
    name: '\u4e0a\u6599\u8f93\u9001\u673a',
    role: 'feeding_conveyor',
    patterns: [/\u4e0a\u6599\u8f93\u9001\u673a/, /feeding\s+conveyor/i],
  },
  {
    name: '\u51b2\u6d17\u8bbe\u5907',
    role: 'washer',
    patterns: [/\u51b2\u6d17\u8bbe\u5907/, /washer|rins(er|ing)/i],
  },
  {
    name: '\u704c\u88c5\u673a',
    role: 'filler',
    patterns: [/\u704c\u88c5\u673a/, /filler|filling\s+machine/i],
  },
  {
    name: '\u65cb\u76d6\u673a',
    role: 'capper',
    patterns: [/\u65cb\u76d6\u673a/, /capper|capping\s+machine/i],
  },
  {
    name: '\u8d34\u6807\u673a',
    role: 'labeler',
    patterns: [/\u8d34\u6807\u673a/, /labeler|labeling\s+machine/i],
  },
  {
    name: '\u672b\u7aef\u6253\u5305\u533a',
    role: 'packing',
    patterns: [/\u6253\u5305\u533a|\u5305\u88c5\u533a|\u5305\u88c5\u673a/, /packing|packaging/i],
  },
]

const ROLE_FALLBACK_QUERIES: Record<string, string[]> = {
  pipe: ['factory straight pipe'],
  piping: ['factory straight pipe'],
  barrel: ['factory barrel'],
  tank: ['factory barrel'],
  storage: ['factory barrel', 'shelf'],
  packing: ['shelf'],
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function paramsStations(params?: Record<string, unknown>) {
  const value = params?.stations
  if (!Array.isArray(value)) return []
  return value
    .map((entry, index) => {
      if (typeof entry === 'string') return { name: entry.trim(), role: roleFromName(entry), index }
      if (!isRecord(entry)) return null
      const name = stringValue(entry.name) ?? stringValue(entry.label) ?? stringValue(entry.equipmentName)
      if (!name) return null
      return { name, role: stringValue(entry.role) ?? roleFromName(name), index }
    })
    .filter((station): station is { name: string; role: string; index: number } => Boolean(station))
}

function cleanStationName(value: string) {
  return value
    .replace(/^\s*(?:and|then|\u548c|\u4ee5\u53ca|\u5e76)?\s*/i, '')
    .replace(/\s*(?:\u8fde\u63a5|\u76f8\u8fde).*$/, '')
    .trim()
}

function stationsFromPromptList(prompt: string) {
  const listMatch = prompt.match(/(?:\u5305\u542b|\u5305\u62ec|\u4f9d\u6b21\u4e3a|\u4f9d\u6b21\u662f)[:\uff1a]\s*([^\u3002.!]+)/)
  if (!listMatch?.[1]) return []
  return listMatch[1]
    .split(/[\u3001,\uff0c;\uff1b]/)
    .map(cleanStationName)
    .filter(Boolean)
    .map((name, index) => ({ name, role: roleFromName(name), index }))
}

function stationsFromKnownTerms(prompt: string) {
  const stations: Array<{ name: string; role: string; index: number; foundAt: number }> = []
  for (const candidate of KNOWN_STATION_PATTERNS) {
    const foundAt = candidate.patterns
      .map((pattern) => prompt.search(pattern))
      .filter((index) => index >= 0)
      .sort((a, b) => a - b)[0]
    if (foundAt != null) {
      stations.push({ name: candidate.name, role: candidate.role, index: stations.length, foundAt })
    }
  }
  return stations
    .sort((a, b) => a.foundAt - b.foundAt)
    .map(({ foundAt: _foundAt, ...station }, index) => ({ ...station, index }))
}

function roleFromName(name: string) {
  const match = KNOWN_STATION_PATTERNS.find((candidate) =>
    candidate.patterns.some((pattern) => pattern.test(name)),
  )
  if (match) return match.role
  const normalized = name.toLowerCase()
  if (normalized.includes('pipe')) return 'piping'
  if (normalized.includes('barrel') || normalized.includes('tank')) return 'storage'
  return normalized.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'station'
}

export function extractFactoryLineStations(input: {
  prompt: string
  params?: Record<string, unknown>
}): Array<{ name: string; role: string; index: number }> {
  const explicit = paramsStations(input.params)
  const stations = explicit.length
    ? explicit
    : stationsFromPromptList(input.prompt).length
      ? stationsFromPromptList(input.prompt)
      : stationsFromKnownTerms(input.prompt)
  const finalStations = stations.length
    ? stations
    : DEFAULT_LINE_STATIONS.map((station, index) => ({ ...station, index }))

  const seen = new Set<string>()
  return finalStations.filter((station) => {
    const key = `${station.role}:${station.name}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function resolveCatalogAsset(station: Pick<FactoryLineStation, 'name' | 'role'>) {
  const direct = searchCatalogItems({ query: station.name, category: 'equipment' })[0]
  if (direct) return direct

  const fallbackQueries = ROLE_FALLBACK_QUERIES[station.role] ?? []
  for (const query of fallbackQueries) {
    const match = searchCatalogItems({ query, category: 'equipment' })[0]
    if (match) return match
  }
  return undefined
}

function rectanglePolygon(centerX: number, centerZ: number, length: number, width: number): Vec2[] {
  const halfL = length / 2
  const halfW = width / 2
  return [
    [centerX - halfL, centerZ - halfW],
    [centerX + halfL, centerZ - halfW],
    [centerX + halfL, centerZ + halfW],
    [centerX - halfL, centerZ + halfW],
  ]
}

function patchParentId(placement: GeneratedGeometryPlacementSpec) {
  return placement.parentId == null ? undefined : (placement.parentId as never)
}

function createLineBackbonePatch(input: {
  prompt: string
  plan: LayoutPlan
  placement: GeneratedGeometryPlacementSpec
  length: number
  centerX: number
  centerZ: number
}) {
  const node = ZoneNode.parse({
    name: 'Production line backbone',
    polygon: rectanglePolygon(input.centerX, input.centerZ, input.length, 0.5),
    color: '#f59e0b',
    metadata: {
      generatedBy: input.placement.generatedBy ?? 'factory-agent',
      factoryLayoutType: input.plan.layoutType,
      sourcePrompt: input.prompt,
      role: 'production-line-backbone',
      composerTool: 'factory_layout_composer',
    },
  })
  const parentId = patchParentId(input.placement)
  return { op: 'create' as const, node, ...(parentId ? { parentId } : {}) }
}

function createStationPatches(input: {
  prompt: string
  plan: LayoutPlan
  placement: GeneratedGeometryPlacementSpec
  stations: FactoryLineStation[]
  length: number
  width: number
  centerX: number
  centerZ: number
}) {
  const parentId = patchParentId(input.placement)
  const spacing = input.length / (input.stations.length + 1)
  const stationLength = Math.max(0.8, Math.min(1.6, spacing * 0.55))
  const stationWidth = Math.max(0.8, Math.min(1.4, input.width * 0.32))
  const zonePatches: GeneratedGeometryCreatePatch[] = []
  const itemPatches: GeneratedGeometryCreatePatch[] = []
  const missingAssets: MissingAsset[] = []

  input.stations.forEach((station, index) => {
    const x = input.centerX - input.length / 2 + spacing * (index + 1)
    const z = input.centerZ
    const stationZone = ZoneNode.parse({
      name: station.name,
      polygon: rectanglePolygon(x, z, stationLength, stationWidth),
      color: station.asset ? '#22c55e' : '#f97316',
      metadata: {
        generatedBy: input.placement.generatedBy ?? 'factory-agent',
        factoryLayoutType: input.plan.layoutType,
        sourcePrompt: input.prompt,
        composerTool: 'factory_layout_composer',
        role: 'production-line-station',
        stationRole: station.role,
        stationIndex: index,
        missingEquipment: !station.asset,
        ...(station.asset ? { catalogItemId: station.asset.id } : {}),
      },
    })
    zonePatches.push({ op: 'create', node: stationZone, ...(parentId ? { parentId } : {}) })

    if (!station.asset) {
      missingAssets.push({
        name: station.name,
        reason: 'No catalog item matched this production-line station yet; generate it with primitive geometry in the next phase.',
        required: true,
      })
      return
    }

    const item = ItemNode.parse({
      name: station.asset.name,
      position: [x, 0, z],
      rotation: [0, 0, 0],
      asset: station.asset,
      metadata: {
        generatedBy: input.placement.generatedBy ?? 'factory-agent',
        catalogItemId: station.asset.id,
        factoryLayoutType: input.plan.layoutType,
        sourcePrompt: input.prompt,
        composerTool: 'factory_layout_composer',
        stationRole: station.role,
        stationIndex: index,
        ...input.placement.metadata,
      },
    })
    itemPatches.push({ op: 'create', node: item, ...(parentId ? { parentId } : {}) })
  })

  return { patches: [...zonePatches, ...itemPatches], missingAssets }
}

export function composeFactoryProductionLineLayout(input: {
  prompt: string
  plan: LayoutPlan
  placement: GeneratedGeometryPlacementSpec
  params?: Record<string, unknown>
}): FactoryLayoutComposerResult {
  const base = buildFactoryLayoutCreatePatches(input)
  const dimensions = inferFactoryLayoutDimensions(input)
  const centerX = input.placement.position?.[0] ?? 0
  const centerZ = input.placement.position?.[2] ?? 0
  const stations = extractFactoryLineStations({ prompt: input.prompt, params: input.params }).map(
    (station) => ({ ...station, asset: resolveCatalogAsset(station) }),
  )
  const backbonePatch = createLineBackbonePatch({
    prompt: input.prompt,
    plan: input.plan,
    placement: input.placement,
    length: dimensions.length,
    centerX,
    centerZ,
  })
  const stationPlan = createStationPatches({
    prompt: input.prompt,
    plan: input.plan,
    placement: input.placement,
    stations,
    length: dimensions.length,
    width: dimensions.width,
    centerX,
    centerZ,
  })
  const patches = [...base.patches, backbonePatch, ...stationPlan.patches]

  return {
    patches,
    nodeIds: patches.map((patch) => patch.node.id),
    created: patches.map((patch) => patch.node.name ?? patch.node.type),
    summary: `${base.summary}; ${stations.length} production-line stations composed`,
    missingAssets: stationPlan.missingAssets,
    stations,
  }
}

export function composeFactoryLayout(input: {
  prompt: string
  plan: LayoutPlan
  placement: GeneratedGeometryPlacementSpec
  params?: Record<string, unknown>
}): FactoryLayoutComposerResult {
  if (input.plan.layoutType === 'production_line') return composeFactoryProductionLineLayout(input)
  const base = buildFactoryLayoutCreatePatches(input)
  return { ...base, missingAssets: [], stations: [] }
}
