import fs from 'node:fs'
import path from 'node:path'
import type {
  ProcessConnectionPlan,
  ProcessConnectionVisualKind,
  ProcessLineDomain,
  ProcessLineLayoutStyle,
  ProcessLinePlan,
  ProcessStationPlan,
} from './process-line-types'
import type { ProcessTemplate } from './process-template-registry'

type IndustryFactoryManifest = {
  id: string
  industry: string
  version: string
  processTemplates?: string[]
  factoryArchitectures?: string[]
}

export type IndustryPackRef = {
  id: string
  version: string
  industry?: string
}

type RawProcessTemplate = {
  processId?: unknown
  processLabel?: unknown
  processDisplayLabel?: unknown
  domain?: unknown
  aliases?: unknown
  requiredRoles?: unknown
  defaultLayoutStyle?: unknown
  defaultDimensions?: unknown
  safetyTags?: unknown
  stations?: unknown
  connections?: unknown
}

let cachedTemplates: ProcessTemplate[] | undefined
let cachedArchitectures: IndustryFactoryArchitecture[] | undefined
let cachedTemplatesSignature: string | undefined
let cachedArchitecturesSignature: string | undefined

type FactoryArchitectureScope = {
  id: string
  label: string
  aliases: string[]
  includeModules: string[]
}

type FactoryArchitectureModule = {
  id: string
  displayLabel?: string
  order: number
  stationIds: string[]
}

type FactoryArchitectureLayoutHints = {
  highestStationId?: string
  longAxisStationId?: string
  sideBranchStationIds?: string[]
  omitPerimeterWalls?: boolean
}

export type IndustryFactoryArchitecture = {
  id: string
  label: string
  industry: string
  processId: string
  layoutStyle: ProcessLineLayoutStyle
  defaultDimensions: { length: number; width: number }
  scopes: FactoryArchitectureScope[]
  modules: FactoryArchitectureModule[]
  layoutHints: FactoryArchitectureLayoutHints
  sourcePack: {
    id: string
    version: string
    industry: string
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

function booleanValue(value: unknown) {
  return typeof value === 'boolean' ? value : undefined
}

function semverParts(version: string | undefined) {
  return (version ?? '0.0.0').split('.').map((part) => Number.parseInt(part, 10) || 0)
}

function compareSemver(left: string | undefined, right: string | undefined) {
  const leftParts = semverParts(left)
  const rightParts = semverParts(right)
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

function keepLatestByPackAndResource<T extends { sourcePack?: IndustryPackRef }>(
  values: T[],
  resourceId: (value: T) => string,
) {
  const byKey = new Map<string, T>()
  for (const value of values) {
    const packId = value.sourcePack?.id ?? 'builtin'
    const key = `${packId}:${resourceId(value)}`
    const previous = byKey.get(key)
    if (!previous || compareSemver(value.sourcePack?.version, previous.sourcePack?.version) > 0) {
      byKey.set(key, value)
    }
  }
  return [...byKey.values()]
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

function footprintHint(value: unknown): ProcessStationPlan['footprintHint'] {
  return value === 'small' ||
    value === 'medium' ||
    value === 'large' ||
    value === 'long' ||
    value === 'tall'
    ? value
    : undefined
}

function connectionMedium(value: unknown): ProcessConnectionPlan['medium'] {
  return value === 'water' ||
    value === 'hydrogen' ||
    value === 'oxygen' ||
    value === 'power' ||
    value === 'cooling' ||
    value === 'material' ||
    value === 'gas' ||
    value === 'molten_metal'
    ? value
    : undefined
}

const CONNECTION_VISUAL_KINDS: ProcessConnectionVisualKind[] = [
  'pipe',
  'cable_tray',
  'flow_arrow',
  'material_conveyor',
  'hot_material_chute',
  'air_duct',
  'hot_gas_duct',
]

function connectionVisualKind(value: unknown, medium?: ProcessConnectionPlan['medium']) {
  if (value === 'busbar') return 'cable_tray'
  if (value === 'pneumatic_pipe') return 'pipe'
  if (value === 'fume_duct') return 'air_duct'
  if (value === 'hot_metal_transfer' || value === 'hot_metal_chute') return 'hot_material_chute'
  if (value === 'crane_transfer') return 'flow_arrow'
  if (
    typeof value === 'string' &&
    CONNECTION_VISUAL_KINDS.includes(value as ProcessConnectionVisualKind)
  ) {
    return value as ProcessConnectionVisualKind
  }
  return medium === 'power' ? 'cable_tray' : 'pipe'
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function aliasPattern(alias: string) {
  return /[a-z]/i.test(alias)
    ? new RegExp(escapeRegExp(alias), 'i')
    : new RegExp(escapeRegExp(alias))
}

function safeRelativePath(value: string) {
  const normalized = value.replace(/\\/g, '/')
  return (
    normalized.length > 0 &&
    !normalized.startsWith('/') &&
    !/^[a-z]:/i.test(normalized) &&
    normalized.split('/').every((segment) => segment && segment !== '.' && segment !== '..')
  )
}

function readJson(file: string) {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown
}

function findRepoRootSync(start = process.cwd()) {
  let current = path.resolve(start)
  for (;;) {
    if (fs.existsSync(path.join(current, 'apps', 'editor', 'data', 'profile-pack-cloud'))) {
      return current
    }
    const parent = path.dirname(current)
    if (parent === current) return path.resolve(start)
    current = parent
  }
}

function profilePackCloudRoot() {
  return path.join(findRepoRootSync(), 'apps', 'editor', 'data', 'profile-pack-cloud')
}

function fileSignature(file: string) {
  try {
    const stat = fs.statSync(file)
    return `${file}:${stat.mtimeMs}:${stat.size}`
  } catch {
    return `${file}:missing`
  }
}

function resourceCacheSignature(
  root: string,
  resourceKey: 'processTemplates' | 'factoryArchitectures',
) {
  if (!fs.existsSync(root)) return 'missing-root'
  const parts: string[] = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = path.join(root, entry.name)
    const manifestPath = path.join(dir, 'pack.json')
    parts.push(fileSignature(manifestPath))
    if (!fs.existsSync(manifestPath)) continue
    let manifest: IndustryFactoryManifest | null = null
    try {
      manifest = normalizeManifest(readJson(manifestPath))
    } catch {
      continue
    }
    const resolvedDir = path.resolve(dir)
    for (const rel of manifest?.[resourceKey] ?? []) {
      if (!safeRelativePath(rel)) continue
      const file = path.resolve(dir, rel)
      if (!(file === resolvedDir || file.startsWith(`${resolvedDir}${path.sep}`))) continue
      parts.push(fileSignature(file))
    }
  }
  return parts.sort().join('|')
}

function normalizeManifest(raw: unknown): IndustryFactoryManifest | null {
  if (!isRecord(raw)) return null
  const id = stringValue(raw.id)
  const industry = stringValue(raw.industry)
  const version = stringValue(raw.version)
  if (!id || !industry || !version) return null
  const processTemplates = stringArray(raw.processTemplates)
  const factoryArchitectures = stringArray(raw.factoryArchitectures)
  return {
    id,
    industry,
    version,
    ...(processTemplates.length ? { processTemplates } : {}),
    ...(factoryArchitectures.length ? { factoryArchitectures } : {}),
  }
}

function normalizeArchitecture(raw: unknown, manifest: IndustryFactoryManifest) {
  if (!isRecord(raw)) return null
  const id = stringValue(raw.id)
  const label = stringValue(raw.label)
  const processId = stringValue(raw.processId)
  if (!id || !label || !processId) return null
  const dimensions = isRecord(raw.defaultDimensions) ? raw.defaultDimensions : {}
  const scopes = Array.isArray(raw.scopes)
    ? raw.scopes
        .filter(isRecord)
        .map((scope) => {
          const scopeId = stringValue(scope.id)
          const scopeLabel = stringValue(scope.label)
          const aliases = stringArray(scope.aliases)
          const includeModules = stringArray(scope.includeModules)
          return scopeId && scopeLabel && includeModules.length
            ? { id: scopeId, label: scopeLabel, aliases, includeModules }
            : null
        })
        .filter((scope): scope is FactoryArchitectureScope => Boolean(scope))
    : []
  const modules = Array.isArray(raw.modules)
    ? raw.modules
        .filter(isRecord)
        .map((module) => {
          const moduleId = stringValue(module.id)
          const stationIds = stringArray(module.stationIds)
          if (!moduleId || !stationIds.length) return null
          return {
            id: moduleId,
            ...(stringValue(module.displayLabel)
              ? { displayLabel: stringValue(module.displayLabel) }
              : {}),
            order: numberValue(module.order) ?? 0,
            stationIds,
          }
        })
        .filter((module): module is FactoryArchitectureModule => Boolean(module))
    : []
  const layoutHints = isRecord(raw.layoutHints) ? raw.layoutHints : {}
  return {
    id,
    label,
    industry: stringValue(raw.industry) ?? manifest.industry,
    processId,
    layoutStyle: processLayoutStyle(raw.layoutStyle),
    defaultDimensions: {
      length: numberValue(dimensions.length) ?? 24,
      width: numberValue(dimensions.width) ?? 9,
    },
    scopes,
    modules,
    layoutHints: {
      ...(stringValue(layoutHints.highestStationId)
        ? { highestStationId: stringValue(layoutHints.highestStationId) }
        : {}),
      ...(stringValue(layoutHints.longAxisStationId)
        ? { longAxisStationId: stringValue(layoutHints.longAxisStationId) }
        : {}),
      ...(stringArray(layoutHints.sideBranchStationIds).length
        ? { sideBranchStationIds: stringArray(layoutHints.sideBranchStationIds) }
        : {}),
      ...(booleanValue(layoutHints.omitPerimeterWalls) != null
        ? { omitPerimeterWalls: booleanValue(layoutHints.omitPerimeterWalls) }
        : {}),
    },
    sourcePack: {
      id: manifest.id,
      version: manifest.version,
      industry: manifest.industry,
    },
  } satisfies IndustryFactoryArchitecture
}

function normalizeStation(raw: unknown): ProcessStationPlan | null {
  if (!isRecord(raw)) return null
  const id = stringValue(raw.id)
  const label = stringValue(raw.label)
  const role = stringValue(raw.role)
  const equipmentHint = stringValue(raw.equipmentHint)
  if (!id || !label || !role || !equipmentHint) return null
  const displayLabel = stringValue(raw.displayLabel)
  const hint = footprintHint(raw.footprintHint)
  const safetyTags = stringArray(raw.safetyTags)
  return {
    id,
    label,
    ...(displayLabel ? { displayLabel } : {}),
    role,
    equipmentHint,
    ...(hint ? { footprintHint: hint } : {}),
    ...(safetyTags.length ? { safetyTags } : {}),
  }
}

function normalizeConnection(raw: unknown): ProcessConnectionPlan | null {
  if (!isRecord(raw)) return null
  const fromStationId = stringValue(raw.fromStationId)
  const toStationId = stringValue(raw.toStationId)
  if (!fromStationId || !toStationId) return null
  const medium = connectionMedium(raw.medium)
  return {
    fromStationId,
    toStationId,
    ...(medium ? { medium } : {}),
    ...(stringValue(raw.fromPortId) ? { fromPortId: stringValue(raw.fromPortId) } : {}),
    ...(stringValue(raw.toPortId) ? { toPortId: stringValue(raw.toPortId) } : {}),
    visualKind: connectionVisualKind(raw.visualKind, medium),
  }
}

function normalizeTemplate(raw: RawProcessTemplate, manifest: IndustryFactoryManifest) {
  const processId = stringValue(raw.processId)
  const processLabel = stringValue(raw.processLabel)
  const processDisplayLabel = stringValue(raw.processDisplayLabel)
  const aliases = stringArray(raw.aliases)
  const stations = Array.isArray(raw.stations)
    ? raw.stations
        .map(normalizeStation)
        .filter((station): station is ProcessStationPlan => Boolean(station))
    : []
  const connections = Array.isArray(raw.connections)
    ? raw.connections
        .map(normalizeConnection)
        .filter((connection): connection is ProcessConnectionPlan => Boolean(connection))
    : []
  if (!processId || !processLabel || aliases.length === 0 || stations.length < 2) return null
  const dimensions = isRecord(raw.defaultDimensions) ? raw.defaultDimensions : {}
  return {
    processId,
    processLabel,
    ...(processDisplayLabel ? { processDisplayLabel } : {}),
    domain: processDomain(raw.domain),
    aliases: aliases.map(aliasPattern),
    requiredRoles: stringArray(raw.requiredRoles),
    defaultLayoutStyle: processLayoutStyle(raw.defaultLayoutStyle),
    defaultDimensions: {
      length: numberValue(dimensions.length) ?? 24,
      width: numberValue(dimensions.width) ?? 9,
    },
    safetyTags: stringArray(raw.safetyTags),
    stations,
    connections,
    sourcePack: {
      id: manifest.id,
      version: manifest.version,
      industry: manifest.industry,
    },
  } satisfies ProcessTemplate
}

function loadTemplatesFromPackDir(dir: string) {
  const manifestPath = path.join(dir, 'pack.json')
  if (!fs.existsSync(manifestPath)) return []
  const manifest = normalizeManifest(readJson(manifestPath))
  if (!manifest?.processTemplates?.length) return []
  const resolvedDir = path.resolve(dir)
  const templates: ProcessTemplate[] = []
  for (const rel of manifest.processTemplates) {
    if (!safeRelativePath(rel)) continue
    const file = path.resolve(dir, rel)
    if (!(file === resolvedDir || file.startsWith(`${resolvedDir}${path.sep}`))) continue
    if (!fs.existsSync(file)) continue
    const raw = readJson(file)
    const values = Array.isArray(raw) ? raw : [raw]
    for (const value of values) {
      if (!isRecord(value)) continue
      const template = normalizeTemplate(value, manifest)
      if (template) templates.push(template)
    }
  }
  return templates
}

function loadArchitecturesFromPackDir(dir: string) {
  const manifestPath = path.join(dir, 'pack.json')
  if (!fs.existsSync(manifestPath)) return []
  const manifest = normalizeManifest(readJson(manifestPath))
  if (!manifest?.factoryArchitectures?.length) return []
  const resolvedDir = path.resolve(dir)
  const architectures: IndustryFactoryArchitecture[] = []
  for (const rel of manifest.factoryArchitectures) {
    if (!safeRelativePath(rel)) continue
    const file = path.resolve(dir, rel)
    if (!(file === resolvedDir || file.startsWith(`${resolvedDir}${path.sep}`))) continue
    if (!fs.existsSync(file)) continue
    const raw = readJson(file)
    const values = Array.isArray(raw) ? raw : [raw]
    for (const value of values) {
      const architecture = normalizeArchitecture(value, manifest)
      if (architecture) architectures.push(architecture)
    }
  }
  return architectures
}

export function loadIndustryProcessTemplates() {
  const root = profilePackCloudRoot()
  const signature = resourceCacheSignature(root, 'processTemplates')
  if (cachedTemplates && cachedTemplatesSignature === signature) return cachedTemplates
  if (!fs.existsSync(root)) {
    cachedTemplates = []
    cachedTemplatesSignature = signature
    return cachedTemplates
  }
  cachedTemplates = keepLatestByPackAndResource(
    fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => {
        try {
          return loadTemplatesFromPackDir(path.join(root, entry.name))
        } catch {
          return []
        }
      }),
    (template) => template.processId,
  )
  cachedTemplatesSignature = signature
  return cachedTemplates
}

export function loadIndustryFactoryArchitectures() {
  const root = profilePackCloudRoot()
  const signature = resourceCacheSignature(root, 'factoryArchitectures')
  if (cachedArchitectures && cachedArchitecturesSignature === signature) return cachedArchitectures
  if (!fs.existsSync(root)) {
    cachedArchitectures = []
    cachedArchitecturesSignature = signature
    return cachedArchitectures
  }
  cachedArchitectures = keepLatestByPackAndResource(
    fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => {
        try {
          return loadArchitecturesFromPackDir(path.join(root, entry.name))
        } catch {
          return []
        }
      }),
    (architecture) => architecture.id,
  )
  cachedArchitecturesSignature = signature
  return cachedArchitectures
}

function containsPromptToken(prompt: string, value: string | undefined) {
  if (!value) return false
  const normalizedPrompt = prompt.toLowerCase()
  const normalizedValue = value.toLowerCase()
  return normalizedValue.length > 1 && normalizedPrompt.includes(normalizedValue)
}

function stationMatchesPrompt(prompt: string, station: ProcessStationPlan) {
  return (
    containsPromptToken(prompt, station.id) ||
    containsPromptToken(prompt, station.role) ||
    containsPromptToken(prompt, station.label) ||
    containsPromptToken(prompt, station.displayLabel) ||
    containsPromptToken(prompt, station.equipmentHint)
  )
}

function scopeMatchesPrompt(prompt: string, scope: FactoryArchitectureScope) {
  return (
    containsPromptToken(prompt, scope.id) ||
    containsPromptToken(prompt, scope.label) ||
    scope.aliases.some((alias) => containsPromptToken(prompt, alias))
  )
}

function keyFocusStationIds(architecture: IndustryFactoryArchitecture, stationIds: Set<string>) {
  return [
    architecture.layoutHints.highestStationId,
    architecture.layoutHints.longAxisStationId,
    ...(architecture.layoutHints.sideBranchStationIds ?? []),
  ].filter((id): id is string => Boolean(id && stationIds.has(id)))
}

function planSubsetDimensions(input: {
  plan: ProcessTemplate['stations']
  selectedCount: number
  base?: { length?: number; width?: number }
}) {
  const ratio = input.plan.length > 0 ? input.selectedCount / input.plan.length : 1
  return {
    length: Math.max(10, (input.base?.length ?? 24) * Math.max(0.32, Math.sqrt(ratio))),
    width: Math.max(6, (input.base?.width ?? 9) * Math.max(0.42, Math.sqrt(ratio))),
  }
}

export function applyFactoryArchitectureToPlan(input: {
  plan: ProcessLinePlan
  prompt: string
}): ProcessLinePlan {
  const architecture = loadIndustryFactoryArchitectures().find(
    (item) => item.processId === input.plan.processId,
  )
  if (!architecture) return input.plan

  const stationMatch = input.plan.stations.find((station) =>
    stationMatchesPrompt(input.prompt, station),
  )
  const scopeMatch = stationMatch
    ? undefined
    : architecture.scopes.find((scope) => scopeMatchesPrompt(input.prompt, scope))
  const moduleIds = new Set(
    stationMatch
      ? architecture.modules
          .filter((module) => module.stationIds.includes(stationMatch.id))
          .map((module) => module.id)
      : scopeMatch?.includeModules,
  )
  const selectedStationIds = stationMatch
    ? new Set([stationMatch.id])
    : moduleIds.size
      ? new Set(
          architecture.modules
            .filter((module) => moduleIds.has(module.id))
            .sort((left, right) => left.order - right.order)
            .flatMap((module) => module.stationIds),
        )
      : undefined
  if (!selectedStationIds?.size) {
    const allStationIds = new Set(input.plan.stations.map((station) => station.id))
    return {
      ...input.plan,
      architecture: {
        id: architecture.id,
        label: architecture.label,
        keyFocusStationIds: keyFocusStationIds(architecture, allStationIds),
        zoneDisplay: 'subtle',
        ...(architecture.layoutHints.omitPerimeterWalls != null
          ? { omitPerimeterWalls: architecture.layoutHints.omitPerimeterWalls }
          : {}),
      },
    }
  }

  const stations = input.plan.stations.filter((station) => selectedStationIds.has(station.id))
  if (!stations.length) return input.plan
  const stationIds = new Set(stations.map((station) => station.id))
  return {
    ...input.plan,
    layoutStyle: stations.length <= 1 ? 'cell' : input.plan.layoutStyle,
    dimensions:
      stations.length === input.plan.stations.length
        ? input.plan.dimensions
        : planSubsetDimensions({
            plan: input.plan.stations,
            selectedCount: stations.length,
            base: input.plan.dimensions,
          }),
    stations,
    connections: input.plan.connections.filter(
      (connection) =>
        stationIds.has(connection.fromStationId) && stationIds.has(connection.toStationId),
    ),
    architecture: {
      id: architecture.id,
      label: architecture.label,
      ...(scopeMatch ? { scopeId: scopeMatch.id, scopeLabel: scopeMatch.label } : {}),
      moduleIds: [...moduleIds],
      keyFocusStationIds: keyFocusStationIds(architecture, stationIds),
      zoneDisplay: 'subtle',
      ...(architecture.layoutHints.omitPerimeterWalls != null
        ? { omitPerimeterWalls: architecture.layoutHints.omitPerimeterWalls }
        : {}),
    },
  }
}

export function resolveIndustryPackDir(ref: IndustryPackRef): string | undefined {
  const root = profilePackCloudRoot()
  if (!fs.existsSync(root)) return undefined
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = path.join(root, entry.name)
    const manifestPath = path.join(dir, 'pack.json')
    if (!fs.existsSync(manifestPath)) continue
    try {
      const manifest = normalizeManifest(readJson(manifestPath))
      if (
        manifest?.id === ref.id &&
        manifest.version === ref.version &&
        (!ref.industry || manifest.industry === ref.industry)
      ) {
        return dir
      }
    } catch {
      // Ignore malformed cloud pack manifests during best-effort resolution.
    }
  }
  return undefined
}

export function resetIndustryProcessTemplateCacheForTests() {
  cachedTemplates = undefined
  cachedArchitectures = undefined
}
