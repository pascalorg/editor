import type { AnyNode, AnyNodeType } from '../schema/types'
import type { DynamicCapabilityMetadata, DynamicType } from './types'

export const COMMON_DYNAMIC_TYPES: readonly DynamicType[] = [
  'visible',
  'move',
  'blink',
  'scale',
  'color',
  'rotate',
]

export const SEMANTIC_DYNAMIC_TYPES: Record<string, readonly DynamicType[]> = {
  pipe: ['flow'],
  conveyor: ['conveyorFlow'],
  tank: ['fill', 'level'],
  container: ['fill'],
  cabinet: ['fill'],
  silo: ['fill', 'level'],
  battery: ['fill'],
  fan: ['speed'],
  motor: ['speed'],
  roller: ['rotate'],
  valve: ['openClose', 'flow'],
  pump: ['running', 'flow'],
  light: ['brightness'],
  display: ['valueDisplay'],
}

const VALID_DYNAMIC_TYPES = new Set<DynamicType>([
  ...COMMON_DYNAMIC_TYPES,
  ...Object.values(SEMANTIC_DYNAMIC_TYPES).flat(),
])

const SEMANTIC_ONLY_DYNAMIC_TYPES = new Set<DynamicType>(['fill', 'level', 'conveyorFlow'])

function semanticAllowsDynamicType(semanticType: string, type: DynamicType) {
  if (!SEMANTIC_ONLY_DYNAMIC_TYPES.has(type)) return true
  return (SEMANTIC_DYNAMIC_TYPES[semanticType] ?? []).includes(type)
}

function uniqueDynamicTypes(values: readonly unknown[]): DynamicType[] {
  const result: DynamicType[] = []
  for (const value of values) {
    if (typeof value !== 'string') continue
    if (!VALID_DYNAMIC_TYPES.has(value as DynamicType)) continue
    if (!result.includes(value as DynamicType)) result.push(value as DynamicType)
  }
  return result
}

function readDynamicCapabilities(
  node: AnyNode | null | undefined,
): DynamicCapabilityMetadata | null {
  const metadata = readMetadata(node)
  const raw = readRecord(metadata.dynamicCapabilities)
  const semanticType =
    typeof raw.semanticType === 'string' && raw.semanticType.trim()
      ? raw.semanticType.trim()
      : undefined
  const supportedTypes = Array.isArray(raw.supportedTypes)
    ? uniqueDynamicTypes(raw.supportedTypes)
    : undefined
  const recommendedTypes = Array.isArray(raw.recommendedTypes)
    ? uniqueDynamicTypes(raw.recommendedTypes)
    : undefined
  const source = typeof raw.source === 'string' && raw.source.trim() ? raw.source.trim() : undefined
  if (!(semanticType || supportedTypes?.length || recommendedTypes?.length || source)) return null
  return { semanticType, supportedTypes, recommendedTypes, source }
}

export function buildDynamicCapabilityMetadata(
  semanticType: string,
  source = 'generated-geometry',
): DynamicCapabilityMetadata {
  const supportedTypes = getDynamicTypesForSemanticType(semanticType)
  const recommendedTypes = SEMANTIC_DYNAMIC_TYPES[semanticType]
    ? [...SEMANTIC_DYNAMIC_TYPES[semanticType]]
    : [getRecommendedDynamicTypeForSemanticType(semanticType)]
  return { semanticType, supportedTypes, recommendedTypes, source }
}

export const NODE_TYPE_SEMANTIC_DEFAULTS: Partial<Record<AnyNodeType, string>> = {
  pipe: 'pipe',
  tank: 'tank',
  'conveyor-belt': 'conveyor',
  'data-widget': 'display',
}

const SEMANTIC_INFERENCE_RULES: Array<{ semanticType: string; pattern: RegExp }> = [
  {
    semanticType: 'conveyor',
    pattern:
      /conveyor|conveyer|belt|belt_surface|roller_table|roller_array|cargo_platform|输送|传送|皮带线/,
  },
  { semanticType: 'pipe', pattern: /pipe|duct|hose|tube|manifold|nozzle|inlet|outlet|管|风管/ },
  { semanticType: 'silo', pattern: /silo|hopper|(^|[_\s-])bin($|[_\s-])|料仓|料斗|仓/ },
  { semanticType: 'cabinet', pattern: /cabinet|locker|enclosure|rack|柜|机柜|箱柜/ },
  { semanticType: 'container', pattern: /container|crate|case|storage|箱|盒|容器/ },
  { semanticType: 'battery', pattern: /battery|cell|电池|蓄电/ },
  { semanticType: 'tank', pattern: /tank|vessel|reactor|罐|釜|水箱|储罐/ },
  { semanticType: 'fan', pattern: /fan|blower|impeller|vent|风机|风扇|叶轮/ },
  { semanticType: 'motor', pattern: /motor|gearbox|drive_motor|电机|马达/ },
  { semanticType: 'roller', pattern: /roller|drum|wheel|滚筒|托辊/ },
  { semanticType: 'valve', pattern: /valve|damper|gate|ball_valve|阀|闸/ },
  { semanticType: 'pump', pattern: /pump|compressor|volute|泵|压缩机/ },
  { semanticType: 'light', pattern: /light|lamp|beacon|headlight|status_light|灯|指示灯/ },
  {
    semanticType: 'display',
    pattern: /display|gauge|meter|screen|indicator|instrument|panel|数显|仪表|屏|表/,
  },
]

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function readMetadata(node: AnyNode | null | undefined): Record<string, unknown> {
  return readRecord(node?.metadata)
}

function normalizeSemanticToken(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function hasSemanticToken(tokens: string[], values: readonly string[]) {
  return tokens.some((token) => values.includes(token))
}

function inferStructuredPartSemanticType(node: AnyNode): string | undefined {
  const metadata = readMetadata(node)
  const roleTokens = [metadata.semanticRole, metadata.primarySemanticRole].map(normalizeSemanticToken)
  const partTokens = [metadata.sourcePartKind, metadata.sourcePartId].map(normalizeSemanticToken)
  const groupTokens = [metadata.semanticGroup].map(normalizeSemanticToken)

  const conveyorTokens = [
      'conveyor',
      'conveyor_frame',
      'belt_surface',
      'conveyor_belt',
      'rubber_belt',
      'moving_belt_surface',
      'covered_conveyor_belt',
      'chip_belt',
      'packaging_conveyor',
      'chip_conveyor_frame',
      'casting_conveyor_frame',
      'infeed_conveyor',
      'cargo_platform',
    ]
  const rollerTokens = [
      'roller',
      'roller_array',
      'support_rollers',
      'drive_roller',
      'idler_roller',
      'drum',
    ]
  const motorTokens = [
      'motor',
      'drive_motor',
      'conveyor_drive_motor',
      'conveyor_drive',
      'conveyor_drive_unit',
      'ribbed_motor_body',
    ]

  if (hasSemanticToken(roleTokens, conveyorTokens)) return 'conveyor'
  if (hasSemanticToken(roleTokens, rollerTokens)) return 'roller'
  if (hasSemanticToken(roleTokens, motorTokens)) return 'motor'
  if (hasSemanticToken(partTokens, conveyorTokens)) return 'conveyor'
  if (hasSemanticToken(partTokens, rollerTokens)) return 'roller'
  if (hasSemanticToken(partTokens, motorTokens)) return 'motor'
  if (hasSemanticToken(groupTokens, conveyorTokens)) {
    return 'conveyor'
  }

  return undefined
}

function collectText(value: unknown, depth = 0): string[] {
  if (depth > 2) return []
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return [String(value)]
  }
  if (Array.isArray(value)) return value.flatMap((item) => collectText(item, depth + 1))
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap((item) =>
      collectText(item, depth + 1),
    )
  }
  return []
}

function nodeInferenceText(node: AnyNode): string {
  const metadata = readMetadata(node)
  const asset = readRecord((node as unknown as Record<string, unknown>).asset)
  const prioritizedMetadata = [
    metadata.semanticRole,
    metadata.semanticGroup,
    metadata.sourcePartKind,
    metadata.sourcePartId,
    metadata.stationRole,
    metadata.factoryStationRole,
    metadata.equipmentRole,
    metadata.primarySemanticRole,
    metadata.family,
    metadata.archetypeFamily,
    metadata.layoutFamily,
    metadata.deviceProfile,
    metadata.profileId,
    metadata.category,
    metadata.semanticSummary,
  ]
  return [
    node.type,
    (node as unknown as Record<string, unknown>).name,
    ...prioritizedMetadata,
    asset.id,
    asset.name,
    asset.category,
    ...collectText(metadata.equipmentContract),
    ...collectText(metadata.sourceArgs),
    ...collectText(metadata.geometryBrief),
  ]
    .filter((value): value is string | number | boolean => value != null)
    .join(' ')
    .toLowerCase()
}

export function inferNodeSemanticType(node: AnyNode | null | undefined): string {
  if (!node) return 'generic'
  const structuredPartSemanticType = inferStructuredPartSemanticType(node)
  if (structuredPartSemanticType) return structuredPartSemanticType
  const text = nodeInferenceText(node)
  for (const rule of SEMANTIC_INFERENCE_RULES) {
    if (rule.pattern.test(text)) return rule.semanticType
  }
  return NODE_TYPE_SEMANTIC_DEFAULTS[node.type] ?? 'generic'
}

export function getNodeSemanticType(node: AnyNode | null | undefined): string {
  if (!node) return 'generic'
  const metadata = readMetadata(node)
  const semanticType = metadata.semanticType
  if (typeof semanticType === 'string' && semanticType.trim()) return semanticType.trim()
  const structuredPartSemanticType = inferStructuredPartSemanticType(node)
  if (structuredPartSemanticType) return structuredPartSemanticType
  const declared = readDynamicCapabilities(node)?.semanticType
  return declared ?? inferNodeSemanticType(node)
}

export function getDynamicTypesForSemanticType(semanticType: string): DynamicType[] {
  const merged = [...COMMON_DYNAMIC_TYPES, ...(SEMANTIC_DYNAMIC_TYPES[semanticType] ?? [])]
  return Array.from(new Set(merged))
}

export function getRecommendedDynamicTypeForSemanticType(semanticType: string): DynamicType {
  return SEMANTIC_DYNAMIC_TYPES[semanticType]?.[0] ?? 'visible'
}

export function getDynamicTypesForNode(node: AnyNode | null | undefined): DynamicType[] {
  const declared = readDynamicCapabilities(node)
  const semanticType = getNodeSemanticType(node)
  const semanticTypes = getDynamicTypesForSemanticType(semanticType)
  const declaredTypes = (declared?.supportedTypes ?? []).filter((type) =>
    semanticAllowsDynamicType(semanticType, type),
  )
  return Array.from(new Set([...semanticTypes, ...declaredTypes]))
}

export function getRecommendedDynamicTypeForNode(node: AnyNode | null | undefined): DynamicType {
  const declared = readDynamicCapabilities(node)
  return (
    declared?.recommendedTypes?.[0] ??
    getRecommendedDynamicTypeForSemanticType(getNodeSemanticType(node))
  )
}
