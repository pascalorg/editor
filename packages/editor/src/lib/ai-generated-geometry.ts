import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'
import useViewer from '@pascal-app/viewer/store'
import useEditor from '../store/use-editor'
import { readAssetSourceContract, type AssetSourceContract } from './asset-source-contract'
import type { GeneratedGeometryArtifact } from './ai-generated-geometry-core'
import {
  buildGeneratedGeometryCreatePatches,
  markGeneratedPlacementDraft,
} from './ai-generated-geometry-nodes'

export {
  computeGeneratedAssemblyPosition,
  createGeneratedGeometryId,
  formatGeneratedShapeDetails,
  type GeneratedGeometryArtifact,
  type GeneratedGeometryShapeSpec,
  inferGeneratedAssemblyName,
  normalizePrimitiveKind,
} from './ai-generated-geometry-core'

export {
  buildGeneratedGeometryCreatePatches,
  buildGeneratedGeometryNodes,
  clampD,
  clampR,
  markGeneratedPlacementDraft,
  toAssemblyLocalPosition,
  type GeneratedGeometryCreatePatch,
  type GeneratedGeometryPatchPlan,
  type GeneratedGeometryPlacementSpec,
} from './ai-generated-geometry-nodes'


export const AI_GEOMETRY_ASSETS_STORAGE_KEY = 'pascal.ai.geometryAssets'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isGeneratedGeometryArtifact(value: unknown): value is GeneratedGeometryArtifact {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.sourceTool === 'string' &&
    isRecord(value.sourceArgs) &&
    Array.isArray(value.shapes) &&
    Array.isArray(value.transforms) &&
    Array.isArray(value.createdNames) &&
    Array.isArray(value.assemblyPosition)
  )
}

export function readSavedGeneratedGeometryArtifacts() {
  if (typeof window === 'undefined') return [] as GeneratedGeometryArtifact[]
  try {
    const raw = window.localStorage.getItem(AI_GEOMETRY_ASSETS_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter(isGeneratedGeometryArtifact) : []
  } catch {
    return []
  }
}

function writeSavedGeneratedGeometryArtifacts(entries: GeneratedGeometryArtifact[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(AI_GEOMETRY_ASSETS_STORAGE_KEY, JSON.stringify(entries))
  window.dispatchEvent(new Event('ai-geometry-assets:updated'))
}

export function removeGeneratedGeometryArtifactFromLocalLibrary(artifactId: string) {
  const next = readSavedGeneratedGeometryArtifacts().filter(
    (artifact) => artifact.id !== artifactId,
  )
  writeSavedGeneratedGeometryArtifacts(next)
}

function replacementAssetSourceFromScene(nodeIds: string[]): AssetSourceContract | undefined {
  const nodes = useScene.getState().nodes
  for (const id of nodeIds) {
    const source = readAssetSourceContract(nodes[id as AnyNodeId]?.metadata)
    if (source && source.kind !== 'ai-geometry') return source
  }
  return undefined
}

export function replaceGeneratedGeometryArtifactOnCanvas(artifact: GeneratedGeometryArtifact) {
  const scene = useScene.getState()
  const idsToReplace = (artifact.replaceNodeIds ?? [])
    .filter((id) => Boolean(scene.nodes[id as AnyNodeId]))
    .map((id) => id as AnyNodeId)
  const assetSource = replacementAssetSourceFromScene(idsToReplace)

  if (idsToReplace.length > 0) scene.deleteNodes(idsToReplace)
  return placeGeneratedGeometryArtifact(artifact, { assetSource })
}

export function shouldUseRevisionContext(text: string, artifact: GeneratedGeometryArtifact | null) {
  if (!artifact) return false
  const normalized = text.toLowerCase()
  const revisionTerms = [
    '\u4fee\u6539',
    '\u8c03\u6574',
    '\u6539',
    '\u589e\u52a0',
    '\u5220\u9664',
    '\u51cf\u5c11',
    '\u4e0d\u6ee1\u610f',
    '\u66f4',
    '\u518d',
    '放大',
    '变大',
    '加大',
    '扩大',
    '调大',
    '改大',
    '缩小',
    '变小',
    '调小',
    '改小',
    '太小',
    '太大',
    '看不清',
    '看不到',
    '不清楚',
    '缩放',
    '几倍',
    '五倍',
    '倍',
    '直径',
    '半径',
    '\u4e1d\u6ed1',
    '\u987a\u6ed1',
    '\u5706\u6da6',
    '\u6d41\u7ebf',
    '\u5e73\u6ed1',
    '不像',
    '不对',
    '不好看',
    '分开',
    '脱离',
    '贴合',
    '比例',
    '车顶',
    '窗户',
    '座舱',
    '车厢',
    'smooth',
    'smoother',
    'sleek',
    'rounded',
    'change',
    'modify',
    'adjust',
    'add',
    'remove',
    'replace',
    'larger',
    'smaller',
    'wider',
    'taller',
  ]
  return revisionTerms.some((term) => normalized.includes(term))
}

export function summarizeGeneratedGeometryArtifactForRevision(artifact: GeneratedGeometryArtifact) {
  const roles = new Map<string, number>()
  const sourceKinds = new Map<string, number>()
  const materialColors = new Set<string>()
  for (const shape of artifact.shapes) {
    if (shape.semanticRole) roles.set(shape.semanticRole, (roles.get(shape.semanticRole) ?? 0) + 1)
    if (shape.sourcePartKind) {
      sourceKinds.set(shape.sourcePartKind, (sourceKinds.get(shape.sourcePartKind) ?? 0) + 1)
    }
    const color = shape.material?.properties?.color
    if (color) materialColors.add(color)
  }

  const roleSummary = [...roles.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([role, count]) => `${role}:${count}`)
    .join(', ')
  const sourceSummary = [...sourceKinds.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([kind, count]) => `${kind}:${count}`)
    .join(', ')
  const recentEdits = artifact.editHistory
    ?.slice(-4)
    .map(
      (edit, index) => `${index + 1}. ${edit.intent ?? edit.feedback ?? edit.summary ?? edit.tool}`,
    )
    .join('\n')
  const keyShapes = artifact.shapes
    .filter((shape, index) => {
      const role = shape.semanticRole ?? ''
      return (
        index < 12 ||
        /body|cabin|roof|window|glass|pillar|tire|wheel|headlight|bumper/.test(role) ||
        /body|cabin|roof|window|glass|pillar|tire|wheel|headlight|bumper/i.test(shape.name ?? '')
      )
    })
    .slice(0, 24)
    .map((shape, index) => {
      const dims = [
        shape.length != null ? `l=${shape.length}` : undefined,
        shape.width != null ? `w=${shape.width}` : undefined,
        shape.height != null ? `h=${shape.height}` : undefined,
        shape.thickness != null ? `t=${shape.thickness}` : undefined,
        shape.radius != null ? `r=${shape.radius}` : undefined,
        shape.majorRadius != null ? `R=${shape.majorRadius}` : undefined,
      ]
        .filter(Boolean)
        .join(',')
      const color = shape.material?.properties?.color
      return `${index + 1}. ${shape.name ?? shape.kind} kind=${shape.kind}${
        shape.semanticRole ? ` role=${shape.semanticRole}` : ''
      }${shape.sourcePartKind ? ` source=${shape.sourcePartKind}` : ''} pos=[${shape.position.join(
        ',',
      )}]${dims ? ` ${dims}` : ''}${color ? ` color=${color}` : ''}`
    })
    .join('\n')

  return [
    `- id: ${artifact.id}`,
    `- title: ${artifact.title}`,
    `- version: ${artifact.version}`,
    `- original prompt: ${artifact.userPrompt}`,
    `- source tool: ${artifact.sourceTool}`,
    `- shape count: ${artifact.shapes.length}`,
    roleSummary ? `- semantic roles: ${roleSummary}` : undefined,
    sourceSummary ? `- source part kinds: ${sourceSummary}` : undefined,
    materialColors.size ? `- visible colors: ${[...materialColors].join(', ')}` : undefined,
    artifact.geometryBrief?.category ? `- category: ${artifact.geometryBrief.category}` : undefined,
    artifact.semanticSummary ? `- semantic validation: ${artifact.semanticSummary}` : undefined,
    artifact.visualQualitySummary
      ? `- visual quality: ${artifact.visualQualitySummary}`
      : undefined,
    recentEdits ? `- recent edit history:\n${recentEdits}` : undefined,
    `- key shape summary:\n${keyShapes}`,
  ]
    .filter(Boolean)
    .join('\n')
}

function truncateForPrompt(value: string, maxLength: number) {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}\n...<truncated ${value.length - maxLength} chars>`
}

export function buildRevisionContext(artifact: GeneratedGeometryArtifact, userRequest: string) {
  return [
    'The user is asking to revise the previous generated geometry.',
    'Prefer revise_geometry for local feedback so the previous model is patched instead of regenerated.',
    'Use compose_recipe/compose_parts/compose_primitive only when the user asks for a completely new object or the patch cannot preserve the current artifact.',
    'In revise_geometry, preserve user-approved traits such as body color, wheels, scale, and existing semantic roles unless the feedback explicitly changes them.',
    `Modification request: ${userRequest}`,
    '',
    'Previous generated geometry summary:',
    summarizeGeneratedGeometryArtifactForRevision(artifact),
    '',
    `Previous normalized tool arguments JSON (truncated):\n${truncateForPrompt(JSON.stringify(artifact.sourceArgs), 1200)}`,
  ].join('\n')
}


function beginGeneratedGeometryPlacement(root: AnyNode) {
  const editor = useEditor.getState()
  useViewer.getState().setSelection({ selectedIds: [] })
  editor.setPhase('structure')
  editor.setStructureLayer('elements')
  editor.setMode('select')
  editor.setMovingNode(root as never)
}

type PlaceGeneratedGeometryOptions = {
  startPlacement?: boolean
  assetSource?: AssetSourceContract
}

export function placeGeneratedGeometryArtifact(
  artifact: GeneratedGeometryArtifact,
  options: PlaceGeneratedGeometryOptions = {},
) {
  const levelId = useViewer.getState().selection.levelId
  const plan = buildGeneratedGeometryCreatePatches(artifact, {
    parentId: levelId ?? undefined,
    generatedBy: 'ai-chat',
    assetSource: options.assetSource,
  })
  if (!plan.patches.length || !plan.rootNode) return { nodeIds: [] as string[], created: plan.created }

  const scene = useScene.getState()
  const rootId = plan.rootNode.id
  const patches = options.startPlacement
    ? plan.patches.map((patch) =>
        patch.node.id === rootId
          ? { ...patch, node: markGeneratedPlacementDraft(patch.node) }
          : patch,
      )
    : plan.patches

  for (const patch of patches) {
    scene.createNode(patch.node, patch.parentId)
  }

  const placedRoot = patches.find((patch) => patch.node.id === rootId)?.node ?? plan.rootNode
  if (options.startPlacement) {
    beginGeneratedGeometryPlacement(placedRoot)
  } else {
    useViewer.getState().setSelection({ selectedIds: [rootId] })
  }
  return { nodeIds: plan.nodeIds, created: plan.created }
}

export function saveGeneratedGeometryArtifactToLocalLibrary(artifact: GeneratedGeometryArtifact) {
  const savedAt = new Date().toISOString()
  const entry = { ...artifact, savedAt }
  const entries = readSavedGeneratedGeometryArtifacts()
  writeSavedGeneratedGeometryArtifacts([
    entry,
    ...entries.filter((item) => item.id !== artifact.id),
  ])
  return savedAt
}
