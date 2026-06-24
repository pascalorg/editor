import type { MaterialSchema } from '@pascal-app/core/schema'
import {
  buildGeneratedGeometryCreatePatches,
  type GeneratedGeometryCreatePatch,
} from '../../../../packages/editor/src/lib/ai-generated-geometry-nodes'
import { executeGeometryToolCall } from '../../../../packages/editor/src/lib/ai-geometry-tool-executor'
import { precisionPartDeterministicRoute } from './primitive-runner'

export type FactorySelectionNodeSnapshot = {
  id: string
  type: string
  name?: string
  parentId?: string
  children?: string[]
  color?: string
  kind?: string
  shellColor?: string
  material?: MaterialSchema
  materialPreset?: string
  length?: number
  width?: number
  height?: number
  depth?: number
  thickness?: number
  radius?: number
  majorRadius?: number
  tubeRadius?: number
  position?: [number, number, number]
  rotation?: [number, number, number]
  scale?: [number, number, number]
  metadata?: Record<string, unknown>
}

export type FactorySelectionSnapshot = {
  selectedIds: string[]
  nodes: FactorySelectionNodeSnapshot[]
}

export type FactorySceneUpdatePatch = {
  op: 'update'
  id: string
  data: Record<string, unknown>
}

export type FactorySceneDeletePatch = {
  op: 'delete'
  id: string
}

export type FactorySceneEditPatch =
  | GeneratedGeometryCreatePatch
  | FactorySceneUpdatePatch
  | FactorySceneDeletePatch

export type FactorySelectionEditResult = {
  patches: FactorySceneEditPatch[]
  nodeIds: string[]
  changed: string[]
  summary?: string[]
  missingReason?: string
}

const MATERIAL_NODE_TYPES = new Set([
  'box',
  'capsule',
  'ceiling',
  'column',
  'cone',
  'conformal-strip',
  'cylinder',
  'door',
  'elevator',
  'extrude',
  'fence',
  'frustum',
  'half-cylinder',
  'hemisphere',
  'item',
  'lathe',
  'road',
  'roof-segment',
  'rounded-panel',
  'shelf',
  'slab',
  'sphere',
  'stair-segment',
  'sweep',
  'torus',
  'trapezoid-prism',
  'wedge',
  'window',
])

const COLOR_FIELD_BY_NODE_TYPE: Record<string, string> = {
  'cable-tray': 'color',
  ladder: 'color',
  pipe: 'color',
  'pipe-fitting': 'color',
  'steel-beam': 'color',
  tank: 'shellColor',
  zone: 'color',
}

const COLOR_KEYWORDS: Array<{ pattern: RegExp; color: string; label: string }> = [
  { pattern: /#([0-9a-f]{6})\b/i, color: '', label: 'custom' },
  { pattern: /\bred\b|红色?|赤色?/, color: '#ef4444', label: 'red' },
  { pattern: /\bblue\b|蓝色?/, color: '#3b82f6', label: 'blue' },
  { pattern: /\bgreen\b|绿色?/, color: '#22c55e', label: 'green' },
  { pattern: /\byellow\b|黄色?/, color: '#facc15', label: 'yellow' },
  { pattern: /\borange\b|橙色?/, color: '#f97316', label: 'orange' },
  { pattern: /\bpurple\b|紫色?/, color: '#8b5cf6', label: 'purple' },
  { pattern: /\bpink\b|粉色?/, color: '#ec4899', label: 'pink' },
  { pattern: /\bblack\b|黑色?/, color: '#111827', label: 'black' },
  { pattern: /\bwhite\b|白色?/, color: '#f8fafc', label: 'white' },
  { pattern: /\bgr[ae]y\b|灰色?/, color: '#64748b', label: 'gray' },
  { pattern: /\bsilver\b|银色?/, color: '#cbd5e1', label: 'silver' },
]

const DIFFERENT_COLOR_CANDIDATES = ['#f97316', '#22c55e', '#3b82f6', '#8b5cf6', '#ef4444']

export function looksLikeSelectionColorEdit(prompt: string) {
  return /改.*色|换.*色|变.*色|上色|染色|不同颜色|别的颜色|另一个颜色|change.*colou?r|different colou?r|another colou?r|recolou?r|paint|(?:make|set).*(?:red|blue|green|yellow|orange|purple|pink|black|white|gr[ae]y|silver|colou?r)/i.test(
    prompt,
  )
}

export function resolveSelectionTankKind(prompt: string) {
  if (/\bhorizontal\b|\u5367\u5f0f/i.test(prompt)) return 'horizontal'
  if (/\bvertical\b|\u7acb\u5f0f/i.test(prompt)) return 'vertical'
  if (/\bspherical\b|\u7403\u5f62|\u7403\u7f50/i.test(prompt)) return 'spherical'
  return undefined
}

export function looksLikeSelectionTankKindEdit(prompt: string) {
  return Boolean(resolveSelectionTankKind(prompt))
}

function normalizeHex(value: string | undefined) {
  const hex = value?.trim().toLowerCase()
  return /^#[0-9a-f]{6}$/.test(hex ?? '') ? hex : undefined
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function finiteVec3(value: unknown): [number, number, number] | undefined {
  return Array.isArray(value) &&
    value.length >= 3 &&
    value.every((item) => typeof item === 'number' && Number.isFinite(item))
    ? ([value[0], value[1], value[2]] as [number, number, number])
    : undefined
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function formatSummaryValue(value: unknown): string {
  if (value == null) return 'none'
  if (typeof value === 'number') return String(Math.round(value * 1000) / 1000)
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return `[${value.map(formatSummaryValue).join(', ')}]`
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return 'updated'
}

function materialColor(value: unknown) {
  const material = recordValue(value)
  const properties = recordValue(material?.properties)
  return typeof properties?.color === 'string' ? properties.color : undefined
}

function nodeLabel(node: FactorySelectionNodeSnapshot | undefined, fallback: string) {
  return node?.name?.trim() || fallback
}

function metadataEndEffector(value: unknown) {
  const metadata = recordValue(value)
  const editableOverride = recordValue(metadata?.editableOverride)
  return typeof metadata?.endEffectorKind === 'string'
    ? metadata.endEffectorKind
    : typeof editableOverride?.endEffector === 'string'
      ? editableOverride.endEffector
      : undefined
}

function summarizeUpdateField(
  node: FactorySelectionNodeSnapshot | undefined,
  field: string,
  nextValue: unknown,
) {
  if (field === 'material') {
    const oldColor = materialColor(node?.material) ?? node?.color ?? node?.shellColor
    const nextColor = materialColor(nextValue)
    return nextColor ? `color ${formatSummaryValue(oldColor)} -> ${nextColor}` : undefined
  }
  if (field === 'materialPreset' && nextValue == null) return undefined
  if (field === 'metadata') {
    const oldEndEffector = metadataEndEffector(node?.metadata)
    const nextEndEffector = metadataEndEffector(nextValue)
    return nextEndEffector
      ? `endEffector ${formatSummaryValue(oldEndEffector)} -> ${nextEndEffector}`
      : 'metadata updated'
  }
  const previous = node ? (node as unknown as Record<string, unknown>)[field] : undefined
  return `${field} ${formatSummaryValue(previous)} -> ${formatSummaryValue(nextValue)}`
}

function summarizeSelectionPatches(
  snapshot: FactorySelectionSnapshot,
  patches: FactorySceneEditPatch[],
) {
  return patches.map((patch) => {
    const node = snapshot.nodes.find((item) => item.id === patch.id)
    const label = nodeLabel(node, patch.id)
    if (patch.op === 'delete') return `${label}: deleted`
    const changes = Object.entries(patch.data)
      .map(([field, value]) => summarizeUpdateField(node, field, value))
      .filter((value): value is string => Boolean(value))
    return `${label}: ${changes.slice(0, 3).join(', ') || 'updated'}`
  })
}

function firstExistingColor(nodes: FactorySelectionNodeSnapshot[]) {
  for (const node of nodes) {
    const materialColor = normalizeHex(node.material?.properties?.color)
    if (materialColor) return materialColor
    const shellColor = normalizeHex(node.shellColor)
    if (shellColor) return shellColor
    const color = normalizeHex(node.color)
    if (color) return color
  }
  return undefined
}

export function resolveSelectionEditColor(
  prompt: string,
  nodes: FactorySelectionNodeSnapshot[] = [],
) {
  for (const keyword of COLOR_KEYWORDS) {
    const match = keyword.pattern.exec(prompt)
    if (!match) continue
    if (keyword.label === 'custom') return `#${match[1]!.toLowerCase()}`
    return keyword.color
  }

  const current = firstExistingColor(nodes)
  return DIFFERENT_COLOR_CANDIDATES.find((color) => color !== current) ?? '#f97316'
}

function customMaterial(color: string): MaterialSchema {
  return {
    preset: 'custom',
    properties: {
      color,
      roughness: 0.55,
      metalness: 0,
      opacity: 1,
      transparent: false,
      side: 'front',
    },
  }
}

function materialPatch(color: string) {
  return {
    material: customMaterial(color),
    materialPreset: null,
  }
}

function updateDataForNode(node: FactorySelectionNodeSnapshot, color: string) {
  const material = customMaterial(color)
  if (node.type === 'wall') {
    return {
      interiorMaterial: material,
      interiorMaterialPreset: null,
      exteriorMaterial: material,
      exteriorMaterialPreset: null,
      material: null,
      materialPreset: null,
    }
  }
  if (node.type === 'roof') {
    return {
      topMaterial: material,
      topMaterialPreset: null,
      edgeMaterial: material,
      edgeMaterialPreset: null,
      wallMaterial: material,
      wallMaterialPreset: null,
      material: null,
      materialPreset: null,
    }
  }
  if (node.type === 'stair') {
    return {
      railingMaterial: material,
      railingMaterialPreset: null,
      treadMaterial: material,
      treadMaterialPreset: null,
      sideMaterial: material,
      sideMaterialPreset: null,
      material: null,
      materialPreset: null,
    }
  }
  if (MATERIAL_NODE_TYPES.has(node.type)) return materialPatch(color)
  const colorField = COLOR_FIELD_BY_NODE_TYPE[node.type]
  if (colorField) return { [colorField]: color }
  return null
}

function selectionSnapshotFromContext(context: unknown): FactorySelectionSnapshot | null {
  if (typeof context !== 'object' || context === null || Array.isArray(context)) return null
  const selection = (context as Record<string, unknown>).selection
  if (typeof selection !== 'object' || selection === null || Array.isArray(selection)) return null
  const record = selection as Record<string, unknown>
  const selectedIds = Array.isArray(record.selectedIds)
    ? record.selectedIds.filter((id): id is string => typeof id === 'string' && Boolean(id))
    : []
  const nodes = Array.isArray(record.nodes)
    ? record.nodes
        .map((node): FactorySelectionNodeSnapshot | null => {
          if (typeof node !== 'object' || node === null || Array.isArray(node)) return null
          const source = node as Record<string, unknown>
          if (typeof source.id !== 'string' || typeof source.type !== 'string') return null
          return {
            id: source.id,
            type: source.type,
            name: typeof source.name === 'string' ? source.name : undefined,
            parentId: typeof source.parentId === 'string' ? source.parentId : undefined,
            children: Array.isArray(source.children)
              ? source.children.filter(
                  (childId): childId is string => typeof childId === 'string' && Boolean(childId),
                )
              : undefined,
            color: typeof source.color === 'string' ? source.color : undefined,
            kind: typeof source.kind === 'string' ? source.kind : undefined,
            shellColor: typeof source.shellColor === 'string' ? source.shellColor : undefined,
            length: finiteNumber(source.length),
            width: finiteNumber(source.width),
            height: finiteNumber(source.height),
            depth: finiteNumber(source.depth),
            thickness: finiteNumber(source.thickness),
            radius: finiteNumber(source.radius),
            majorRadius: finiteNumber(source.majorRadius),
            tubeRadius: finiteNumber(source.tubeRadius),
            position: finiteVec3(source.position),
            rotation: finiteVec3(source.rotation),
            scale: finiteVec3(source.scale),
            material:
              typeof source.material === 'object' &&
              source.material !== null &&
              !Array.isArray(source.material)
                ? (source.material as MaterialSchema)
                : undefined,
            materialPreset:
              typeof source.materialPreset === 'string' ? source.materialPreset : undefined,
            metadata: recordValue(source.metadata),
          }
        })
        .filter((node): node is FactorySelectionNodeSnapshot => Boolean(node))
    : []
  return { selectedIds, nodes }
}

function expandedEditableNodes(snapshot: FactorySelectionSnapshot) {
  const byId = new Map(snapshot.nodes.map((node) => [node.id, node]))
  const editable = new Map<string, FactorySelectionNodeSnapshot>()
  const visit = (id: string, fromAssembly: boolean, visiting = new Set<string>()) => {
    if (visiting.has(id)) return
    const node = byId.get(id)
    if (!node) return
    const nextVisiting = new Set(visiting).add(id)
    if (node.type === 'assembly') {
      for (const childId of node.children ?? []) visit(childId, true, nextVisiting)
      return
    }
    if (fromAssembly || snapshot.selectedIds.includes(id)) editable.set(id, node)
  }

  for (const id of snapshot.selectedIds) visit(id, false)
  return [...editable.values()]
}

function selectedRootNodes(snapshot: FactorySelectionSnapshot) {
  const byId = new Map(snapshot.nodes.map((node) => [node.id, node]))
  return snapshot.selectedIds
    .map((id) => byId.get(id))
    .filter(Boolean) as FactorySelectionNodeSnapshot[]
}

type EditableDimension =
  | 'uniform'
  | 'length'
  | 'width'
  | 'height'
  | 'depth'
  | 'thickness'
  | 'radius'
  | 'diameter'
  | 'majorRadius'
  | 'tubeRadius'

const GENERATED_PRIMITIVE_NODE_TYPES = new Set([
  'box',
  'capsule',
  'cone',
  'conformal-strip',
  'cylinder',
  'extrude',
  'frustum',
  'half-cylinder',
  'hemisphere',
  'lathe',
  'rounded-panel',
  'sphere',
  'sweep',
  'torus',
  'trapezoid-prism',
  'wedge',
])

export function looksLikeSelectionGeometryEdit(prompt: string) {
  return /(\u52a0\u957f|\u66f4\u957f|\u957f\u4e00\u70b9|\u53d8\u957f|\u653e\u5927|\u5927\u4e00\u70b9|\u53d8\u5927|\u7f29\u5c0f|\u5c0f\u4e00\u70b9|\u53d8\u5c0f|\u53d8\u5bbd|\u66f4\u5bbd|\u53d8\u9ad8|\u66f4\u9ad8|\u53d8\u539a|\u66f4\u539a|\u53d8\u8584|\u5c42|\u5c42\u6570|level|levels|storey|story|stories|longer|shorter|larger|bigger|smaller|wider|narrower|taller|higher|thicker|thinner|scale|resize|enlarge|shrink)/i.test(
    prompt,
  )
}

function editableHints(
  node: FactorySelectionNodeSnapshot | undefined,
): Record<string, unknown> | undefined {
  return recordValue(node?.metadata?.editableHints)
}

function normalizeDimension(value: unknown): EditableDimension | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value
    .trim()
    .replace(/[\s_-]+/g, '')
    .toLowerCase()
  switch (normalized) {
    case 'length':
    case 'long':
    case 'primary':
    case 'axislength':
      return 'length'
    case 'width':
    case 'wide':
      return 'width'
    case 'height':
    case 'tall':
      return 'height'
    case 'depth':
      return 'depth'
    case 'thickness':
    case 'thick':
      return 'thickness'
    case 'radius':
      return 'radius'
    case 'diameter':
      return 'diameter'
    case 'majorradius':
      return 'majorRadius'
    case 'tuberadius':
      return 'tubeRadius'
    case 'uniform':
    case 'all':
    case 'overall':
      return 'uniform'
    default:
      return undefined
  }
}

export function resolveSelectionGeometryDimension(
  prompt: string,
  node?: FactorySelectionNodeSnapshot,
): EditableDimension {
  if (
    /(\u52a0\u957f|\u66f4\u957f|\u957f\u4e00\u70b9|\u53d8\u957f|longer|shorter|length)/i.test(
      prompt,
    )
  ) {
    return 'length'
  }
  if (/(\u53d8\u5bbd|\u66f4\u5bbd|\u7a84\u4e00\u70b9|wider|narrower|width)/i.test(prompt)) {
    return 'width'
  }
  if (/(\u53d8\u9ad8|\u66f4\u9ad8|\u9ad8\u4e00\u70b9|taller|higher|height)/i.test(prompt)) {
    return 'height'
  }
  if (/(\u53d8\u539a|\u66f4\u539a|\u53d8\u8584|thicker|thinner|thickness)/i.test(prompt)) {
    return 'thickness'
  }
  if (/(\u76f4\u5f84|\u534a\u5f84|diameter|radius)/i.test(prompt)) return 'diameter'
  const hinted = normalizeDimension(editableHints(node)?.primaryDimension)
  if (hinted) return hinted
  const role = `${node?.metadata?.semanticRole ?? ''} ${node?.name ?? ''}`.toLowerCase()
  if (/blade|叶片|桨叶/.test(role)) return 'length'
  return 'uniform'
}

export function resolveSelectionGeometryFactor(prompt: string) {
  const percent = /(\d+(?:\.\d+)?)\s*%/.exec(prompt)
  const numericPercent = percent ? Number(percent[1]) : Number.NaN
  const shrink =
    /(\u7f29\u5c0f|\u5c0f\u4e00\u70b9|\u53d8\u5c0f|\u53d8\u8584|shorter|smaller|shrink|narrower|thinner)/i.test(
      prompt,
    )
  if (Number.isFinite(numericPercent) && numericPercent > 0) {
    return shrink ? Math.max(0.1, 1 - numericPercent / 100) : 1 + numericPercent / 100
  }
  if (/(\u4e00\u500d|double|twice)/i.test(prompt)) return shrink ? 0.5 : 2
  if (/(\u4e00\u70b9|slightly|little|bit)/i.test(prompt)) return shrink ? 0.88 : 1.15
  return shrink ? 0.8 : 1.25
}

function clampFactorForNode(node: FactorySelectionNodeSnapshot, factor: number) {
  const hints = editableHints(node)
  const min = finiteNumber(hints?.minFactor) ?? 0.2
  const max = finiteNumber(hints?.maxFactor) ?? 4
  return Math.max(min, Math.min(max, factor))
}

function scaled(value: number | undefined, factor: number) {
  return value == null ? undefined : Math.max(0.001, value * factor)
}

function scaleVector(value: [number, number, number] | undefined, factor: number) {
  const base = value ?? [1, 1, 1]
  return [base[0] * factor, base[1] * factor, base[2] * factor] as [number, number, number]
}

function geometryScalePatch(
  node: FactorySelectionNodeSnapshot,
  dimension: EditableDimension,
  factor: number,
) {
  const patch: Record<string, unknown> = {}
  const apply = (field: keyof FactorySelectionNodeSnapshot) => {
    const next = scaled(node[field] as number | undefined, factor)
    if (next != null) patch[field] = next
  }

  switch (dimension) {
    case 'length':
      if (node.length != null) apply('length')
      else if (
        node.height != null &&
        ['cylinder', 'cone', 'frustum', 'capsule', 'half-cylinder'].includes(node.type)
      ) {
        apply('height')
      }
      break
    case 'width':
      if (node.width != null) apply('width')
      else if (node.radius != null) apply('radius')
      break
    case 'height':
      if (node.height != null) apply('height')
      else patch.scale = scaleVector(node.scale, factor)
      break
    case 'depth':
      if (node.depth != null) apply('depth')
      else if (node.width != null) apply('width')
      break
    case 'thickness':
      if (node.thickness != null) apply('thickness')
      else if (node.tubeRadius != null) apply('tubeRadius')
      else if (node.height != null) apply('height')
      break
    case 'radius':
      if (node.radius != null) apply('radius')
      else if (node.majorRadius != null) apply('majorRadius')
      break
    case 'diameter':
      if (node.radius != null) apply('radius')
      if (node.majorRadius != null) apply('majorRadius')
      if (node.tubeRadius != null && node.type === 'torus') apply('tubeRadius')
      break
    case 'majorRadius':
      if (node.majorRadius != null) apply('majorRadius')
      else if (node.radius != null) apply('radius')
      break
    case 'tubeRadius':
      if (node.tubeRadius != null) apply('tubeRadius')
      else if (node.thickness != null) apply('thickness')
      break
    default:
      if (node.length != null) apply('length')
      if (node.width != null) apply('width')
      if (node.height != null) apply('height')
      if (node.depth != null) apply('depth')
      if (node.thickness != null) apply('thickness')
      if (node.radius != null) apply('radius')
      if (node.majorRadius != null) apply('majorRadius')
      if (node.tubeRadius != null) apply('tubeRadius')
      if (!Object.keys(patch).length) patch.scale = scaleVector(node.scale, factor)
      break
  }

  return Object.keys(patch).length ? patch : null
}

function isGeneratedSubpartNode(node: FactorySelectionNodeSnapshot) {
  return Boolean(node.metadata?.generatedShape) || GENERATED_PRIMITIVE_NODE_TYPES.has(node.type)
}

function generatedSubpartSearchText(node: FactorySelectionNodeSnapshot) {
  const generatedShape = recordValue(node.metadata?.generatedShape)
  const selector = recordValue(generatedShape?.selector)
  return [
    node.name,
    node.type,
    node.kind,
    node.metadata?.semanticRole,
    node.metadata?.semanticGroup,
    node.metadata?.sourcePartKind,
    node.metadata?.sourcePartId,
    generatedShape?.label,
    selector?.semanticRole,
    selector?.semanticGroup,
    selector?.sourcePartKind,
    selector?.sourcePartId,
  ]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase()
}

function filterGeometryCandidatesByPrompt(
  prompt: string,
  candidates: FactorySelectionNodeSnapshot[],
) {
  const filters: RegExp[] = []
  if (/(\u6868\u53f6|\u53f6\u7247|\bblade\b|\bfan\s*blade\b)/i.test(prompt)) {
    filters.push(/blade|fan_blade|\u6868\u53f6|\u53f6\u7247/i)
  }

  if (!filters.length) return candidates
  const narrowed = candidates.filter((node) => {
    const text = generatedSubpartSearchText(node)
    return filters.some((filter) => filter.test(text))
  })
  return narrowed.length ? narrowed : candidates
}

function rootOrNamedSubpartTargets(snapshot: FactorySelectionSnapshot, prompt: string) {
  const expanded = expandedEditableNodes(snapshot).filter(isGeneratedSubpartNode)
  const narrowed = filterGeometryCandidatesByPrompt(prompt, expanded)
  if (expanded.length > 0 && narrowed.length > 0 && narrowed.length < expanded.length) {
    return narrowed
  }
  return selectedRootNodes(snapshot)
}

const CHINESE_NUMBER: Record<string, number> = {
  \u96f6: 0,
  \u4e00: 1,
  \u4e8c: 2,
  \u4e24: 2,
  \u4e09: 3,
  \u56db: 4,
  \u4e94: 5,
  \u516d: 6,
  \u4e03: 7,
  \u516b: 8,
  \u4e5d: 9,
  \u5341: 10,
}

const ENGLISH_NUMBER: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
}

function parsedLevelCountToken(value: string | undefined): number | undefined {
  if (!value) return undefined
  if (/^\d+$/.test(value)) return Number(value)
  return CHINESE_NUMBER[value] ?? ENGLISH_NUMBER[value.toLowerCase()]
}

function requestedTowerLevelCount(prompt: string): number | undefined {
  const targetPatterns = [
    /(?:\u6539\u6210|\u53d8\u6210|\u8bbe\u6210|\u8c03\u6210|to|into|set\s+to)\s*(\d+|[\u96f6\u4e00\u4e8c\u4e24\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341]|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:\u5c42|levels?|storeys?|stories?)/i,
    /(\d+|[\u96f6\u4e00\u4e8c\u4e24\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341]|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:\u5c42|levels?|storeys?|stories?)/i,
  ]
  for (const pattern of targetPatterns) {
    const match = pattern.exec(prompt)
    const count = parsedLevelCountToken(match?.[1])
    if (count != null && count >= 2 && count <= 9) return count
  }
  return undefined
}

function looksLikeTowerCraneLevelEdit(prompt: string) {
  return (
    requestedTowerLevelCount(prompt) != null &&
    /(\u5854\u540a|\u67b6\u5b50|\u4e0b\u65b9\u7684\u67b6\u5b50|tower[_\s-]?crane|crane|mast|frame|levels?|storeys?|stories?)/i.test(
      prompt,
    )
  )
}

function nodeSearchText(node: FactorySelectionNodeSnapshot | undefined) {
  if (!node) return ''
  return [
    node.id,
    node.type,
    node.name,
    node.kind,
    node.metadata?.semanticRole,
    node.metadata?.semanticGroup,
    node.metadata?.sourcePartKind,
    node.metadata?.sourcePartId,
    recordValue(node.metadata?.generatedShape)?.label,
    recordValue(recordValue(node.metadata?.generatedShape)?.selector)?.semanticRole,
    recordValue(recordValue(node.metadata?.generatedShape)?.selector)?.sourcePartKind,
    recordValue(recordValue(node.metadata?.generatedShape)?.selector)?.sourcePartId,
  ]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase()
}

function descendantIds(snapshot: FactorySelectionSnapshot, rootId: string) {
  const byId = new Map(snapshot.nodes.map((node) => [node.id, node]))
  const ids: string[] = []
  const visit = (id: string, visiting = new Set<string>()) => {
    if (visiting.has(id)) return
    const node = byId.get(id)
    if (!node) return
    const nextVisiting = new Set(visiting).add(id)
    for (const childId of node.children ?? []) {
      visit(childId, nextVisiting)
      ids.push(childId)
    }
  }
  visit(rootId)
  return ids
}

function assemblyRootForSelection(snapshot: FactorySelectionSnapshot) {
  const byId = new Map(snapshot.nodes.map((node) => [node.id, node]))
  for (const selectedId of snapshot.selectedIds) {
    let node = byId.get(selectedId)
    const seen = new Set<string>()
    while (node && !seen.has(node.id)) {
      seen.add(node.id)
      if (node.type === 'assembly') return node
      node = typeof node.parentId === 'string' ? byId.get(node.parentId) : undefined
    }
  }
  return selectedRootNodes(snapshot).find((node) => node.type === 'assembly')
}

function selectionLooksLikeTowerCrane(snapshot: FactorySelectionSnapshot) {
  const text = snapshot.nodes.map(nodeSearchText).join(' ')
  return (
    /tower_crane|hammerhead|tower_mast|tower_column|tower_beam|structural_tower_frame|\btower\b/.test(
      text,
    ) && /main_jib|counter_jib|jib|wire_rope|hook_block|slewing/.test(text)
  )
}

function towerRouteArgsWithLevelCount(levelCount: number) {
  const route = precisionPartDeterministicRoute('generate a construction tower crane', null)
  if (!route) return undefined
  const args = structuredClone(route.args) as Record<string, unknown>
  const parts = Array.isArray(args.parts) ? (args.parts as Array<Record<string, unknown>>) : []
  const mast = parts.find((part) => part.id === 'tower_mast')
  if (!mast) return undefined
  mast.levelCount = levelCount
  return args
}

export function composeSelectionTowerLevelEdit(input: {
  prompt: string
  context?: unknown
}): FactorySelectionEditResult | null {
  if (!looksLikeTowerCraneLevelEdit(input.prompt)) return null
  const snapshot = selectionSnapshotFromContext(input.context)
  if (!snapshot?.selectedIds.length) {
    return {
      patches: [],
      nodeIds: [],
      changed: [],
      missingReason:
        'No canvas object is selected. Select a generated tower crane assembly before changing its frame levels.',
    }
  }
  if (!selectionLooksLikeTowerCrane(snapshot)) return null
  const root = assemblyRootForSelection(snapshot)
  if (!root) {
    return {
      patches: [],
      nodeIds: [],
      changed: [],
      missingReason: 'The selected tower crane root assembly could not be found.',
    }
  }
  const levelCount = requestedTowerLevelCount(input.prompt)
  const args = levelCount == null ? undefined : towerRouteArgsWithLevelCount(levelCount)
  if (!args || levelCount == null) {
    return {
      patches: [],
      nodeIds: [],
      changed: [],
      missingReason: 'The requested tower crane level count could not be resolved.',
    }
  }

  const geometry = executeGeometryToolCall('compose_parts', args, {
    prompt: input.prompt,
  })
  if (!geometry.artifact) {
    return {
      patches: [],
      nodeIds: [],
      changed: [],
      missingReason: geometry.content || 'Regenerating the tower crane did not produce geometry.',
    }
  }
  const replacement = buildGeneratedGeometryCreatePatches(geometry.artifact, {
    parentId: root.parentId,
    position: root.position,
    rotation: root.rotation,
    generatedBy: 'factory-agent',
    metadata: {
      replacedNodeId: root.id,
      editKind: 'tower_crane_level_count',
      levelCount,
    },
  })
  const deleteIds = [...descendantIds(snapshot, root.id), root.id]
  const deletePatches = deleteIds.map((id) => ({ op: 'delete' as const, id }))
  const patches: FactorySceneEditPatch[] = [...deletePatches, ...replacement.patches]

  return {
    patches,
    nodeIds: [...deleteIds, ...replacement.nodeIds],
    changed: [root.name ?? root.id],
    summary: [`${nodeLabel(root, root.id)}: tower mast levels -> ${levelCount}`],
  }
}

export function composeSelectionGeometryEdit(input: {
  prompt: string
  context?: unknown
}): FactorySelectionEditResult | null {
  if (!looksLikeSelectionGeometryEdit(input.prompt)) return null
  const snapshot = selectionSnapshotFromContext(input.context)
  if (!snapshot?.selectedIds.length) {
    return {
      patches: [],
      nodeIds: [],
      changed: [],
      missingReason:
        'No canvas object is selected. Select a generated subpart or assembly before asking for a geometry edit.',
    }
  }

  const candidates = filterGeometryCandidatesByPrompt(
    input.prompt,
    expandedEditableNodes(snapshot).filter(isGeneratedSubpartNode),
  )
  if (!candidates.length) {
    return {
      patches: [],
      nodeIds: [],
      changed: [],
      missingReason: 'The selected object has no editable generated geometry subparts.',
    }
  }

  const factor = resolveSelectionGeometryFactor(input.prompt)
  const patches = candidates.flatMap((node) => {
    const dimension = resolveSelectionGeometryDimension(input.prompt, node)
    const data = geometryScalePatch(node, dimension, clampFactorForNode(node, factor))
    return data ? [{ op: 'update' as const, id: node.id, data }] : []
  })

  if (!patches.length) {
    return {
      patches: [],
      nodeIds: [],
      changed: [],
      missingReason: 'The selected generated subpart does not expose an editable dimension.',
    }
  }

  return {
    patches,
    nodeIds: patches.map((patch) => patch.id),
    changed: patches.map(
      (patch) => snapshot.nodes.find((node) => node.id === patch.id)?.name ?? patch.id,
    ),
    summary: summarizeSelectionPatches(snapshot, patches),
  }
}

export function looksLikeSelectionMoveEdit(prompt: string) {
  return /(\u5f80|\u5411|\u79fb\u52a8|\u632a|move|shift).*(\u5de6|\u53f3|\u524d|\u540e|\u4e0a|\u4e0b|left|right|forward|front|back|backward|up|down)|(\u5de6\u79fb|\u53f3\u79fb|\u524d\u79fb|\u540e\u79fb|\u4e0a\u79fb|\u4e0b\u79fb)/i.test(
    prompt,
  )
}

function parseDistance(prompt: string, fallback = 0.5) {
  const match = /(\d+(?:\.\d+)?)\s*(cm|厘米|m|米)?/i.exec(prompt)
  if (!match) return /(\u4e00\u70b9|slightly|little|bit)/i.test(prompt) ? 0.25 : fallback
  const value = Number(match[1])
  if (!Number.isFinite(value)) return fallback
  const unit = match[2]?.toLowerCase()
  return unit === 'cm' || unit === '\u5398\u7c73' ? value / 100 : value
}

function addVec3(
  value: [number, number, number] | undefined,
  delta: [number, number, number],
): [number, number, number] {
  const base = value ?? [0, 0, 0]
  return [base[0] + delta[0], base[1] + delta[1], base[2] + delta[2]]
}

function resolveMoveDelta(prompt: string): [number, number, number] | undefined {
  const distance = parseDistance(prompt)
  if (/(\u5de6|left)/i.test(prompt)) return [-distance, 0, 0]
  if (/(\u53f3|right)/i.test(prompt)) return [distance, 0, 0]
  if (/(\u4e0a|up)/i.test(prompt)) return [0, distance, 0]
  if (/(\u4e0b|down)/i.test(prompt)) return [0, -distance, 0]
  if (/(\u524d|forward|front)/i.test(prompt)) return [0, 0, distance]
  if (/(\u540e|back|backward)/i.test(prompt)) return [0, 0, -distance]
  return undefined
}

export function composeSelectionMoveEdit(input: {
  prompt: string
  context?: unknown
}): FactorySelectionEditResult | null {
  if (!looksLikeSelectionMoveEdit(input.prompt)) return null
  const snapshot = selectionSnapshotFromContext(input.context)
  if (!snapshot?.selectedIds.length) {
    return {
      patches: [],
      nodeIds: [],
      changed: [],
      missingReason: 'No canvas object is selected. Select an object before asking to move it.',
    }
  }

  const delta = resolveMoveDelta(input.prompt)
  if (!delta) {
    return {
      patches: [],
      nodeIds: [],
      changed: [],
      missingReason: 'No movement direction was recognized.',
    }
  }

  const candidates = rootOrNamedSubpartTargets(snapshot, input.prompt)
  const patches = candidates.map((node) => ({
    op: 'update' as const,
    id: node.id,
    data: { position: addVec3(node.position, delta) },
  }))

  return {
    patches,
    nodeIds: patches.map((patch) => patch.id),
    changed: patches.map(
      (patch) => snapshot.nodes.find((node) => node.id === patch.id)?.name ?? patch.id,
    ),
    summary: summarizeSelectionPatches(snapshot, patches),
  }
}

export function looksLikeSelectionRotateEdit(prompt: string) {
  return /(\u65cb\u8f6c|\u8f6c\s*\d|\u8f6c\u4e00\u4e0b|rotate|turn)/i.test(prompt)
}

function resolveRotationAxisIndex(prompt: string) {
  if (/(\bx\b|x\s*axis|x\u8f74)/i.test(prompt)) return 0
  if (/(\bz\b|z\s*axis|z\u8f74)/i.test(prompt)) return 2
  return 1
}

function resolveRotationRadians(prompt: string) {
  const match = /(-?\d+(?:\.\d+)?)\s*(?:\u5ea6|deg|degree|degrees|\u00b0)?/i.exec(prompt)
  const degrees = match ? Number(match[1]) : 90
  const signedDegrees = /(\u987a\u65f6\u9488|clockwise)/i.test(prompt)
    ? -Math.abs(degrees)
    : degrees
  return (signedDegrees * Math.PI) / 180
}

function addRotation(
  value: [number, number, number] | undefined,
  axisIndex: number,
  radians: number,
): [number, number, number] {
  const next: [number, number, number] = [...(value ?? [0, 0, 0])] as [number, number, number]
  next[axisIndex] = (next[axisIndex] ?? 0) + radians
  return next
}

export function composeSelectionRotateEdit(input: {
  prompt: string
  context?: unknown
}): FactorySelectionEditResult | null {
  if (!looksLikeSelectionRotateEdit(input.prompt)) return null
  const snapshot = selectionSnapshotFromContext(input.context)
  if (!snapshot?.selectedIds.length) {
    return {
      patches: [],
      nodeIds: [],
      changed: [],
      missingReason: 'No canvas object is selected. Select an object before asking to rotate it.',
    }
  }

  const axisIndex = resolveRotationAxisIndex(input.prompt)
  const radians = resolveRotationRadians(input.prompt)
  const candidates = rootOrNamedSubpartTargets(snapshot, input.prompt)
  const patches = candidates.map((node) => ({
    op: 'update' as const,
    id: node.id,
    data: { rotation: addRotation(node.rotation, axisIndex, radians) },
  }))

  return {
    patches,
    nodeIds: patches.map((patch) => patch.id),
    changed: patches.map(
      (patch) => snapshot.nodes.find((node) => node.id === patch.id)?.name ?? patch.id,
    ),
    summary: summarizeSelectionPatches(snapshot, patches),
  }
}

export function looksLikeSelectionDeleteEdit(prompt: string) {
  return /(\u5220\u9664|\u5220\u6389|\u53bb\u6389|\u79fb\u9664|delete|remove)/i.test(prompt)
}

export function composeSelectionDeleteEdit(input: {
  prompt: string
  context?: unknown
}): FactorySelectionEditResult | null {
  if (!looksLikeSelectionDeleteEdit(input.prompt)) return null
  const snapshot = selectionSnapshotFromContext(input.context)
  if (!snapshot?.selectedIds.length) {
    return {
      patches: [],
      nodeIds: [],
      changed: [],
      missingReason: 'No canvas object is selected. Select an object before asking to delete it.',
    }
  }

  const candidates = rootOrNamedSubpartTargets(snapshot, input.prompt)
  const patches = candidates.map((node) => ({ op: 'delete' as const, id: node.id }))

  return {
    patches,
    nodeIds: patches.map((patch) => patch.id),
    changed: patches.map(
      (patch) => snapshot.nodes.find((node) => node.id === patch.id)?.name ?? patch.id,
    ),
    summary: summarizeSelectionPatches(snapshot, patches),
  }
}

export function resolveSelectionReplacement(prompt: string) {
  if (!/(\u6539\u6210|\u6362\u6210|\u66ff\u6362|replace|change.*to|switch.*to)/i.test(prompt)) {
    return undefined
  }
  if (/(\u5939\u722a|gripper|claw)/i.test(prompt))
    return { target: 'end_effector', kind: 'gripper' }
  if (/(\u5438\u76d8|suction|vacuum)/i.test(prompt)) {
    return { target: 'end_effector', kind: 'suction' }
  }
  if (/(\u6cd5\u5170|tool\s*flange|flange)/i.test(prompt)) {
    return { target: 'end_effector', kind: 'tool-flange' }
  }
  return undefined
}

function endEffectorCandidates(snapshot: FactorySelectionSnapshot) {
  const expanded = expandedEditableNodes(snapshot)
  const matched = expanded.filter((node) =>
    /end_effector|tool_flange|gripper|finger|\u672b\u7aef|\u5939\u722a/i.test(
      generatedSubpartSearchText(node),
    ),
  )
  return matched.length ? matched : selectedRootNodes(snapshot)
}

export function composeSelectionReplaceEdit(input: {
  prompt: string
  context?: unknown
}): FactorySelectionEditResult | null {
  const replacement = resolveSelectionReplacement(input.prompt)
  if (!replacement) return null
  const snapshot = selectionSnapshotFromContext(input.context)
  if (!snapshot?.selectedIds.length) {
    return {
      patches: [],
      nodeIds: [],
      changed: [],
      missingReason:
        'No canvas object is selected. Select an object before asking to replace a part.',
    }
  }

  const candidates =
    replacement.target === 'end_effector'
      ? endEffectorCandidates(snapshot)
      : selectedRootNodes(snapshot)
  const patches = candidates.map((node) => ({
    op: 'update' as const,
    id: node.id,
    data: {
      metadata: {
        ...(node.metadata ?? {}),
        editableOverride: {
          ...(recordValue(node.metadata?.editableOverride) ?? {}),
          endEffector: replacement.kind,
        },
        endEffectorKind: replacement.kind,
      },
    },
  }))

  return {
    patches,
    nodeIds: patches.map((patch) => patch.id),
    changed: patches.map(
      (patch) => snapshot.nodes.find((node) => node.id === patch.id)?.name ?? patch.id,
    ),
    summary: summarizeSelectionPatches(snapshot, patches),
  }
}

export function composeSelectionColorEdit(input: {
  prompt: string
  context?: unknown
}): FactorySelectionEditResult | null {
  if (!looksLikeSelectionColorEdit(input.prompt)) return null
  const snapshot = selectionSnapshotFromContext(input.context)
  if (!snapshot?.selectedIds.length) {
    return {
      patches: [],
      nodeIds: [],
      changed: [],
      missingReason:
        'No canvas object is selected. Select an object or assembly before asking for a color edit.',
    }
  }

  const candidates = expandedEditableNodes(snapshot)
  const color = resolveSelectionEditColor(input.prompt, candidates)
  const patches = candidates.flatMap((node) => {
    const data = updateDataForNode(node, color)
    return data ? [{ op: 'update' as const, id: node.id, data }] : []
  })

  if (!patches.length) {
    return {
      patches: [],
      nodeIds: [],
      changed: [],
      missingReason: 'The selected object has no editable color or material surface.',
    }
  }

  return {
    patches,
    nodeIds: patches.map((patch) => patch.id),
    changed: patches.map(
      (patch) => snapshot.nodes.find((node) => node.id === patch.id)?.name ?? patch.id,
    ),
    summary: summarizeSelectionPatches(snapshot, patches),
  }
}

export function composeSelectionTankKindEdit(input: {
  prompt: string
  context?: unknown
}): FactorySelectionEditResult | null {
  const kind = resolveSelectionTankKind(input.prompt)
  if (!kind) return null
  const snapshot = selectionSnapshotFromContext(input.context)
  if (!snapshot?.selectedIds.length) {
    return {
      patches: [],
      nodeIds: [],
      changed: [],
      missingReason:
        'No canvas object is selected. Select a tank or tank assembly before asking for a tank shape edit.',
    }
  }

  const candidates = expandedEditableNodes(snapshot).filter((node) => node.type === 'tank')
  if (!candidates.length) {
    return {
      patches: [],
      nodeIds: [],
      changed: [],
      missingReason: 'The selected object does not contain an editable tank node.',
    }
  }

  const patches = candidates
    .filter((node) => node.kind !== kind)
    .map((node) => ({
      op: 'update' as const,
      id: node.id,
      data: { kind },
    }))

  if (!patches.length) {
    return {
      patches: [],
      nodeIds: [],
      changed: [],
      missingReason: `The selected tank is already ${kind}.`,
    }
  }

  return {
    patches,
    nodeIds: patches.map((patch) => patch.id),
    changed: patches.map(
      (patch) => snapshot.nodes.find((node) => node.id === patch.id)?.name ?? patch.id,
    ),
    summary: summarizeSelectionPatches(snapshot, patches),
  }
}

export function composeSelectionEdit(input: {
  prompt: string
  context?: unknown
}): FactorySelectionEditResult | null {
  return (
    composeSelectionDeleteEdit(input) ??
    composeSelectionMoveEdit(input) ??
    composeSelectionRotateEdit(input) ??
    composeSelectionColorEdit(input) ??
    composeSelectionTankKindEdit(input) ??
    composeSelectionTowerLevelEdit(input) ??
    composeSelectionGeometryEdit(input) ??
    composeSelectionReplaceEdit(input)
  )
}
